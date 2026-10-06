import { isTurnCurrent, type TurnToken } from "@/server/ai/turn-safety";
import type { DeliveryMetadata } from "@/server/sales/delivery-ledger";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { publish } from "@/server/events/bus";
import { StaleTurnError, SendError, sendText, sendMediaMessage } from "@/server/inbox/send";
import { bestEffortAttention, markAttentionPending } from "@/server/inbox/attention";

import { scoped } from "@/lib/db/tenant";
import { saveMediaFile, deleteMediaFile } from "@/server/whatsapp/media";

type Conversation = typeof schema.conversation.$inferSelect;

export type HandoffReasonCode =
  | "cliente"
  | "modelo"
  | "error"
  | "ventana"
  | "commercial"
  | "unsupported_media"
  | "duplicate_demo"
  | "delivery_failed";

/**
 * Entrega la respuesta: envío real o persistencia sandbox (`is_test`).
 * Devuelve false si no se envió (p. ej. ventana cerrada).
 */
export async function deliverReply(
  conversation: Conversation,
  text: string,
  metadata?: DeliveryMetadata
): Promise<boolean> {
  if (metadata && !await isTurnCurrent(metadata.token)) return false;
  if (conversation.isTest) {
    await persistTestOutbound(conversation, text);
    return true;
  }
  try {
    await sendText({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      text,
      aiGenerated: true,
      deliveryMetadata: metadata,
    });
    return true;
  } catch (err) {
    if (err instanceof StaleTurnError) return false;
    if (err instanceof SendError && err.code === "window_closed") {
      await applyHandoff(conversation.id, conversation.organizationId, "ventana");
      return false;
    }
    if (err instanceof SendError && err.code === "sandbox_violation") {
      return false;
    }
    if (!metadata || await isTurnCurrent(metadata.token)) await applyHandoff(conversation.id, conversation.organizationId, "delivery_failed");
    return false;
  }
}

/** Demo nativa: sandbox persiste antes de entrar al sender/red. Sin retry. */
export async function deliverDemo(
  conversation: Conversation,
  file: { data: Buffer; mimeType: string; fileName?: string },
  caption: string,
  metadata?: DeliveryMetadata
): Promise<boolean> {
  try {
    if (metadata && !await isTurnCurrent(metadata.token)) return false;
    if (conversation.isTest) {
      const assetId = newId("mediaAsset");
      try {
        const storagePath = await saveMediaFile(conversation.organizationId, assetId, file.data);
        if (metadata && !await isTurnCurrent(metadata.token)) return false;
        await getDb().transaction(async (tx) => {
          await tx.insert(schema.mediaAsset).values({
            id: assetId, organizationId: conversation.organizationId,
            kind: "video", mimeType: file.mimeType, fileName: file.fileName ?? null,
            fileSize: file.data.length, caption, storagePath, fetchStatus: "available",
            payload: { sandboxConversationId: conversation.id },
          });
          await tx.insert(schema.message).values({
            id: newId("message"), organizationId: conversation.organizationId,
            conversationId: conversation.id, direction: "out", type: "video",
            text: null, mediaAssetId: assetId, status: "sent", origin: "ai", aiGenerated: true,
          });
          await tx.update(schema.conversation).set({ lastMessageAt: new Date(), updatedAt: new Date() })
            .where(scoped(schema.conversation.organizationId, conversation.organizationId,
              eq(schema.conversation.id, conversation.id)));
        });
      } catch {
        // Un commit incierto no autoriza borrar un archivo posiblemente persistido.
        try {
          const rows = await getDb().select({ id: schema.mediaAsset.id }).from(schema.mediaAsset).where(
            scoped(schema.mediaAsset.organizationId, conversation.organizationId, eq(schema.mediaAsset.id, assetId))
          ).limit(1);
          if (!rows.length) await deleteMediaFile(conversation.organizationId, assetId);
        } catch { /* conservar ante incertidumbre de BD */ }
        return false;
      }
      return true;
    }
    await sendMediaMessage({
      conversationId: conversation.id, organizationId: conversation.organizationId,
      file, caption, aiGenerated: true, deliveryMetadata: metadata,
    });
    return true;
  } catch (err) {
    if (err instanceof StaleTurnError) return false;
    if (err instanceof SendError && err.code === "window_closed") {
      await applyHandoff(conversation.id, conversation.organizationId, "ventana");
    }
    if (!metadata || await isTurnCurrent(metadata.token)) await applyHandoff(conversation.id, conversation.organizationId, "delivery_failed");
    // No segundo mensaje ni reenvío: Graph pudo aceptar antes del fallo local.
    console.warn("[sales] entrega de demo no completada");
    return false;
  }
}

/** Mensaje saliente del sandbox: se persiste, JAMÁS toca la API (FR-031). */
async function persistTestOutbound(
  conversation: Conversation,
  text: string
): Promise<void> {
  const db = getDb();
  await db.insert(schema.message).values({
    id: newId("message"),
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    direction: "out",
    type: "text",
    text,
    status: "sent",
    aiGenerated: true,
    origin: "ai",
  });
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));
}

export async function applyHandoff(
  conversationId: string,
  organizationId: string,
  reason: HandoffReasonCode,
  preservePaymentGroupId?: string,
  token?: TurnToken
): Promise<void> {
  const db = getDb();
  const now = new Date();
  const updated = await db.transaction(async tx => {
    await tx.select({ id: schema.conversation.id }).from(schema.conversation).where(scoped(
      schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId))).for("update");
    if (token && !await isTurnCurrent(token, tx)) return [];
    if (preservePaymentGroupId) await tx.update(schema.salesOutboundDelivery).set({ expectedHandoffAt: now })
      .where(scoped(schema.salesOutboundDelivery.organizationId, organizationId,
        eq(schema.salesOutboundDelivery.conversationId, conversationId),
        eq(schema.salesOutboundDelivery.paymentGroupId, preservePaymentGroupId)));
    const changed = await tx.update(schema.conversation).set({ handoffAt: now, handoffReason: reason, updatedAt: now })
      .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId))).returning();
    if (!changed[0]) return changed;
    const ledgers = await tx.select().from(schema.salesOutboundDelivery).where(scoped(
      schema.salesOutboundDelivery.organizationId, organizationId, eq(schema.salesOutboundDelivery.conversationId, conversationId)));
    for (const ledger of ledgers) if (!preservePaymentGroupId || ledger.paymentGroupId !== preservePaymentGroupId) {
      await tx.update(schema.salesOutboundDelivery).set({ invalidatedAt: now }).where(scoped(
        schema.salesOutboundDelivery.organizationId, organizationId, eq(schema.salesOutboundDelivery.messageId, ledger.messageId)));
    }
    await tx.update(schema.salesFollowUpJob).set({ status: "cancelled", claimedAt: null, error: reason, updatedAt: now })
      .where(scoped(schema.salesFollowUpJob.organizationId, organizationId,
        eq(schema.salesFollowUpJob.conversationId, conversationId), inArray(schema.salesFollowUpJob.status, ["pending", "processing"])));
    const leadPatch: Partial<typeof schema.lead.$inferInsert> = { nextFollowUpAt: null, updatedAt: now };
    if (["unsupported_media", "duplicate_demo", "delivery_failed"].includes(reason)) leadPatch.automationLane = "human";
    await tx.update(schema.lead).set(leadPatch).where(scoped(schema.lead.organizationId, organizationId,
      eq(schema.lead.contactId, changed[0].contactId)));
    return changed;
  });
  if (!updated[0]) return;
  // 013 C1 - Punto ÚNICO de handoff IA -> humano: la conversación queda
  // esperando a Max ("pending"). Best-effort: si falla, el handoff sigue
  // siendo válido (plan §3.5, D-4). Las conversaciones del Laboratorio se
  // filtran dentro del módulo.
  await bestEffortAttention(`handoff ${conversationId}`, () =>
    markAttentionPending({ organizationId, conversationId })
  );
  publish(organizationId, {
    type: "conversation.updated",
    data: {
      conversation: { id: conversationId, handoffReason: reason },
    },
  });
}
