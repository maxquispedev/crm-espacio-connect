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

/* ============================================================
 * Catálogos congelados (contrato del resolver/writer)
 * ============================================================ */

export const NEXT_ACTION_OPTION_KEYS = [
  "ask_more_questions",
  "show_operations_demo",
  "show_online_enrollment_demo",
  "present_price",
  "schedule_call",
  "schedule_follow_up",
  "disqualify",
] as const;

export const BUYING_TIMING_OPTION_KEYS = [
  "now",
  "soon",
  "future_season",
  "unknown",
  "no_current_plan",
] as const;

export const MAIN_VALUE_PROPOSITION_OPTION_KEYS = [
  "operational_control",
  "reduce_whatsapp_dependency",
  "online_enrollment",
  "reduce_manual_work",
  "no_relevant_value_now",
] as const;

export const ENGINE_REQUIRED_KEYS = [
  "next_action",
  "needs_human_call",
] as const;

export const KNOWN_SIGNAL_KEYS = [
  "real_operational_need",
  "product_fit",
  "motivation_to_change",
  "purchase_intent",
  "buying_timing",
  "main_value_proposition",
] as const;

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
