import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { publish } from "@/server/events/bus";
import { SendError, sendText } from "@/server/inbox/send";

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
