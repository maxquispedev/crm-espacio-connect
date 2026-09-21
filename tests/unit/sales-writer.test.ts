import { beforeEach, describe, expect, it, vi } from "vitest";
import { SalesWriterOutput, writeSalesReply } from "@/server/sales/writer";
import { VENDE_VELOZ_OFFER } from "@/server/sales/vende-veloz";
import { resolveSalesPlan } from "@/server/sales/resolve-plan";
import { BASE_FACTS, makeDecision } from "./sales-fixtures";

const chatJson = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai", () => ({
  chatJson: (...args: unknown[]) => chatJson(...args),
}));

describe("SalesWriterOutput (contrato de redacción)", () => {
  it("solo admite { text } y descarta acciones ejecutables", () => {
    const parsed = SalesWriterOutput.safeParse({
      text: "Hola, te cuento el precio.",
      action: "handoff",
      move_stage: "Cliente",
      lane: "human",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual({ text: "Hola, te cuento el precio." });
    expect(parsed.data).not.toHaveProperty("action");
    expect(parsed.data).not.toHaveProperty("move_stage");
  });

  it("acepta text null", () => {
    expect(SalesWriterOutput.parse({ text: null })).toEqual({ text: null });
  });
});

describe("writeSalesReply", () => {
  beforeEach(() => {
    chatJson.mockReset();
    chatJson.mockResolvedValue({ ok: true, data: { text: "redactado" }, raw: "{}" });
  });

  it("si el plan no pide reply, no llama al LLM", async () => {
    const plan = resolveSalesPlan({
      decision: makeDecision({ nextAction: "ask_more_questions" }),
      currentSalesState: BASE_FACTS,
      currentPipelineStage: "won",
    });
    const silent = { ...plan, shouldReply: false };
    const result = await writeSalesReply({
      decision: makeDecision(),
      plan: silent,
      conversation: [],
      kb: [],
      facts: BASE_FACTS,
    });
    expect(result).toEqual({ ok: true, text: null });
    expect(chatJson).not.toHaveBeenCalled();
  });

  it("inyecta la oferta S/497 + S/197 + S/1 y prohíbe decidir pipeline/handoff", async () => {
    const plan = resolveSalesPlan({
      decision: makeDecision({ nextAction: "present_price" }),
      currentSalesState: BASE_FACTS,
      currentPipelineStage: "interested",
    });
    await writeSalesReply({
      decision: makeDecision({ nextAction: "present_price" }),
      plan,
      conversation: [{ from: "lead", text: "¿cuánto cuesta?" }],
      kb: [],
      facts: BASE_FACTS,
    });
    expect(chatJson).toHaveBeenCalledOnce();
    const messages = chatJson.mock.calls[0]![1] as { role: string; content: string }[];
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    expect(system).toContain(`S/${VENDE_VELOZ_OFFER.setup}`);
    expect(system).toContain(`S/${VENDE_VELOZ_OFFER.monthlyBase}`);
    expect(system).toContain(`+S/${VENDE_VELOZ_OFFER.extraPerActiveStudent}`);
    expect(system).toContain("S/497");
    expect(system).toContain("S/197");
    expect(system).toMatch(/move_stage/);
    expect(system).toMatch(/PROHIBIDO/);
    expect(VENDE_VELOZ_OFFER.setup).toBe(497);
    expect(VENDE_VELOZ_OFFER.monthlyBase).toBe(197);
    expect(VENDE_VELOZ_OFFER.extraPerActiveStudent).toBe(1);
  });

  it("si el proveedor falla, no inventa texto comercial", async () => {
    chatJson.mockResolvedValue({
      ok: false,
      error: "provider_error",
      detail: "timeout",
    });
    const plan = resolveSalesPlan({
      decision: makeDecision({ nextAction: "ask_more_questions" }),
      currentSalesState: BASE_FACTS,
      currentPipelineStage: "new",
    });
    const result = await writeSalesReply({
      decision: makeDecision(),
      plan,
      conversation: [],
      kb: [],
      facts: BASE_FACTS,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("provider_error");
  });
});
