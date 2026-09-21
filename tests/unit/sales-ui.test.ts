import { describe, expect, it } from "vitest";
import {
  followUpReasonLabel,
  isDormantSales,
  labelForScore,
  operationalLaneLabel,
  operationalLaneShortLabel,
} from "@/lib/sales-ui";

describe("labelForScore (escala Jev 0..4)", () => {
  it("product_fit 3.86 → Encaje muy fuerte", () => {
    expect(labelForScore(3.86, "product_fit")).toBe("Encaje muy fuerte");
  });

  it("purchase_intent 2.19 → Media", () => {
    expect(labelForScore(2.19, "purchase_intent")).toBe("Media");
  });

  it("purchase_intent 3.48 → Alta", () => {
    expect(labelForScore(3.48, "purchase_intent")).toBe("Alta");
  });

  it("score 0.8 no se trata como 0..1 inflado", () => {
    expect(labelForScore(0.8, "purchase_intent")).not.toBe("Muy alta");
    expect(labelForScore(0.8, "purchase_intent")).not.toBe("Alta");
    expect(labelForScore(0.8, "product_fit")).not.toBe("Encaje muy fuerte");
    expect(labelForScore(0.8, "purchase_intent")).toBe("Baja");
  });

  it("1.25 / 3.97 usan nearest 0..4", () => {
    expect(labelForScore(1.25, "product_fit")).toBe("Encaje débil");
    expect(labelForScore(1.25, "purchase_intent")).toBe("Baja");
    expect(labelForScore(3.97, "product_fit")).toBe("Encaje muy fuerte");
    expect(labelForScore(3.97, "purchase_intent")).toBe("Muy alta");
  });
});

describe("Dormant vs perdido en UI", () => {
  it("STOP + no_reply_exhausted se presenta como Dormido, no Perdido ni Detenido", () => {
    const sales = { lane: "stop" as const, followUpReason: "no_reply_exhausted" };
    expect(isDormantSales(sales)).toBe(true);
    expect(operationalLaneLabel(sales)).toBe("Dormido");
    expect(operationalLaneShortLabel(sales)).toBe("Dormido");
    expect(operationalLaneLabel(sales)).not.toMatch(/Perdido/i);
    expect(followUpReasonLabel("no_reply_exhausted")).toBe(
      "Dormido por falta de respuesta"
    );
  });

  it("STOP comercial no se relabela Dormido", () => {
    const sales = { lane: "stop" as const, followUpReason: null };
    expect(isDormantSales(sales)).toBe(false);
    expect(operationalLaneLabel(sales)).toBe("Detenido");
  });
});
