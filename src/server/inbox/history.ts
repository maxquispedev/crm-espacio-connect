import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { normalizeMx } from "@/lib/meta/client";
import { publish } from "@/server/events/bus";
import {
  attachMediaAsset,
  getOrCreateConversation,
  mediaInputFrom,
  type MediaInput,
} from "@/server/inbox/ingest";
import {
  getOrCreateContactByIdentity,
  type ResolvedIdentity,
} from "@/server/inbox/identity";
import type {
  WebhookMessage,
  WebhookValue,
} from "@/server/inbox/webhook";
import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";

/**
 * Ingesta de historial / agenda de coexistence.
 *
 * Camino SEPARADO de `processMessagesValue` / `processEchoesValue`: no dispara
 * agente, unread, handoff ni actividad de leads. Solo materializa
 * contactos/conversaciones/mensajes con su timestamp real.
 */

const HISTORY_TYPES = new Set([
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contacts",
  "media_placeholder",
]);

type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

const HISTORY_STATUS: Record<string, MessageStatus> = {
  PENDING: "pending",
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
  PLAYED: "read",
  ERROR: "failed",
};

type MessageRow = typeof schema.message.$inferSelect;

export type HistoryMessageInsert = {
  id: string;
  organizationId: string;
  conversationId: string;
  waMessageId: string;
  direction: "in" | "out";
  type: string;
  text: string | null;
  status: MessageStatus;
  origin: "ai" | "operator" | "manual" | "template";
  waTimestamp: Date;
  createdAt: Date;
};

export type HistoryStore = {
  findMessageByWaId(
    organizationId: string,
    waMessageId: string
  ): Promise<MessageRow | null>;
  insertMessage(row: HistoryMessageInsert): Promise<MessageRow | null>;
  updateMessage(
    id: string,
    patch: { type?: string; text?: string | null }
  ): Promise<void>;
  advanceConversationClock(input: {
    conversationId: string;
    waTimestamp: Date;
    direction: "in" | "out";
  }): Promise<void>;
};

export type HistoryIngestDeps = {
  getCredentialsByPhoneNumberId: typeof getCredentialsByPhoneNumberId;
  getOrCreateContactByIdentity: typeof getOrCreateContactByIdentity;
  getOrCreateConversation: typeof getOrCreateConversation;
  store: HistoryStore;
  attachMediaAsset: typeof attachMediaAsset;
  publish: typeof publish;
};

function defaultStore(): HistoryStore {
  return {
    async findMessageByWaId(organizationId, waMessageId) {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.message)
        .where(
          and(
            eq(schema.message.organizationId, organizationId),
            eq(schema.message.waMessageId, waMessageId)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async insertMessage(row) {
      const db = getDb();
      const inserted = await db
        .insert(schema.message)
        .values(row)
        .onConflictDoNothing({ target: [schema.message.waMessageId] })
        .returning();
      return inserted[0] ?? null;
    },
    async updateMessage(id, patch) {
      const db = getDb();
      await db
        .update(schema.message)
        .set(patch)
        .where(eq(schema.message.id, id));
    },
    async advanceConversationClock({ conversationId, waTimestamp, direction }) {
      const db = getDb();
      await db
        .update(schema.conversation)
        .set({
          lastMessageAt: sql`GREATEST(COALESCE(${schema.conversation.lastMessageAt}, ${waTimestamp}), ${waTimestamp})`,
          ...(direction === "in"
            ? {
                lastInboundAt: sql`GREATEST(COALESCE(${schema.conversation.lastInboundAt}, ${waTimestamp}), ${waTimestamp})`,
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.conversation.id, conversationId));
    },
  };
}

function defaultDeps(): HistoryIngestDeps {
  return {
    getCredentialsByPhoneNumberId,
    getOrCreateContactByIdentity,
    getOrCreateConversation,
    store: defaultStore(),
    attachMediaAsset,
    publish,
  };
}

/** Dígitos + normalización MX (521→52). Tolera "+52 55 …". */
export function normalizeWebhookPhone(raw: string): string {
  return normalizeMx(raw.replace(/\D/g, "") || raw);
}

/**
 * Unix epoch en segundos → Date. Null si el timestamp no es usable:
 * un fallback a "ahora" abriría la ventana 24 h y desordenaría el hilo.
 */
export function historyTimestampToDate(timestamp: string): Date | null {
  const n = Number(timestamp);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000);
}

export function mapHistoryStatus(
  raw: string | undefined,
  direction: "in" | "out"
): MessageStatus {
  if (raw) {
    const mapped = HISTORY_STATUS[raw.toUpperCase()];
    if (mapped) return mapped;
  }
  return direction === "in" ? "delivered" : "sent";
}

/**
 * Inbound = el lead escribió (`from` = thread). Outbound = el negocio
 * (`to` presente, o `from` = número del negocio).
 */
export function resolveHistoryDirection(
  msg: { from?: string; to?: string },
  threadId: string,
  businessPhone?: string | null
): "in" | "out" | null {
  const thread = normalizeWebhookPhone(threadId);
  const from = msg.from ? normalizeWebhookPhone(msg.from) : null;
  const to = msg.to ? normalizeWebhookPhone(msg.to) : null;
  const biz = businessPhone ? normalizeWebhookPhone(businessPhone) : null;

  if (to && to === thread) return "out";
  if (from && biz && from === biz) return "out";
  if (from && from === thread) return "in";
  if (from && from !== thread) return "out";
  return null;
}

/** True si `incoming` debe reemplazar `existing` (nunca retroceder). */
export function isNewerTimestamp(
  existing: Date | null | undefined,
  incoming: Date
): boolean {
  if (!existing) return true;
  return incoming.getTime() > existing.getTime();
}

export function isMediaPlaceholder(type: string): boolean {
  return type === "media_placeholder";
}

function contactNameFromSync(item: {
  full_name?: string;
  first_name?: string;
}): string | null {
  const full = item.full_name?.trim();
  if (full) return full;
  const first = item.first_name?.trim();
  return first || null;
}

function identityFromThreadPhone(phone: string): ResolvedIdentity {
  const normalized = normalizeWebhookPhone(phone);
  return {
    identity: normalized,
    phone: normalized,
    waUserId: null,
    profileName: null,
  };
}

/**
 * Procesa `field: "history"`. Un chunk malformado no tumba el resto.
 */
export async function processHistoryValue(
  value: WebhookValue,
  deps: HistoryIngestDeps = defaultDeps()
): Promise<void> {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return;

  const credentials = await deps.getCredentialsByPhoneNumberId(phoneNumberId);
  if (!credentials) {
    console.warn(
      `[history] evento para phone_number_id desconocido (${phoneNumberId}): descartado`
    );
    return;
  }

  const organizationId = credentials.organizationId;
  const businessPhone = value.metadata?.display_phone_number ?? null;

  for (const chunk of value.history ?? []) {
    if (chunk.errors?.length) {
      for (const err of chunk.errors) {
        console.warn(
          `[history] sync rechazado o fallido (code=${err.code ?? "?"}): ${err.title ?? err.message ?? "sin detalle"}`
        );
      }
      if (!chunk.threads?.length) continue;
    }

    for (const thread of chunk.threads ?? []) {
      if (!thread.id) {
        console.warn("[history] thread sin id: omitido");
        continue;
      }
      try {
        await ingestHistoryThread(
          {
            organizationId,
            threadId: thread.id,
            messages: thread.messages ?? [],
            businessPhone,
          },
          deps
        );
      } catch (err) {
        console.error(
          `[history] error procesando thread ${thread.id}:`,
          err
        );
      }
    }
  }
}

async function ingestHistoryThread(
  input: {
    organizationId: string;
    threadId: string;
    messages: WebhookMessage[];
    businessPhone: string | null;
  },
  deps: HistoryIngestDeps
): Promise<void> {
  const { contact } = await deps.getOrCreateContactByIdentity(
    input.organizationId,
    identityFromThreadPhone(input.threadId)
  );
  const conversation = await deps.getOrCreateConversation(
    input.organizationId,
    contact.id
  );

  let wrote = false;
  for (const msg of input.messages) {
    const changed = await ingestHistoryMessage(
      {
        organizationId: input.organizationId,
        conversationId: conversation.id,
        threadId: input.threadId,
        businessPhone: input.businessPhone,
        msg,
      },
      deps
    );
    if (changed) wrote = true;
  }

  if (wrote) {
    deps.publish(input.organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: conversation.id } },
    });
  }
}

async function ingestHistoryMessage(
  input: {
    organizationId: string;
    conversationId: string;
    threadId: string;
    businessPhone: string | null;
    msg: WebhookMessage;
  },
  deps: HistoryIngestDeps
): Promise<boolean> {
  const { msg } = input;
  if (!HISTORY_TYPES.has(msg.type)) return false;

  const waTimestamp = historyTimestampToDate(msg.timestamp);
  if (!waTimestamp) {
    console.warn(`[history] mensaje ${msg.id} sin timestamp usable: omitido`);
    return false;
  }

  const direction = resolveHistoryDirection(
    msg,
    input.threadId,
    input.businessPhone
  );
  if (!direction) {
    console.warn(`[history] mensaje ${msg.id} sin dirección resoluble: omitido`);
    return false;
  }

  const media: MediaInput | null = isMediaPlaceholder(msg.type)
    ? null
    : mediaInputFrom(msg);

  const existing = await deps.store.findMessageByWaId(
    input.organizationId,
    msg.id
  );
  if (existing) {
    return enrichExistingHistoryMessage(existing, msg, media, deps);
  }

  const inserted = await deps.store.insertMessage({
    id: newId("message"),
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    waMessageId: msg.id,
    direction,
    type: msg.type,
    text: msg.text?.body ?? null,
    status: mapHistoryStatus(msg.history_context?.status, direction),
    origin: direction === "out" ? "manual" : "operator",
    waTimestamp,
    createdAt: waTimestamp,
  });

  if (!inserted) {
    // Carrera: otro chunk insertó el mismo wamid. Enriquecer si aplica.
    const raced = await deps.store.findMessageByWaId(
      input.organizationId,
      msg.id
    );
    if (raced) return enrichExistingHistoryMessage(raced, msg, media, deps);
    return false;
  }

  if (media) {
    await deps.attachMediaAsset(input.organizationId, inserted.id, media);
  }

  await deps.store.advanceConversationClock({
    conversationId: input.conversationId,
    waTimestamp,
    direction,
  });
  return true;
}

/**
 * Mismo wamid: no duplicar. Si era placeholder y ahora hay media/tipo real,
 * se actualiza el registro existente.
 */
async function enrichExistingHistoryMessage(
  existing: MessageRow,
  msg: WebhookMessage,
  media: MediaInput | null,
  deps: HistoryIngestDeps
): Promise<boolean> {
  const nextType = isMediaPlaceholder(msg.type) ? existing.type : msg.type;
  const nextText = msg.text?.body ?? existing.text;
  const typeChanged =
    nextType !== existing.type && !isMediaPlaceholder(msg.type);
  const textChanged = nextText !== existing.text;

  if (typeChanged || textChanged) {
    await deps.store.updateMessage(existing.id, {
      ...(typeChanged ? { type: nextType } : {}),
      ...(textChanged ? { text: nextText } : {}),
    });
  }

  if (media && !existing.mediaAssetId) {
    await deps.attachMediaAsset(existing.organizationId, existing.id, media);
    return true;
  }
  return typeChanged || textChanged;
}

/**
 * Procesa `field: "smb_app_state_sync"`.
 * `add` crea/actualiza el contacto. `remove` NO borra nada del CRM.
 */
export async function processStateSyncValue(
  value: WebhookValue,
  deps: HistoryIngestDeps = defaultDeps()
): Promise<void> {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return;

  const credentials = await deps.getCredentialsByPhoneNumberId(phoneNumberId);
  if (!credentials) {
    console.warn(
      `[state-sync] evento para phone_number_id desconocido (${phoneNumberId}): descartado`
    );
    return;
  }

  for (const item of value.state_sync ?? []) {
    if (item.type && item.type !== "contact") continue;
    const action = (item.action ?? "add").toLowerCase();
    const phone = item.contact?.phone_number;
    if (!phone) {
      console.warn("[state-sync] contacto sin teléfono: omitido");
      continue;
    }

    if (action === "remove") {
      console.log(
        `[state-sync] remove ignorado para ${normalizeWebhookPhone(phone)} (no se borra del CRM)`
      );
      continue;
    }

    if (action !== "add") continue;

    try {
      const name = contactNameFromSync(item.contact ?? {});
      await deps.getOrCreateContactByIdentity(credentials.organizationId, {
        ...identityFromThreadPhone(phone),
        profileName: name,
      });
    } catch (err) {
      console.error(
        `[state-sync] error creando contacto ${phone}:`,
        err
      );
    }
  }
}
