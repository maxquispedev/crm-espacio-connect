import { describe, expect, it } from "vitest";
import { normalizeJevResponse } from "@/server/sales/normalize";
import { validJevRaw } from "./sales-fixtures";

describe("normalizeJevResponse", () => {
  it("acepta un payload válido y no inventa confidence/probabilities", () => {
    const result = normalizeJevResponse(validJevRaw("present_price"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.nextAction.choice).toBe("present_price");
    expect(result.decision.nextAction.confidence).toBeUndefined();
    expect(result.decision.nextAction.probabilities).toBeUndefined();
    expect(result.decision.realOperationalNeed?.noul).toBe(0.82);
  });

  it("conserva confidence y probabilities cuando vienen en el raw", () => {
    const raw = validJevRaw();
    raw.answers.next_action = {
      type: "choice",
      choice: "ask_more_questions",
      confidence: 0.91,
      probabilities: { ask_more_questions: 0.8, present_price: 0.1 },
    };
    const result = normalizeJevResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.nextAction.confidence).toBe(0.91);
    expect(result.decision.nextAction.probabilities).toEqual({
      ask_more_questions: 0.8,
      present_price: 0.1,
    });
  });

  it("falla si falta answers", () => {
    const result = normalizeJevResponse({ model: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail).toMatch(/answers/);
  });

  it("falla si next_action no está en el contrato", () => {
    const raw = validJevRaw();
    raw.answers.next_action = { type: "choice", choice: "pause_and_wait" };
    const result = normalizeJevResponse(raw);
    expect(result.ok).toBe(false);
  });

  it("falla si el cuerpo no es un objeto", () => {
    expect(normalizeJevResponse("nope").ok).toBe(false);
    expect(normalizeJevResponse(null).ok).toBe(false);
  });

  it("falla si falta una engine-required (next_action) en la respuesta", () => {
    // Corte 3: solo las engine-required (next_action + needs_human_call)
    // son obligatorias. Los known signals son nullable. Esta prueba
    // verifica la primera parte: si el motor apagó next_action o el
    // proveedor la omitió, el normalize hace fail con missing_required.
    const raw = validJevRaw();
    delete (raw.answers as { next_action?: unknown }).next_action;
    expect(normalizeJevResponse(raw).ok).toBe(false);
  });
});
