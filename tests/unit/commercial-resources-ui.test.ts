import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CommercialResourcesClient, PaymentFields, VideoResourceRow, paymentFormOf, paymentPayloadOf, readResourceError } from "@/components/agent/commercial/resources-client";
import { DEMO_RESOURCE_SLOTS, PaymentInstructionsSchema } from "@/lib/commercial/resources";
const empty = { transfers: [], yape: null, paymentLink: null };
const noop = () => {};

describe("UI recursos reales", () => {
  it("muestra mensaje servidor de validación o fallo, sin ocultar detalle de campos", async () => {
    expect(await readResourceError(Response.json({ error: { message: "paymentInstructions.yape.holder: Requerido" } }, { status: 422 }), "Error")).toContain("yape.holder");
    expect(await readResourceError(new Response("bad gateway", { status: 502 }), "Error")).toBe("Error (HTTP 502)");
  });
  it("renderiza sección y límite, sin exigir conversación ni credenciales", () => {
    const html = renderToStaticMarkup(createElement(CommercialResourcesClient));
    expect(html).toContain("Recursos comerciales"); expect(html).toContain("16 MiB"); expect(html).toContain("Cargando recursos");
  });
  it.each(DEMO_RESOURCE_SLOTS)("slot %s vacío/completo, upload/replacement y preview privada", (slot) => {
    const initial = renderToStaticMarkup(createElement(VideoResourceRow, { video: { slot, configured: false, media: null }, busy: false, onUpload: noop }));
    expect(initial).toContain("Sin configurar"); expect(initial).toContain("Subir MP4"); expect(initial).toContain('accept="video/mp4,.mp4"');
    const full = renderToStaticMarkup(createElement(VideoResourceRow, { video: { slot, configured: true,
      media: { assetId: "ma_test", fileName: "demo.mp4", fileSize: 1024, mimeType: "video/mp4", previewUrl: "/api/media/ma_test" } }, busy: true, onUpload: noop }));
    expect(full).toContain("Reemplazar MP4"); expect(full).toContain("demo.mp4"); expect(full).toContain('src="/api/media/ma_test"');
    expect(full).toContain("controls="); expect(full).toContain("disabled=");
  });
  it("form vacío guarda vacío y completo conserva ceros y normaliza al validar servidor", () => {
    expect(paymentPayloadOf(paymentFormOf(empty))).toEqual(empty);
    const payload = { transfers: [{ bank: " Banco ", holder: " Prueba ", currency: "USD" as const, cci: "000-001" }], yape: { phone: "+51 999888777", holder: "Prueba" }, paymentLink: "https://pay.example.test" };
    expect(paymentPayloadOf(paymentFormOf(payload))).toEqual(payload);
    expect(PaymentInstructionsSchema.parse(paymentPayloadOf(paymentFormOf(payload))).transfers[0]?.cci).toBe("000-001");
  });
  it("Yape/cuenta incompletos permanecen en payload y se rechazan sin publicarse parcialmente", () => {
    const form = { ...paymentFormOf(empty), yapePhone: "999888777" };
    expect(paymentPayloadOf(form).yape).toEqual({ phone: "999888777", holder: "" });
    expect(PaymentInstructionsSchema.safeParse(paymentPayloadOf(form)).success).toBe(false);
    form.transfers.push({ bank: "Banco", holder: "Prueba", currency: "PEN", accountNumber: "", cci: "" });
    expect(paymentPayloadOf(form).transfers).toHaveLength(1);
    expect(PaymentInstructionsSchema.safeParse(paymentPayloadOf(form)).success).toBe(false);
  });
  it("form real presenta campos mínimos y Guardar cobro explícito; quinta cuenta limita añadir", () => {
    const form = paymentFormOf(empty);
    form.transfers = Array.from({ length: 5 }, () => ({ bank: "Banco", holder: "Prueba", currency: "PEN", accountNumber: "001", cci: "" }));
    const html = renderToStaticMarkup(createElement(PaymentFields, { form, busy: false, onChange: noop, onSave: noop }));
    expect(html).toContain("Guardar cobro"); expect(html).toContain('type="submit"'); expect(html).toContain("Teléfono Yape");
    expect(html).toContain("Link de pago HTTPS"); expect(html).toContain("Cuenta 5"); expect(html).toMatch(/disabled=""[^>]*>Añadir transferencia/);
  });
});
