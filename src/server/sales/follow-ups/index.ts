export {
  FOLLOW_UP_DELAY_MS,
  MAX_FOLLOW_UP_ATTEMPTS,
  MAX_RUN_ATTEMPTS,
  classifyFollowUpReason,
  hasMoreCommercialAttempts,
  nextFollowUpDelay,
  shouldStartFollowUp,
  type AutomaticFollowUpReason,
} from "@/server/sales/follow-ups/policy";

export {
  FollowUpWriterOutput,
  writeFollowUpText,
  type FollowUpWriterFailure,
  type FollowUpWriterOutputType,
  type FollowUpWriterResult,
  type FollowUpWriterSuccess,
  type WriteFollowUpInput,
} from "@/server/sales/follow-ups/follow-up-writer";
