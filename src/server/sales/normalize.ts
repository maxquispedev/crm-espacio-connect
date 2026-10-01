import type {
  BuyingTimingChoice,
  MainValuePropositionChoice,
  NextActionAnswer,
  NextActionChoice,
  NormalizedAnswer,
  NormalizedChoice,
  NormalizedNoul,
  NormalizedScore,
} from "@/server/sales/answers";
import {
  type NormalizeError,
  type NormalizeResult,
  KNOWN_SIGNAL_KEYS,
  ENGINE_REQUIRED_KEYS,
  type SalesDecision,
} from "@/server/sales/decision";
import {
  JEV_SALES_QUESTIONS_V2,
  type JevQuestionDefinition,
  type JevQuestions,
  pickActiveQuestions,
} from "@/server/sales/questions";

/**
 * Convierte el JSON crudo del proveedor (TypeSafe o mock) a la
 * `SalesDecision` del runtime. Contrato dinámico (Corte 3):
 *
 *   - `next_action` y `needs_human_call` son **engine-required**:
 *     si faltan en `activeQuestions` o `enabled=false`, el motor ya
 *     no las envía al proveedor (T303). Si la respuesta del
 *     proveedor las omite o las entrega con `type` incorrecto, el
 *     normalizer hace `fail` con código estructurado.
 *   - Los 6 known signals son **nullable**:
 *     - Si están en `activeQuestions` con `enabled=true` → parsear.
 *     - Si están con `enabled=false` o no están en `activeQuestions`
 *       → `null` (fallback documentado en cada consumidor).
 *     - Si vienen en la respuesta pero con shape inválido → `null`.
 *   - Cualquier clave extra (`analytical/custom`) que venga en la
 *     respuesta y NO esté en `knownSignalKeys` se parsea por su
 *     `type` y se preserva en `signals[key]`.
 *
 * El normalizer NO añade defaults ni inventa datos. Su misión es
 * traducir fielmente la respuesta del proveedor a la forma del
 * runtime.
 */
export function normalizeJevResponse(
  raw: unknown,
  activeQuestions?: JevQuestions | Record<string, JevQuestionDefinition>,
  knownSignalKeys: readonly string[] = KNOWN_SIGNAL_KEYS
): NormalizeResult {
  if (!isRecord(raw)) {
    return fail({ code: "invalid_envelope", detail: "la respuesta del proveedor no es un objeto" });
  }

  const answers = raw.answers;
  if (!isRecord(answers)) {
    return fail({ code: "invalid_envelope", detail: "falta answers" });
  }

  // Set activo que el motor realmente envió a Jev. Si el caller no lo
  // provee (compatibilidad con tests antiguos / modo mock), usamos
  // el set por defecto V2 (todas habilitadas).
  const active: Record<string, JevQuestionDefinition> =
    activeQuestions !== undefined
      ? pickActiveQuestions(activeQuestions)
      : pickActiveQuestions(JEV_SALES_QUESTIONS_V2);

  // Engine-required: next_action y needs_human_call. Si el motor ya
  // no las envía (estaban apagadas en el playbook), el normalizer no
  // debe hacer fallback: la respuesta DEBE traerlas, y si no, fail.
  for (const required of ENGINE_REQUIRED_KEYS) {
    const q = active[required];
    const rawAns = answers[required];
    if (!q) {
      // El motor no envió la pregunta: si la respuesta igual la trae,
      // la ignoramos silenciosamente (defensivo contra respuestas
      // pre-generadas con el set antiguo).
      continue;
    }
    if (!isRecord(rawAns)) {
      return fail({
        code: "missing_required",
        detail: `answers.${required} ausente`,
        key: required,
      });
    }
    if (rawAns.type !== undefined) {
      const expected = required === "next_action" ? "choice" : "noul";
      if (rawAns.type !== expected) {
        return fail({
          code: "type_mismatch",
          detail: `answers.${required} type inválido`,
          key: required,
        });
      }
    }
  }

  // next_action (engine-required, choice con keys V1).
  const nextActionResult = parseNextActionOrRequired(
    answers.next_action,
    active.next_action
  );
  if (!nextActionResult.ok) return nextActionResult.result;
  const nextAction = nextActionResult.value;

  // needs_human_call (engine-required, noul).
  const needsHumanCallResult = parseNeedsHumanCallOrRequired(
    answers.needs_human_call,
    active.needs_human_call
  );
  if (!needsHumanCallResult.ok) return needsHumanCallResult.result;
  const needsHumanCall = needsHumanCallResult.value;

  // Known signals: nullable. Si están activos, parsear; si no, null.
  const realOperationalNeed = parseKnownSignalNullable<NormalizedNoul>(
    answers.real_operational_need,
    active.real_operational_need,
    "real_operational_need",
    "noul"
  );
  if (realOperationalNeed.ok === false) return realOperationalNeed.result;

  const productFit = parseKnownSignalNullable<NormalizedScore>(
    answers.product_fit,
    active.product_fit,
    "product_fit",
    "score"
  );
  if (productFit.ok === false) return productFit.result;

  const motivationToChange = parseKnownSignalNullable<NormalizedScore>(
    answers.motivation_to_change,
    active.motivation_to_change,
    "motivation_to_change",
    "score"
  );
  if (motivationToChange.ok === false) return motivationToChange.result;

  const purchaseIntent = parseKnownSignalNullable<NormalizedScore>(
    answers.purchase_intent,
    active.purchase_intent,
    "purchase_intent",
    "score"
  );
  if (purchaseIntent.ok === false) return purchaseIntent.result;

  const buyingTiming = parseKnownSignalNullable<NormalizedChoice<BuyingTimingChoice>>(
    answers.buying_timing,
    active.buying_timing,
    "buying_timing",
    "choice",
    isBuyingTimingChoiceKey
  );
  if (buyingTiming.ok === false) return buyingTiming.result;

  const mainValueProposition = parseKnownSignalNullable<
    NormalizedChoice<MainValuePropositionChoice>
  >(
    answers.main_value_proposition,
    active.main_value_proposition,
    "main_value_proposition",
    "choice",
    isMainValuePropositionChoiceKey
  );
  if (mainValueProposition.ok === false) return mainValueProposition.result;

  // Buffer de señales arbitrarias (analytical/custom): cualquier key
  // extra que venga en la respuesta y NO esté en knownSignalKeys ni
  // en engine-required se parsea por su `type` y se preserva.
  const signals: Record<string, NormalizedAnswer> = {};
  const reservedKeys = new Set<string>([
    ...knownSignalKeys,
    ...ENGINE_REQUIRED_KEYS,
  ]);
  for (const [key, value] of Object.entries(answers)) {
    if (reservedKeys.has(key)) continue;
    if (!isRecord(value)) continue;
    const parsed = parseArbitraryAnswer(key, value);
    if (parsed !== null) signals[key] = parsed;
  }

  const decision: SalesDecision = {
    realOperationalNeed: realOperationalNeed.value,
    productFit: productFit.value,
    motivationToChange: motivationToChange.value,
    purchaseIntent: purchaseIntent.value,
    buyingTiming: buyingTiming.value,
    mainValueProposition: mainValueProposition.value,
    nextAction,
    needsHumanCall,
    signals,
  };

  return { ok: true, decision };
}

/* ============================================================
 * Parsers elementales
 * ============================================================ */

function parseNoul(value: unknown, key: string): NormalizedNoul | string {
  if (!isRecord(value)) return `answers.${key} no es un objeto`;
  if (value.type !== undefined && value.type !== "noul") {
    return `answers.${key} type inválido`;
  }
  if (typeof value.noul !== "number" || !Number.isFinite(value.noul)) {
    return `answers.${key} noul ausente o no numérico`;
  }
  return withSignals({ type: "noul" as const, noul: value.noul }, value);
}

function parseScore(value: unknown, key: string): NormalizedScore | string {
  if (!isRecord(value)) return `answers.${key} no es un objeto`;
  if (value.type !== undefined && value.type !== "score") {
    return `answers.${key} type inválido`;
  }
  if (typeof value.score !== "number" || !Number.isFinite(value.score)) {
    return `answers.${key} score ausente o no numérico`;
  }
  return withSignals({ type: "score" as const, score: value.score }, value);
}

function parseChoice<T extends string>(
  value: unknown,
  key: string,
  isAllowed: (choice: string) => choice is T
): NormalizedChoice<T> | string {
  if (!isRecord(value)) return `answers.${key} no es un objeto`;
  if (value.type !== undefined && value.type !== "choice") {
    return `answers.${key} type inválido`;
  }
  if (typeof value.choice !== "string" || !isAllowed(value.choice)) {
    return `answers.${key} choice inválido`;
  }
  return withSignals({ type: "choice" as const, choice: value.choice }, value);
}

/* ============================================================
 * Parsers del runtime (engine-required + nullable known signals)
 * ============================================================ */

function parseNextActionOrRequired(
  raw: unknown,
  q: JevQuestionDefinition | undefined
): { ok: true; value: NextActionAnswer } | { ok: false; result: NormalizeResult } {
  if (!q) {
    // El motor no envió la pregunta; el resultado depende de si el
    // caller del motor aún la requiere. En el runtime actual,
    // runSalesOrchestratorTurn exige next_action para ramificar el
    // plan, así que esta rama nunca se da (next_action SIEMPRE está
    // activo). Devolvemos fail explícito si llega aquí, es bug del
    // caller.
    return {
      ok: false,
      result: fail({
        code: "missing_required",
        detail: "next_action no está activo en el playbook",
        key: "next_action",
      }),
    };
  }
  const parsed = parseChoice(raw, "next_action", isNextActionChoiceKey);
  if (typeof parsed === "string") {
    // Distinguir entre type inválido e invalid_choice_key.
    if (isRecord(raw) && raw.type !== undefined && raw.type !== "choice") {
      return {
        ok: false,
        result: fail({
          code: "type_mismatch",
          detail: `answers.next_action type inválido`,
          key: "next_action",
        }),
      };
    }
    if (isRecord(raw) && typeof raw.choice === "string" && !isNextActionChoiceKey(raw.choice)) {
      return {
        ok: false,
        result: fail({
          code: "invalid_choice_key",
          detail: `answers.next_action choice '${raw.choice}' fuera del set V1`,
          key: "next_action",
        }),
      };
    }
    return {
      ok: false,
      result: fail({
        code: "missing_required",
        detail: parsed,
        key: "next_action",
      }),
    };
  }
  // Narrow: parseChoice retorna NormalizedChoice<NextActionChoice>
  // que ya incluye confidence/probabilities (con `withSignals`).
  return { ok: true, value: parsed as NextActionAnswer };
}

function parseNeedsHumanCallOrRequired(
  raw: unknown,
  q: JevQuestionDefinition | undefined
): { ok: true; value: NormalizedNoul } | { ok: false; result: NormalizeResult } {
  if (!q) {
    return {
      ok: false,
      result: fail({
        code: "missing_required",
        detail: "needs_human_call no está activo en el playbook",
        key: "needs_human_call",
      }),
    };
  }
  const parsed = parseNoul(raw, "needs_human_call");
  if (typeof parsed === "string") {
    if (isRecord(raw) && raw.type !== undefined && raw.type !== "noul") {
      return {
        ok: false,
        result: fail({
          code: "type_mismatch",
          detail: `answers.needs_human_call type inválido`,
          key: "needs_human_call",
        }),
      };
    }
    return {
      ok: false,
      result: fail({
        code: "missing_required",
        detail: parsed,
        key: "needs_human_call",
      }),
    };
  }
  return { ok: true, value: parsed };
}

/**
 * Parser de un known signal con semántica nullable:
 *   - Si la pregunta NO está activa → null.
 *   - Si la respuesta está ausente o mal formada → null.
 *   - Si la respuesta es válida → parseada con su shape correcto.
 *
 * Devuelve `{ ok: true, value: T | null }` en éxito, o
 * `{ ok: false, result: NormalizeResult }` en error (única fuente
 * de fail: `invalid_choice_key` cuando la respuesta trae una key
 * fuera del set V1 — comportamiento explícito por T304).
 */
function parseKnownSignalNullable<T extends NormalizedAnswer>(
  raw: unknown,
  q: JevQuestionDefinition | undefined,
  key: string,
  expected: "noul" | "score" | "choice",
  isAllowedChoiceKey?: (choice: string) => boolean
): { ok: true; value: T | null } | { ok: false; result: NormalizeResult } {
  if (!q) return { ok: true, value: null };
  if (!isRecord(raw)) {
    // Si la pregunta está activa y no hay respuesta, fallback a null
    // documentado por consumidor.
    return { ok: true, value: null };
  }
  if (raw.type !== undefined && raw.type !== expected) {
    // type_mismatch: el proveedor trajo un shape distinto al
    // esperado para esta pregunta. NO es engine-required: degradamos
    // a null sin tirar el turno entero.
    return { ok: true, value: null };
  }
  if (expected === "noul") {
    const parsed = parseNoul(raw, key);
    if (typeof parsed === "string") return { ok: true, value: null };
    return { ok: true, value: parsed as unknown as T };
  }
  if (expected === "score") {
    const parsed = parseScore(raw, key);
    if (typeof parsed === "string") return { ok: true, value: null };
    return { ok: true, value: parsed as unknown as T };
  }
  // expected === "choice"
  // Para buying_timing y main_value_proposition validamos que la key
  // pertenezca al set V1 (default criteria). Si llega una key fuera
  // del set V1, fail explícito con invalid_choice_key.
  if (typeof raw.choice === "string") {
    const keyInV1Set = isChoiceInV1Default(key);
    if (!keyInV1Set) {
      // La pregunta activa del playbook NO es buying_timing ni
      // main_value_proposition: no podemos validar la key contra V1.
      // Aceptamos cualquier string (criterio del playbook actual).
      const parsed = parseChoice(
        raw,
        key,
        (v): v is string => typeof v === "string"
      );
      if (typeof parsed === "string") return { ok: true, value: null };
      return { ok: true, value: parsed as unknown as T };
    }
    if (!isV1DefaultChoiceValid(key, raw.choice)) {
      return {
        ok: false,
        result: fail({
          code: "invalid_choice_key",
          detail: `answers.${key} choice '${raw.choice}' fuera del set V1`,
          key,
        }),
      };
    }
  }
  const allowedFn: (choice: string) => boolean =
    isAllowedChoiceKey ?? ((): boolean => true);
  const parsed = parseChoice(raw, key, (v): v is string => allowedFn(v));
  if (typeof parsed === "string") return { ok: true, value: null };
  return { ok: true, value: parsed as unknown as T };
}

/**
 * Determina si una clave de choice pertenece a uno de los 2 choice
 * keys V1 que validamos contra el set por defecto (`buying_timing`
 * y `main_value_proposition`). Para esos, `isV1DefaultChoiceValid`
 * verifica que la key de la respuesta esté en los criteria V1.
 */
function isChoiceInV1Default(key: string): boolean {
  return key === "buying_timing" || key === "main_value_proposition";
}

function isV1DefaultChoiceValid(key: string, choice: string): boolean {
  if (key === "buying_timing") return isBuyingTimingChoiceKey(choice);
  if (key === "main_value_proposition") return isMainValuePropositionChoiceKey(choice);
  return false;
}

/* ============================================================
 * Parser para analytical/custom (signals arbitrarios)
 * ============================================================ */

function parseArbitraryAnswer(
  key: string,
  raw: Record<string, unknown>
): NormalizedAnswer | null {
  const t = raw.type;
  if (t === "noul") {
    if (typeof raw.noul !== "number" || !Number.isFinite(raw.noul)) return null;
    return withSignals({ type: "noul" as const, noul: raw.noul }, raw);
  }
  if (t === "score") {
    if (typeof raw.score !== "number" || !Number.isFinite(raw.score)) return null;
    return withSignals({ type: "score" as const, score: raw.score }, raw);
  }
  if (t === "choice") {
    if (typeof raw.choice !== "string") return null;
    return withSignals({ type: "choice" as const, choice: raw.choice }, raw);
  }
  // Sin `type` declarado: intentar deducir por shape. Esto preserva
  // respuestas del proveedor que no marquen el discriminador.
  if (typeof raw.noul === "number" && Number.isFinite(raw.noul)) {
    return withSignals({ type: "noul" as const, noul: raw.noul }, raw);
  }
  if (typeof raw.score === "number" && Number.isFinite(raw.score)) {
    return withSignals({ type: "score" as const, score: raw.score }, raw);
  }
  if (typeof raw.choice === "string") {
    return withSignals({ type: "choice" as const, choice: raw.choice }, raw);
  }
  return null;
}

/* ============================================================
 * Helpers
 * ============================================================ */

function withSignals<T extends object>(
  base: T,
  raw: Record<string, unknown>
): T & { confidence?: number; probabilities?: Record<string, number> } {
  const confidence = readConfidence(raw.confidence);
  const probabilities = readProbabilities(raw.probabilities);
  return {
    ...base,
    ...(confidence !== undefined ? { confidence } : {}),
    ...(probabilities !== undefined ? { probabilities } : {}),
  };
}

function readConfidence(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readProbabilities(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      out[key] = entry;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function isBuyingTimingChoiceKey(value: string): value is BuyingTimingChoice {
  return value in JEV_SALES_QUESTIONS_V2.buying_timing.criteria;
}

function isMainValuePropositionChoiceKey(
  value: string
): value is MainValuePropositionChoice {
  return value in JEV_SALES_QUESTIONS_V2.main_value_proposition.criteria;
}

function isNextActionChoiceKey(value: string): value is NextActionChoice {
  return value in JEV_SALES_QUESTIONS_V2.next_action.criteria;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(error: NormalizeError): NormalizeResult {
  return { ok: false, error };
}