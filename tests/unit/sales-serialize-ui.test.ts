import { describe, expect, it } from "vitest";
import { serializeLeadSalesState } from "@/server/sales/serialize-ui";
import type { schema } from "@/lib/db";

type Lead = typeof schema.lead.$inferSelect;

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: "ld_1",
    organizationId: "org_1",
    contactId: "ct_1",
    stageId: "st_1",
    position: 0,
    lastActivityAt: null,
    automationLane: "auto",
    demoShownAt: null,
    pricePresentedAt: null,
    paymentInstructionsSentAt: null,
    humanRequestedAt: null,
    nextFollowUpAt: null,
    followUpCount: 0,
    followUpReason: null,
    lastJevEvaluatedAt: null,
    lastJevDecision: null,
    lastJevError: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

describe("serializeLeadSalesState", () => {
  it("no filtra probabilities crudas al cliente", () => {
    const dto = serializeLeadSalesState(
      lead({
        lastJevEvaluatedAt: new Date("2026-09-20T12:00:00Z"),
        lastJevDecision: {
          decision: {
            nextAction: {
              type: "choice",
              choice: "present_price",
              probabilities: { present_price: 0.4, ask_more_questions: 0.3 },
              confidence: 0.88,
            },
            buyingTiming: { type: "choice", choice: "now" },
            realOperationalNeed: { type: "noul", noul: 0.9 },
            productFit: { type: "score", score: 0.8 },
            purchaseIntent: { type: "score", score: 0.7 },
          },
        },
      })
    );
    expect(dto.snapshot?.nextAction).toBe("present_price");
    expect(dto.snapshot?.nextActionConfidence).toBe(0.88);
    expect(JSON.stringify(dto)).not.toContain("probabilities");
    expect(dto.snapshot).not.toHaveProperty("probabilities");
  });

  it("expone lane y hechos durables", () => {
    const dto = serializeLeadSalesState(
      lead({
        automationLane: "wait",
        demoShownAt: new Date("2026-09-01T00:00:00Z"),
        nextFollowUpAt: new Date("2026-10-01T00:00:00Z"),
      })
    );
    expect(dto.lane).toBe("wait");
    expect(dto.demoShownAt).toBeTruthy();
    expect(dto.pricePresentedAt).toBeNull();
    expect(dto.nextFollowUpAt).toBeTruthy();
    expect(dto.followUpCount).toBe(0);
    expect(dto.followUpReason).toBeNull();
  });

  it("expone count/reason y no filtra secretos ni errores técnicos", () => {
    const dto = serializeLeadSalesState(
      lead({
        followUpCount: 2,
        followUpReason: "template_required",
        lastJevError: "Bearer sk-secret Graph 500",
      })
    );
    expect(dto.followUpCount).toBe(2);
    expect(dto.followUpReason).toBe("template_required");
    const raw = JSON.stringify(dto);
    expect(raw).not.toContain("sk-secret");
    expect(raw).not.toContain("Bearer");
    expect(raw).not.toContain("lastJevError");
    expect(dto).not.toHaveProperty("lastJevError");
    expect(dto).not.toHaveProperty("lastJevDecision");
  });
});
