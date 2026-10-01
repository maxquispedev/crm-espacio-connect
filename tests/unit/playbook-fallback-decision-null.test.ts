/**
 * T305 — Cuando el playbook apaga un known signal o el proveedor no
 * lo trae, `decision.buyingTiming` y/o `decision.mainValueProposition`
 * son `null`. El resolver y el writer NO deben fallar; deben
 * aplicar los fallbacks explícitos documentados.
 *
 *   - `resolve-plan.ts`: si `buyingTiming === null` → tratar como
 *     `"unknown"`; el branching `future_season` no se ejecuta.
 *   - `writer.ts`: si `mainValueProposition === null` → no incluir
 *     línea de ángulo; si `buyingTiming === null` → no incluir línea
 *     de timing.
 *   - `follow-up-writer.ts`: tolerar `null` con fallbacks
 *     `"unspecified"`/`"unknown"`.
 */
import { describe, expect, it } from "vitest";

import { resolveSalesPlan } from "@/server/sales/resolve-plan";
import type { SalesDecision } from "@/server/sales/decision";
import { BASE_FACTS } from "./sales-fixtures";

function decisionWithNulls(
  over: Partial<{
    buyingTiming: SalesDecision["buyingTiming"];
    mainValueProposition: SalesDecision["mainValueProposition"];
  }> = {}
): SalesDecision {
  return {
    realOperationalNeed: { type: "noul", noul: 0.5 },
    productFit: { type: "score", score: 2 },
    motivationToChange: { type: "score", score: 1.5 },
    purchaseIntent: { type: "score", score: 1 },
    buyingTiming: over.buyingTiming !== undefined ? over.buyingTiming : null,
    mainValueProposition:
      over.mainValueProposition !== undefined
        ? over.mainValueProposition
        : null,
    nextAction: { type: "choice", choice: "schedule_follow_up" },
    needsHumanCall: { type: "noul", noul: 0.1 },
    signals: {},
  };
}

describe("fallback con decision.* null (T305)", () => {
  it("resolve-plan: buyingTiming null → fallback a scheduled_follow_up (no future_season)", () => {
    const plan = resolveSalesPlan({
      decision: decisionWithNulls({ buyingTiming: null }),
      currentSalesState: BASE_FACTS,
      currentPipelineStage: "interested",
    });
    expect(plan.lane).toBe("wait");
    expect(plan.followUpDirective).toEqual({
      kind: "schedule",
      reason: "scheduled_follow_up",
    });
  });

  it("resolve-plan: buyingTiming = this_year → mantiene future_season (branching V2)", () => {
    const plan = resolveSalesPlan({
      decision: decisionWithNulls({
        buyingTiming: { type: "choice", choice: "this_year" },
      }),
      currentSalesState: BASE_FACTS,
      currentPipelineStage: "interested",
    });
    expect(plan.followUpDirective).toEqual({
      kind: "schedule",
      reason: "future_season",
    });
  });

  it("resolve-plan: todos los known signals null + next_action válido → plan ejecutable", () => {
    const plan = resolveSalesPlan({
      decision: decisionWithNulls({
        buyingTiming: null,
        mainValueProposition: null,
      }),
      currentSalesState: BASE_FACTS,
      currentPipelineStage: "interested",
    });
    expect(plan.nextAction).toBe("schedule_follow_up");
    expect(plan.lane).toBe("wait");
  });
});
