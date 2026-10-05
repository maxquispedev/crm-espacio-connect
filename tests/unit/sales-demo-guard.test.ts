import { describe, expect, it } from "vitest";
import { hasOnlyGenericCuriosity } from "@/server/sales/demo-guard";
import { resolveSalesPlan } from "@/server/sales/resolve-plan";
import { makeDecision, BASE_FACTS } from "./sales-fixtures";

const turns = (...texts: string[]) => texts.map(text => ({ from: "lead" as const, text }));
describe("guard conservador de curiosidad", () => {
  it.each(["Hola", "¡Hola! Quiero más información", "Buenas tardes, quisiera información por favor", "Más información", "Me interesa saber más información"])("bloquea opener %s", text => {
    expect(hasOnlyGenericCuriosity(turns(text))).toBe(true);
  });
  it.each(["Quiero ver cómo controlan los pagos pendientes", "¿Me puedes mostrar cómo funciona eso de los saldos?", "Enséñame el sistema", "Lo llevo en Excel y no sé quién debe", "Necesito controlar las inscripciones", "sí", "[audio]", "Hola, quiero información de pagos"])("no interpreta texto concreto/ambiguo: %s", text => {
    expect(hasOnlyGenericCuriosity(turns(text))).toBe(false);
  });
  it("ignora vendedor, conserva problema anterior y no interpreta hilo vacío", () => {
    expect(hasOnlyGenericCuriosity([...turns("Hola"), { from: "seller", text: "¿Se te pierden los pagos?" }])).toBe(true);
    expect(hasOnlyGenericCuriosity(turns("Se me pierden los Yapes", "quiero información"))).toBe(false);
    expect(hasOnlyGenericCuriosity([])).toBe(false);
  });
  it.each(["demoShownAt", "pricePresentedAt", "paymentInstructionsSentAt", "humanRequestedAt"])("fact durable %s protege contexto recortado", key => {
    expect(resolveSalesPlan({ decision: makeDecision({ nextAction: "show_operations_demo" }),
      conversation: turns("Hola"), currentSalesState: { ...BASE_FACTS, [key]: new Date() }, currentPipelineStage: "interested" }).nextAction).toBe("show_operations_demo");
  });
  it("no bloquea demo con scores bajos si pidió verla", () => {
    const decision = makeDecision({ nextAction: "show_operations_demo" });
    decision.realOperationalNeed!.noul = 0.16;
    expect(resolveSalesPlan({ decision, conversation: turns("Enséñame el sistema"),
      currentSalesState: BASE_FACTS, currentPipelineStage: "new" }).nextAction).toBe("show_operations_demo");
  });
});
