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

  it("inyecta la oferta S/247 + S/1, declara la implementación incluida y prohíbe decidir pipeline/handoff", async () => {
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
    expect(system).toContain(`S/${VENDE_VELOZ_OFFER.monthlyBase}`);
    expect(system).toContain(`+S/${VENDE_VELOZ_OFFER.extraPerActiveStudent}`);
    expect(system).toContain("S/247");
    expect(system).toMatch(/move_stage/);
    expect(system).toMatch(/PROHIBIDO/);
    expect(VENDE_VELOZ_OFFER.setup).toBe(0);
    expect(VENDE_VELOZ_OFFER.monthlyBase).toBe(247);
    expect(VENDE_VELOZ_OFFER.extraPerActiveStudent).toBe(1);
  });

  it("con setup 0 nunca renderiza 'S/0': declara la implementación asistida incluida (DV-7)", async () => {
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
    const messages = chatJson.mock.calls[0]![1] as { role: string; content: string }[];
    const system = messages.find((m) => m.role === "system")?.content ?? "";

    // El hueco ejecutable de setup=0: antes producía "Implementación: S/0 una sola vez".
    expect(system).not.toMatch(/S\/0/);
    expect(system).not.toMatch(/una sola vez/);
    expect(system).toMatch(/Implementación asistida incluida/i);
    // Y el bloque de oferta conserva el resto de la oferta vigente.
    expect(system).toContain("S/247");
    expect(system).toContain("+S/1");
    expect(system).toContain("50");
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

  it.each(["ask_more_questions", "show_operations_demo", "show_online_enrollment_demo",
    "present_price", "schedule_call", "schedule_follow_up", "send_payment_instructions"] as const)(
    "HUMAN puro (%s) retorna null sin LLM pese a instrucciones antiguas", async nextAction => {
      const decision = makeDecision({ nextAction, needsHumanNoul: 0.82 });
      const plan = resolveSalesPlan({ decision, currentSalesState: BASE_FACTS, currentPipelineStage: "new" });
      expect(plan).toMatchObject({ lane: "human", shouldHandoff: true });
      const result = await writeSalesReply({ decision, plan, conversation: [], kb: [], facts: BASE_FACTS,
        writerInstructions: { [nextAction]: "Te paso con el equipo." },
        agentProfile: { instructions: "Te derivo con un asesor." } });
      expect(result).toEqual({ ok: true, text: null });
      expect(chatJson).not.toHaveBeenCalled();
    });

  it("schedule_call retorna null aun sin complejidad y en sandbox", async () => {
    const decision = makeDecision({ nextAction: "schedule_call" });
    const plan = resolveSalesPlan({ decision, currentSalesState: BASE_FACTS, currentPipelineStage: "new" });
    expect(await writeSalesReply({ decision, plan, conversation: [], kb: [], facts: BASE_FACTS, isTest: true }))
      .toEqual({ ok: true, text: null });
    expect(chatJson).not.toHaveBeenCalled();
  });

  it.each([true, false])("writer conoce disponibilidad demo=%s y redacta caption sin link de KB", async available => {
    const decision = makeDecision({ nextAction: "show_operations_demo" });
    const plan = resolveSalesPlan({ decision, currentSalesState: BASE_FACTS, currentPipelineStage: "new" });
    await writeSalesReply({ decision, plan, conversation: [], kb: [], facts: BASE_FACTS,
      demo: { slot: "demo_payments_balances", available } });
    const prompt = chatJson.mock.calls[0]![1][0].content;
    expect(prompt).toContain(available ? "SOLO el caption del video nativo" : "NO disponible");
    expect(prompt).not.toContain("Si la KB tiene un recurso real de demo, úsalo");
  });

});
