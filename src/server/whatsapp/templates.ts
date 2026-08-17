import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { graphRequest, MetaApiError, normalizeRecipient } from "@/lib/meta/client";
import { scoped } from "@/lib/db/tenant";
import { publishMessageNew } from "@/server/events/message-new";
import {
  getCredentialsByOrg,
  getCredentialsByWabaId,
  markReconnectRequired,
} from "@/server/whatsapp/credentials";
import { callGraphSend, SendError } from "@/server/inbox/send";
import { serializeMessage } from "@/server/inbox/ingest";
import type { WebhookValue } from "@/server/inbox/webhook";
import {
  buildTemplateGraphMessage,
  countVariables,
  renderBody,
  resolveBodyValues,
  validateBodyVariables,
} from "@/lib/whatsapp/template-placeholders";

export {
  buildTemplateGraphMessage,
  buildTemplateSendComponents,
  countVariables,
  renderBody,
  resolveBodyValues,
  validateBodyVariables,
} from "@/lib/whatsapp/template-placeholders";

/** Errores tipados del servicio de plantillas → HTTP en la capa de API. */
export class TemplateError extends Error {
  code:
    | "not_connected"
    | "reconnect_required"
    | "invalid"
    | "not_found"
    | "meta_error"
    | "meta_unavailable";

  constructor(code: TemplateError["code"], message: string) {
    super(message);
    this.name = "TemplateError";
    this.code = code;
  }
}

const TEMPLATE_ERROR_STATUS: Record<TemplateError["code"], number> = {
  not_connected: 409,
  reconnect_required: 409,
  invalid: 422,
  not_found: 404,
  meta_error: 422,
  meta_unavailable: 503,
};

export function templateErrorStatus(err: TemplateError): number {
  return TEMPLATE_ERROR_STATUS[err.code];
}

type TemplateRow = typeof schema.template.$inferSelect;

export function serializeTemplate(t: TemplateRow) {
  return {
    id: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    body: t.body,
    status: t.status,
    rejectionReason: t.rejectionReason,
  };
}

/** Crea la plantilla y la manda a aprobación de Meta (FR-050). */
export async function createTemplate(
  organizationId: string,
  input: { name: string; language: string; category: string; body: string }
): Promise<TemplateRow> {
  const variableError = validateBodyVariables(input.body);
  if (variableError) throw new TemplateError("invalid", variableError);

  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) {
    throw new TemplateError("not_connected", "Conecta tu número de WhatsApp primero");
  }
  if (creds.status === "reconnect_required") {
    throw new TemplateError("reconnect_required", "Reconecta tu número antes de crear plantillas");
  }

  const name = input.name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  if (!name) throw new TemplateError("invalid", "Nombre de plantilla inválido");

  const variableCount = countVariables(input.body);
  const bodyExample =
    variableCount > 0
      ? {
          example: {
            body_text: [
              Array.from({ length: variableCount }, (_, i) =>
                variableCount === 1 ? "ejemplo" : `ejemplo${i + 1}`
              ),
            ],
          },
        }
      : {};
  let waTemplateId: string | null = null;
  try {
    const res = await graphRequest<{ id?: string; status?: string }>(
      `${creds.wabaId}/message_templates`,
      {
        method: "POST",
        token: creds.token,
        body: {
          name,
          language: input.language,
          category: input.category,
          components: [
            {
              type: "BODY",
              text: input.body,
              ...bodyExample,
            },
          ],
        },
      }
    );
    waTemplateId = res.id ?? null;
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markReconnectRequired(organizationId);
        throw new TemplateError("reconnect_required", "El token expiró: reconecta el número");
      }
      if (err.status === 0 || err.status >= 500) {
        throw new TemplateError("meta_unavailable", "Meta no está disponible ahora");
      }
      throw new TemplateError("meta_error", err.message);
    }
    throw err;
  }

  const db = getDb();
  const inserted = await db
    .insert(schema.template)
    .values({
      id: newId("template"),
      organizationId,
      name,
      language: input.language,
      category: input.category,
      body: input.body,
      status: "pending",
      waTemplateId,
    })
    .onConflictDoUpdate({
      target: [
        schema.template.organizationId,
        schema.template.name,
        schema.template.language,
      ],
      set: {
        category: input.category,
        body: input.body,
        status: "pending",
        rejectionReason: null,
        waTemplateId,
        updatedAt: new Date(),
      },
    })
    .returning();
  return inserted[0]!;
}

function mapMetaStatus(
  status: string | undefined
): TemplateRow["status"] | null {
  const s = (status ?? "").toUpperCase();
  if (s === "APPROVED") return "approved";
  if (s === "REJECTED") return "rejected";
  if (s === "PENDING" || s === "IN_APPEAL" || s === "PENDING_DELETION") {
    return "pending";
  }
  return null;
}

/** Subconjunto de `GET {waba}/message_templates` que usa el sync. */
export type RemoteMessageTemplate = {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  rejected_reason?: string | null;
  components?: unknown;
};

type LocalTemplateRef = Pick<
  TemplateRow,
  "id" | "name" | "language" | "category" | "status" | "waTemplateId" | "body"
>;

/**
 * Extrae el texto BODY de `components` de Graph. HEADER/BUTTONS se ignoran
 * (el schema local no los guarda). Acepta `BODY` o `body`.
 */
export function extractTemplateBody(components: unknown): string {
  if (!Array.isArray(components)) return "";
  for (const item of components) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { type?: unknown; text?: unknown };
    if (typeof rec.type === "string" && rec.type.toUpperCase() === "BODY") {
      return typeof rec.text === "string" ? rec.text : "";
    }
  }
  return "";
}

export type TemplateSyncPlan =
  | { kind: "ignore" }
  | {
      kind: "update";
      localId: string;
      status: TemplateRow["status"];
      category: string;
      rejectionReason: string | null;
      waTemplateId: string | null;
    }
  | {
      kind: "insert";
      name: string;
      language: string;
      category: string;
      body: string;
      status: TemplateRow["status"];
      waTemplateId: string | null;
      rejectionReason: string | null;
    };

function findLocalTemplate(
  local: readonly LocalTemplateRef[],
  remote: RemoteMessageTemplate
): LocalTemplateRef | undefined {
  if (remote.id) {
    const byWaId = local.find((t) => t.waTemplateId === remote.id);
    if (byWaId) return byWaId;
  }
  if (remote.name && remote.language) {
    return local.find(
      (t) => t.name === remote.name && t.language === remote.language
    );
  }
  return undefined;
}

/**
 * Decide update/insert/ignore para una plantilla remota contra las filas
 * YA CARGADAS de una sola organización (el caller aplica `scoped()`).
 */
export function planRemoteTemplateSync(
  local: readonly LocalTemplateRef[],
  remote: RemoteMessageTemplate
): TemplateSyncPlan {
  const status = mapMetaStatus(remote.status);
  if (!status) return { kind: "ignore" };

  const match = findLocalTemplate(local, remote);
  if (match) {
    const category = remote.category ?? match.category;
    if (match.status === status && match.category === category) {
      return { kind: "ignore" };
    }
    return {
      kind: "update",
      localId: match.id,
      status,
      category,
      rejectionReason: remote.rejected_reason ?? null,
      waTemplateId: match.waTemplateId ?? remote.id ?? null,
    };
  }

  const name = remote.name?.trim();
  const language = remote.language?.trim();
  if (!name || !language) return { kind: "ignore" };

  return {
    kind: "insert",
    name,
    language,
    category: remote.category ?? "UTILITY",
    body: extractTemplateBody(remote.components),
    status,
    waTemplateId: remote.id ?? null,
    rejectionReason: remote.rejected_reason ?? null,
  };
}

/**
 * Sincroniza estados desde Graph (`GET {waba}/message_templates`). Cubre el
 * modo agencia: los webhooks de plantillas NO siguen el override de callback,
 * así que el pull es la vía universal (DV-VC-04/DV-VC-15).
 *
 * Plantillas remotas sin fila local se importan (identidad
 * `organization + name + language`). HEADER/BUTTONS de Meta no se persisten.
 */
export async function syncTemplates(organizationId: string): Promise<number> {
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) {
    throw new TemplateError("not_connected", "Conecta tu número de WhatsApp primero");
  }

  let data: { data?: RemoteMessageTemplate[] };
  try {
    data = await graphRequest(
      `${creds.wabaId}/message_templates?fields=id,name,language,status,category,rejected_reason,components`,
      { token: creds.token }
    );
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markReconnectRequired(organizationId);
        throw new TemplateError("reconnect_required", "El token expiró: reconecta el número");
      }
      throw new TemplateError("meta_unavailable", "No se pudo consultar Meta");
    }
    throw err;
  }

  const db = getDb();
  const local = await db
    .select()
    .from(schema.template)
    .where(scoped(schema.template.organizationId, organizationId));
  const known: LocalTemplateRef[] = [...local];

  let updated = 0;
  for (const remote of data.data ?? []) {
    const plan = planRemoteTemplateSync(known, remote);
    if (plan.kind === "ignore") continue;

    if (plan.kind === "update") {
      await db
        .update(schema.template)
        .set({
          status: plan.status,
          category: plan.category,
          rejectionReason: plan.rejectionReason,
          waTemplateId: plan.waTemplateId,
          updatedAt: new Date(),
        })
        .where(eq(schema.template.id, plan.localId));
      const row = known.find((t) => t.id === plan.localId);
      if (row) {
        row.status = plan.status;
        row.category = plan.category;
        row.waTemplateId = plan.waTemplateId;
      }
      updated += 1;
      continue;
    }

    const inserted = await db
      .insert(schema.template)
      .values({
        id: newId("template"),
        organizationId,
        name: plan.name,
        language: plan.language,
        category: plan.category,
        body: plan.body,
        status: plan.status,
        rejectionReason: plan.rejectionReason,
        waTemplateId: plan.waTemplateId,
      })
      .onConflictDoNothing({
        target: [
          schema.template.organizationId,
          schema.template.name,
          schema.template.language,
        ],
      })
      .returning();
    const row = inserted[0];
    if (!row) continue;
    known.push(row);
    updated += 1;
  }
  return updated;
}

/** Evento webhook `message_template_status_update` (modo directo, FR-050). */
export async function applyTemplateStatusEvent(
  wabaId: string | null,
  value: WebhookValue
): Promise<void> {
  if (!wabaId) return;
  const creds = await getCredentialsByWabaId(wabaId);
  if (!creds) return;

  const status = mapMetaStatus(value.event);
  const name = value.message_template_name;
  const language = value.message_template_language;
  if (!status || !name || !language) return;

  const db = getDb();
  await db
    .update(schema.template)
    .set({
      status,
      rejectionReason: status === "rejected" ? (value.reason ?? null) : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.template.organizationId, creds.organizationId),
        eq(schema.template.name, name),
        eq(schema.template.language, language)
      )
    );
}

/** Envía una plantilla APROBADA a una conversación (ventana cerrada, FR-051). */
export async function sendTemplate(input: {
  organizationId: string;
  conversationId: string;
  templateId: string;
  /** Compat: valor de `{{1}}`. Se ignora si `variables` está definido. */
  variable?: string;
  /** Valores BODY en orden `{{1}}`…`{{n}}`. */
  variables?: string[];
  /** Sufijo del botón URL dinámico (componente `button` / `sub_type: url`). */
  urlButtonSuffix?: string;
}): Promise<{ messageId: string }> {
  const db = getDb();

  const templates = await db
    .select()
    .from(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        input.organizationId,
        eq(schema.template.id, input.templateId)
      )
    )
    .limit(1);
  const template = templates[0];
  if (!template) throw new TemplateError("not_found", "Plantilla no encontrada");
  if (template.status !== "approved") {
    throw new TemplateError("invalid", "Solo se pueden enviar plantillas aprobadas");
  }
  const placeholderError = validateBodyVariables(template.body);
  if (placeholderError) throw new TemplateError("invalid", placeholderError);
  const expectedCount = countVariables(template.body);
  const resolved = resolveBodyValues(expectedCount, input);
  if (!resolved.ok) throw new TemplateError("invalid", resolved.error);

  const rows = await db
    .select({ conversation: schema.conversation, contact: schema.contact })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      scoped(
        schema.conversation.organizationId,
        input.organizationId,
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new TemplateError("not_found", "Conversación no encontrada");
  if (row.conversation.isTest) {
    // Aserción dura del sandbox (FR-031)
    throw new SendError(
      "sandbox_violation",
      "Conversación de prueba del Laboratorio: el envío real está prohibido"
    );
  }

  const creds = await getCredentialsByOrg(input.organizationId);
  if (!creds) throw new TemplateError("not_connected", "Sin número conectado");
  if (creds.status === "reconnect_required") {
    throw new TemplateError("reconnect_required", "Reconecta el número");
  }

  // 003: destinatario = teléfono normalizado o BSUID.
  const templateRecipient = row.contact.phone
    ? normalizeRecipient(row.contact.phone)
    : row.contact.waUserId;
  if (!templateRecipient) {
    throw new TemplateError(
      "meta_error",
      "El contacto no tiene teléfono ni identidad de WhatsApp utilizable"
    );
  }

  const waMessageId = await callGraphSend(creds, {
    messaging_product: "whatsapp",
    to: templateRecipient,
    type: "template",
    template: buildTemplateGraphMessage({
      name: template.name,
      language: template.language,
      bodyValues: resolved.values,
      urlButtonSuffix: input.urlButtonSuffix,
    }),
  });

  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId,
      direction: "out",
      type: "template",
      text: renderBody(template.body, resolved.values),
      status: "pending",
      origin: "template",
    })
    .returning();
  const message = inserted[0]!;

  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, input.conversationId));

  await publishMessageNew({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    message: serializeMessage(message),
  });

  return { messageId: message.id };
}
