import { asc, desc, eq, gt, or } from "drizzle-orm";
import { getDb, getSql, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { countVariables } from "@/lib/whatsapp/template-placeholders";
import { publish } from "@/server/events/bus";
import { isWindowOpen } from "@/server/inbox/window";
import { SendError, sendText } from "@/server/inbox/send";
import { trimConversation } from "@/server/sales/build-state";
import { writeFollowUpText } from "@/server/sales/follow-ups/follow-up-writer";
import {
  hasMoreCommercialAttempts,
  MAX_RUN_ATTEMPTS,
} from "@/server/sales/follow-ups/policy";
import {
  enqueueFollowUpAttempt,
  markDormant,
  patchLeadFollowUp,
} from "@/server/sales/follow-ups/store";
import type { JevConversationTurn } from "@/server/sales/state";
import {
  sendTemplate,
  TemplateError,
} from "@/server/whatsapp/templates";

type FollowUpJob = typeof schema.salesFollowUpJob.$inferSelect;
type Lead = typeof schema.lead.$inferSelect;
type Conversation = typeof schema.conversation.$inferSelect;
type AgentProfile = typeof schema.agentProfile.$inferSelect;

const TICK_MS = 60_000;
const BATCH_SIZE = 10;
const CLAIM_LEASE_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS = 15 * 60 * 1000;

const globalForWorker = globalThis as unknown as {
  __voceroFollowUpTimer?: ReturnType<typeof setInterval>;
};

type RawClaimedJob = {
  id: string;
  organization_id: string;
  lead_id: string;
  conversation_id: string;
  reason: FollowUpJob["reason"];
  attempt_number: number;
  due_at: Date;
  anchor_at: Date;
  status: FollowUpJob["status"];
  run_attempts: number;
  claimed_at: Date | null;
  message_id: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
};

type LoadedContext = {
  job: FollowUpJob;
  lead: Lead;
  conversation: Conversation;
  profile: AgentProfile;
};

type GateFailure =
  | { kind: "cancelled"; error: string }
  | { kind: "blocked"; error: string };

/**
 * Arranca el interval in-process. Idempotente ante HMR.
 * No espera el primer tick.
 */
export function startSalesFollowUpWorker(): void {
  if (globalForWorker.__voceroFollowUpTimer) return;
  globalForWorker.__voceroFollowUpTimer = setInterval(() => {
    void runDueFollowUps().catch((err) => {
      console.error("[follow-up] tick falló:", err);
    });
  }, TICK_MS);
  void runDueFollowUps().catch((err) => {
    console.error("[follow-up] primer tick falló:", err);
  });
}

/** Reclama y procesa un batch de jobs vencidos. Un job malo no tumba el resto. */
export async function runDueFollowUps(): Promise<number> {
  const claimed = await claimDueJobs(BATCH_SIZE);
  let processed = 0;
  for (const job of claimed) {
    try {
      await processClaimedJob(job);
      processed += 1;
    } catch (err) {
      console.error(`[follow-up] job ${job.id} lanzó:`, err);
      await recoverUnexpectedError(job, err);
    }
  }
  return processed;
}

async function claimDueJobs(limit: number): Promise<FollowUpJob[]> {
  const now = new Date();
  const leaseCutoff = new Date(now.getTime() - CLAIM_LEASE_MS);
  const sql = getSql();
  const rows = await sql<RawClaimedJob[]>`
    UPDATE sales_follow_up_job AS job
    SET
      status = 'processing',
      claimed_at = ${now},
      updated_at = ${now}
    WHERE job.id IN (
      SELECT id
      FROM sales_follow_up_job
      WHERE due_at <= ${now}
        AND (
          status = 'pending'
          OR (
            status = 'processing'
            AND claimed_at IS NOT NULL
            AND claimed_at < ${leaseCutoff}
          )
        )
      ORDER BY due_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING job.*
  `;
  return rows.map(mapClaimedJob);
}

async function processClaimedJob(claimed: FollowUpJob): Promise<void> {
  const loaded = await loadContext(claimed);
  if (!loaded) {
    await finishJob(claimed, {
      status: "cancelled",
      error: "context_missing",
    });
    return;
  }

  const gate = await revalidate(loaded);
  if (gate) {
    await finishJob(loaded.job, {
      status: gate.kind === "blocked" ? "blocked" : "cancelled",
      error: gate.error,
    });
    if (gate.error !== "due_mismatch" && gate.error !== "job_not_processing") {
      await clearLeadSchedule(loaded.job);
    }
    return;
  }

  const { job, lead, conversation, profile } = loaded;

  try {
    const delivered = conversation.isTest
      ? await sendSandboxFollowUp(loaded)
      : isWindowOpen(conversation.lastInboundAt)
        ? await sendOpenWindowFollowUp(loaded)
        : await sendClosedWindowFollowUp(profile, job);

    if (!delivered.ok) {
      if (delivered.retry) {
        await requeueTechnicalRetry(job, delivered.error);
      } else {
        await failJob(job, delivered.error, delivered.blocked);
      }
      return;
    }

    await onSendSuccess(job, delivered.messageId);
  } catch (err) {
    if (isTransientError(err)) {
      await requeueTechnicalRetry(job, shortError(err));
      return;
    }
    throw err;
  }
}

async function loadContext(
  claimed: FollowUpJob
): Promise<LoadedContext | null> {
  const db = getDb();
  const orgId = claimed.organizationId;

  const jobs = await db
    .select()
    .from(schema.salesFollowUpJob)
    .where(
      scoped(
        schema.salesFollowUpJob.organizationId,
        orgId,
        eq(schema.salesFollowUpJob.id, claimed.id)
      )
    )
    .limit(1);
  const job = jobs[0];
  if (!job) return null;

  const leads = await db
    .select()
    .from(schema.lead)
    .where(
      scoped(schema.lead.organizationId, orgId, eq(schema.lead.id, job.leadId))
    )
    .limit(1);
  const lead = leads[0];
  if (!lead) return null;

  const convs = await db
    .select()
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        orgId,
        eq(schema.conversation.id, job.conversationId)
      )
    )
    .limit(1);
  const conversation = convs[0];
  if (!conversation) return null;

  const profiles = await db
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, orgId))
    .limit(1);
  const profile = profiles[0];
  if (!profile) return null;

  return { job, lead, conversation, profile };
}

async function revalidate(ctx: LoadedContext): Promise<GateFailure | null> {
  const { job, lead, conversation, profile } = ctx;

  if (job.status !== "processing") {
    return { kind: "cancelled", error: "job_not_processing" };
  }
  if (job.organizationId !== conversation.organizationId) {
    return { kind: "cancelled", error: "org_mismatch" };
  }
  if (!profile.salesFollowUpsEnabled || !profile.salesOrchestratorEnabled) {
    return { kind: "cancelled", error: "follow_ups_disabled" };
  }
  if (!conversation.aiEnabled) {
    return { kind: "cancelled", error: "ai_disabled" };
  }
  if (conversation.handoffAt) {
    return { kind: "cancelled", error: "handoff_active" };
  }
  if (lead.automationLane === "human") {
    return { kind: "cancelled", error: "lane_human" };
  }
  if (lead.automationLane === "stop") {
    return { kind: "cancelled", error: "lane_stop" };
  }
  if (job.reason === "scheduled_wait") {
    if (lead.automationLane !== "wait") {
      return { kind: "cancelled", error: "wait_lane_required" };
    }
  } else if (
    lead.automationLane !== "auto" &&
    lead.automationLane !== "auto_close"
  ) {
    return { kind: "cancelled", error: "lane_not_auto" };
  }
  if (!dueMatchesLead(lead.nextFollowUpAt, job.dueAt)) {
    return { kind: "cancelled", error: "due_mismatch" };
  }
  if (await hasMessageAfterAnchor(job)) {
    return { kind: "cancelled", error: "message_after_anchor" };
  }
  return null;
}

async function sendOpenWindowFollowUp(
  ctx: LoadedContext
): Promise<DeliverResult> {
  const turns = await loadTurns(ctx.job.organizationId, ctx.job.conversationId);
  const kb = await loadKb(ctx.job.organizationId);
  const written = await writeFollowUpText({
    conversation: turns,
    reason: ctx.job.reason,
    attemptNumber: ctx.job.attemptNumber,
    lastJevSnapshot: ctx.lead.lastJevDecision,
    kb,
    pricePresented: ctx.lead.pricePresentedAt !== null,
  });
  if (!written.ok) {
    return {
      ok: false,
      retry: written.error === "provider_error" || written.error === "invalid_output",
      error: written.error,
    };
  }

  try {
    const sent = await sendText({
      conversationId: ctx.conversation.id,
      organizationId: ctx.job.organizationId,
      text: written.text,
      aiGenerated: true,
    });
    return { ok: true, messageId: sent.messageId };
  } catch (err) {
    if (err instanceof SendError && err.code === "window_closed") {
      return sendClosedWindowFollowUp(ctx.profile, ctx.job);
    }
    if (err instanceof SendError && err.code === "sandbox_violation") {
      return sendSandboxFollowUp(ctx);
    }
    throw err;
  }
}

async function sendClosedWindowFollowUp(
  profile: AgentProfile,
  job: FollowUpJob
): Promise<DeliverResult> {
  const templateId = profile.salesFollowUpTemplateId;
  if (!templateId) {
    return { ok: false, retry: false, blocked: true, error: "template_required" };
  }

  const template = await loadApprovedZeroVarTemplate(
    job.organizationId,
    templateId
  );
  if (!template) {
    return { ok: false, retry: false, blocked: true, error: "template_required" };
  }

  try {
    const sent = await sendTemplate({
      organizationId: job.organizationId,
      conversationId: job.conversationId,
      templateId: template.id,
    });
    return { ok: true, messageId: sent.messageId };
  } catch (err) {
    if (err instanceof TemplateError && err.code === "meta_unavailable") {
      return { ok: false, retry: true, error: "meta_unavailable" };
    }
    if (
      err instanceof TemplateError &&
      (err.code === "invalid" || err.code === "not_found")
    ) {
      return { ok: false, retry: false, blocked: true, error: "template_required" };
    }
    if (err instanceof SendError && err.code === "sandbox_violation") {
      return { ok: false, retry: false, blocked: true, error: "sandbox" };
    }
    throw err;
  }
}

async function sendSandboxFollowUp(ctx: LoadedContext): Promise<DeliverResult> {
  const windowOpen = isWindowOpen(ctx.conversation.lastInboundAt);
  if (!windowOpen) {
    const templateId = ctx.profile.salesFollowUpTemplateId;
    if (!templateId) {
      return {
        ok: false,
        retry: false,
        blocked: true,
        error: "template_required",
      };
    }
    const template = await loadApprovedZeroVarTemplate(
      ctx.job.organizationId,
      templateId
    );
    if (!template) {
      return {
        ok: false,
        retry: false,
        blocked: true,
        error: "template_required",
      };
    }
    const messageId = await persistSandboxOutbound(
      ctx.conversation,
      template.body
    );
    return { ok: true, messageId };
  }

  const turns = await loadTurns(ctx.job.organizationId, ctx.job.conversationId);
  const kb = await loadKb(ctx.job.organizationId);
  const written = await writeFollowUpText({
    conversation: turns,
    reason: ctx.job.reason,
    attemptNumber: ctx.job.attemptNumber,
    lastJevSnapshot: ctx.lead.lastJevDecision,
    kb,
    pricePresented: ctx.lead.pricePresentedAt !== null,
  });
  if (!written.ok) {
    return {
      ok: false,
      retry: written.error === "provider_error" || written.error === "invalid_output",
      error: written.error,
    };
  }
  const messageId = await persistSandboxOutbound(ctx.conversation, written.text);
  return { ok: true, messageId };
}

async function onSendSuccess(
  job: FollowUpJob,
  messageId: string
): Promise<void> {
  const now = new Date();
  await finishJob(job, {
    status: "sent",
    messageId,
    error: null,
  });
  await patchLeadFollowUp(job.organizationId, job.leadId, {
    followUpCount: job.attemptNumber,
    updatedAt: now,
  });

  if (job.reason === "scheduled_wait") {
    await patchLeadFollowUp(job.organizationId, job.leadId, {
      nextFollowUpAt: null,
      followUpReason: "scheduled_wait",
      updatedAt: now,
    });
    publishConversation(job.organizationId, job.conversationId);
    return;
  }

  if (hasMoreCommercialAttempts(job.reason, job.attemptNumber)) {
    await enqueueFollowUpAttempt({
      organizationId: job.organizationId,
      leadId: job.leadId,
      conversationId: job.conversationId,
      reason: job.reason,
      attemptNumber: job.attemptNumber + 1,
      anchorAt: now,
    });
    publishConversation(job.organizationId, job.conversationId);
    return;
  }

  await markDormant({
    organizationId: job.organizationId,
    leadId: job.leadId,
  });
  publishConversation(job.organizationId, job.conversationId);
}

async function requeueTechnicalRetry(
  job: FollowUpJob,
  error: string
): Promise<void> {
  const nextAttempts = job.runAttempts + 1;
  const now = new Date();
  if (nextAttempts >= MAX_RUN_ATTEMPTS) {
    await failJob(job, error, false, nextAttempts);
    return;
  }
  const db = getDb();
  await db
    .update(schema.salesFollowUpJob)
    .set({
      status: "pending",
      runAttempts: nextAttempts,
      claimedAt: null,
      error,
      dueAt: new Date(now.getTime() + RETRY_DELAY_MS),
      updatedAt: now,
    })
    .where(
      scoped(
        schema.salesFollowUpJob.organizationId,
        job.organizationId,
        eq(schema.salesFollowUpJob.id, job.id)
      )
    );
}

async function failJob(
  job: FollowUpJob,
  error: string,
  blocked = false,
  runAttempts = job.runAttempts + 1
): Promise<void> {
  await finishJob(job, {
    status: blocked ? "blocked" : "failed",
    error,
    runAttempts,
  });
  await patchLeadFollowUp(job.organizationId, job.leadId, {
    nextFollowUpAt: null,
    followUpReason: blocked ? error : "follow_up_failed",
    updatedAt: new Date(),
  });
}

async function recoverUnexpectedError(
  job: FollowUpJob,
  err: unknown
): Promise<void> {
  try {
    if (isTransientError(err)) {
      await requeueTechnicalRetry(job, shortError(err));
      return;
    }
    await failJob(job, shortError(err));
  } catch (inner) {
    console.error(`[follow-up] no se pudo registrar fallo de ${job.id}:`, inner);
  }
}

async function finishJob(
  job: FollowUpJob,
  patch: {
    status: FollowUpJob["status"];
    error?: string | null;
    messageId?: string | null;
    runAttempts?: number;
  }
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.salesFollowUpJob)
    .set({
      status: patch.status,
      error: patch.error === undefined ? job.error : patch.error,
      messageId: patch.messageId === undefined ? job.messageId : patch.messageId,
      runAttempts: patch.runAttempts ?? job.runAttempts,
      claimedAt: null,
      updatedAt: new Date(),
    })
    .where(
      scoped(
        schema.salesFollowUpJob.organizationId,
        job.organizationId,
        eq(schema.salesFollowUpJob.id, job.id)
      )
    );
}

async function clearLeadSchedule(job: FollowUpJob): Promise<void> {
  await patchLeadFollowUp(job.organizationId, job.leadId, {
    nextFollowUpAt: null,
    updatedAt: new Date(),
  });
}

async function hasMessageAfterAnchor(job: FollowUpJob): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        job.organizationId,
        eq(schema.message.conversationId, job.conversationId),
        or(
          gt(schema.message.createdAt, job.anchorAt),
          gt(schema.message.waTimestamp, job.anchorAt)
        )
      )
    )
    .limit(1);
  return Boolean(rows[0]);
}

async function loadApprovedZeroVarTemplate(
  organizationId: string,
  templateId: string
): Promise<typeof schema.template.$inferSelect | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        organizationId,
        eq(schema.template.id, templateId)
      )
    )
    .limit(1);
  const template = rows[0];
  if (!template) return null;
  if (template.status !== "approved") return null;
  if (countVariables(template.body) !== 0) return null;
  return template;
}

async function loadTurns(
  organizationId: string,
  conversationId: string
): Promise<JevConversationTurn[]> {
  const db = getDb();
  const rows = await db
    .select({
      direction: schema.message.direction,
      text: schema.message.text,
    })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversationId)
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(80);

  rows.reverse();
  return trimConversation(
    rows.flatMap((row) => {
      const text = (row.text ?? "").trim();
      if (!text) return [];
      return [
        {
          from: row.direction === "in" ? "lead" : "seller",
          text,
        } satisfies JevConversationTurn,
      ];
    })
  );
}

async function loadKb(organizationId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
}

async function persistSandboxOutbound(
  conversation: Conversation,
  text: string
): Promise<string> {
  const db = getDb();
  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      direction: "out",
      type: "text",
      text,
      status: "sent",
      aiGenerated: true,
      origin: "ai",
    })
    .returning({ id: schema.message.id });
  const messageId = inserted[0]?.id;
  if (!messageId) throw new Error("sandbox follow-up: insert sin fila");
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(
      scoped(
        schema.conversation.organizationId,
        conversation.organizationId,
        eq(schema.conversation.id, conversation.id)
      )
    );
  return messageId;
}

function dueMatchesLead(nextFollowUpAt: Date | null, dueAt: Date): boolean {
  if (!nextFollowUpAt) return false;
  return Math.abs(nextFollowUpAt.getTime() - dueAt.getTime()) < 1000;
}

function isTransientError(err: unknown): boolean {
  if (err instanceof SendError) {
    return err.code === "meta_unavailable";
  }
  if (err instanceof TemplateError) {
    return err.code === "meta_unavailable";
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("timeout") ||
      msg.includes("econnreset") ||
      msg.includes("network") ||
      msg.includes("fetch failed")
    );
  }
  return false;
}

function shortError(err: unknown): string {
  if (err instanceof SendError) return err.code;
  if (err instanceof TemplateError) return err.code;
  if (err instanceof Error) return err.message.slice(0, 180);
  return "unknown_error";
}

function mapClaimedJob(row: RawClaimedJob): FollowUpJob {
  return {
    id: row.id,
    organizationId: row.organization_id,
    leadId: row.lead_id,
    conversationId: row.conversation_id,
    reason: row.reason,
    attemptNumber: Number(row.attempt_number),
    dueAt: new Date(row.due_at),
    anchorAt: new Date(row.anchor_at),
    status: row.status,
    runAttempts: Number(row.run_attempts),
    claimedAt: row.claimed_at ? new Date(row.claimed_at) : null,
    messageId: row.message_id,
    error: row.error,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function publishConversation(
  organizationId: string,
  conversationId: string
): void {
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversationId } },
  });
}

type DeliverResult =
  | { ok: true; messageId: string }
  | { ok: false; retry: boolean; error: string; blocked?: boolean };
