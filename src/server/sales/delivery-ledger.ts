import { eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { DemoResourceSlot } from "@/lib/commercial/resources";
import { isTurnCurrent, type SafetyDb, type TurnToken } from "@/server/ai/turn-safety";
import type { SalesPlan } from "@/server/sales/resolve-plan";
import { scheduleNextFollowUp, enqueueFollowUpAttempt } from "@/server/sales/follow-ups/store";
import { hasMoreCommercialAttempts } from "@/server/sales/follow-ups/policy";

export type DeliveryMetadata = {
  token: TurnToken;
  leadId?: string;
  plan?: SalesPlan;
  demoSlot?: DemoResourceSlot;
  /** Missing demo fallback must not authorize after_demo. */
  scheduleFollowUp?: boolean;
  payment?: { groupId: string; part: number; parts: number };
  followUpJobId?: string;
};
export type StoredPlan = { salesPlan?: SalesPlan; scheduleFollowUp: boolean; sales: boolean; allowClosedWindow: boolean };

export async function reserveDemoSlot(token: TurnToken, slot: DemoResourceSlot): Promise<boolean> {
  const rows = await getDb().insert(schema.salesDemoReservation).values({
    id: newId("salesDemoReservation"), organizationId: token.organizationId,
    conversationId: token.conversationId, slot, inboundMessageId: token.inboundMessageId,
  }).onConflictDoNothing({ target: [schema.salesDemoReservation.organizationId,
    schema.salesDemoReservation.conversationId, schema.salesDemoReservation.slot] }).returning();
  return rows.length === 1;
}

export async function recordDelivery(
  db: SafetyDb, messageId: string, metadata: DeliveryMetadata
): Promise<void> {
  await db.insert(schema.salesOutboundDelivery).values({
    messageId, organizationId: metadata.token.organizationId,
    conversationId: metadata.token.conversationId, leadId: metadata.leadId ?? null,
    inboundMessageId: metadata.token.inboundMessageId, manualMessageId: metadata.token.manualMessageId,
    plan: { salesPlan: metadata.plan, scheduleFollowUp: metadata.scheduleFollowUp === true,
      sales: metadata.token.sales === true, allowClosedWindow: metadata.token.allowClosedWindow === true } satisfies StoredPlan,
    demoSlot: metadata.demoSlot ?? null, paymentGroupId: metadata.payment?.groupId ?? null,
    paymentPart: metadata.payment?.part ?? null, paymentParts: metadata.payment?.parts ?? null,
    followUpJobId: metadata.followUpJobId ?? null,
  });
  if (metadata.followUpJobId) {
    // Once a durable outbound exists the claimed job cannot be reclaimed/retried.
    await db.update(schema.salesFollowUpJob).set({ messageId }).where(scoped(
      schema.salesFollowUpJob.organizationId, metadata.token.organizationId,
      eq(schema.salesFollowUpJob.id, metadata.followUpJobId), eq(schema.salesFollowUpJob.status, "processing")
    ));
  }
}

export async function invalidateDeliveries(organizationId: string, conversationId: string, db: SafetyDb = getDb()) {
  await db.update(schema.salesOutboundDelivery).set({ invalidatedAt: new Date() }).where(scoped(
    schema.salesOutboundDelivery.organizationId, organizationId,
    eq(schema.salesOutboundDelivery.conversationId, conversationId), isNull(schema.salesOutboundDelivery.invalidatedAt)
  ));
}

type Ledger = typeof schema.salesOutboundDelivery.$inferSelect;
const factKeys = ["demoShownAt", "pricePresentedAt", "paymentInstructionsSentAt"] as const;

/** Called under the conversation/message lock in the status transaction. */
export async function reconcileDeliveryEffects(db: SafetyDb, organizationId: string, messageId: string,
  status: string, now: Date): Promise<{ handoff: boolean }> {
  const [ledger] = await db.select().from(schema.salesOutboundDelivery).where(scoped(
    schema.salesOutboundDelivery.organizationId, organizationId, eq(schema.salesOutboundDelivery.messageId, messageId)
  )).limit(1);
  if (!ledger) return { handoff: false };
  const stored = ledger.plan as StoredPlan | null;
  const token: TurnToken = { organizationId, conversationId: ledger.conversationId,
    inboundMessageId: ledger.inboundMessageId, manualMessageId: ledger.manualMessageId,
    sales: stored?.sales, allowClosedWindow: true };
  if (status === "failed") {
    if (ledger.failedAt) return { handoff: false };
    await db.update(schema.salesOutboundDelivery).set({ failedAt: now }).where(scoped(
      schema.salesOutboundDelivery.organizationId, organizationId, eq(schema.salesOutboundDelivery.messageId, messageId)
    ));
    await revokeLinkedEffects(db, ledger);
    return { handoff: await isTurnCurrent(token, db, ledger.expectedHandoffAt) };
  }
  if (ledger.failedAt || ledger.confirmedAt) return { handoff: false };
  if (ledger.invalidatedAt) { await cancelInvalidatedFollowUp(db, ledger); return { handoff: false }; }
  if (!await isTurnCurrent(token, db, ledger.expectedHandoffAt)) {
    await db.update(schema.salesOutboundDelivery).set({ invalidatedAt: now }).where(scoped(
      schema.salesOutboundDelivery.organizationId, organizationId, eq(schema.salesOutboundDelivery.messageId, messageId)
    ));
    await cancelInvalidatedFollowUp(db, ledger);
    return { handoff: false };
  }

  const [lead] = ledger.leadId ? await db.select().from(schema.lead).where(scoped(
    schema.lead.organizationId, organizationId, eq(schema.lead.id, ledger.leadId)
  )).for("update") : [];
  const plan = stored?.salesPlan;
  const previous: Record<string, string | null> = {};
  const patch: Partial<typeof schema.lead.$inferInsert> = { updatedAt: now };
  const setFact = (key: typeof factKeys[number]) => {
    if (!lead) return;
    // Keep independent prior facts. This delivery only owns facts it creates.
    if (lead[key]) return;
    previous[key] = null;
    patch[key] = now;
  };
  if (lead && ledger.demoSlot) setFact("demoShownAt");
  if (lead && plan?.nextAction === "present_price") setFact("pricePresentedAt");
  // Payment can span multiple native text messages. Only the final successful
  // part plus ALL earlier confirmed parts authorize the single payment fact.
  if (lead && ledger.paymentGroupId) {
    const parts = await db.select().from(schema.salesOutboundDelivery).where(scoped(
      schema.salesOutboundDelivery.organizationId, organizationId,
      eq(schema.salesOutboundDelivery.paymentGroupId, ledger.paymentGroupId)
    ));
    if (parts.length === ledger.paymentParts && parts.every(part =>
      part.messageId === messageId || (!!part.confirmedAt && !part.failedAt && !part.invalidatedAt))) setFact("paymentInstructionsSentAt");
  }
  if (lead) await db.update(schema.lead).set(patch).where(scoped(
    schema.lead.organizationId, organizationId, eq(schema.lead.id, lead.id)
  ));
  if (lead && plan && stored?.scheduleFollowUp && !ledger.followUpJobId) {
    await scheduleNextFollowUp({ organizationId, leadId: lead.id, conversationId: ledger.conversationId,
      plan, anchorAt: now, sourceMessageId: messageId }, db);
  }
  if (lead && ledger.followUpJobId) await confirmFollowUp(db, ledger, now);
  await db.update(schema.salesOutboundDelivery).set({ confirmedAt: now, factPrevious: previous }).where(scoped(
    schema.salesOutboundDelivery.organizationId, organizationId, eq(schema.salesOutboundDelivery.messageId, messageId)
  ));
  return { handoff: false };
}

async function revokeLinkedEffects(db: SafetyDb, ledger: Ledger) {
  const { organizationId, leadId, messageId } = ledger;
  // Payment failures revoke the fact owned by whichever part completed the group.
  const owners = ledger.paymentGroupId ? await db.select().from(schema.salesOutboundDelivery).where(scoped(
    schema.salesOutboundDelivery.organizationId, organizationId,
    eq(schema.salesOutboundDelivery.paymentGroupId, ledger.paymentGroupId)
  )) : [ledger];
  for (const owner of owners) {
    const previous = owner.factPrevious as Record<string, string | null> | null;
    if (!leadId || !owner.confirmedAt || !previous) continue;
    for (const key of factKeys) {
      if (!(key in previous)) continue;
      await db.update(schema.lead).set({ [key]: previous[key] ? new Date(previous[key]!) : null, updatedAt: new Date() })
        .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.id, leadId), eq(schema.lead[key], owner.confirmedAt)));
    }
  }
  const [sourceJob] = ledger.followUpJobId ? await db.select().from(schema.salesFollowUpJob).where(scoped(
    schema.salesFollowUpJob.organizationId, organizationId, eq(schema.salesFollowUpJob.id, ledger.followUpJobId)
  )).limit(1) : [];
  const sourceMessageId = sourceJob?.sourceMessageId ?? messageId;
  const cancelled = await db.update(schema.salesFollowUpJob).set({ status: "cancelled", error: "delivery_failed", claimedAt: null, updatedAt: new Date() })
    .where(scoped(schema.salesFollowUpJob.organizationId, organizationId,
      eq(schema.salesFollowUpJob.sourceMessageId, sourceMessageId), inArray(schema.salesFollowUpJob.status, ["pending", "processing"])))
    .returning();
  if (sourceJob) await db.update(schema.salesFollowUpJob).set({ status: "failed", error: "delivery_failed", claimedAt: null, updatedAt: new Date() })
    .where(scoped(schema.salesFollowUpJob.organizationId, organizationId, eq(schema.salesFollowUpJob.id, sourceJob.id)));
  if (leadId) for (const job of [...cancelled, ...(sourceJob ? [sourceJob] : [])]) {
    await db.update(schema.lead).set({ nextFollowUpAt: null, updatedAt: new Date() }).where(scoped(
      schema.lead.organizationId, organizationId, eq(schema.lead.id, leadId), eq(schema.lead.nextFollowUpAt, job.dueAt)
    ));
  }
}

async function cancelInvalidatedFollowUp(db: SafetyDb, ledger: Ledger) {
  if (!ledger.followUpJobId) return;
  const cancelled = await db.update(schema.salesFollowUpJob).set({ status: "cancelled", error: "stale_delivery_context", claimedAt: null, updatedAt: new Date() })
    .where(scoped(schema.salesFollowUpJob.organizationId, ledger.organizationId,
      eq(schema.salesFollowUpJob.id, ledger.followUpJobId), eq(schema.salesFollowUpJob.messageId, ledger.messageId),
      eq(schema.salesFollowUpJob.status, "processing"))).returning();
  if (ledger.leadId) for (const job of cancelled) await db.update(schema.lead).set({ nextFollowUpAt: null, updatedAt: new Date() }).where(scoped(
    schema.lead.organizationId, ledger.organizationId, eq(schema.lead.id, ledger.leadId), eq(schema.lead.nextFollowUpAt, job.dueAt)
  ));
}

async function confirmFollowUp(db: SafetyDb, ledger: Ledger, now: Date) {
  const [job] = await db.select().from(schema.salesFollowUpJob).where(scoped(
    schema.salesFollowUpJob.organizationId, ledger.organizationId, eq(schema.salesFollowUpJob.id, ledger.followUpJobId!)
  )).limit(1);
  if (!job || job.status !== "processing" || job.messageId !== ledger.messageId) return;
  const [profile] = await db.select().from(schema.agentProfile).where(scoped(schema.agentProfile.organizationId, ledger.organizationId)).limit(1);
  if (!profile?.salesFollowUpsEnabled) { await cancelInvalidatedFollowUp(db, ledger); return; }
  await db.update(schema.salesFollowUpJob).set({ status: "sent", claimedAt: null, error: null, updatedAt: now }).where(scoped(
    schema.salesFollowUpJob.organizationId, ledger.organizationId, eq(schema.salesFollowUpJob.id, job.id)
  ));
  await db.update(schema.lead).set({ followUpCount: job.attemptNumber, nextFollowUpAt: null, updatedAt: now }).where(scoped(
    schema.lead.organizationId, ledger.organizationId, eq(schema.lead.id, ledger.leadId!)
  ));
  if (hasMoreCommercialAttempts(job.reason, job.attemptNumber)) {
    await enqueueFollowUpAttempt({ organizationId: ledger.organizationId, leadId: ledger.leadId!,
      conversationId: ledger.conversationId, reason: job.reason, attemptNumber: job.attemptNumber + 1,
      anchorAt: now, sourceMessageId: job.sourceMessageId ?? ledger.messageId }, db);
  } else if (job.reason !== "scheduled_wait") {
    await db.update(schema.lead).set({ automationLane: "stop", followUpReason: "no_reply_exhausted", updatedAt: now })
      .where(scoped(schema.lead.organizationId, ledger.organizationId, eq(schema.lead.id, ledger.leadId!)));
  }
}
