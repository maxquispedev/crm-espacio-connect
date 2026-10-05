import { describe, expect, it } from "vitest";
import { selectDemoSlot } from "@/server/sales/demo-routing";
import { demoCaption } from "@/server/sales/demo-resource";
import type { JevConversationTurn } from "@/server/sales/state";
const route = (...texts: string[]) => selectDemoSlot("show_operations_demo", texts.map(text => ({ from: "lead", text })));
describe("routing de demos — pedido vigente", () => {
  it.each(["pagos", "saldos", "voucher", "deuda", "matrículas y pagos", "No sé cómo controlar pagos"])("payments: %s", text => {
    expect(route(text)).toBe("demo_payments_balances");
  });
  it.each(["matrícula", "alumnos", "operación general"])("panel: %s", text => {
    expect(route("pagos", text)).toBe("demo_enrollment_panel");
  });
  it("petición de funcionamiento conserva tema previo o anuncio", () => {
    expect(route("pagos", "muéstrame cómo funciona")).toBe("demo_payments_balances");
    expect(selectDemoSlot("show_operations_demo", [{ from: "lead", text: "Enséñame el sistema" }],
      { source_type: "ad", headline: "Controla pagos y saldos pendientes", body: null })).toBe("demo_payments_balances");
    expect(selectDemoSlot("show_operations_demo", [{ from: "lead", text: "En realidad quiero ver cómo funciona la matrícula" }],
      { source_type: "ad", headline: "Controla pagos y saldos pendientes", body: null })).toBe("demo_enrollment_panel");
    expect(selectDemoSlot("show_operations_demo", [], { source_type: "ad", headline: null, body: "Controla tus pagos" })).toBe("demo_payments_balances");
  });
  it("cambio de panel a pagos y asentimiento conserva el pedido", () => {
    expect(route("alumnos", "muéstrame saldos", "sí por favor")).toBe("demo_payments_balances");
  });
  it.each(["no me interesan los pagos, quiero matrícula", "ya no quiero pagos", "sin saldos", "olvida los vouchers", "no pagos, matrícula", "no tengo deudas", "pagos ya los tengo controlados"])("negación: %s", text => {
    expect(route("pagos", text)).toBe("demo_enrollment_panel");
  });
  it("negación de panel no veta pagos positivos", () => {
    expect(route("no quiero matrícula, mejor pagos")).toBe("demo_payments_balances");
  });
  it("ignora menciones del vendedor", () => {
    const turns: JevConversationTurn[] = [{ from: "lead", text: "alumnos" }, { from: "seller", text: "pagos y vouchers" }];
    expect(selectDemoSlot("show_operations_demo", turns)).toBe("demo_enrollment_panel");
  });
  it("acción online gana incluso con tema pagos", () => {
    expect(selectDemoSlot("show_online_enrollment_demo", [{ from: "lead", text: "pagos" }])).toBe("demo_online_enrollment");
  });
  it("no entrega demos para otras acciones", () => {
    expect(selectDemoSlot("present_price", [])).toBeNull();
    expect(selectDemoSlot("disqualify", [])).toBeNull();
  });
  it.each(["https://example.test/demo", "www.example.com", "Te envié el video", "x".repeat(400)])("caption seguro: %s", text => {
    expect(demoCaption("demo_online_enrollment", text)).toBe("Así funciona la matrícula online.");
  });
});
