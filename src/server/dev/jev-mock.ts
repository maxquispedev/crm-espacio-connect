import { normalizeJevResponse } from "@/server/sales/normalize";
import { JEV_SALES_QUESTIONS_V2 } from "@/server/sales/questions";
import type { SalesDecision } from "@/server/sales/decision";

/**
 * Respuesta Jev determinista para el entorno de mocks.
 * AUTO + ask_more_questions: el worker de follow-ups puede arrancar secuencia.
 * No sustituye TypeSafe en runtime real.
 */
export function mockJevRaw(): {
  model: string;
  answers: Record<string, Record<string, unknown>>;
} {
  return {
    model: "jev-mock",
    answers: {
      real_operational_need: { type: "noul", noul: 0.62 },
      product_fit: { type: "score", score: 2.4 },
      motivation_to_change: { type: "score", score: 1.8 },
      purchase_intent: { type: "score", score: 1.5 },
      buying_timing: { type: "choice", choice: "unknown" },
      main_value_proposition: {
        type: "choice",
        choice: "operations",
      },
      next_action: { type: "choice", choice: "ask_more_questions" },
      needs_human_call: { type: "noul", noul: 0.12 },
    },
  };
}

/** Evalúa con el canned AUTO. Nunca llama a TypeSafe. */
export function evaluateJevMock():
  | { ok: true; decision: SalesDecision; model: string; snapshot: unknown }
  | { ok: false; error: "invalid_response"; detail: string; snapshot: unknown } {
  const body = mockJevRaw();
  // El mock siempre asume el set activo completo (defaults V2 sin
  // `enabled` explicito, lo que el runtime trata como activo):
  // preserva el contrato actual y permite que los tests que esperan
  // todas las preguntas pobladas sigan funcionando.
  const normalized = normalizeJevResponse(body, JEV_SALES_QUESTIONS_V2);
  if (!normalized.ok) {
    return {
      ok: false,
      error: "invalid_response",
      detail: normalized.error.detail,
      snapshot: body,
    };
  }
  return {
    ok: true,
    decision: normalized.decision,
    model: body.model,
    snapshot: body,
  };
}