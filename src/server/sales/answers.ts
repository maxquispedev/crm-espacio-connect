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

export type BuyingTimingChoice =
  | "now"
  | "soon"
  | "future_season"
  | "unknown"
  | "no_current_plan";

export type MainValuePropositionChoice =
  | "operational_control"
  | "reduce_whatsapp_dependency"
  | "online_enrollment"
  | "reduce_manual_work"
  | "no_relevant_value_now";

export type NextActionChoice =
  | "ask_more_questions"
  | "show_operations_demo"
  | "show_online_enrollment_demo"
  | "present_price"
  | "schedule_call"
  | "schedule_follow_up"
  | "disqualify";

export type RealOperationalNeedAnswer = NormalizedNoul;
export type ProductFitAnswer = NormalizedScore;
export type MotivationToChangeAnswer = NormalizedScore;
export type PurchaseIntentAnswer = NormalizedScore;
export type BuyingTimingAnswer = NormalizedChoice<BuyingTimingChoice>;
export type MainValuePropositionAnswer =
  NormalizedChoice<MainValuePropositionChoice>;
export type NextActionAnswer = NormalizedChoice<NextActionChoice>;
export type NeedsHumanCallAnswer = NormalizedNoul;
