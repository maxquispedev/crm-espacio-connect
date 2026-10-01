/**
 * T304/T303 — Contracto dinámico: el cliente HTTP envía SOLO el set
 * activo de preguntas al proveedor, y el normalizer respeta
 * `activeQuestions` para validar la respuesta.
 *
 * NO se usa `as any` ni casts inseguros. La prueba
 * `arbitraryAnalyticalCustomCompiles` es clave: demuestra que el
 * contrato genérico `JevQuestionDefinition` admite preguntas V1
 * arbitrarias sin tocar TypeScript.
 */
import { describe, expect, it, vi } from "vitest";

import { normalizeJevResponse } from "@/server/sales/normalize";
import type { NormalizeErrorCode } from "@/server/sales/decision";
import type { JevQuestionDefinition } from "@/server/sales/questions";
import { JEV_SALES_QUESTIONS_V2 } from "@/server/sales/questions";

/**
 * Helper: extrae TODOS los `JevQuestionDefinition` del set V2. Por
 * definición V2 todas las preguntas del set canónico están activas
 * (no llevan `enabled=false`); el runtime las trata como activas.
 * Esta es la base de "active questions" para los tests de normalize.
 */
function activeV2(): Record<string, JevQuestionDefinition> {
  const out: Record<string, JevQuestionDefinition> = {};
  for (const [k, v] of Object.entries(JEV_SALES_QUESTIONS_V2)) {
    // `enabled` puede no estar presente en el set V2 (todas activas
    // por convención). El cast es defensivo: JevQuestionDefinition
    // tiene `enabled?: boolean`.
    const enabled = (v as { enabled?: boolean }).enabled;
    if (enabled !== false) out[k] = v;
  }
  return out;
}

describe("normalizeJevResponse — contracto dinámico", () => {
  it("devuelve `ok: true` con todas las preguntas V2 activas presentes", () => {
    const result = normalizeJevResponse(
      {
        answers: {
          real_operational_need: { type: "noul", noul: 0.8 },
          product_fit: { type: "score", score: 3 },
          motivation_to_change: { type: "score", score: 2 },
          purchase_intent: { type: "score", score: 1 },
          buying_timing: { type: "choice", choice: "unknown" },
          main_value_proposition: {
            type: "choice",
            choice: "operations",
          },
          next_action: { type: "choice", choice: "ask_more_questions" },
          needs_human_call: { type: "noul", noul: 0.2 },
        },
      },
      activeV2()
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.nextAction.choice).toBe("ask_more_questions");
      expect(result.decision.buyingTiming?.choice).toBe("unknown");
      expect(result.decision.realOperationalNeed?.noul).toBe(0.8);
      expect(result.decision.signals).toEqual({});
    }
  });

  it("next_action ausente en respuesta → fail con missing_required", () => {
    const result = normalizeJevResponse(
      {
        answers: {
          needs_human_call: { type: "noul", noul: 0.2 },
          // next_action omitido a propósito.
        },
      },
      activeV2()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe<NormalizeErrorCode>("missing_required");
      expect(result.error.key).toBe("next_action");
    }
  });

  it("needs_human_call ausente en respuesta → fail con missing_required", () => {
    const result = normalizeJevResponse(
      {
        answers: {
          next_action: { type: "choice", choice: "ask_more_questions" },
          // needs_human_call omitido a propósito.
        },
      },
      activeV2()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe<NormalizeErrorCode>("missing_required");
      expect(result.error.key).toBe("needs_human_call");
    }
  });

  it("next_action con `type` incorrecto → fail con type_mismatch", () => {
    const result = normalizeJevResponse(
      {
        answers: {
          next_action: { type: "noul", noul: 0.5 }, // debería ser choice
          needs_human_call: { type: "noul", noul: 0.2 },
        },
      },
      activeV2()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe<NormalizeErrorCode>("type_mismatch");
      expect(result.error.key).toBe("next_action");
    }
  });

  it("next_action.choice fuera del set V1 → fail con invalid_choice_key", () => {
    const result = normalizeJevResponse(
      {
        answers: {
          next_action: { type: "choice", choice: "inventada_xyz" },
          needs_human_call: { type: "noul", noul: 0.2 },
        },
      },
      activeV2()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe<NormalizeErrorCode>("invalid_choice_key");
      expect(result.error.key).toBe("next_action");
    }
  });

  it("buying_timing.choice fuera del set V1 → fail con invalid_choice_key", () => {
    const result = normalizeJevResponse(
      {
        answers: {
          next_action: { type: "choice", choice: "ask_more_questions" },
          needs_human_call: { type: "noul", noul: 0.2 },
          buying_timing: { type: "choice", choice: "mañana_seguro" },
        },
      },
      activeV2()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe<NormalizeErrorCode>("invalid_choice_key");
      expect(result.error.key).toBe("buying_timing");
    }
  });

  it("product_fit activo sin respuesta → null con fallback documentado", () => {
    const result = normalizeJevResponse(
      {
        answers: {
          next_action: { type: "choice", choice: "ask_more_questions" },
          needs_human_call: { type: "noul", noul: 0.2 },
          buying_timing: { type: "choice", choice: "unknown" },
          // product_fit activo pero NO traído en la respuesta
        },
      },
      activeV2()
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.productFit).toBeNull();
      expect(result.decision.buyingTiming?.choice).toBe("unknown");
    }
  });

  it("pregunta con `enabled=false` se omite del payload activo (T303)", async () => {
    // Espía sobre fetch para verificar que `product_fit` NO aparece
    // en el body enviado al proveedor cuando está apagada.
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          answers: {
            next_action: { type: "choice", choice: "ask_more_questions" },
            needs_human_call: { type: "noul", noul: 0.2 },
            // Sin product_fit; el mock NO la devuelve porque el
            // motor no la pidió.
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchSpy);

    // Mock del módulo de env: evaluateJev consulta isJevConfigured() y
    // getEnv() — sin un env válido completo el cliente aborta antes de
    // invocar fetch. Inyectamos el subset que Jev necesita.
    vi.doMock("@/lib/env", () => ({
      isJevConfigured: () => true,
      isMockEnabled: () => false,
      getEnv: () => ({
        TYPESAFE_API_KEY: "test",
        TYPESAFE_JEV_ENDPOINT: "https://example.test/jev",
        JEV_MODEL: "test-model",
      }),
    }));

    const { evaluateJev } = await import("@/server/sales/client");
    const { JEV_SALES_QUESTIONS_V2 } = await import("@/server/sales/questions");

    const customQuestions = {
      ...JEV_SALES_QUESTIONS_V2,
      product_fit: { ...JEV_SALES_QUESTIONS_V2.product_fit, enabled: false },
    } as unknown as Record<string, JevQuestionDefinition>;

    const result = await evaluateJev({
      state: {
        product: {
          name: "Vende Veloz 365",
          one_liner: "x",
          who_it_is_for: ["a"],
          core_jobs: ["a"],
          not_the_product: [],
          how_it_starts: "x",
          implementation: {
            price: "S/497",
            kind: "pago único",
            includes: ["x"],
            does_not_include: ["x"],
          },
          subscription: {
            price: "S/197 al mes",
            includes_active_students: 50,
            extra_active_student: "S/1",
            active_student_means: "x",
          },
        },
        commercial_policy: {
          default_channel: "WhatsApp",
          goal: "x",
          automation_first: "x",
          auto_close: "x",
          human_handoff: "x",
          future_interest: "x",
          no_response: "x",
          disqualification: "x",
          evidence_rule: "x",
        },
        crm_state: {
          pipeline_stage: "new",
          automation_lane: "auto",
          demo_shown: false,
          price_presented: false,
          payment_instructions_sent: false,
          human_requested: false,
          follow_up_count: 0,
        },
        conversation: [],
      } as never,
      questions: customQuestions,
    });

    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = (fetchSpy.mock.calls[0] as unknown[])[1] as
      | RequestInit
      | undefined;
    expect(init?.body).toBeTruthy();
    const body = JSON.parse(String(init?.body)) as {
      questions: Record<string, JevQuestionDefinition>;
    };
    expect(body.questions.product_fit).toBeUndefined();
    // Las engine-required siguen presentes
    expect(body.questions.next_action).toBeTruthy();
    expect(body.questions.needs_human_call).toBeTruthy();

    vi.unstubAllGlobals();
    vi.doUnmock("@/lib/env");
  });

  it("pregunta analítica arbitraria compila sin `as any` y se preserva en signals", async () => {
    // Definición typed de pregunta `analytical/custom` arbitraria.
    const fooBar: JevQuestionDefinition = {
      type: "noul",
      enabled: true,
      instructions: "¿Está el prospecto en fase foo bar?",
      criteria: { true: "sí", false: "no" },
    };

    // Esto compila sin `as any` gracias al contrato genérico.
    const activeQuestions: Record<string, JevQuestionDefinition> = {
      next_action: JEV_SALES_QUESTIONS_V2.next_action,
      needs_human_call: JEV_SALES_QUESTIONS_V2.needs_human_call,
      foo_bar: fooBar,
    };

    const result = normalizeJevResponse(
      {
        answers: {
          next_action: { type: "choice", choice: "ask_more_questions" },
          needs_human_call: { type: "noul", noul: 0.2 },
          foo_bar: { type: "noul", noul: 0.77 },
        },
      },
      activeQuestions
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.signals["foo_bar"]).toEqual({
        type: "noul",
        noul: 0.77,
      });
    }
  });

  it("pregunta custom score+choice se preserva con su `type` correcto", () => {
    const painScore: JevQuestionDefinition = {
      type: "score",
      enabled: true,
      instructions: "Magnitud del dolor actual",
      criteria: { "0": "leve", "1": "medio", "2": "fuerte" },
    };
    const activeQuestions: Record<string, JevQuestionDefinition> = {
      next_action: JEV_SALES_QUESTIONS_V2.next_action,
      needs_human_call: JEV_SALES_QUESTIONS_V2.needs_human_call,
      pain_score: painScore,
    };
    const result = normalizeJevResponse(
      {
        answers: {
          next_action: { type: "choice", choice: "ask_more_questions" },
          needs_human_call: { type: "noul", noul: 0.2 },
          pain_score: { type: "score", score: 2 },
        },
      },
      activeQuestions
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const pain = result.decision.signals["pain_score"];
      expect(pain?.type).toBe("score");
      expect((pain as { score: number } | undefined)?.score).toBe(2);
    }
  });
});
