import { scoped } from "@/lib/db/tenant";
import { StaleTurnError, captureTurnToken, isTurnCurrent } from "@/server/ai/turn-safety";
import { recordDelivery, invalidateDeliveries, type DeliveryMetadata } from "@/server/sales/delivery-ledger";
import { bindOutboundWamid } from "@/server/inbox/status";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { graphRequest, MetaApiError } from "@/lib/meta/client";
import { resolveMessageAddress, type MessageAddress } from "@/server/whatsapp/addressing";
import { publishMessageNew } from "@/server/events/message-new";
import {
  getCredentialsByOrg,
  markReconnectRequired,
  type Credentials,
} from "@/server/whatsapp/credentials";
import { isWindowOpen } from "@/server/inbox/window";
import { serializeMessage } from "@/server/inbox/ingest";
import {
  saveMediaFile,
  uploadGraphMedia,
  validateOutgoing,
  type FileMediaKind,
} from "@/server/whatsapp/media";
import { cancelFollowUpsOnManualReply } from "@/server/sales/follow-ups/store";
import {
  bestEffortAttention,
  markAttentionWaitingClient,
} from "@/server/inbox/attention";

/** Error tipado del envío; `code` mapea a HTTP en la capa de API. */
export class SendError extends Error {
  code:
    | "sandbox_violation"
    | "not_connected"
    | "reconnect_required"
    | "window_closed"
    | "meta_error"
    | "meta_unavailable"
    | "upload_failed";
  /** 008: presente cuando el fallo ocurrió TRAS persistir el mensaje (failed). */
  messageId?: string;

  constructor(code: SendError["code"], message: string) {
    super(message);
    this.name = "SendError";
    this.code = code;
  }
}

type SendResult = { messageId: string };
export { StaleTurnError } from "@/server/ai/turn-safety";
export type AutomaticSendOptions = {
  aiGenerated?: boolean;
  deliveryMetadata?: DeliveryMetadata;
  preSendGuard?: () => Promise<boolean>;
};
export async function ensureAutomaticSendCurrent(input: AutomaticSendOptions & { organizationId: string; conversationId: string }): Promise<void> {
  if (input.aiGenerated && !input.deliveryMetadata) {
    const token = await captureTurnToken(input.organizationId, input.conversationId);
    if (!token) throw new StaleTurnError();
    input.deliveryMetadata = { token };
  }
  if (input.deliveryMetadata && !await isTurnCurrent(input.deliveryMetadata.token)) throw new StaleTurnError();
  if (input.preSendGuard && !await input.preSendGuard()) throw new StaleTurnError();
}

type SendTarget = {
  conversation: typeof schema.conversation.$inferSelect;
  credentials: Credentials;
  recipient: MessageAddress;
};

/**
 * Pre-flight común de todo envío por la conversación (008): existencia +
 * tenant, sandbox del Laboratorio (ASERCIÓN DURA, FR-031: jamás toca la API
 * real), ventana de 24 h, credenciales y destinatario.
 */
async function prepareSend(
  conversationId: string,
  organizationId: string
): Promise<SendTarget> {
  const db = getDb();
  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const row = rows[0];
  if (!row || row.conversation.organizationId !== organizationId) {
    throw new SendError("meta_error", "Conversación no encontrada");
  }

  if (row.conversation.isTest) {
    throw new SendError(
      "sandbox_violation",
      "Conversación de prueba del Laboratorio: el envío real está prohibido"
    );
  }

  if (!isWindowOpen(row.conversation.lastInboundAt)) {
    throw new SendError(
      "window_closed",
      "La ventana de 24 horas está cerrada; usa una plantilla aprobada"
    );
  }

  const credentials = await getCredentialsByOrg(organizationId);
  if (!credentials) {
    throw new SendError("not_connected", "No hay número de WhatsApp conectado");
  }
  if (credentials.status === "reconnect_required") {
    throw new SendError(
      "reconnect_required",
      "El token de WhatsApp expiró: reconecta el número en Configuración"
    );
  }

  const recipient = resolveMessageAddress(row.contact);
  if (!recipient) {
    throw new SendError(
      "meta_error",
      "El contacto no tiene teléfono ni identidad de WhatsApp utilizable"
    );
  }

  return { conversation: row.conversation, credentials, recipient };
}

export async function persistOutbound(input: {
  organizationId: string;
  conversationId: string;
  waMessageId: string | null;
  type: string;
  text: string | null;
  status: "pending" | "failed";
  error?: string | null;
  aiGenerated?: boolean;
  origin: "ai" | "operator" | "template";
  deliveryMetadata?: DeliveryMetadata;
  mediaAssetId?: string | null;
  media?: typeof schema.mediaAsset.$inferSelect | null;
}): Promise<string> {
  const db = getDb();
  const message = await db.transaction(async tx => {
    const [inserted] = await tx.insert(schema.message).values({
      id: newId("message"), organizationId: input.organizationId, conversationId: input.conversationId,
      waMessageId: input.waMessageId, direction: "out", type: input.type, text: input.text,
      status: input.status, error: input.error ?? null, aiGenerated: input.aiGenerated ?? false,
      origin: input.origin, mediaAssetId: input.mediaAssetId ?? null,
    }).returning();
    if (!inserted) throw new Error("outbound_insert_failed");
    if (input.deliveryMetadata) await recordDelivery(tx, inserted.id, input.deliveryMetadata);
    await tx.update(schema.conversation).set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(scoped(schema.conversation.organizationId, input.organizationId, eq(schema.conversation.id, input.conversationId)));
    return inserted;
  });
  await publishMessageNew({ organizationId: input.organizationId, conversationId: input.conversationId,
    message: serializeMessage(message, input.media ?? null) });
  return message.id;
}

export async function finalizeAcceptedOutbound(input: { organizationId: string; conversationId: string; messageId: string; waMessageId: string; aiGenerated?: boolean }): Promise<void> {
  await bindOutboundWamid(input.organizationId, input.messageId, input.waMessageId);
  if (!input.aiGenerated) {
    await invalidateDeliveries(input.organizationId, input.conversationId);
    await cancelFollowUpsOnManualReply({ organizationId: input.organizationId, conversationId: input.conversationId });
    await bestEffortAttention(`outbound del operador ${input.conversationId}`, () =>
      markAttentionWaitingClient({ organizationId: input.organizationId, conversationId: input.conversationId }));
  }
}

export async function failPersistedOutbound(organizationId: string, messageId: string, err: unknown): Promise<void> {
  await getDb().update(schema.message).set({ status: "failed", error: err instanceof SendError ? err.message : "No se pudo completar el envío a WhatsApp" })
    .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.id, messageId), eq(schema.message.status, "pending")));
}

/** Envía un mensaje de texto libre por WhatsApp. */
export async function sendText(input: {
  conversationId: string; organizationId: string; text: string;
} & AutomaticSendOptions): Promise<SendResult> {
  const { credentials, recipient } = await prepareSend(input.conversationId, input.organizationId);
  await ensureAutomaticSendCurrent(input);
  const messageId = await persistOutbound({ ...input, waMessageId: null, type: "text", text: input.text,
    status: "pending", origin: input.aiGenerated ? "ai" : "operator" });
  try {
    await ensureAutomaticSendCurrent(input);
    const waMessageId = await callGraphSend(credentials, { messaging_product: "whatsapp", ...recipient,
      type: "text", text: { body: input.text } });
    await finalizeAcceptedOutbound({ ...input, messageId, waMessageId });
    return { messageId };
  } catch (err) {
    await failPersistedOutbound(input.organizationId, messageId, err);
    if (err instanceof SendError) err.messageId = messageId;
    throw err;
  }
}

/**
 * 008 — Envía un adjunto de archivo (imagen/video/audio/documento).
 * El archivo queda ANTES en el volumen local (fuente durable de la preview);
 * si Graph falla tras eso, el mensaje se persiste `failed` (visible en el
 * hilo, nunca se pierde en silencio) y el SendError lleva `messageId`.
 *
 * 004 — Acepta un override opcional `kind` (typed contract) para que el
 * cliente pueda forzar `document` cuando el archivo cruza el límite de su
 * tipo nativo (típico: video > 16 MB). Cuando el override es a `document`,
 * la subida a Graph y el `mimeType` persistido usan `application/octet-stream`
 * para esquivar el chequeo de tamaño del tipo nativo en la Cloud API; el
 * `fileName` original se conserva en el payload y en `mediaAsset.fileName`.
 */
export async function sendMediaMessage(input: {
  conversationId: string;
  organizationId: string;
  file: { data: Buffer; mimeType: string; fileName?: string };
  caption?: string;
  /** Default operador compatible; IA no cancela seguimientos manualmente. */
  aiGenerated?: boolean;
  /** Override tipado del kind (ver `validateOutgoing` para constraints). */
  kind?: FileMediaKind;
  deliveryMetadata?: DeliveryMetadata;
  preSendGuard?: () => Promise<boolean>;
}): Promise<SendResult> {
  // Validación previa (FR-007): tipo y tamaño antes de tocar disco o red.
  // El override (typed contract) decide qué límites aplicar; el servidor
  // no se basa en faking del MIME para aceptar el archivo.
  const kind = validateOutgoing(input.file.mimeType, input.file.data.byteLength, {
    kind: input.kind,
  });

  // Cuando el cliente forza `document` (caso video grande) subimos y
  // persistimos como application/octet-stream: el binario real viaja intacto,
  // pero la metadata declara "documento genérico" para no activar el chequeo
  // de tipo nativo de la Cloud API. El nombre original va en el payload.
  const isKindOverridden = Boolean(input.kind && input.kind === "document");
  const uploadFile = isKindOverridden
    ? {
        ...input.file,
        mimeType: "application/octet-stream",
      }
    : input.file;

  const { credentials, recipient } = await prepareSend(
    input.conversationId,
    input.organizationId
  );

  await ensureAutomaticSendCurrent(input);

  const db = getDb();
  const assetId = newId("mediaAsset");
  const storagePath = await saveMediaFile(
    input.organizationId,
    assetId,
    input.file.data
  );
  const assetRows = await db
    .insert(schema.mediaAsset)
    .values({
      id: assetId,
      organizationId: input.organizationId,
      kind,
      mimeType: isKindOverridden ? "application/octet-stream" : input.file.mimeType,
      fileName: input.file.fileName ?? null,
      fileSize: input.file.data.byteLength,
      caption: input.caption ?? null,
      storagePath,
      fetchStatus: "available",
    })
    .returning();
  const asset = assetRows[0]!;

  const messageId = await persistOutbound({ ...input, waMessageId: null, type: kind, text: null,
    status: "pending", origin: input.aiGenerated ? "ai" : "operator", mediaAssetId: assetId, media: asset });
  try {
    await ensureAutomaticSendCurrent(input);
    const waMediaId = await uploadGraphMedia(credentials, uploadFile);
    await db
      .update(schema.mediaAsset)
      .set({ waMediaId, updatedAt: new Date() })
      .where(eq(schema.mediaAsset.id, assetId));

    // Upload may take seconds: validate inbound + permissions AFTER upload.
    await ensureAutomaticSendCurrent(input);
    const mediaPayload: Record<string, unknown> = { id: waMediaId };
    if (input.caption && kind !== "audio") mediaPayload.caption = input.caption;
    if (kind === "document" && input.file.fileName) {
      mediaPayload.filename = input.file.fileName;
    }
    const waMessageId = await callGraphSend(credentials, {
      messaging_product: "whatsapp",
      ...recipient,
      type: kind,
      [kind]: mediaPayload,
    });

    await finalizeAcceptedOutbound({ ...input, messageId, waMessageId });
    return { messageId };
  } catch (err) {
    let sendErr: SendError;
    if (err instanceof SendError) {
      sendErr = err;
    } else if (err instanceof MetaApiError && err.isAuthError) {
      // Mismo criterio que el texto: SOLO 401/código 190 (fix 2026-08-04).
      await markReconnectRequired(input.organizationId);
      sendErr = new SendError(
        "reconnect_required",
        "El token de WhatsApp expiró: reconecta el número en Configuración"
      );
    } else {
      sendErr = new SendError(
        "upload_failed",
        "No se pudo subir el adjunto a WhatsApp"
      );
    }
    await failPersistedOutbound(input.organizationId, messageId, sendErr);
    sendErr.messageId = messageId;
    if (err instanceof StaleTurnError) throw err;
    throw sendErr;
  }
}

export type LocationInput = {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
};

export type ContactInput = { name: string; phone: string };

/** 008 — Envía una ubicación o contactos (payload estructurado, sin archivo). */
export async function sendStructured(
  input: {
    conversationId: string;
    organizationId: string;
  } & (
    | { kind: "location"; location: LocationInput }
    | { kind: "contacts"; contacts: ContactInput[] }
  )
): Promise<SendResult> {
  const { credentials, recipient } = await prepareSend(
    input.conversationId,
    input.organizationId
  );

  const payload =
    input.kind === "location"
      ? { type: "location", location: input.location }
      : {
          type: "contacts",
          contacts: input.contacts.map((c) => ({
            name: { formatted_name: c.name, first_name: c.name },
            phones: [{ phone: c.phone, type: "CELL" }],
          })),
        };

  const db = getDb();
  const assetRows = await db
    .insert(schema.mediaAsset)
    .values({
      id: newId("mediaAsset"),
      organizationId: input.organizationId,
      kind: input.kind,
      payload: input.kind === "location" ? input.location : input.contacts,
      fetchStatus: "available",
    })
    .returning();
  const asset = assetRows[0]!;

  const messageId = await persistOutbound({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    waMessageId: null,
    type: input.kind,
    text: null,
    status: "pending",
    origin: "operator",
    mediaAssetId: asset.id,
    media: asset,
  });
  try {
  const waMessageId = await callGraphSend(credentials, {
    messaging_product: "whatsapp",
    ...recipient,
    ...payload,
  });

    await finalizeAcceptedOutbound({ ...input, messageId, waMessageId });
  } catch (err) {
    await failPersistedOutbound(input.organizationId, messageId, err);
    if (err instanceof SendError) err.messageId = messageId;
    throw err;
  }
  return { messageId };
}

/** Llama a Graph /messages y traduce errores de Meta a SendError. */
export async function callGraphSend(
  credentials: Credentials,
  payload: unknown
): Promise<string> {
  try {
    const res = await graphRequest<{ messages?: { id: string }[] }>(
      `${credentials.phoneNumberId}/messages`,
      { method: "POST", token: credentials.token, body: payload }
    );
    const id = res.messages?.[0]?.id;
    if (!id) throw new SendError("meta_error", "Meta no devolvió ID de mensaje");
    return id;
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markReconnectRequired(credentials.organizationId);
        throw new SendError(
          "reconnect_required",
          "El token de WhatsApp expiró: reconecta el número en Configuración"
        );
      }
      if (err.status === 0 || err.status >= 500) {
        throw new SendError("meta_unavailable", "Meta no está disponible ahora");
      }
      throw new SendError("meta_error", err.message);
    }
    throw err;
  }
}
