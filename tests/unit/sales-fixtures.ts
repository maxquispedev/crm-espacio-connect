import type { SalesDecision } from "@/server/sales/decision";
import type { DurableSalesFacts } from "@/server/sales/resolve-plan";
import type {
  BuyingTimingChoice,
  NextActionChoice,
} from "@/server/sales/answers";

export const BASE_FACTS: DurableSalesFacts = {
  automationLane: "auto",
  demoShownAt: null,
  pricePresentedAt: null,
  paymentInstructionsSentAt: null,
  humanRequestedAt: null,
  followUpCount: 0,
};

export function makeDecision(overrides?: {
  nextAction?: NextActionChoice;
  buyingTiming?: BuyingTimingChoice;
  needsHumanNoul?: number;
  needsHumanTrue?: number;
}): SalesDecision {
  const needsHumanCall: SalesDecision["needsHumanCall"] = {
    type: "noul",
    noul: overrides?.needsHumanNoul ?? 0.1,
  };
  if (overrides?.needsHumanTrue !== undefined) {
    needsHumanCall.probabilities = { true: overrides.needsHumanTrue };
  }

  return {
    realOperationalNeed: { type: "noul", noul: 0.8 },
    productFit: { type: "score", score: 0.7 },
    motivationToChange: { type: "score", score: 0.55 },
    purchaseIntent: { type: "score", score: 0.5 },
    buyingTiming: {
      type: "choice",
      choice: overrides?.buyingTiming ?? "unknown",
    },
    mainValueProposition: {
      type: "choice",
      choice: "operational_control",
    },
    nextAction: {
      type: "choice",
      choice: overrides?.nextAction ?? "ask_more_questions",
    },
    needsHumanCall,
  };
}

export function validJevRaw(nextAction: string = "ask_more_questions"): {
  model: string;
  answers: Record<string, Record<string, unknown>>;
} {
  return {
    model: "jev-test",
    answers: {
      real_operational_need: { type: "noul", noul: 0.82 },
      product_fit: { type: "score", score: 0.7 },
      motivation_to_change: { type: "score", score: 0.5 },
      purchase_intent: { type: "score", score: 0.4 },
      buying_timing: { type: "choice", choice: "unknown" },
      main_value_proposition: {
        type: "choice",
        choice: "operational_control",
      },
      next_action: { type: "choice", choice: nextAction },
      needs_human_call: { type: "noul", noul: 0.12 },
    },
  };
}
