/**
 * Sales Playbook — Schema versionado (Corte 1, Feature 008).
 *
 * El loader y el editor validan cualquier payload de playbook contra
 * `ConfigV1Schema` antes de INSERT/UPDATE. El `schema_version` es
 * semver: mayor = breaking, menor = aditivo, patch = fix interno.
 *
 * El Zod hace dos pasadas:
 *   1. **Structural** (object-level): que el documento entero sea válido.
 *   2. **Contractual** (`superRefine`): que las clases protegidas cumplan
 *      el contrato del resolver/writer:
 *        - `engine-required` (`next_action`, `needs_human_call`):
 *          presencia obligatoria, `type` exacto, `enabled = true`,
 *          no eliminables.
 *        - `known signals` (`buying_timing`, `main_value_proposition`):
 *          option keys contractuales inmutables; descripciones editables.
 *        - `analytical/custom`: libres, validado `^[a-z_]+$` y ≤ 60 chars.
 *
 * Las option keys de `next_action`, `buying_timing` y
 * `main_value_proposition` son **contrato del resolver/writer**: el Zod
 * rechaza payloads que pretendan renombrarlas o añadir/quitar keys.
 * Solo las descripciones son editables.
 *
 * No forma parte del runtime productivo: el loader entra en Corte 3.
 */

import { z } from "zod";

import {
  BUYING_TIMING_OPTION_KEYS,
  ENGINE_REQUIRED_KEYS,
  MAIN_VALUE_PROPOSITION_OPTION_KEYS,
  NEXT_ACTION_OPTION_KEYS,
  PROTECTED_QUESTION_TYPES,
} from "./constants";

/* ============================================================
 * Catálogos congelados (contrato del resolver/writer)
 *
 * Viven en `./constants` (módulo sin dependencias) para que la UI del
 * editor pueda clasificarlas sin arrastrar Zod al bundle del cliente.
 * Se re-exportan aquí para conservar los imports existentes.
 * ============================================================ */

export {
  BUYING_TIMING_OPTION_KEYS,
  ENGINE_REQUIRED_KEYS,
  KNOWN_SIGNAL_KEYS,
  MAIN_VALUE_PROPOSITION_OPTION_KEYS,
  NEXT_ACTION_OPTION_KEYS,
  PROTECTED_CHOICE_OPTION_KEYS,
  PROTECTED_QUESTION_TYPES,
} from "./constants";

/* ============================================================
 * Bloques estructurales
 * ============================================================ */

const QuestionKeySchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z_]+$/, {
    message: "key debe cumplir /^[a-z_]+$/",
  });

const ProductSchema = z.object({
  name: z.string().min(1).max(120),
  one_liner: z.string().min(1).max(500),
  who_it_is_for: z.array(z.string().min(1).max(300)).min(1).max(20),
  core_jobs: z.array(z.string().min(1).max(200)).min(1).max(30),
  not_the_product: z.array(z.string().min(1).max(300)).max(20),
  how_it_starts: z.string().min(1).max(500),
});

const OfferSchema = z.object({
  currency: z.enum(["PEN", "USD", "MXN", "EUR"]),
  setup: z.number().int().min(0).max(1_000_000),
  monthlyBase: z.number().int().min(0).max(1_000_000),
  includedActiveStudents: z.number().int().min(1).max(100_000),
  extraPerActiveStudent: z.number().int().min(0).max(100_000),
  setupIsOneTime: z.boolean(),
  implementation: z.object({
    purpose: z.string().min(1).max(200),
    includes: z.array(z.string().min(1).max(200)).min(1).max(20),
  }),
  neverPromise: z.array(z.string().min(1).max(200)).min(1).max(20),
});

const PolicySchema = z.object({
  defaultChannel: z.enum(["WhatsApp", "WhatsApp+SMS", "WhatsApp+Email"]),
  goal: z.string().min(1).max(800),
  automationFirst: z.string().min(1).max(800),
  autoClose: z.string().min(1).max(800),
  humanHandoff: z.string().min(1).max(800),
  futureInterest: z.string().min(1).max(800),
  noResponse: z.string().min(1).max(800),
  disqualification: z.string().min(1).max(800),
  evidenceRule: z.string().min(1).max(800),
});

const PrioritiesSchema = z.object({
  primary: z.array(z.string().min(1).max(200)).min(1).max(8),
  secondary: z.array(z.string().min(1).max(200)).max(8),
  tertiary: z.array(z.string().min(1).max(200)).max(8),
});

const WriterSchema = z.object({
  ask_more_questions: z.string().min(1).max(1500),
  show_operations_demo: z.string().min(1).max(1500),
  show_online_enrollment_demo: z.string().min(1).max(1500),
  present_price: z.string().min(1).max(1500),
  schedule_call: z.string().min(1).max(1500),
  schedule_follow_up: z.string().min(1).max(1500),
  disqualify: z.string().min(1).max(1500),
});

/* ============================================================
 * Preguntas Jev (tres clases con guardarraíles distintos)
 * ============================================================ */

const QuestionChoiceSchema = z.object({
  type: z.literal("choice"),
  enabled: z.boolean(),
  instructions: z.string().min(1).max(2000),
  criteria: z.record(
    z.string().min(1).max(500),
    z.string().min(1).max(500)
  ),
});

const QuestionNoulSchema = z.object({
  type: z.literal("noul"),
  enabled: z.boolean(),
  instructions: z.string().min(1).max(2000),
  criteria: z.object({
    true: z.string().min(1).max(500),
    false: z.string().min(1).max(500),
  }),
});

const QuestionScoreSchema = z.object({
  type: z.literal("score"),
  enabled: z.boolean(),
  instructions: z.string().min(1).max(2000),
  criteria: z.array(z.string().min(1).max(500)).min(2).max(7),
});

const QuestionSchema = z.discriminatedUnion("type", [
  QuestionChoiceSchema,
  QuestionNoulSchema,
  QuestionScoreSchema,
]);

const QuestionsSchema = z.record(QuestionKeySchema, QuestionSchema);

const ProhibitionsSchema = z.object({
  neverPromise: z.array(z.string().min(1).max(200)).max(20),
  prohibitedClaims: z.array(z.string().min(1).max(200)).max(20),
});

const HandoffSchema = z.object({
  auto: z.string().min(1).max(500).optional(),
  auto_close: z.string().min(1).max(500).optional(),
  human: z.string().min(1).max(500).optional(),
  wait: z.string().min(1).max(500).optional(),
  stop: z.string().min(1).max(500).optional(),
});

/* ============================================================
 * ConfigV1 — schema_version "1.0"
 * ============================================================ */

/**
 * Forma estructural de `ConfigV1` **sin** las guardarraíles Jev.
 * Se exporta aparte para que callers (ej. `parseBody` en routes de
 * patch) puedan acceder a `.shape.<bloque>` para construir patches
 * parciales; `ConfigV1Schema` es un `ZodEffects` que oculta `.shape`.
 */
export const ConfigV1ObjectSchema = z.object({
  schema_version: z.literal("1.0"),
  product: ProductSchema,
  offer: OfferSchema,
  commercial_policy: PolicySchema,
  priorities: PrioritiesSchema,
  writer: WriterSchema,
  jev_questions: QuestionsSchema,
  prohibitions: ProhibitionsSchema,
  handoff: HandoffSchema,
  urgency_rules: z.string().max(1000).nullable().optional(),
});

export const ConfigV1Schema = ConfigV1ObjectSchema.superRefine((cfg, ctx) => {
  refineConfigV1(cfg, ctx);
});

export type ConfigV1 = z.infer<typeof ConfigV1Schema>;

/* ============================================================
 * parseConfigV1 — devuelve discriminated union { ok, data | error }
 * ============================================================ */

export type ParseErrorDetail = {
  path: (string | number)[];
  message: string;
  code: string;
};

export type ParseConfigV1Success = { ok: true; data: ConfigV1 };
export type ParseConfigV1Failure = {
  ok: false;
  error: string;
  details: ParseErrorDetail[];
};

export type ParseConfigV1Result =
  | ParseConfigV1Success
  | ParseConfigV1Failure;

export function parseConfigV1(input: unknown): ParseConfigV1Result {
  const result = ConfigV1Schema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  const details: ParseErrorDetail[] = result.error.issues.map((issue) => ({
    path: issue.path as (string | number)[],
    message: issue.message,
    code: issue.code,
  }));
  return {
    ok: false,
    error: "invalid_config_v1",
    details,
  };
}

/* ============================================================
 * Guardarraíles Jev (superRefine)
 * ============================================================ */

function refineConfigV1(
  cfg: z.infer<typeof ConfigV1Schema>,
  ctx: z.RefinementCtx
): void {
  const qs = cfg.jev_questions;

  // --- engine-required -------------------------------------------------
  // `next_action` y `needs_human_call`: presencia obligatoria, type fijo,
  // enabled=true, no eliminables. Option keys exactas en `next_action`.
  for (const key of ENGINE_REQUIRED_KEYS) {
    const q = qs[key];
    if (q === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["jev_questions", key],
        message: `engine-required ausente: ${key}`,
        params: { code: "engine_required_missing", key },
      });
      continue;
    }
    const expectedType = key === "next_action" ? "choice" : "noul";
    if (q.type !== expectedType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["jev_questions", key, "type"],
        message: `engine-required type mismatch: ${key} debe ser ${expectedType}, recibido ${q.type}`,
        params: {
          code: "engine_required_type_mismatch",
          key,
          expected: expectedType,
          received: q.type,
        },
      });
      continue;
    }
    if (q.enabled !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["jev_questions", key, "enabled"],
        message: `engine-required deshabilitado: ${key}`,
        params: { code: "engine_required_disabled", key },
      });
    }
  }

  // `next_action` option keys exactas
  const nextAction = qs.next_action;
  if (nextAction && nextAction.type === "choice") {
    assertExactChoiceKeys(
      ctx,
      ["jev_questions", "next_action", "criteria"],
      nextAction.criteria,
      NEXT_ACTION_OPTION_KEYS,
      "next_action"
    );
  }

  // --- known signals ----------------------------------------------------
  // `buying_timing` y `main_value_proposition`: option keys contractuales
  // exactas (verificadas contra `questions.ts`).
  const buyingTiming = qs.buying_timing;
  if (buyingTiming && buyingTiming.type === "choice") {
    assertExactChoiceKeys(
      ctx,
      ["jev_questions", "buying_timing", "criteria"],
      buyingTiming.criteria,
      BUYING_TIMING_OPTION_KEYS,
      "buying_timing"
    );
  }
  const mainValue = qs.main_value_proposition;
  if (mainValue && mainValue.type === "choice") {
    assertExactChoiceKeys(
      ctx,
      ["jev_questions", "main_value_proposition", "criteria"],
      mainValue.criteria,
      MAIN_VALUE_PROPOSITION_OPTION_KEYS,
      "main_value_proposition"
    );
  }

  // Las otras 4 known signals (`noul` / `score`) no tienen option keys:
  // la estructural ya garantiza su forma.
}

function assertExactChoiceKeys(
  ctx: z.RefinementCtx,
  path: (string | number)[],
  criteria: Record<string, string>,
  expected: readonly string[],
  questionKey: string
): void {
  const actual = Object.keys(criteria).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((k, i) => k !== wanted[i])
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: `${questionKey}.criteria keys mismatch: esperado exactamente [${expected.join(
        ", "
      )}], recibido [${actual.join(", ")}]`,
      params: {
        code: "choice_keys_mismatch",
        question: questionKey,
        expected,
        actual,
      },
    });
  }
}

/* ============================================================
 * assertJevProtectedKeys — candado por clase, contra el baseline
 * ============================================================ */

/**
 * Revisión de las clases protegidas contra el **baseline** (el draft
 * tal y como está guardado), complemento del `superRefine` de
 * `ConfigV1Schema`.
 *
 * El Zod ya cubre, sin conocer el historial:
 *   - `engine-required` ausentes / con `type` incorrecto /
 *     con `enabled = false`;
 *   - option keys fuera del set V1 en `next_action`, `buying_timing`
 *     y `main_value_proposition`;
 *   - `key` mal formadas (`^[a-z_]+$`, ≤ 60 chars).
 *
 * Lo que el Zod **no** puede saber es si una `known signal` cambió
 * de `type`. El schema es un `discriminatedUnion` sobre `type`, así
 * que `real_operational_need` pasando de `noul` a `score` con sus
 * criterios nuevos es un documento *estructuralmente válido* que el
 * motor leería con otra forma de la que espera. Eso es exactamente
 * lo que el Corte 5 prohíbe ("key, type fijos"), así que lo
 * detectamos aquí comparando con el documento previo.
 *
 * Códigos emitidos (alineados con el `code` de los 422 del API):
 *   - `protected_key_removed`  — desaparece una key protegida.
 *   - `protected_type_change`  — cambia el `type` de una key protegida.
 *
 * `baseline` es el `jev_questions` guardado. Si viene `undefined`
 * (no debería en el PUT, que siempre tiene draft), solo se valida
 * contra la tabla de tipos esperados.
 */
export function assertJevProtectedKeys(
  next: unknown,
  baseline?: unknown
): ParseErrorDetail[] {
  const issues: ParseErrorDetail[] = [];
  const qs = asQuestionRecord(next);
  if (qs === null) return issues;

  const base = asQuestionRecord(baseline);
  const protectedKeys = Object.keys(PROTECTED_QUESTION_TYPES);

  for (const key of protectedKeys) {
    const expectedType = PROTECTED_QUESTION_TYPES[key];
    if (expectedType === undefined) continue;
    const q = qs[key];

    if (q === undefined) {
      // Las `engine-required` nunca desaparecen (el Zod ya lo exige);
      // las `known signal` sí pueden: el resolver tolera ausentes.
      if (base?.[key] !== undefined) {
        issues.push({
          path: ["jev_questions", key],
          message: `pregunta protegida eliminada: ${key} es contrato del motor`,
          code: "protected_key_removed",
        });
      }
      continue;
    }

    if (q.type !== expectedType) {
      issues.push({
        path: ["jev_questions", key, "type"],
        message: `protected type change: ${key} debe seguir siendo ${expectedType}, recibido ${q.type}`,
        code: "protected_type_change",
      });
      continue;
    }

    // Si el baseline tenía otra forma, el cambio es explícito aunque
    // el `type` esperado coincida (p. ej. la key se creó nueva con el
    // `type` correcto pero no venía del contrato).
    const prev = base?.[key];
    if (prev !== undefined && prev.type !== q.type) {
      issues.push({
        path: ["jev_questions", key, "type"],
        message: `protected type change: ${key} cambió de ${prev.type} a ${q.type}`,
        code: "protected_type_change",
      });
    }
  }

  return issues;
}

/**
 * Narrowing defensivo del record de preguntas. Acepta cualquier valor
 * (el PUT lo pasa ya parseado, pero la función también se usa en
 * tests) y devuelve `null` si no tiene la forma mínima de un map de
 * preguntas.
 */
function asQuestionRecord(
  value: unknown
): Record<string, { type?: unknown }> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, { type?: unknown }>;
}
