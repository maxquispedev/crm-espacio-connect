import { describe, expect, it } from "vitest";
import { exportBounds, exportInputSchema } from "@/server/commercial-export/input";
import { safeCustomData, safeDeliveryPlan, safeFileName, safeJev } from "@/server/commercial-export/safe-json";

const valid = { date_from: "2026-10-06", date_to: "2026-10-06" };
describe("commercial export contract", () => {
  it("inclusive Lima days become exact half-open UTC boundaries", () => {
    expect(exportBounds(exportInputSchema.parse(valid))).toEqual({
      from: new Date("2026-10-06T05:00:00Z"), until: new Date("2026-10-07T05:00:00Z"),
    });
  });
  it.each(["2026-02-29", "2026-02-30", "2026-13-01", "2026-10-00", "invalid", "2026-10-06T00:00:00Z"])("rejects invalid date %s", date => {
    expect(exportInputSchema.safeParse({ ...valid, date_from: date }).success).toBe(false);
  });
  it("supports leap day and year rollover independent of server TZ", () => {
    expect(exportInputSchema.safeParse({ date_from: "2024-02-29", date_to: "2024-02-29" }).success).toBe(true);
    expect(exportBounds(exportInputSchema.parse({ date_from: "2026-12-31", date_to: "2026-12-31" })).until.toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });
  it("rejects inverted range, tenant and conversation selectors, bool coercion", () => {
    for (const input of [{ date_from: "2026-10-07", date_to: "2026-10-06" },
      { ...valid, organization_id: "B" }, { ...valid, conversation_id: "B" },
      { ...valid, lead_id: "B" }, { ...valid, ad_attributed_only: "false" }]) {
      expect(exportInputSchema.safeParse(input).success).toBe(false);
    }
  });
  it("normalizes optional source IDs and bounds their size", () => {
    expect(exportInputSchema.parse({ ...valid, source_ids: [" ad-1 "] }).source_ids).toEqual(["ad-1"]);
    expect(exportInputSchema.safeParse({ ...valid, source_ids: [""] }).success).toBe(false);
    expect(exportInputSchema.safeParse({ ...valid, source_ids: Array(21).fill("ad") }).success).toBe(false);
  });
  it("preserves commercial Jev decision and effective plan without arbitrary raw JSON", () => {
    const result = safeJev({ snapshot: { token: "secret" }, phone: "private",
      decision: { nextAction: { type: "choice", choice: "present_price", confidence: .9, phone: "private" },
        purchaseIntent: { score: 2.4 }, buyingTiming: null, token: "secret" },
      plan: { lane: "auto_close", nextAction: "ask_more_questions", shouldHandoff: false, token: "secret" } });
    expect(result?.decision.nextAction).toEqual({ type: "choice", choice: "present_price", confidence: .9 });
    expect(result?.plan?.nextAction).toBe("ask_more_questions");
    expect(JSON.stringify(result)).not.toMatch(/phone|token|secret|snapshot/);
    expect(safeJev(null)).toBeNull();
  });
  it("allowlists custom_data and delivery plan", () => {
    expect(safeCustomData({ lead_stage: "won", value: 247, currency: "PEN", ctwaClid: "private", nested: { token: "secret" } }))
      .toEqual({ lead_stage: "won", value: 247, currency: "PEN" });
    expect(safeDeliveryPlan({ salesPlan: { lane: "auto", nextAction: "present_price", phone: "private" },
      scheduleFollowUp: true, token: "secret" })).toEqual({ sales_plan: { lane: "auto", nextAction: "present_price" }, scheduleFollowUp: true });
  });
  it("never exports paths as filenames", () => {
    expect(safeFileName("/data/private/video.mp4")).toBe("video.mp4");
    expect(safeFileName("C:\\private\\video.mp4")).toBe("video.mp4");
    expect(safeFileName(null)).toBeNull();
  });
});
