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
    expect(parsed.data).toEqual({ commercial_evidence: "unknown", text: "Hola, te cuento el precio." });
    expect(parsed.data).not.toHaveProperty("action");
    expect(parsed.data).not.toHaveProperty("move_stage");
  });

  it("acepta text null", () => {
    expect(SalesWriterOutput.parse({ text: null })).toEqual({ commercial_evidence: "unknown", text: null });
  });
});

describe("writeSalesReply", () => {
  beforeEach(() => {
    chatJson.mockReset();
    chatJson.mockResolvedValue({ ok: true, data: { commercial_evidence: "supported", text: "redactado" }, raw: "{}" });
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


describe("016 — evidencia antes de redactar", () => {
  const decision = makeDecision({ nextAction: "ask_more_questions" });
  const plan = resolveSalesPlan({ decision, currentSalesState: BASE_FACTS, currentPipelineStage: "interested" });
  it("Roberto: producto contiene asistencia/sesiones incluso con Published antigua", async () => {
    chatJson.mockResolvedValue({ ok: true, data: { commercial_evidence: "supported", text: "Sí, puedes registrar la asistencia de los alumnos y llevar el control de sus sesiones. ¿Hoy cómo la registran?" } });
    const conversation = ["Precio", "S/247 al mes", "¿Qué incluye el servicio?", "Alumnos y pagos", "Necesito un control de asistencia"].map((text, i) => ({ from: i % 2 === 0 ? "lead" as const : "seller" as const, text }));
    const result = await writeSalesReply({ decision, plan, conversation, kb: [], facts: BASE_FACTS });
    expect(result).toMatchObject({ commercialEvidence: "supported", text: expect.stringContaining("asistencia") });
    expect(chatJson.mock.calls.at(-1)![1][0].content).toContain("registro de asistencia de alumnos y control/consumo de sesiones");
  });
  it.each(["¿Se integra directamente con SistemaNoDocumentado?", "¿Puedo migrar 3,000 alumnos desde X?", "¿Tiene API para X?", "¿Incluyen tal desarrollo especial?"])("%s: unknown suprime incluso texto de incertidumbre", async text => {
    chatJson.mockResolvedValue({ ok: true, data: { commercial_evidence: "unknown", text: "No tengo confirmado, creo que sí" } });
    expect(await writeSalesReply({ decision, plan, conversation: [{ from: "lead", text }], kb: [], facts: BASE_FACTS })).toEqual({ ok: true, text: null, commercialEvidence: "unknown" });
  });
  it("sin clasificación nunca autoriza outbound", async () => {
    chatJson.mockResolvedValue({ ok: true, data: { text: "Sí, se integra" } });
    expect(await writeSalesReply({ decision, plan, conversation: [{ from: "lead", text: "¿Se integra con X?" }], kb: [], facts: BASE_FACTS })).toMatchObject({ text: null, commercialEvidence: "unknown" });
  });
  it("falta contexto de academia conserva pregunta", async () => {
    chatJson.mockResolvedValue({ ok: true, data: { commercial_evidence: "context_needed", text: "¿Qué te cuesta más controlar hoy?" } });
    expect(await writeSalesReply({ decision, plan, conversation: [{ from: "lead", text: "Necesito algo para controlar mejor mi academia" }], kb: [], facts: BASE_FACTS })).toMatchObject({ text: "¿Qué te cuesta más controlar hoy?", commercialEvidence: "context_needed" });
  });
});

describe("020 — opener por anuncio y copy runtime", () => {
  const decision = makeDecision({ nextAction: "ask_more_questions" });
  const plan = resolveSalesPlan({ decision, currentSalesState: BASE_FACTS, currentPipelineStage: "new" });
  it.each([
    ["Controla pagos y saldos pendientes", /quién pagó.*cuánto pagó.*cuánto falta cobrar/],
    ["Prepárate antes del verano", /verano.*alumnos, pagos, horarios y consultas/],
    ["Toda tu academia, en un solo lugar", /centraliza alumnos, apoderados, planes y horarios/],
    ["Ten tu academia bajo control", /operación.*Excel, papel y WhatsApp/],
  ])("%s: beneficio y una pregunta, sin asumir dolor", async (headline, content) => {
    const result = await writeSalesReply({ decision, plan, facts: BASE_FACTS, kb: [],
      conversation: [{ from: "lead", text: "¡Hola! Quiero más información" }],
      adContext: { source_type: "ad", headline: String(headline), body: "Pagos y saldos" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toMatch(content as RegExp);
    expect(result.text!.match(/\?/g)).toHaveLength(1);
    expect(result.text!.length).toBeLessThan(260);
    expect(result.text).not.toMatch(/tienes deudas|tus morosos|se te pierden/);
  });
  it("retry omite camino fijo, explicita texto enviado y última respuesta", async () => {
    chatJson.mockReset();
    chatJson.mockResolvedValue({ ok: true, data: { commercial_evidence: "supported", text: "Además puedes consultar los saldos por alumno." } });
    const result = await writeSalesReply({ decision, plan, facts: BASE_FACTS, kb: [], rejectedReply: "Opener enviado",
      conversation: [{ from: "lead", text: "Hola" }, { from: "seller", text: "Opener enviado" }, { from: "lead", text: "Más información" }] });
    expect(chatJson).toHaveBeenCalledOnce();
    const prompt = JSON.stringify(chatJson.mock.calls[0]![1]);
    expect(prompt).toContain("Opener enviado"); expect(prompt).toContain("No repitas la misma pregunta");
    expect(prompt).toContain("Más información"); expect(result).toMatchObject({ text: expect.stringContaining("Además") });
  });
  it("precio ignora copy antiguo de override y da instrucciones naturales", async () => {
    chatJson.mockReset(); chatJson.mockResolvedValue({ ok: true, data: { commercial_evidence: "supported", text: "S/247 al mes" } });
    const d = makeDecision({ nextAction: "present_price" });
    await writeSalesReply({ decision: d, plan: resolveSalesPlan({ decision: d, currentSalesState: BASE_FACTS, currentPipelineStage: "new" }), facts: BASE_FACTS, kb: [],
      conversation: [{ from: "lead", text: "Precio" }], writerInstructions: { present_price: "ANTIGUA: no tiene costo de setup, no existe fee por adelantado" } });
    const prompt = JSON.stringify(chatJson.mock.calls[0]![1]);
    expect(prompt).not.toContain("ANTIGUA"); expect(prompt).not.toContain("sin costo de setup");
    expect(prompt).toContain("primeros 30 días"); expect(prompt).toContain("Empieza por el precio");
    expect(prompt).toContain("no exijas esa cantidad"); expect(prompt).toContain("S/247");
  });
});
