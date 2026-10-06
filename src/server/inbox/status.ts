import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { describeSendError } from "@/lib/meta/send-errors";
import { publish } from "@/server/events/bus";
import { reconcileDeliveryEffects } from "@/server/sales/delivery-ledger";
import { bestEffortAttention, markAttentionPending } from "@/server/inbox/attention";
import type { WebhookStatus } from "@/server/inbox/webhook";

const STATUS_RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };
type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";
export function isUpgrade(current: string, next: string): boolean {
  if (current === "failed") return false;
  if (next === "failed") return true;
  const c = STATUS_RANK[current], n = STATUS_RANK[next];
  return c !== undefined && n !== undefined && n > c;
}

export async function applyStatusUpdate(organizationId: string, status: WebhookStatus): Promise<void> {
  if (!(status.status in STATUS_RANK) || status.status === "pending") {
    if (status.status !== "failed") return;
  }
  const failure = status.errors?.[0];
  const error = status.status === "failed" ? describeSendError(failure?.code, failure?.message ?? failure?.title) : null;
  // Record even when no message is bound yet. A webhook that beats the Graph
  // HTTP response is replayed durably once bindOutboundWamid runs.
  await getDb().insert(schema.waStatusReceipt).values({ id: newId("waStatusReceipt"), organizationId,
    waMessageId: status.id, status: status.status, error,
  }).onConflictDoNothing({ target: [schema.waStatusReceipt.organizationId,
    schema.waStatusReceipt.waMessageId, schema.waStatusReceipt.status] }).returning();
  await reconcileOutboundStatus(organizationId, status.id);
}

export async function reconcileOutboundStatus(organizationId: string, waMessageId: string): Promise<void> {
  const db = getDb();
  const [initial] = await db.select().from(schema.message).where(scoped(
    schema.message.organizationId, organizationId, eq(schema.message.waMessageId, waMessageId)
  )).limit(1);
  if (!initial) return;
  const result = await db.transaction(async tx => {
    // Same lock order as inbound/decision/manual invalidation. Serialize all
    // duplicate or reversed statuses before effects and their scheduling.
    await tx.select({ id: schema.conversation.id }).from(schema.conversation).where(scoped(
      schema.conversation.organizationId, organizationId, eq(schema.conversation.id, initial.conversationId)
    )).for("update");
    const [msg] = await tx.select().from(schema.message).where(scoped(
      schema.message.organizationId, organizationId, eq(schema.message.id, initial.id)
    )).for("update");
    if (!msg) return null;
    const receipts = await tx.select().from(schema.waStatusReceipt).where(scoped(
      schema.waStatusReceipt.organizationId, organizationId, eq(schema.waStatusReceipt.waMessageId, waMessageId)
    )).orderBy(desc(schema.waStatusReceipt.createdAt));
    const failed = receipts.find(r => r.status === "failed");
    const next = failed ? "failed" : receipts.reduce<string>((best, r) =>
      (STATUS_RANK[r.status] ?? -1) > (STATUS_RANK[best] ?? -1) ? r.status : best, msg.status);
    if (!receipts.length) return null;
    if (isUpgrade(msg.status, next)) await tx.update(schema.message).set({ status: next as MessageStatus, error: failed?.error ?? null })
      .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.id, msg.id)));
    // Reconciliation is independent of display rank: a read-before-sent event
    // must still authorize exactly once, and failed never authorizes again.
    const effects = await reconcileDeliveryEffects(tx, organizationId, msg.id,
      msg.status === "failed" ? "failed" : next, new Date());
    if (effects.handoff) {
      const now = new Date();
      await tx.update(schema.conversation).set({ handoffAt: now, handoffReason: "delivery_failed", updatedAt: now })
        .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, msg.conversationId)));
      const [conv] = await tx.select().from(schema.conversation).where(scoped(
        schema.conversation.organizationId, organizationId, eq(schema.conversation.id, msg.conversationId)
      )).limit(1);
      if (conv) await tx.update(schema.lead).set({ automationLane: "human", nextFollowUpAt: null, updatedAt: now })
        .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.contactId, conv.contactId)));
      await tx.update(schema.salesFollowUpJob).set({ status: "cancelled", error: "delivery_failed", claimedAt: null, updatedAt: now })
        .where(scoped(schema.salesFollowUpJob.organizationId, organizationId,
          eq(schema.salesFollowUpJob.conversationId, msg.conversationId),
          // only live jobs; independent historical facts remain untouched
          inArray(schema.salesFollowUpJob.status, ["pending", "processing"])));
    }
    return { conversationId: msg.conversationId, messageId: msg.id,
      status: msg.status === "failed" ? "failed" : next, error: failed?.error ?? msg.error, handoff: effects.handoff };
  });
  if (!result) return;
  if (result.handoff) {
    await bestEffortAttention(`failed ${result.conversationId}`, () => markAttentionPending({ organizationId, conversationId: result.conversationId }));
    publish(organizationId, { type: "conversation.updated", data: { conversation: { id: result.conversationId } } });
  }
  publish(organizationId, { type: "message.status", data: result });
}

/** Wamid binding never resets a terminal/confirmed state. */
export async function bindOutboundWamid(organizationId: string, messageId: string, waMessageId: string): Promise<void> {
  await getDb().update(schema.message).set({ waMessageId }).where(scoped(
    schema.message.organizationId, organizationId, eq(schema.message.id, messageId)
  ));
  await reconcileOutboundStatus(organizationId, waMessageId);
}
