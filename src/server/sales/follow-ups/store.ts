import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { SalesFollowUpJobStatus, SalesFollowUpReason } from "@/lib/types";
import type { SalesPlan } from "@/server/sales/resolve-plan";
import {
  classifyFollowUpReason,
  nextFollowUpDelay,
  shouldStartFollowUp,
} from "@/server/sales/follow-ups/policy";

type Lead = typeof schema.lead.$inferSelect;
type FollowUpJob = typeof schema.salesFollowUpJob.$inferSelect;

const OPEN_JOB_STATUSES: SalesFollowUpJobStatus[] = ["pending", "processing"];

const SILENCE_REASONS: ReadonlySet<string> = new Set([
  "awaiting_reply",
  "after_demo",
  "after_price",
  "scheduled_wait",
  "no_reply_exhausted",
]);

type FollowUpPlan = Pick<SalesPlan, "lane" | "nextAction" | "shouldReply">;

export type ScheduleManualFollowUpResult =
  | { ok: true; job: FollowUpJob }
  | {
      ok: false;
      error: "due_in_past" | "lead_not_found" | "conversation_not_found";
    };

/**
 * Tras un envío comercial exitoso: cancela la secuencia anterior y programa
 * el intento 1. No-op si el plan no admite seguimiento.
 */
export async function scheduleNextFollowUp(input: {
  organizationId: string;
  leadId: string;
  conversationId: string;
  plan: FollowUpPlan;
  anchorAt: Date;
}): Promise<FollowUpJob | null> {
  if (!shouldStartFollowUp(input.plan)) return null;

  const reason = classifyFollowUpReason(input.plan);
  if (!reason) return null;

  const delayMs = nextFollowUpDelay(reason, 1);
  if (delayMs === null) return null;

  await cancelOpenJobs(input.organizationId, input.leadId, "replaced_by_new_sequence");

  const dueAt = new Date(input.anchorAt.getTime() + delayMs);
  const job = await insertJob({
    organizationId: input.organizationId,
    leadId: input.leadId,
    conversationId: input.conversationId,
    reason,
    attemptNumber: 1,
    dueAt,
    anchorAt: input.anchorAt,
  });

  await patchLead(input.organizationId, input.leadId, {
    nextFollowUpAt: dueAt,
    followUpCount: 0,
    followUpReason: reason,
    updatedAt: new Date(),
  });

  return job;
}

/**
 * Programación manual one-shot (`scheduled_wait`). No encadena 3 intentos.
 * Todavía sin endpoint/UI: solo API server-side.
 */
export async function scheduleManualFollowUp(input: {
  organizationId: string;
  leadId: string;
  dueAt: Date;
  now?: Date;
}): Promise<ScheduleManualFollowUpResult> {
  const now = input.now ?? new Date();
  if (!(input.dueAt.getTime() > now.getTime())) {
    return { ok: false, error: "due_in_past" };
  }

  const lead = await loadLead(input.organizationId, input.leadId);
  if (!lead) return { ok: false, error: "lead_not_found" };

  const conversationId = await findRealConversationId(
    input.organizationId,
    lead.contactId
  );
  if (!conversationId) return { ok: false, error: "conversation_not_found" };

  await cancelOpenJobs(input.organizationId, input.leadId, "replaced_by_manual_schedule");

  const job = await insertJob({
    organizationId: input.organizationId,
    leadId: input.leadId,
    conversationId,
    reason: "scheduled_wait",
    attemptNumber: 1,
    dueAt: input.dueAt,
    anchorAt: now,
  });

  await patchLead(input.organizationId, input.leadId, {
    automationLane: "wait",
    nextFollowUpAt: input.dueAt,
    followUpReason: "scheduled_wait",
    updatedAt: now,
  });

  return { ok: true, job };
}

/**
 * Cancela jobs `pending` y marca `processing` como `cancelled` para que un
 * worker futuro revalide y no envíe. No crea una secuencia nueva.
 */
export async function cancelPendingFollowUps(input: {
  organizationId: string;
  leadId: string;
  reason?: string;
}): Promise<number> {
  return cancelOpenJobs(
    input.organizationId,
    input.leadId,
    input.reason ?? "cancelled"
  );
}

/**
 * El prospecto volvió a escribir: invalida la secuencia y reactiva DORMANT.
 * No reactiva STOP por descalificación ni HUMAN.
 */
export async function resetFollowUpsOnInbound(input: {
  organizationId: string;
  leadId: string;
}): Promise<void> {
  const lead = await loadLead(input.organizationId, input.leadId);
  if (!lead) return;

  await cancelOpenJobs(input.organizationId, input.leadId, "inbound_message");

  const now = new Date();
  const patch: Record<string, unknown> = {
    nextFollowUpAt: null,
    followUpCount: 0,
    updatedAt: now,
  };

  if (SILENCE_REASONS.has(lead.followUpReason ?? "")) {
    patch.followUpReason = null;
  }

  if (
    lead.automationLane === "stop" &&
    lead.followUpReason === "no_reply_exhausted"
  ) {
    patch.automationLane = "auto";
    patch.followUpReason = null;
  }

  await patchLead(input.organizationId, input.leadId, patch);
}

/**
 * Invalida seguimientos por respuesta manual (echo o operador CRM).
 * No cambia lane ni reactiva DORMANT. No crea secuencia nueva.
 */
export async function cancelFollowUpsOnManualReply(input: {
  organizationId: string;
  conversationId: string;
}): Promise<void> {
  const leadId = await findLeadIdForConversation(
    input.organizationId,
    input.conversationId
  );
  if (!leadId) return;

  await cancelOpenJobs(input.organizationId, leadId, "manual_reply");
  await patchLead(input.organizationId, leadId, {
    nextFollowUpAt: null,
    updatedAt: new Date(),
  });
}

/**
 * Agota la secuencia por silencio. No mueve pipeline ni `stageId`.
 */
export async function markDormant(input: {
  organizationId: string;
  leadId: string;
}): Promise<void> {
  await cancelOpenJobs(input.organizationId, input.leadId, "no_reply_exhausted");
  await patchLead(input.organizationId, input.leadId, {
    automationLane: "stop",
    followUpReason: "no_reply_exhausted",
    nextFollowUpAt: null,
    updatedAt: new Date(),
  });
}

/** Job abierto más próximo, o null. */
export async function getCurrentFollowUp(input: {
  organizationId: string;
  leadId: string;
}): Promise<FollowUpJob | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.salesFollowUpJob)
    .where(
      scoped(
        schema.salesFollowUpJob.organizationId,
        input.organizationId,
        eq(schema.salesFollowUpJob.leadId, input.leadId),
        inArray(schema.salesFollowUpJob.status, OPEN_JOB_STATUSES)
      )
    )
    .orderBy(asc(schema.salesFollowUpJob.dueAt))
    .limit(1);
  return rows[0] ?? null;
}

async function cancelOpenJobs(
  organizationId: string,
  leadId: string,
  error: string
): Promise<number> {
  const db = getDb();
  const now = new Date();
  const updated = await db
    .update(schema.salesFollowUpJob)
    .set({
      status: "cancelled",
      error,
      claimedAt: null,
      updatedAt: now,
    })
    .where(
      scoped(
        schema.salesFollowUpJob.organizationId,
        organizationId,
        eq(schema.salesFollowUpJob.leadId, leadId),
        inArray(schema.salesFollowUpJob.status, OPEN_JOB_STATUSES)
      )
    )
    .returning({ id: schema.salesFollowUpJob.id });
  return updated.length;
}

async function insertJob(input: {
  organizationId: string;
  leadId: string;
  conversationId: string;
  reason: SalesFollowUpReason;
  attemptNumber: number;
  dueAt: Date;
  anchorAt: Date;
}): Promise<FollowUpJob> {
  const db = getDb();
  const now = new Date();
  const inserted = await db
    .insert(schema.salesFollowUpJob)
    .values({
      id: newId("salesFollowUpJob"),
      organizationId: input.organizationId,
      leadId: input.leadId,
      conversationId: input.conversationId,
      reason: input.reason,
      attemptNumber: input.attemptNumber,
      dueAt: input.dueAt,
      anchorAt: input.anchorAt,
      status: "pending",
      runAttempts: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const job = inserted[0];
  if (!job) throw new Error("sales_follow_up_job: insert sin fila");
  return job;
}

async function loadLead(
  organizationId: string,
  leadId: string
): Promise<Lead | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.lead)
    .where(
      scoped(schema.lead.organizationId, organizationId, eq(schema.lead.id, leadId))
    )
    .limit(1);
  return rows[0] ?? null;
}

async function patchLead(
  organizationId: string,
  leadId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.lead)
    .set(patch)
    .where(
      scoped(schema.lead.organizationId, organizationId, eq(schema.lead.id, leadId))
    );
}

async function findLeadIdForConversation(
  organizationId: string,
  conversationId: string
): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ leadId: schema.lead.id })
    .from(schema.conversation)
    .innerJoin(
      schema.lead,
      and(
        eq(schema.lead.contactId, schema.conversation.contactId),
        eq(schema.lead.organizationId, schema.conversation.organizationId)
      )
    )
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  return rows[0]?.leadId ?? null;
}

async function findRealConversationId(
  organizationId: string,
  contactId: string
): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.contactId, contactId),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  return rows[0]?.id ?? null;
}
