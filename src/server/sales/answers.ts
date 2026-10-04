/**
 * Respuestas Jev ya normalizadas. El resto del CRM usa estos tipos,
 * no el JSON crudo del proveedor.
 */

export type NormalizedNoul = {
  type: "noul";
  /** Probabilidad TypeSafe; el umbral de “claramente positivo” lo fija el resolver. */
  noul: number;
  confidence?: number;
  probabilities?: Record<string, number>;
};

export type NormalizedScore = {
  type: "score";
  score: number;
  confidence?: number;
  probabilities?: Record<string, number>;
};

export type NormalizedChoice<T extends string> = {
  type: "choice";
  choice: T;
  confidence?: number;
  probabilities?: Record<string, number>;
};

/**
 * Set de claves V2 del contrato de preguntas. El orquestrador las
 * acepta como `choice` cuando la pregunta `buying_timing` está activa.
 * El runtime valida contra `JEV_SALES_QUESTIONS_V2.buying_timing.criteria`
 * — esta unión debe coincidir con esas claves.
 */
export type BuyingTimingChoice = import("./questions").BuyingTimingChoice;

export type MainValuePropositionChoice = import("./questions").MainValuePropositionChoice;

export type NextActionChoice =
  | "ask_more_questions"
  | "show_operations_demo"
  | "show_online_enrollment_demo"
  | "present_price"
  | "schedule_call"
  | "schedule_follow_up"
  | "disqualify"
  | "send_payment_instructions";

export type RealOperationalNeedAnswer = NormalizedNoul;
export type ProductFitAnswer = NormalizedScore;
export type MotivationToChangeAnswer = NormalizedScore;
export type PurchaseIntentAnswer = NormalizedScore;
export type BuyingTimingAnswer = NormalizedChoice<BuyingTimingChoice>;
export type MainValuePropositionAnswer =
  NormalizedChoice<MainValuePropositionChoice>;
export type NextActionAnswer = NormalizedChoice<NextActionChoice>;
export type NeedsHumanCallAnswer = NormalizedNoul;

/**
 * Forma normalizada genérica de cualquier respuesta Jev (sin narrow
 * por key). El runtime la usa para el buffer `signals` y para
 * preservar preguntas `analytical/custom` arbitrarias que el
 * playbook pueda activar.
 */
export type NormalizedAnswer =
  | NormalizedNoul
  | NormalizedScore
  | (NormalizedChoice<string>);