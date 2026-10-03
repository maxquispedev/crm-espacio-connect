import { describe, expect, it } from "vitest";
import type { NextActionChoice } from "@/server/sales/answers";
import {
  NEEDS_HUMAN_CALL_THRESHOLD,
  isClearlyPositiveHumanCall,
  resolveSalesPlan,
} from "@/server/sales/resolve-plan";
import { BASE_FACTS, makeDecision } from "./sales-fixtures";

const NEXT_ACTIONS: NextActionChoice[] = [
  "ask_more_questions",
  "show_operations_demo",
  "show_online_enrollment_demo",
  "present_price",
  "schedule_call",
  "schedule_follow_up",
  "disqualify",
];

describe("resolveSalesPlan", () => {
  it("disqualify → STOP, lost, no won, sin handoff", () => {
    const plan = resolveSalesPlan({
      decision: makeDecision({ nextAction: "disqualify" }),
      currentSalesState: BASE_FACTS,
      currentPipelineStage: "new",
    });
    expect(plan.lane).toBe("stop");
    expect(plan.desiredPipelineSemantic).toBe("lost");
    expect(plan.desiredPipelineSemantic).not.toBe("won");
    expect(plan.shouldHandoff).toBe(false);
    expect(plan.shouldReply).toBe(true);
  });

  it("schedule_call → HUMAN + handoff commercial", () => {
    const plan = resolveSalesPlan({
      decision: makeDecision({ nextAction: "schedule_call" }),
      currentSalesState: BASE_FACTS,
      currentPipelineStage: "active_conversation",
    });
    expect(plan.lane).toBe("human");
    expect(plan.shouldHandoff).toBe(true);
    expect(plan.handoffReason).toBe("commercial");
  });

  it("needs_human_call en el umbral → HUMAN aunque next_action sea demo", () => {
    expect(NEEDS_HUMAN_CALL_THRESHOLD).toBe(0.7);
    const plan = resolveSalesPlan({
      decision: makeDecision({
        nextAction: "show_operations_demo",
        needsHumanNoul: 0.7,
      }),
      currentSalesState: BASE_FACTS,
      currentPipelineStage: "new",
    });
    expect(plan.lane).toBe("human");
    expect(plan.shouldHandoff).toBe(true);
  });

  it("needs_human_call bajo el umbral no escala", () => {
    const plan = resolveSalesPlan({
      decision: makeDecision({
        nextAction: "ask_more_questions",
        needsHumanNoul: 0.69,
      }),
      currentSalesState: BASE_FACTS,
      currentPipelineStage: "new",
    });
    expect(plan.lane).toBe("auto");
    expect(plan.shouldHandoff).toBe(false);
  });

  it("schedule_follow_up → WAIT y no inventa fecha de seguimiento", () => {
    const plan = resolveSalesPlan({
      decision: makeDecision({
        nextAction: "schedule_follow_up",
        buyingTiming: "future_season",
      }),
      currentSalesState: BASE_FACTS,
      currentPipelineStage: "interested",
    });
    expect(plan.lane).toBe("wait");
    expect(plan.shouldHandoff).toBe(false);
    expect(plan.followUpDirective).toEqual({
      kind: "schedule",
      reason: "future_season",
    });
    expect(plan).not.toHaveProperty("nextFollowUpAt");
  });

  it("present_price → AUTO_CLOSE", () => {
    const plan = resolveSalesPlan({
      decision: makeDecision({ nextAction: "present_price" }),
      currentSalesState: BASE_FACTS,
      currentPipelineStage: "active_conversation",
    });
    expect(plan.lane).toBe("auto_close");
    expect(plan.shouldHandoff).toBe(false);
  });

  it("precio ya presentado → AUTO_CLOSE aunque next_action sea preguntar", () => {
    const plan = resolveSalesPlan({
      decision: makeDecision({ nextAction: "ask_more_questions" }),
      currentSalesState: {
        ...BASE_FACTS,
        pricePresentedAt: new Date(),
      },
      currentPipelineStage: "interested",
    });
    expect(plan.lane).toBe("auto_close");
  });

  it("demos y preguntas caen en AUTO", () => {
    for (const nextAction of [
      "ask_more_questions",
      "show_operations_demo",
      "show_online_enrollment_demo",
    ] as const) {
      const plan = resolveSalesPlan({
        decision: makeDecision({ nextAction }),
        currentSalesState: BASE_FACTS,
        currentPipelineStage: "new",
      });
      expect(plan.lane).toBe("auto");
    }
  });

  it("ninguna next_action pide kind=won", () => {
    for (const nextAction of NEXT_ACTIONS) {
      const plan = resolveSalesPlan({
        decision: makeDecision({ nextAction }),
        currentSalesState: BASE_FACTS,
        currentPipelineStage: "interested",
      });
      expect(plan.desiredPipelineSemantic).not.toBe("won");
    }
  });

  it("no mueve un lead que ya está en won", () => {
    const plan = resolveSalesPlan({
      decision: makeDecision({ nextAction: "disqualify" }),
      currentSalesState: BASE_FACTS,
      currentPipelineStage: "won",
    });
    expect(plan.desiredPipelineSemantic).toBeNull();
    expect(plan.lane).toBe("stop");
  });
});

describe("isClearlyPositiveHumanCall", () => {
  it("usa noul cuando no hay probabilities.true", () => {
    expect(
      isClearlyPositiveHumanCall({ type: "noul", noul: 0.7 })
    ).toBe(true);
    expect(
      isClearlyPositiveHumanCall({ type: "noul", noul: 0.69 })
    ).toBe(false);
  });

  it("prioriza probabilities.true si viene en la respuesta", () => {
    expect(
      isClearlyPositiveHumanCall({
        type: "noul",
        noul: 0.1,
        probabilities: { true: 0.8 },
      })
    ).toBe(true);
  });
});
