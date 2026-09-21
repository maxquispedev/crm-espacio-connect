import { describe, expect, it } from "vitest";
import { labelForScore } from "@/lib/sales-ui";

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
});
