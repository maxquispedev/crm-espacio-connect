import { describe, expect, it } from "vitest";
import { duplicatesAutomaticText, hasBroadPrioritizationReply } from "@/server/sales/conversation-guards";
import { resolveSalesPlan } from "@/server/sales/resolve-plan";
import { selectDemoSlot } from "@/server/sales/demo-routing";
import { BASE_FACTS, makeDecision } from "./sales-fixtures";
import type { JevConversationTurn } from "@/server/sales/state";
const question = "¿Qué se te desordena más: alumnos, pagos, horarios o saldos?";
const turns = (answer: string, text = question): JevConversationTurn[] => [{ from: "seller", text }, { from: "lead", text: answer }];
const resolve = (conversation = turns("Todos"), facts = BASE_FACTS, action: Parameters<typeof makeDecision>[0] = {}) => resolveSalesPlan({
  decision: makeDecision({ nextAction: "ask_more_questions", ...action }), conversation, currentSalesState: facts, currentPipelineStage: "active_conversation" });

describe("020 — priorización amplia conservadora", () => {
  it.each(["Todos", "todo", "varios", "Todos esos", "todo eso", "¡Todos!", "todas"])("%s corta la primera repregunta", answer => {
    const conversation = turns(answer);
    expect(hasBroadPrioritizationReply(conversation)).toBe(true);
    expect(resolve(conversation)).toMatchObject({ nextAction: "show_operations_demo", questionLoopGuardReason: "broad_operational_need" });
    expect(selectDemoSlot("show_operations_demo", conversation, { source_type: "ad", headline: "Controla pagos", body: null })).toBe("demo_enrollment_panel");
  });
  it.each(["todos los alumnos", "no todos", "varios quizá", "todos pero quiero precio", "no", "pagos y saldos"])("ambiguo/específico %s no fuerza acción", answer => {
    expect(hasBroadPrioritizationReply(turns(answer))).toBe(false);
    expect(resolve(turns(answer)).nextAction).toBe("ask_more_questions");
  });
  it.each(["¿Cuántos alumnos hay?", "¿Todos recibieron el aviso?", "¿Qué medios de pago usas más?", "¿Qué quieres?", "¿Alumnos, pagos, horarios o saldos?"])("%s no es priorización suficiente", question => {
    expect(hasBroadPrioritizationReply(turns("todos", question))).toBe(false);
  });
  it("todos sin pregunta o con otro lead interpuesto no basta", () => {
    expect(hasBroadPrioritizationReply([{ from: "lead", text: "Todos" }])).toBe(false);
    expect(hasBroadPrioritizationReply([{ from: "seller", text: question }, { from: "lead", text: "Excel" }, { from: "lead", text: "Todos" }])).toBe(false);
  });
  it("cuál de esos temas requiere lista inmediatamente anterior", () => {
    const q = "¿Cuál de esos temas se te hace más difícil controlar hoy?";
    expect(hasBroadPrioritizationReply(turns("Todos", q))).toBe(false);
    expect(hasBroadPrioritizationReply([{ from: "seller", text: "Alumnos, pagos, horarios y saldos" }, { from: "lead", text: "Con excel" }, ...turns("Todos", q)])).toBe(true);
  });
  it.each(["demoShownAt", "pricePresentedAt", "paymentInstructionsSentAt", "humanRequestedAt"] as const)("%s prevalece", key => {
    expect(resolve(undefined, { ...BASE_FACTS, [key]: new Date() }).nextAction).toBe("ask_more_questions");
  });
  it.each(["human", "stop"] as const)("lane %s no autoriza demo", automationLane => {
    expect(resolve(undefined, { ...BASE_FACTS, automationLane }).nextAction).toBe("ask_more_questions");
  });
  it.each(["present_price", "send_payment_instructions", "schedule_call", "disqualify", "schedule_follow_up"] as const)("propuesta %s intacta", nextAction => {
    expect(resolve(undefined, undefined, { nextAction }).nextAction).toBe(nextAction);
  });
  it("needsHumanCall prevalece", () => {
    expect(resolve(undefined, undefined, { needsHumanNoul: 0.9 })).toMatchObject({ lane: "human", shouldHandoff: true, nextAction: "ask_more_questions" });
  });
  it("fixture bug de dos Todos corta en el primero; solo historial antiguo no activa guard", () => {
    const first = turns("Todos");
    expect(resolve(first).nextAction).toBe("show_operations_demo");
    const oldBug: JevConversationTurn[] = [...first, { from: "seller", text: "¿Qué suele complicarte primero?" }, { from: "lead", text: "Todos" }];
    expect(hasBroadPrioritizationReply(oldBug)).toBe(false);
    expect(selectDemoSlot("show_operations_demo", [{ from: "lead", text: "Con excel" }, { from: "seller", text: question }, { from: "lead", text: "Pagos y saldos" }])).toBe("demo_payments_balances");
  });
});
describe("020 — duplicación textual", () => {
  it.each(["  CLARO 😊  información\n adicional  ", "Claro 😊 informacio\u0301n adicional"])("normaliza superficialmente %s", text => {
    expect(duplicatesAutomaticText(text, ["Claro 😊 información adicional"])).toBe(true);
  });
  it("compara todos los candidatos recientes y permite información nueva", () => {
    expect(duplicatesAutomaticText("segunda", ["primera", "segunda", "tercera"])).toBe(true);
    expect(duplicatesAutomaticText("Algo adicional", ["Algo"])).toBe(false);
    expect(duplicatesAutomaticText("  ", [" "])).toBe(false);
  });
});

describe("020 — tema publicitario sin IDs", () => {
  it("headline verano prevalece sobre body de pagos; body sirve sin headline", async () => {
    const { adOpeningTopic } = await import("@/server/sales/demo-routing");
    expect(adOpeningTopic({ headline: "Prepárate antes del verano", body: "pagos y saldos", source_type: "ad" })).toBe("summer");
    expect(adOpeningTopic({ headline: null, body: "Controla pagos y saldos", source_type: "ad" })).toBe("payments");
    expect(adOpeningTopic()).toBe("control");
    expect(adOpeningTopic({ headline: "Una academia organizada", body: null, source_type: "ad" })).toBe("control");
  });
});
