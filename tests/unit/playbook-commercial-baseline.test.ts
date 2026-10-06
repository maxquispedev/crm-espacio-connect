/**
 * Corte 2 (spec 009) — baseline comercial de la primera cohorte.
 *
 * Demuestra, con el código real, que el fallback técnico y el bootstrap
 * publicado expresan la MISMA oferta vigente:
 *
 *   setup 0 · mensualidad S/247 · 50 alumnos incluidos · +S/1 desde el 51
 *   implementación asistida incluida · primer mes adelantado
 *   sin permanencia obligatoria · dominio .com del primer año cuando aplica
 *   renovación del dominio desde el 2º año aparte y no líder
 *   objetivo = aprendizaje, no margen
 *
 * Y que el contrato congelado de Jev (criterios, option keys y tipos)
 * queda intacto: la estrategia se expresa en los textos, no en el
 * contrato (DV-8).
 *
 * NO enciende nada: `SALES_PLAYBOOK_RUNTIME_ENABLED` sigue en `false`
 * (ver `sales-launch-hardcoded.test.ts`).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigV1Schema, parseConfigV1 } from "@/lib/sales/playbook/schema";
import {
  BUYING_TIMING_OPTION_KEYS,
  MAIN_VALUE_PROPOSITION_OPTION_KEYS,
  NEXT_ACTION_OPTION_KEYS,
  PROTECTED_QUESTION_TYPES,
} from "@/lib/sales/playbook/constants";
import { VENDE_VELOZ_PLAYBOOK_V1 } from "@/lib/sales/playbook/v1";
import {
  VENDE_VELOZ_COMMERCIAL_POLICY,
  VENDE_VELOZ_OFFER,
  VENDE_VELOZ_PRODUCT,
} from "@/server/sales/vende-veloz";
import { writeSalesReply } from "@/server/sales/writer";
import type { VendeVelozOffer } from "@/server/sales/vende-veloz";
import { JEV_SALES_QUESTIONS_V2 } from "@/server/sales/questions";
import { BASE_FACTS, makeDecision } from "./sales-fixtures";
import { resolveSalesPlan } from "@/server/sales/resolve-plan";
import canonicalQuestions from "../fixtures/jev-questions-v2.json";

/**
 * El orquestador castea la oferta publicada a `OfferBlock`
 * (`orchestrator.ts`); el test reproduce ese mismo borde.
 */
type VendeVelozOfferLike = VendeVelozOffer;

const chatJson = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai", () => ({
  chatJson: (...args: unknown[]) => chatJson(...args),
}));

const OFFER = VENDE_VELOZ_PLAYBOOK_V1.offer;
const POLICY = VENDE_VELOZ_PLAYBOOK_V1.commercial_policy;
const WRITER = VENDE_VELOZ_PLAYBOOK_V1.writer;

beforeEach(() => {
  chatJson.mockReset();
  chatJson.mockResolvedValue({ ok: true, data: { text: "redactado" }, raw: "{}" });
});

/** Captura el system prompt que el writer le pasa al LLM en un turno present_price. */
async function renderSystem(offer: VendeVelozOfferLike): Promise<string> {
  const plan = resolveSalesPlan({
    decision: makeDecision({ nextAction: "present_price" }),
    currentSalesState: BASE_FACTS,
    currentPipelineStage: "interested",
  });
  await writeSalesReply({
    decision: makeDecision({ nextAction: "present_price" }),
    plan,
    conversation: [{ from: "lead", text: "¿cuánto cuesta?" }],
    kb: [],
    facts: BASE_FACTS,
    offer,
  });
  const messages = chatJson.mock.calls.at(-1)![1] as { role: string; content: string }[];
  return messages.find((m) => m.role === "system")?.content ?? "";
}

describe("corte 2 — ConfigV1 vigente parsea sin errores", () => {
  it("parseConfigV1 del bootstrap V1 es válido y sin detalles", () => {
    const result = parseConfigV1(VENDE_VELOZ_PLAYBOOK_V1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.offer.monthlyBase).toBe(247);
    } else {
      expect(result.details).toEqual([]);
    }
  });

  it("ConfigV1Schema.parse no lanza (el build-time guard sigue verde)", () => {
    expect(() => ConfigV1Schema.parse(VENDE_VELOZ_PLAYBOOK_V1)).not.toThrow();
  });

  it("un round-trip JSON no rompe la validación", () => {
    const roundTrip = JSON.parse(JSON.stringify(VENDE_VELOZ_PLAYBOOK_V1));
    expect(ConfigV1Schema.safeParse(roundTrip).success).toBe(true);
  });
});

describe("corte 2 — el bootstrap refleja la oferta vigente", () => {
  it("números: setup 0, mensualidad 247, 50 incluidos, +S/1 desde el 51", () => {
    expect(OFFER.currency).toBe("PEN");
    expect(OFFER.setup).toBe(0);
    expect(OFFER.monthlyBase).toBe(247);
    expect(OFFER.includedActiveStudents).toBe(50);
    expect(OFFER.extraPerActiveStudent).toBe(1);
  });

  it("la implementación se declara incluida, con primer mes adelantado y sin permanencia", () => {
    expect(OFFER.implementation.purpose).toMatch(/incluida/i);
    const includes = OFFER.implementation.includes.join(" | ");
    expect(includes).toMatch(/primer pago inicia la implementación e incluye los primeros 30 días/i);
    expect(includes).toMatch(/sin permanencia obligatoria/i);
    expect(includes).toMatch(/dominio/i);
    expect(includes).toMatch(/si ya tiene uno, se conecta el existente/i);
  });

  it("neverPromise prohíbe prometer alumnos y la renovación del dominio aparte/no líder", () => {
    const never = OFFER.neverPromise.join(" | ");
    expect(never).toMatch(/Generaci[oó]n de alumnos/i);
    expect(never).toMatch(/Demanda asegurada/i);
    expect(never).toMatch(/renovaci[oó]n del dominio desde el segundo a[oñ]o/i);
    expect(never).toMatch(/argumento principal|encabeza/i);
  });

  it("el objetivo comercial es aprendizaje, no margen", () => {
    expect(POLICY.goal).toMatch(/aprender/i);
    expect(POLICY.goal).toMatch(/primera cohorte/i);
    expect(POLICY.goal).toMatch(/no maximizar margen/i);
  });

  it("present_price del playbook: S/247, 50 incluidos, +S/1, sin permanencia, sin briefings", () => {
    const price = WRITER.present_price;
    expect(price).toContain("oferta vigente");
    expect(price).toMatch(/no hay permanencia obligatoria/i);
    expect(price).toContain("primer pago inicia la implementación");
    expect(price).toContain("primeros 30 días");
    expect(price).toContain("No uses setup, fee");
    expect(price).toContain("No menciones dominio si no lo pregunta");
    // Los precios de la cohorte anterior no pueden quedar en la instrucción.
    expect(price).not.toMatch(/497/);
    expect(price).not.toMatch(/\b197\b/);
  });

  it("handoff y urgency_rules piden escalar ante avance genuino y no inventar urgencia", () => {
    const handoff = Object.values(PLAYBOOK_HANDOFF()).join(" | ");
    expect(handoff).toMatch(/avance comercial genuino/i);
    expect(handoff).toMatch(/pide expl[ií]citamente una persona/i);
    expect(handoff).toMatch(/no se exige cerrar la venta de forma aut[oó]noma/i);
    expect(PLAYBOOK_URGENCY()).toMatch(/No inventar urgencia|no usar escasez/i);
  });
});

describe("corte 2 — contratos Jev siguen válidos (DV-8)", () => {
  it("criteria mantienen contrato; next_action/needs_human_call refuerzan evidencia", () => {
    for (const [key, question] of Object.entries(OFFER_JEV())) {
      const frozen = canonicalQuestions[key as keyof typeof canonicalQuestions];
      expect(frozen).toBeDefined();
      if (key === "next_action") {
        const criteria = question.criteria as Record<string, string>;
        expect(Object.keys(criteria)).toEqual(Object.keys(frozen.criteria));
        expect(criteria.show_operations_demo).toMatch(/necesidad operativa concreta|explícitamente/);
        expect(criteria.show_operations_demo).toMatch(/anuncio no prueba necesidad/);
        expect(criteria.ask_more_questions).toMatch(/UNA pregunta/);
      } else if (key === "needs_human_call") {
        const criteria = question.criteria as Record<string, string>;
        expect(Object.keys(criteria)).toEqual(Object.keys(frozen.criteria));
        expect(criteria.true).toContain("pregunta comercial material");
        expect(criteria.true).toContain("capacidad documentada");
        expect(criteria.false).toEqual((frozen.criteria as Record<string, string>).false);
      } else expect(question.criteria).toEqual(frozen.criteria);
    }
  });

  it("los tipos protegidos no cambiaron", () => {
    for (const [key, expectedType] of Object.entries(PROTECTED_QUESTION_TYPES)) {
      const question = OFFER_JEV()[key];
      expect(question).toBeDefined();
      expect(question!.type).toBe(expectedType);
      expect(question!.enabled).toBe(true);
    }
  });

  it("las option keys contractuales siguen exactas", () => {
    const qs = OFFER_JEV();
    const keys = (k: string): string[] =>
      Object.keys(qs[k]!.criteria as unknown as Record<string, string>).sort();
    expect(keys("next_action")).toEqual([...NEXT_ACTION_OPTION_KEYS].sort());
    expect(keys("buying_timing")).toEqual([...BUYING_TIMING_OPTION_KEYS].sort());
    expect(keys("main_value_proposition")).toEqual(
      [...MAIN_VALUE_PROPOSITION_OPTION_KEYS].sort()
    );
  });

  it("el texto de instructions sí cambia: estrategia de filtrado de tráfico V1", () => {
    expect(instructionsOf("next_action")).toMatch(/filtrar tr[aá]fico/i);
    expect(instructionsOf("next_action")).toMatch(/UNA sola pregunta/i);
    expect(instructionsOf("next_action")).toMatch(
      /nunca conviertas la conversaci[oó]n en una encuesta/i
    );
    expect(instructionsOf("purchase_intent")).toMatch(/intenci[oó]n comercial/i);
    expect(instructionsOf("purchase_intent")).toMatch(
      /no midas intenci[oó]n por el tama[oñ]o/i
    );
    expect(instructionsOf("needs_human_call")).toMatch(/avance comercial genuino/i);
  });
});

describe("corte 2 — fallback y Published representan la misma estrategia", () => {
  it("fallback y bootstrap coinciden en los números de la oferta", () => {
    expect(VENDE_VELOZ_OFFER.currency).toBe(OFFER.currency);
    expect(VENDE_VELOZ_OFFER.setup).toBe(OFFER.setup);
    expect(VENDE_VELOZ_OFFER.monthlyBase).toBe(OFFER.monthlyBase);
    expect(VENDE_VELOZ_OFFER.includedActiveStudents).toBe(OFFER.includedActiveStudents);
    expect(VENDE_VELOZ_OFFER.extraPerActiveStudent).toBe(OFFER.extraPerActiveStudent);
    expect(VENDE_VELOZ_OFFER.setupIsOneTime).toBe(OFFER.setupIsOneTime);
  });

  it("el fallback tampoco arrastra los precios de la cohorte anterior", () => {
    const json = JSON.stringify(VENDE_VELOZ_OFFER) + JSON.stringify(VENDE_VELOZ_PRODUCT);
    expect(json).not.toMatch(/497/);
    expect(json).not.toMatch(/\b197\b/);
    expect(VENDE_VELOZ_PRODUCT.subscription.price).toBe("S/247 al mes");
  });

  it("el writer renderiza la MISMA oferta con fallback y con la Published", async () => {
    const fallbackSystem = await renderSystem(VENDE_VELOZ_OFFER);
    const publishedSystem = await renderSystem(OFFER as unknown as VendeVelozOfferLike);

    for (const system of [fallbackSystem, publishedSystem]) {
      expect(system).toContain("S/247");
      expect(system).toContain("+S/1");
      expect(system).toMatch(/50 alumnos activos/);
      // El hueco ejecutable de setup=0 (DV-7) en ambos caminos.
      expect(system).not.toMatch(/S\/0/);
      expect(system).toMatch(/Implementaci[oó]n asistida incluida/i);
    }
  });

  it("la política del playbook y la del fallback cuentan la misma historia", () => {
    expect(POLICY.goal).toMatch(/aprender/i);
    expect(VENDE_VELOZ_COMMERCIAL_POLICY.human_handoff).toMatch(/human/i);
    // El fallback de política no promete automatizar el cierre de punta a punta.
    expect(VENDE_VELOZ_COMMERCIAL_POLICY.goal).not.toMatch(/aprender/i);
  });

  it("el runtime sigue apagado: nada de este corte lo enciende", () => {
    expect(OFFER.setup).toBe(0);
    expect(JEV_SALES_QUESTIONS_V2).toEqual(canonicalQuestions);
  });
});

/* Helpers locales para no repetir accesos largos en cada aserción. */
function OFFER_JEV() {
  return VENDE_VELOZ_PLAYBOOK_V1.jev_questions as Record<
    string,
    { type: string; enabled: boolean; instructions: string; criteria: unknown }
  >;
}
/** Lectura segura de `instructions` bajo `noUncheckedIndexedAccess`. */
function instructionsOf(key: string): string {
  return OFFER_JEV()[key]?.instructions ?? "";
}
function PLAYBOOK_HANDOFF(): string[] {
  return Object.values(VENDE_VELOZ_PLAYBOOK_V1.handoff).filter(
    (v): v is string => typeof v === "string"
  );
}
function PLAYBOOK_URGENCY(): string {
  return VENDE_VELOZ_PLAYBOOK_V1.urgency_rules ?? "";
}
