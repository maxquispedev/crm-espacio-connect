import type { SafetyDb } from "@/server/ai/turn-safety";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { SalesFollowUpJobStatus, SalesFollowUpReason } from "@/lib/types";
import type { SalesPlan } from "@/server/sales/resolve-plan";
import {
  applyBusinessHours,
  classifyFollowUpReason,
  nextFollowUpDelay,
  shouldReactivateDormant,
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
      error:
        | "due_in_past"
        | "lead_not_found"
        | "conversation_not_found"
        | "human_lane"
        | "handoff_active"
        | "orchestrator_disabled"
        | "follow_ups_disabled";
    };

/**
 * Tras un envío comercial exitoso: cancela la secuencia anterior y programa
 * el intento 1. No-op si el plan no admite seguimiento o follow-ups están OFF.
 *
 * El `due_at` se normaliza al horario comercial (spec 018): un seguimiento
 * automático nunca se programa para las 03:00. Los delays no cambian; lo que
 * cambia es DÓNDE cae el vencimiento dentro del día.
 */
export async function scheduleNextFollowUp(input: {
  organizationId: string;
  leadId: string;
  conversationId: string;
  plan: FollowUpPlan;
  anchorAt: Date;
  sourceMessageId?: string;
}, db: SafetyDb = getDb()): Promise<FollowUpJob | null> {
  if (!shouldStartFollowUp(input.plan)) return null;

  const reason = classifyFollowUpReason(input.plan);
  if (!reason) return null;

  const delayMs = nextFollowUpDelay(reason, 1);
  if (delayMs === null) return null;

  const profile = await loadAgentProfile(input.organizationId, db);
  if (!profile?.salesFollowUpsEnabled) return null;

  await cancelOpenJobs(input.organizationId, input.leadId, "replaced_by_new_sequence", db);

  const dueAt = applyBusinessHours(
    reason,
    new Date(input.anchorAt.getTime() + delayMs)
  );
  const job = await insertJob({
    organizationId: input.organizationId,
    leadId: input.leadId,
    conversationId: input.conversationId,
    reason,
    attemptNumber: 1,
    dueAt,
    anchorAt: input.anchorAt,
    sourceMessageId: input.sourceMessageId,
  }, db);

  await patchLead(input.organizationId, input.leadId, {
    nextFollowUpAt: dueAt,
    followUpCount: 0,
    followUpReason: reason,
    updatedAt: new Date(),
  }, db);

  return job;
}

/**
 * Programación manual one-shot (`scheduled_wait`). No encadena 3 intentos.
 * Rechaza HUMAN y handoff; DORMANT (STOP + silencio) sí puede reactivarse.
 *
 * Spec 018: NO se normaliza al horario comercial. Aquí la fecha la eligió una
 * persona a propósito (el operador la ve y la acepta); diferirla a las 09:00
 * cambiaría un compromiso humano por una regla de máquina.
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

  const profile = await loadAgentProfile(input.organizationId);
  if (!profile?.salesOrchestratorEnabled) {
    return { ok: false, error: "orchestrator_disabled" };
  }
  if (!profile.salesFollowUpsEnabled) {
    return { ok: false, error: "follow_ups_disabled" };
  }

  const lead = await loadLead(input.organizationId, input.leadId);
  if (!lead) return { ok: false, error: "lead_not_found" };
  if (lead.automationLane === "human") {
    return { ok: false, error: "human_lane" };
  }

  const conversation = await loadRealConversation(
    input.organizationId,
    lead.contactId
  );
  if (!conversation) return { ok: false, error: "conversation_not_found" };
  if (conversation.handoffAt) {
    return { ok: false, error: "handoff_active" };
  }
  const conversationId = conversation.id;

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
  const loaded = await loadLeadWithStage(input.organizationId, input.leadId);
  if (!loaded) return;
  const { lead, pipelineKind } = loaded;

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
    shouldReactivateDormant({
      lane: lead.automationLane,
      followUpReason: lead.followUpReason,
      pipelineKind,
    })
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
  error: string,
  db: SafetyDb = getDb()
): Promise<number> {
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

/**
 * Encola el siguiente intento comercial. No cancela el job ya `sent`.
 * El `due_at` también se normaliza al horario comercial (spec 018): encadenar
 * el intento 2 a las 02:00 debe correr tan solo hasta las 09:00, sin perder el
 * intento ni alterar el delay relativo.
 */
export async function enqueueFollowUpAttempt(input: {
  organizationId: string;
  leadId: string;
  conversationId: string;
  reason: SalesFollowUpReason;
  attemptNumber: number;
  anchorAt: Date;
  sourceMessageId?: string;
}, db: SafetyDb = getDb()): Promise<FollowUpJob | null> {
  const delayMs = nextFollowUpDelay(input.reason, input.attemptNumber);
  if (delayMs === null) return null;

  const dueAt = applyBusinessHours(
    input.reason,
    new Date(input.anchorAt.getTime() + delayMs)
  );
  const job = await insertJob({
    organizationId: input.organizationId,
    leadId: input.leadId,
    conversationId: input.conversationId,
    reason: input.reason,
    attemptNumber: input.attemptNumber,
    dueAt,
    anchorAt: input.anchorAt,
    sourceMessageId: input.sourceMessageId,
  }, db);

  await patchLead(input.organizationId, input.leadId, {
    nextFollowUpAt: dueAt,
    followUpReason: input.reason,
    updatedAt: new Date(),
  }, db);

  return job;
}

export async function patchLeadFollowUp(
  organizationId: string,
  leadId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await patchLead(organizationId, leadId, patch);
}

async function insertJob(input: {
  organizationId: string;
  leadId: string;
  conversationId: string;
  reason: SalesFollowUpReason;
  attemptNumber: number;
  dueAt: Date;
  anchorAt: Date;
  sourceMessageId?: string;
},
  db: SafetyDb = getDb()
): Promise<FollowUpJob> {
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
      sourceMessageId: input.sourceMessageId ?? null,
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

async function loadAgentProfile(
  organizationId: string,
  db: SafetyDb = getDb()
): Promise<{
  salesOrchestratorEnabled: boolean;
  salesFollowUpsEnabled: boolean;
} | null> {
  const rows = await db
    .select({
      salesOrchestratorEnabled: schema.agentProfile.salesOrchestratorEnabled,
      salesFollowUpsEnabled: schema.agentProfile.salesFollowUpsEnabled,
    })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

async function loadLead(
  organizationId: string,
  leadId: string,
  db: SafetyDb = getDb()
): Promise<Lead | null> {
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
  patch: Record<string, unknown>,
  db: SafetyDb = getDb()
): Promise<void> {
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

async function loadLeadWithStage(
  organizationId: string,
  leadId: string
): Promise<{ lead: Lead; pipelineKind: "open" | "won" | "lost" | null } | null> {
  const db = getDb();
  const rows = await db
    .select({
      lead: schema.lead,
      pipelineKind: schema.pipelineStage.kind,
    })
    .from(schema.lead)
    .innerJoin(
      schema.pipelineStage,
      eq(schema.lead.stageId, schema.pipelineStage.id)
    )
    .where(
      scoped(schema.lead.organizationId, organizationId, eq(schema.lead.id, leadId))
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { lead: row.lead, pipelineKind: row.pipelineKind };
}

async function loadRealConversation(
  organizationId: string,
  contactId: string
): Promise<{ id: string; handoffAt: Date | null } | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.conversation.id,
      handoffAt: schema.conversation.handoffAt,
    })
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
  return rows[0] ?? null;
}
