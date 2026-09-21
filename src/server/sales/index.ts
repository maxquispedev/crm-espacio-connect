/**
 * Contrato tipado del Sales Orchestrator.
 * Frontera: raw provider → normalizeJevResponse → SalesDecision → CRM.
 * El cliente HTTP vive en `client.ts` y no está cableado al inbox.
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
  JevCrmState,
  JevPersistTarget,
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

export { normalizeJevResponse } from "@/server/sales/normalize";

export {
  evaluateJev,
  JEV_MAX_RETRIES,
  type EvaluateJevOptions,
  type JevClientErrorCode,
  type JevClientFailure,
  type JevClientResult,
  type JevClientSuccess,
  type JevEvaluateInput,
} from "@/server/sales/client";

export {
  JEV_STATE_CONTEXT,
  buildJevSalesState,
  trimConversation,
  type BuildJevSalesStateFailure,
  type BuildJevSalesStateInput,
  type BuildJevSalesStateResult,
  type BuildJevSalesStateSuccess,
} from "@/server/sales/build-state";

export {
  NEEDS_HUMAN_CALL_THRESHOLD,
  isClearlyPositiveHumanCall,
  resolveSalesPlan,
  type DurableSalesFacts,
  type FollowUpDirective,
  type PipelineSemantic,
  type ResolveSalesPlanInput,
  type SalesFactUpdates,
  type SalesPlan,
} from "@/server/sales/resolve-plan";

export {
  SalesWriterOutput,
  writeSalesReply,
  type SalesWriterFailure,
  type SalesWriterOutputType,
  type SalesWriterResult,
  type SalesWriterSuccess,
  type WriteSalesReplyInput,
} from "@/server/sales/writer";

export {
  matchSemanticStage,
  runSalesOrchestratorTurn,
} from "@/server/sales/orchestrator";

export { persistClientHumanRequest } from "@/server/sales/explicit-handoff";

export {
  FOLLOW_UP_DELAY_MS,
  FollowUpWriterOutput,
  MAX_FOLLOW_UP_ATTEMPTS,
  MAX_RUN_ATTEMPTS,
  classifyFollowUpReason,
  hasMoreCommercialAttempts,
  nextFollowUpDelay,
  shouldStartFollowUp,
  writeFollowUpText,
  cancelFollowUpsOnManualReply,
  cancelPendingFollowUps,
  getCurrentFollowUp,
  markDormant,
  resetFollowUpsOnInbound,
  scheduleManualFollowUp,
  scheduleNextFollowUp,
  enqueueFollowUpAttempt,
  runDueFollowUps,
  startSalesFollowUpWorker,
  type AutomaticFollowUpReason,
  type FollowUpWriterFailure,
  type FollowUpWriterOutputType,
  type FollowUpWriterResult,
  type FollowUpWriterSuccess,
  type WriteFollowUpInput,
  type ScheduleManualFollowUpResult,
} from "@/server/sales/follow-ups";
