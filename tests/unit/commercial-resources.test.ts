import { describe, expect, it } from "vitest";
import {
  CommercialResourceValueSchema, PaymentInstructionsSchema, hasPaymentInstructions,
} from "@/lib/commercial/resources";

const empty = { transfers: [], yape: null, paymentLink: null };
const transfer = { bank: " Banco prueba ", holder: " Titular prueba ", currency: "PEN", accountNumber: "001-234 567" };

describe("recursos comerciales: cobro completo y cerrado", () => {
  it("vacío válido, sin método configurado ni defaults", () => {
    expect(PaymentInstructionsSchema.parse(empty)).toEqual(empty);
    expect(hasPaymentInstructions(empty)).toBe(false);
  });
  it("normaliza etiquetas, conserva ceros y admite cuenta, CCI o ambos", () => {
    for (const ids of [{ accountNumber: "001-234 567" }, { cci: "000123" }, { accountNumber: "0001", cci: "0002" }]) {
      const parsed = PaymentInstructionsSchema.parse({ ...empty, transfers: [{ bank: transfer.bank, holder: transfer.holder, currency: "USD", ...ids }] });
      expect(parsed.transfers[0]).toEqual({ bank: "Banco prueba", holder: "Titular prueba", currency: "USD", ...ids });
      expect(hasPaymentInstructions(parsed)).toBe(true);
    }
  });
  it("máximo cinco cuentas", () => {
    expect(PaymentInstructionsSchema.safeParse({ ...empty, transfers: Array(5).fill(transfer) }).success).toBe(true);
    expect(PaymentInstructionsSchema.safeParse({ ...empty, transfers: Array(6).fill(transfer) }).success).toBe(false);
  });
  it.each([
    {}, { transfers: [] }, { ...empty, transfers: [{ ...transfer, accountNumber: undefined }] },
    { ...empty, transfers: [{ ...transfer, bank: " " }] },
    { ...empty, transfers: [{ ...transfer, holder: "x".repeat(121) }] },
    { ...empty, transfers: [{ ...transfer, currency: "EUR" }] },
    { ...empty, transfers: [{ ...transfer, accountNumber: 123 }] },
    { ...empty, transfers: [{ ...transfer, accountNumber: "abc" }] },
    { ...empty, transfers: [{ ...transfer, accountNumber: "---" }] },
    { ...empty, transfers: [{ ...transfer, accountNumber: "0".repeat(41) }] },
    { ...empty, transfers: [{ ...transfer, cci: "" }] },
    { ...empty, transfers: [{ ...transfer, pin: "1234" }] },
    { ...empty, token: "no permitido" },
  ])("rechaza bloque inválido sin publicación parcial: %j", (value) => {
    expect(PaymentInstructionsSchema.safeParse(value).success).toBe(false);
  });
  it("Yape completo normaliza +51 opcional", () => {
    for (const phone of ["999888777", "+51999888777", " +51 999888777 "]) {
      const result = PaymentInstructionsSchema.parse({ ...empty, yape: { phone, holder: " Prueba " } });
      expect(result.yape).toEqual({ phone: "999888777", holder: "Prueba" });
      expect(hasPaymentInstructions(result)).toBe(true);
    }
  });
  it.each([
    { phone: "999888777" }, { holder: "Prueba" }, { phone: "123", holder: "Prueba" },
    { phone: "+52999888777", holder: "Prueba" }, { phone: "999 888 777", holder: "Prueba" },
    { phone: "999888777", holder: " " }, { phone: 999888777, holder: "Prueba" },
  ])("rechaza Yape incompleto/inválido: %j", (yape) => {
    expect(PaymentInstructionsSchema.safeParse({ ...empty, yape }).success).toBe(false);
  });
  it.each(["https://payments.example.test/pay?a=1", "https://8.8.8.8/pay", "https://[2606:4700:4700::1111]/pay"])("admite HTTPS público sin visitarlo: %s", (paymentLink) => {
    const value = PaymentInstructionsSchema.parse({ ...empty, paymentLink });
    expect(value.paymentLink).toBe(paymentLink);
    expect(hasPaymentInstructions(value)).toBe(true);
  });
  it.each([
    "", "/pay", "http://payments.example.test", "javascript:alert(1)",
    "https://user:password@payments.example.test", "https://localhost/pay", "https://localhost./pay",
    "https://sub.localhost", "https://host.local", "https://127.1", "https://2130706433", "https://0x7f000001",
    "https://10.0.0.1", "https://172.16.1.1", "https://192.168.1.1", "https://169.254.169.254",
    "https://100.64.0.1", "https://[::1]", "https://[fc00::1]", "https://[fe80::1]",
    "https://[::ffff:127.0.0.1]", "https://[::ffff:192.168.1.1]",
    `https://payments.example.test/${"x".repeat(2048)}`,
  ])("rechaza link inválido/local/privado: %s", (paymentLink) => {
    expect(PaymentInstructionsSchema.safeParse({ ...empty, paymentLink }).success).toBe(false);
  });
  it("slots y shape cerrados: demo con media, pago con payload", () => {
    expect(CommercialResourceValueSchema.safeParse({ slot: "demo_enrollment_panel", mediaAssetId: "ma_test", payload: null }).success).toBe(true);
    expect(CommercialResourceValueSchema.safeParse({ slot: "payment_instructions", mediaAssetId: null, payload: empty }).success).toBe(true);
    for (const value of [
      { slot: "demo_other", mediaAssetId: "ma_test", payload: null },
      { slot: "demo_enrollment_panel", mediaAssetId: null, payload: null },
      { slot: "demo_enrollment_panel", mediaAssetId: "../asset", payload: null },
      { slot: "demo_enrollment_panel", mediaAssetId: "ma_test", payload: empty },
      { slot: "payment_instructions", mediaAssetId: "ma_test", payload: empty },
      { slot: "payment_instructions", mediaAssetId: null, payload: null },
      { slot: "payment_instructions", mediaAssetId: null, payload: empty, organizationId: "org_b" },
    ]) expect(CommercialResourceValueSchema.safeParse(value).success).toBe(false);
  });
});
