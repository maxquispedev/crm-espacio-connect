/**
 * Sales Playbook — Catálogos congelados del contrato (Corte 4, Feature 008).
 *
 * Estos catálogos son **contrato del resolver/writer**, no configuración:
 * las option keys de `next_action`, `buying_timing` y
 * `main_value_proposition` no se pueden renombrar ni reordenar. El Zod de
 * `schema.ts` y el normalizer (`server/sales/normalize.ts`) los consumen
 * como fuente única de verdad.
 *
 * **Por qué viven aparte de `schema.ts`:** el editor de UI (Corte 4) los
 * necesita para pintar los badges por clase de pregunta Jev, pero
 * `schema.ts` importa Zod. Mantener los catálogos en un módulo sin
 * dependencias evita arrastrar el validador completo al bundle del
 * navegador. `schema.ts` los re-exporta, así que los imports existentes
 * no cambian.
 */

/** Las 7 option keys de `next_action`. Contrato duro del resolver. */
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

/** Preguntas cuya ausencia invalida el turno. No editables en `key`/`type`. */
export const ENGINE_REQUIRED_KEYS = [
  "next_action",
  "needs_human_call",
] as const;

/** Señales comerciales que el motor reconoce y tolera ausentes. */
export const KNOWN_SIGNAL_KEYS = [
  "real_operational_need",
  "product_fit",
  "motivation_to_change",
  "purchase_intent",
  "buying_timing",
  "main_value_proposition",
] as const;

export type EngineRequiredKey = (typeof ENGINE_REQUIRED_KEYS)[number];
export type KnownSignalKey = (typeof KNOWN_SIGNAL_KEYS)[number];

/**
 * Las tres clases de preguntas Jev. La UI pinta un badge distinto por
 * clase y el editor Jev (Corte 5) aplica candados según la clase.
 */
export type JevQuestionClass = "engine-required" | "known-signal" | "analytical";

const ENGINE_REQUIRED_SET: ReadonlySet<string> = new Set(ENGINE_REQUIRED_KEYS);
const KNOWN_SIGNAL_SET: ReadonlySet<string> = new Set(KNOWN_SIGNAL_KEYS);

/**
 * Clasifica una key de pregunta Jev. `analytical` es el default: toda
 * pregunta creada por el usuario que no sea una de las 8 de V1.
 */
export function classifyJevQuestion(key: string): JevQuestionClass {
  if (ENGINE_REQUIRED_SET.has(key)) return "engine-required";
  if (KNOWN_SIGNAL_SET.has(key)) return "known-signal";
  return "analytical";
}

/** Etiquetas legibles de cada clase, para badges de la UI. */
export const JEV_QUESTION_CLASS_LABEL: Record<JevQuestionClass, string> = {
  "engine-required": "Obligatorias para el motor",
  "known-signal": "Señales que el motor reconoce",
  analytical: "Analíticas / propias",
};

/** Emoji de cada clase (contrato visual del spec 008). */
export const JEV_QUESTION_CLASS_ICON: Record<JevQuestionClass, string> = {
  "engine-required": "🔒",
  "known-signal": "📊",
  analytical: "➕",
};

/**
 * Las 7 instrucciones del writer, en el orden de las option keys del
 * resolver. El editor de UI (Corte 4) renderiza un textarea por entrada
 * en este orden fijo; no es editable la cantidad ni el orden.
 */
export const WRITER_NEXT_ACTIONS = [
  { key: "ask_more_questions", label: "Hacer más preguntas" },
  { key: "show_operations_demo", label: "Mostrar demo de operación" },
  { key: "show_online_enrollment_demo", label: "Mostrar demo de matrícula online" },
  { key: "present_price", label: "Presentar precio" },
  { key: "schedule_call", label: "Agendar llamada" },
  { key: "schedule_follow_up", label: "Agendar seguimiento" },
  { key: "disqualify", label: "Descalificar" },
] as const satisfies readonly { key: keyof WriterEntryShape; label: string }[];

/**
 * Forma de una entrada del bloque `writer`. Declarada aparte para que
 * `WRITER_NEXT_ACTIONS` pueda `satisfies`-tipearse sin importar el
 * schema Zod (y con él, arrastrar el validador al bundle del cliente).
 */
type WriterEntryShape = Record<string, string>;
