import type {
  BuyingTimingChoice,
  MainValuePropositionChoice,
  NextActionChoice,
  NormalizedChoice,
  NormalizedNoul,
  NormalizedScore,
} from "@/server/sales/answers";
import type {
  JevNormalizeResult,
  SalesDecision,
} from "@/server/sales/decision";
import { JEV_SALES_QUESTIONS_V2 } from "@/server/sales/questions";

/**
 * Convierte el JSON crudo de TypeSafe al contrato interno.
 * No inventa probabilities ni confidence ausentes.
 */
export function normalizeJevResponse(raw: unknown): JevNormalizeResult {
  if (!isRecord(raw)) {
    return fail("la respuesta del proveedor no es un objeto");
  }

  const answers = raw.answers;
  if (!isRecord(answers)) {
    return fail("falta answers");
  }

  const realOperationalNeed = parseNoul(
    answers.real_operational_need,
    "real_operational_need"
  );
  if (typeof realOperationalNeed === "string") return fail(realOperationalNeed);

  const productFit = parseScore(answers.product_fit, "product_fit");
  if (typeof productFit === "string") return fail(productFit);

  const motivationToChange = parseScore(
    answers.motivation_to_change,
    "motivation_to_change"
  );
  if (typeof motivationToChange === "string") return fail(motivationToChange);

  const purchaseIntent = parseScore(answers.purchase_intent, "purchase_intent");
  if (typeof purchaseIntent === "string") return fail(purchaseIntent);

  const buyingTiming = parseChoice(
    answers.buying_timing,
    "buying_timing",
    isBuyingTiming
  );
  if (typeof buyingTiming === "string") return fail(buyingTiming);

  const mainValueProposition = parseChoice(
    answers.main_value_proposition,
    "main_value_proposition",
    isMainValueProposition
  );
  if (typeof mainValueProposition === "string") return fail(mainValueProposition);

  const nextAction = parseChoice(
    answers.next_action,
    "next_action",
    isNextAction
  );
  if (typeof nextAction === "string") return fail(nextAction);

  const needsHumanCall = parseNoul(
    answers.needs_human_call,
    "needs_human_call"
  );
  if (typeof needsHumanCall === "string") return fail(needsHumanCall);

  const decision: SalesDecision = {
    realOperationalNeed,
    productFit,
    motivationToChange,
    purchaseIntent,
    buyingTiming,
    mainValueProposition,
    nextAction,
    needsHumanCall,
  };

  return { ok: true, decision };
}

function parseNoul(value: unknown, key: string): NormalizedNoul | string {
  if (!isRecord(value)) return `answers.${key} no es un objeto`;
  if (value.type !== undefined && value.type !== "noul") {
    return `answers.${key} type inválido`;
  }
  if (typeof value.noul !== "number" || !Number.isFinite(value.noul)) {
    return `answers.${key} noul ausente o no numérico`;
  }
  return withSignals({ type: "noul", noul: value.noul }, value);
}

function parseScore(value: unknown, key: string): NormalizedScore | string {
  if (!isRecord(value)) return `answers.${key} no es un objeto`;
  if (value.type !== undefined && value.type !== "score") {
    return `answers.${key} type inválido`;
  }
  if (typeof value.score !== "number" || !Number.isFinite(value.score)) {
    return `answers.${key} score ausente o no numérico`;
  }
  return withSignals({ type: "score", score: value.score }, value);
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
  return withSignals({ type: "choice", choice: value.choice }, value);
}

function withSignals<T extends { type: string }>(
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

function isBuyingTiming(value: string): value is BuyingTimingChoice {
  return value in JEV_SALES_QUESTIONS_V2.buying_timing.criteria;
}

function isMainValueProposition(
  value: string
): value is MainValuePropositionChoice {
  return value in JEV_SALES_QUESTIONS_V2.main_value_proposition.criteria;
}

function isNextAction(value: string): value is NextActionChoice {
  return value in JEV_SALES_QUESTIONS_V2.next_action.criteria;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(error: string): JevNormalizeResult {
  return { ok: false, error };
}
