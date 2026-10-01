import type {
  BuyingTimingAnswer,
  MainValuePropositionAnswer,
  MotivationToChangeAnswer,
  NeedsHumanCallAnswer,
  NextActionAnswer,
  ProductFitAnswer,
  PurchaseIntentAnswer,
  RealOperationalNeedAnswer,
} from "@/server/sales/answers";
import type { NormalizedAnswer } from "@/server/sales/answers";

/**
 * Decisión comercial de Jev, ya normalizada.
 * No incluye lane: eso lo decide el resolver determinístico.
 *
 * Corte 3 — Contrato dinámico:
 *   - `nextAction` y `needsHumanCall` siguen siendo REQUERIDOS (el
 *     motor los necesita para ramificar el plan y para el handoff).
 *   - Los 6 known signals pasan a `T | null`: si el playbook publicado
 *     los apaga (`enabled=false`) o si la respuesta del proveedor
 *     no los trae, el campo es `null`. Cada consumidor tiene su
 *     fallback explícito documentado.
 *   - `signals` preserva cualquier `analytical/custom` arbitraria
 *     que el proveedor emita, parseada por su `type` (noul/score/
 *     choice). Sirve como buffer de "respuestas fuera del set V1"
 *     sin modificar la forma estable de SalesDecision.
 */
export type SalesDecision = {
  realOperationalNeed: RealOperationalNeedAnswer | null;
  productFit: ProductFitAnswer | null;
  motivationToChange: MotivationToChangeAnswer | null;
  purchaseIntent: PurchaseIntentAnswer | null;
  buyingTiming: BuyingTimingAnswer | null;
  mainValueProposition: MainValuePropositionAnswer | null;
  /** Requerido. Sale de `next_action` que el motor siempre envía. */
  nextAction: NextActionAnswer;
  /** Requerido. Sale de `needs_human_call` que el motor siempre envía. */
  needsHumanCall: NeedsHumanCallAnswer;
  /**
   * Buffer de señales arbitrarias del proveedor. El cliente HTTP
   * las recibe como JSON y el normalizer las parsea por su `type`
   * sin filtrar por nombre.
   */
  signals: Record<string, NormalizedAnswer>;
};

/**
 * JSON crudo del proveedor. Solo el normalizer lo interpreta.
 * El adaptador HTTP puede persistirlo en `lead.last_jev_decision`.
 */
export type JevRawProviderResponse = unknown;

/**
 * Forma observada en el harness de evaluación. No es un contrato HTTP
 * validado; no usar fuera del normalizer.
 */
export type JevProviderAnswer =
  | { type: "noul"; noul: number; confidence?: number; probabilities?: Record<string, number> }
  | {
      type: "choice";
      choice: string;
      probabilities?: Record<string, number>;
      confidence?: number;
    }
  | {
      type: "score";
      score: number;
      legend?: Record<string, string>;
      probabilities?: Record<string, number>;
      confidence?: number;
    };

export type JevNormalizeSuccess = {
  ok: true;
  decision: SalesDecision;
};

export type JevNormalizeFailure = {
  ok: false;
  error: string;
};

export type JevNormalizeResult = JevNormalizeSuccess | JevNormalizeFailure;

/**
 * Códigos estructurados que el normalizer usa al fallar. El cliente
 * HTTP los mapea a `detail` para el usuario, pero los tests pueden
 * assert sobre `code` sin parsear el mensaje.
 */
export type NormalizeErrorCode =
  | "missing_required"
  | "type_mismatch"
  | "invalid_choice_key"
  | "malformed_shape"
  | "invalid_envelope";

export type NormalizeError = {
  code: NormalizeErrorCode;
  detail: string;
  key?: string;
};

export type NormalizeSuccess = {
  ok: true;
  decision: SalesDecision;
};

export type NormalizeResult = NormalizeSuccess | { ok: false; error: NormalizeError };

/**
 * Frontera: raw provider response → normalizeJevResponse → SalesDecision.
 * El cliente HTTP es el único que habla con TypeSafe.
 */
export type NormalizeJevResponse = (
  raw: JevRawProviderResponse,
  activeQuestions: Readonly<Record<string, import("@/server/sales/questions").JevQuestionDefinition>>,
  knownSignalKeys: readonly string[]
) => NormalizeResult;

/**
 * Claves de los 6 known signals que el normalizer trata como nullable
 * cuando el playbook los apaga o el proveedor no los emite. NO incluye
 * `next_action` ni `needs_human_call` (esos son engine-required y se
 * exigen como `fail` si faltan en la respuesta).
 */
export const KNOWN_SIGNAL_KEYS = [
  "real_operational_need",
  "product_fit",
  "motivation_to_change",
  "purchase_intent",
  "buying_timing",
  "main_value_proposition",
] as const;

export type KnownSignalKey = (typeof KNOWN_SIGNAL_KEYS)[number];

/**
 * Claves que el motor SIEMPRE envía al proveedor porque el resolver
 * determinístico las necesita. Si la respuesta las omite, el
 * normalizer hace `fail` con `code: 'missing_required'`.
 */
export const ENGINE_REQUIRED_KEYS = [
  "next_action",
  "needs_human_call",
] as const;

export type EngineRequiredKey = (typeof ENGINE_REQUIRED_KEYS)[number];
