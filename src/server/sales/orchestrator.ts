import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import { applyHandoff, deliverReply } from "@/server/ai/delivery";
import { buildJevSalesState } from "@/server/sales/build-state";
import { evaluateJev } from "@/server/sales/client";
import type { PipelineSemantic, SalesPlan } from "@/server/sales/resolve-plan";
import { resolveSalesPlan } from "@/server/sales/resolve-plan";
import { VENDE_VELOZ_OFFER } from "@/server/sales/vende-veloz";
import { writeSalesReply } from "@/server/sales/writer";

type Conversation = typeof schema.conversation.$inferSelect;
type Lead = typeof schema.lead.$inferSelect;
type Stage = typeof schema.pipelineStage.$inferSelect;

/**
 * Turno comercial cuando `salesOrchestratorEnabled`.
 * Jev no envía mensajes. El writer no decide. Efectos solo en servidor.
 */
export async function runSalesOrchestratorTurn(input: {
  organizationId: string;
  conversationId: string;
  conversation: Conversation;
}): Promise<void> {
  const { organizationId, conversationId, conversation } = input;

  const built = await buildJevSalesState({ organizationId, conversationId });
  if (!built.ok) return;
  if (!built.persist.leadId) return;

  const leadCtx = await loadLeadContext(organizationId, built.persist.leadId);
  if (!leadCtx) return;

  const jev = await evaluateJev({ state: built.state });
  if (!jev.ok) {
    console.error("[sales] Jev falló:", jev.error);
    await persistLeadPatch(organizationId, leadCtx.lead.id, {
      lastJevError: sanitizeError(jev.detail),
      updatedAt: new Date(),
    });
    publishConversation(organizationId, conversationId);
    return;
  }

  const plan = resolveSalesPlan({
    decision: jev.decision,
    currentSalesState: {
      automationLane: leadCtx.lead.automationLane,
      demoShownAt: leadCtx.lead.demoShownAt,
      pricePresentedAt: leadCtx.lead.pricePresentedAt,
      paymentInstructionsSentAt: leadCtx.lead.paymentInstructionsSentAt,
      humanRequestedAt: leadCtx.lead.humanRequestedAt,
      followUpCount: leadCtx.lead.followUpCount,
    },
    currentPipelineStage: toSemantic(leadCtx.stage),
  });

  await persistDecision({
    organizationId,
    conversationId,
    lead: leadCtx.lead,
    stage: leadCtx.stage,
    plan,
    snapshot: {
      snapshot: jev.snapshot,
      decision: jev.decision,
      plan: {
        lane: plan.lane,
        nextAction: plan.nextAction,
        shouldHandoff: plan.shouldHandoff,
      },
      requestId: jev.requestId ?? null,
      model: jev.model ?? null,
    },
  });

  const skipRepeatStop =
    leadCtx.lead.automationLane === "stop" && plan.lane === "stop";
  const shouldWrite = plan.shouldReply && !skipRepeatStop;

  let sent = false;
  if (shouldWrite) {
    const kb = await loadKb(organizationId);
    const written = await writeSalesReply({
      decision: jev.decision,
      plan,
      conversation: built.state.conversation,
      kb,
      facts: {
        automationLane: plan.lane,
        demoShownAt: leadCtx.lead.demoShownAt,
        pricePresentedAt: leadCtx.lead.pricePresentedAt,
        paymentInstructionsSentAt: leadCtx.lead.paymentInstructionsSentAt,
        humanRequestedAt: leadCtx.lead.humanRequestedAt,
        followUpCount: leadCtx.lead.followUpCount,
      },
      product: built.state.product,
      policy: built.state.commercial_policy,
      offer: VENDE_VELOZ_OFFER,
    });

    if (written.ok && written.text) {
      sent = await deliverReply(conversation, written.text);
      if (sent) {
        await persistDeliveryFacts(organizationId, leadCtx.lead.id, plan);
      }
    } else if (!written.ok) {
      console.error("[sales] writer falló:", written.error);
    }
  }

  if (plan.shouldHandoff) {
    await applyHandoff(conversationId, organizationId, "commercial");
  }
}

async function persistDecision(input: {
  organizationId: string;
  conversationId: string;
  lead: Lead;
  stage: Stage;
  plan: SalesPlan;
  snapshot: unknown;
}): Promise<void> {
  const now = new Date();
  const patch: Record<string, unknown> = {
    automationLane: input.plan.lane,
    lastJevEvaluatedAt: now,
    lastJevDecision: input.snapshot,
    lastJevError: null,
    lastActivityAt: now,
    updatedAt: now,
  };

  if (input.plan.followUpDirective.kind === "schedule") {
    patch.followUpReason = input.plan.followUpDirective.reason;
  }

  const nextStageId = await resolveStageId(
    input.organizationId,
    input.plan.desiredPipelineSemantic,
    input.stage
  );
  if (nextStageId) patch.stageId = nextStageId;

  await persistLeadPatch(input.organizationId, input.lead.id, patch);
  publishConversation(input.organizationId, input.conversationId);
}

async function persistDeliveryFacts(
  organizationId: string,
  leadId: string,
  plan: SalesPlan
): Promise<void> {
  if (plan.lane === "human" || plan.shouldHandoff) return;

  const now = new Date();
  const patch: Record<string, unknown> = { updatedAt: now };
  if (plan.nextAction === "present_price") {
    patch.pricePresentedAt = now;
  }
  if (
    plan.nextAction === "show_operations_demo" ||
    plan.nextAction === "show_online_enrollment_demo"
  ) {
    patch.demoShownAt = now;
  }
  if (Object.keys(patch).length === 1) return;
  await persistLeadPatch(organizationId, leadId, patch);
}

async function persistLeadPatch(
  organizationId: string,
  leadId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.lead)
    .set(patch)
    .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.id, leadId)));
}

async function resolveStageId(
  organizationId: string,
  semantic: PipelineSemantic | null,
  current: Stage
): Promise<string | null> {
  if (!semantic || semantic === "won") return null;
  const db = getDb();
  const stages = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const match = matchSemanticStage(semantic, stages);
  if (!match || match.id === current.id) return null;
  return match.id;
}

/** Resuelve etapa por semántica. Nunca elige `kind=won`. */
export function matchSemanticStage(
  semantic: PipelineSemantic,
  stages: Stage[]
): Stage | undefined {
  if (semantic === "lost") {
    return stages.find((stage) => stage.kind === "lost");
  }
  if (semantic === "interested") {
    return stages.find(
      (stage) => stage.kind === "open" && /interesado/i.test(stage.name)
    );
  }
  if (semantic === "active_conversation") {
    return stages.find(
      (stage) =>
        stage.kind === "open" && /conversaci[oó]n/i.test(stage.name)
    );
  }
  return undefined;
}

function toSemantic(stage: Stage): PipelineSemantic | null {
  if (stage.kind === "won") return "won";
  if (stage.kind === "lost") return "lost";
  if (/interesado/i.test(stage.name)) return "interested";
  if (/conversaci[oó]n/i.test(stage.name)) return "active_conversation";
  if (/^nuevo$/i.test(stage.name)) return "new";
  return stage.kind === "open" ? "active_conversation" : null;
}

async function loadLeadContext(
  organizationId: string,
  leadId: string
): Promise<{ lead: Lead; stage: Stage } | null> {
  const db = getDb();
  const rows = await db
    .select({ lead: schema.lead, stage: schema.pipelineStage })
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
  return row ?? null;
}

async function loadKb(organizationId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
}

function publishConversation(organizationId: string, conversationId: string): void {
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversationId } },
  });
}

function sanitizeError(detail: string): string {
  return detail.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 500);
}
