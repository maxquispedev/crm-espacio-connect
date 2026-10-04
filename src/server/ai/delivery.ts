import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { publish } from "@/server/events/bus";
import { SendError, sendText, sendMediaMessage } from "@/server/inbox/send";

import { scoped } from "@/lib/db/tenant";
import { saveMediaFile, deleteMediaFile } from "@/server/whatsapp/media";

type Conversation = typeof schema.conversation.$inferSelect;

export type HandoffReasonCode =
  | "cliente"
  | "modelo"
  | "error"
  | "ventana"
  | "commercial";

/**
 * Entrega la respuesta: envío real o persistencia sandbox (`is_test`).
 * Devuelve false si no se envió (p. ej. ventana cerrada).
 */
export async function deliverReply(
  conversation: Conversation,
  text: string
): Promise<boolean> {
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
    });
    return true;
  } catch (err) {
    if (err instanceof SendError && err.code === "window_closed") {
      await applyHandoff(conversation.id, conversation.organizationId, "ventana");
      return false;
    }
    if (err instanceof SendError && err.code === "sandbox_violation") {
      return false;
    }
    throw err;
  }
}

/** Demo nativa: sandbox persiste antes de entrar al sender/red. Sin retry. */
export async function deliverDemo(
  conversation: Conversation,
  file: { data: Buffer; mimeType: string; fileName?: string },
  caption: string
): Promise<boolean> {
  try {
    if (conversation.isTest) {
      const assetId = newId("mediaAsset");
      try {
        const storagePath = await saveMediaFile(conversation.organizationId, assetId, file.data);
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
      file, caption, aiGenerated: true,
    });
    return true;
  } catch (err) {
    if (err instanceof SendError && err.code === "window_closed") {
      await applyHandoff(conversation.id, conversation.organizationId, "ventana");
    }
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
  reason: HandoffReasonCode
): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(schema.conversation)
    .set({ handoffAt: new Date(), handoffReason: reason, updatedAt: new Date() })
    .where(
      and(
        eq(schema.conversation.id, conversationId),
        eq(schema.conversation.organizationId, organizationId)
      )
    )
    .returning();
  if (!updated[0]) return;
  publish(organizationId, {
    type: "conversation.updated",
    data: {
      conversation: { id: conversationId, handoffReason: reason },
    },
  });
}
