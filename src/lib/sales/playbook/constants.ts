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

/* ============================================================
 * Candados por clase (Corte 5, T501/T506)
 *
 * Estas funciones son la ÚNICA fuente de verdad de qué se puede
 * editar en el editor Jev. La UI las consulta para pintar candados
 * y deshabilitar controles; el servidor NO depende de ellas (el Zod
 * de `schema.ts` valida el resultado final). Duplicar la regla en
 * dos sitios es justo el tipo de drift que este corte evita.
 * ============================================================ */

/** Los tres shapes de criterio que acepta el schema. */
export type JevQuestionType = "choice" | "noul" | "score";

/**
 * `type` esperado por el motor para cada key protegida. Las
 * `engine-required` ya lo fijan en el Zod; las `known signal` no
 * (su Zod solo mira las option keys cuando son `choice`), así que
 * esta tabla + `assertJevProtectedKeys` son el candado real.
 */
export const PROTECTED_QUESTION_TYPES: Readonly<
  Record<string, JevQuestionType>
> = {
  next_action: "choice",
  needs_human_call: "noul",
  real_operational_need: "noul",
  product_fit: "score",
  motivation_to_change: "score",
  purchase_intent: "score",
  buying_timing: "choice",
  main_value_proposition: "choice",
};

/**
 * Preguntas cuyas option keys son contrato: la UI las precarga y no
 * permite añadirlas ni quitarlas (solo editar la descripción).
 */
export const PROTECTED_CHOICE_OPTION_KEYS: Readonly<
  Record<string, readonly string[]>
> = {
  next_action: NEXT_ACTION_OPTION_KEYS,
  buying_timing: BUYING_TIMING_OPTION_KEYS,
  main_value_proposition: MAIN_VALUE_PROPOSITION_OPTION_KEYS,
};

/** `true` si la pregunta es parte del contrato del motor (no analítica). */
export function isJevKeyLocked(key: string): boolean {
  return classifyJevQuestion(key) !== "analytical";
}

/** `true` si la key no se puede renombrar (engine-required y known signal). */
export function isJevKeyRenamable(key: string): boolean {
  return !isJevKeyLocked(key);
}

/**
 * `true` si el `type` no se puede cambiar. Igual que la key: solo las
 * analíticas son libres.
 */
export function isJevTypeLocked(key: string): boolean {
  return isJevKeyLocked(key);
}

/**
 * `true` si el toggle `enabled` está bloqueado. Solo las
 * `engine-required`: si el motor puede fallar sin ellas, desactivar
 * una es un payload inválido (422 `engine_required_disabled`).
 * Las `known signal` SÍ se desactivan (con fallback).
 */
export function isJevEnabledLocked(key: string): boolean {
  return classifyJevQuestion(key) === "engine-required";
}

/** `true` si la pregunta puede duplicarse. Las contractuales no. */
export function isJevDuplicable(key: string): boolean {
  return classifyJevQuestion(key) !== "engine-required";
}

/** `true` si la pregunta puede eliminarse. Solo las analíticas. */
export function isJevDeletable(key: string): boolean {
  return classifyJevQuestion(key) === "analytical";
}

/** Las option keys que el motor espera para esta key, si están congeladas. */
export function frozenOptionKeys(key: string): readonly string[] | null {
  return PROTECTED_CHOICE_OPTION_KEYS[key] ?? null;
}

/**
 * Tooltip de la clase: explica qué está bloqueado y por qué. Vive
 * junto a los candados para que el texto y la regla no diverjan.
 */
export const JEV_QUESTION_CLASS_TOOLTIP: Record<JevQuestionClass, string> = {
  "engine-required":
    "Esta pregunta es parte del contrato del motor. Su key, type y option keys no pueden cambiar.",
  "known-signal":
    "Señal comercial reconocida por el motor. Key, type y option keys fijos. Puedes desactivar y editar descripciones.",
  analytical: "Pregunta libre, no afecta al motor.",
};

/**
 * Sugiere una key libre al duplicar: `<base>_copy`, y si ya existe
 * `<base>_copy_b`, `_copy_c`…
 *
 * **Por qué letras y no `_copy_2`:** el schema exige `^[a-z_]+$`, que
 * NO admite dígitos. Un sufijo numérico haría que el PUT fuera
 * rechazado por formato. Por eso la serie avanza con letras.
 */
export function suggestCopyKey(
  base: string,
  taken: Iterable<string>
): string {
  const used = new Set(taken);
  // `^[a-z_]+$` con tope de 60 chars: dejamos margen para el sufijo.
  const root = base.length > 50 ? base.slice(0, 50) : base;
  const first = `${root}_copy`;
  if (!used.has(first)) return first;
  const letters = "abcdefghijklmnopqrstuvwxyz";
  for (const letter of letters) {
    const candidate = `${root}_copy_${letter}`;
    if (!used.has(candidate)) return candidate;
  }
  // 26 intentos es de sobra; si se agotan, devuelve la primera y
  // deja que el Zod/apparezca el error de colisión.
  return first;
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

/** Extensión opt-in 1.1; el catálogo 1.0 permanece congelado. */
export const NEXT_ACTION_OPTION_KEYS_V11 = [...NEXT_ACTION_OPTION_KEYS, "send_payment_instructions"] as const;
