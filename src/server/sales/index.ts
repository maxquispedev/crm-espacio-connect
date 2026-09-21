/**
 * Contrato tipado del Sales Orchestrator.
 * Frontera: raw provider → normalizer → SalesDecision → CRM.
 * Este módulo no hace HTTP ni ejecuta el pipeline de IA.
 */

export { AUTOMATION_LANES, type AutomationLane } from "@/server/sales/lanes";

export type {
  BuyingTimingAnswer,
  BuyingTimingChoice,
  MainValuePropositionAnswer,
  MainValuePropositionChoice,
  MotivationToChangeAnswer,
  NeedsHumanCallAnswer,
  NextActionAnswer,
  NextActionChoice,
  NormalizedChoice,
  NormalizedNoul,
  NormalizedScore,
  ProductFitAnswer,
  PurchaseIntentAnswer,
  RealOperationalNeedAnswer,
} from "@/server/sales/answers";

export type {
  JevNormalizeFailure,
  JevNormalizeResult,
  JevNormalizeSuccess,
  JevProviderAnswer,
  JevRawProviderResponse,
  NormalizeJevResponse,
  SalesDecision,
} from "@/server/sales/decision";

export type {
  JevConversationTurn,
  JevDurableFacts,
  JevSalesState,
} from "@/server/sales/state";

export {
  JEV_QUESTION_KEYS,
  JEV_SALES_QUESTIONS_V2,
  type JevQuestionKey,
  type JevSalesQuestionsV2,
} from "@/server/sales/questions";

export {
  VENDE_VELOZ_COMMERCIAL_POLICY,
  VENDE_VELOZ_OFFER,
  VENDE_VELOZ_PRODUCT,
  type VendeVelozCommercialPolicy,
  type VendeVelozOffer,
  type VendeVelozProduct,
} from "@/server/sales/vende-veloz";
