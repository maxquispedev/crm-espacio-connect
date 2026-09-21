import type { NextActionChoice, NormalizedNoul } from "@/server/sales/answers";
import type { SalesDecision } from "@/server/sales/decision";
import type { AutomationLane } from "@/server/sales/lanes";

/**
 * P(true) mínima para que `needs_human_call` escale a HUMAN.
 * Override secundario: `schedule_call` escala aunque esta probabilidad sea menor.
 * Conservador: no convertir incertidumbre pequeña en handoff.
 */
export const NEEDS_HUMAN_CALL_THRESHOLD = 0.7;

export type PipelineSemantic =
  | "new"
  | "active_conversation"
  | "interested"
  | "won"
  | "lost";

export type DurableSalesFacts = {
  automationLane: AutomationLane;
  demoShownAt?: string | Date | null;
  pricePresentedAt: string | Date | null;
  paymentInstructionsSentAt: string | Date | null;
  humanRequestedAt?: string | Date | null;
  followUpCount?: number;
};

export type ResolveSalesPlanInput = {
  decision: SalesDecision;
  currentSalesState: DurableSalesFacts;
  currentPipelineStage: PipelineSemantic | null;
};

export type FollowUpDirective =
  | { kind: "none" }
  | { kind: "schedule"; reason: "future_season" | "scheduled_follow_up" };

/**
 * Hechos que este plan autoriza ahora. demo/precio/pago se marcan
 * tras entrega exitosa, no aquí. `humanRequestedAt` solo si el prospecto
 * lo pidió de forma estructurada; Jev no lo distingue de complejidad.
 */
export type SalesFactUpdates = {
  humanRequestedAt?: "now";
};

export type SalesPlan = {
  lane: AutomationLane;
  nextAction: NextActionChoice;
  shouldReply: boolean;
  shouldHandoff: boolean;
  handoffReason: "commercial" | null;
  desiredPipelineSemantic: PipelineSemantic | null;
  factUpdates: SalesFactUpdates;
  followUpDirective: FollowUpDirective;
};

/**
 * Convierte la decisión de Jev + hechos durables en un plan ejecutable.
 * Pura: sin I/O, sin IDs de etapa, sin lead score.
 */
export function resolveSalesPlan(input: ResolveSalesPlanInput): SalesPlan {
  const nextAction = input.decision.nextAction.choice;
  const stage = input.currentPipelineStage;

  if (nextAction === "disqualify") {
    return makePlan({
      lane: "stop",
      nextAction,
      shouldReply: true,
      shouldHandoff: false,
      desiredPipelineSemantic: pipelineIntent("lost", stage),
      followUpDirective: { kind: "none" },
    });
  }

  if (nextAction === "schedule_call") {
    return humanPlan(nextAction, stage);
  }

  if (isClearlyPositiveHumanCall(input.decision.needsHumanCall)) {
    return humanPlan(nextAction, stage);
  }

  if (nextAction === "schedule_follow_up") {
    return makePlan({
      lane: "wait",
      nextAction,
      shouldReply: true,
      shouldHandoff: false,
      desiredPipelineSemantic: pipelineIntent("interested", stage),
      followUpDirective: {
        kind: "schedule",
        reason:
          input.decision.buyingTiming.choice === "future_season"
            ? "future_season"
            : "scheduled_follow_up",
      },
    });
  }

  if (nextAction === "present_price") {
    return autoClosePlan(nextAction, stage);
  }

  if (alreadyInClose(input.currentSalesState)) {
    return autoClosePlan(nextAction, stage);
  }

  if (
    nextAction === "ask_more_questions" ||
    nextAction === "show_operations_demo" ||
    nextAction === "show_online_enrollment_demo"
  ) {
    return makePlan({
      lane: "auto",
      nextAction,
      shouldReply: true,
      shouldHandoff: false,
      desiredPipelineSemantic: pipelineIntent("active_conversation", stage),
      followUpDirective: { kind: "none" },
    });
  }

  return holdCurrent(input);
}

export function isClearlyPositiveHumanCall(
  answer: NormalizedNoul
): boolean {
  const trueProbability = answer.probabilities?.true;
  const probability =
    typeof trueProbability === "number" ? trueProbability : answer.noul;
  return probability >= NEEDS_HUMAN_CALL_THRESHOLD;
}

function alreadyInClose(state: DurableSalesFacts): boolean {
  return hasFact(state.pricePresentedAt) || hasFact(state.paymentInstructionsSentAt);
}

function hasFact(value: string | Date | null | undefined): boolean {
  return value !== null && value !== undefined && value !== "";
}

function humanPlan(
  nextAction: NextActionChoice,
  stage: PipelineSemantic | null
): SalesPlan {
  return makePlan({
    lane: "human",
    nextAction,
    shouldReply: true,
    shouldHandoff: true,
    desiredPipelineSemantic: pipelineIntent("interested", stage),
    followUpDirective: { kind: "none" },
  });
}

function autoClosePlan(
  nextAction: NextActionChoice,
  stage: PipelineSemantic | null
): SalesPlan {
  return makePlan({
    lane: "auto_close",
    nextAction,
    shouldReply: true,
    shouldHandoff: false,
    desiredPipelineSemantic: pipelineIntent("interested", stage),
    followUpDirective: { kind: "none" },
  });
}

function holdCurrent(input: ResolveSalesPlanInput): SalesPlan {
  return makePlan({
    lane: input.currentSalesState.automationLane,
    nextAction: input.decision.nextAction.choice,
    shouldReply: false,
    shouldHandoff: false,
    desiredPipelineSemantic: null,
    followUpDirective: { kind: "none" },
  });
}

function pipelineIntent(
  desired: PipelineSemantic,
  current: PipelineSemantic | null
): PipelineSemantic | null {
  if (desired === "won") return null;
  if (current === "won") return null;
  return desired;
}

function makePlan(input: {
  lane: AutomationLane;
  nextAction: NextActionChoice;
  shouldReply: boolean;
  shouldHandoff: boolean;
  desiredPipelineSemantic: PipelineSemantic | null;
  followUpDirective: FollowUpDirective;
}): SalesPlan {
  return {
    ...input,
    handoffReason: input.shouldHandoff ? "commercial" : null,
    factUpdates: {},
  };
}
