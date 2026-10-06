// JSONB is not a trusted DTO. Never spread provider snapshots or arbitrary objects.
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const scalar = (value: unknown): value is string | number | boolean | null =>
  value === null || typeof value === "string" || typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));
function pick(value: unknown, keys: readonly string[]) {
  const source = record(value);
  return Object.fromEntries(keys.filter(key => key in source && scalar(source[key])).map(key => [key, source[key]]));
}
const planKeys = ["lane", "nextAction", "shouldReply", "shouldHandoff", "handoffReason",
  "desiredPipelineSemantic", "demoGuardReason", "commercialEvidenceReason", "paymentDeliveryAuthorized"];
export function safePlan(value: unknown) {
  if (value === null || value === undefined) return null;
  return pick(value, planKeys);
}
export function safeJev(value: unknown) {
  if (value === null || value === undefined) return null;
  const source = record(value);
  const decision = record(source.decision);
  const keys = ["realOperationalNeed", "productFit", "motivationToChange", "purchaseIntent",
    "buyingTiming", "mainValueProposition", "nextAction", "needsHumanCall"];
  const answer = (value: unknown) => pick(value, ["type", "noul", "score", "choice", "confidence"]);
  // Dynamic analytical signals are normalized answers; key names are question IDs.
  // Exclude unknown keys to prevent arbitrary structured PII entering the export.
  return {
    decision: Object.fromEntries(keys.filter(key => key in decision).map(key =>
      [key, decision[key] === null ? null : answer(decision[key])])),
    plan: safePlan(source.plan),
  };
}
export function safeCustomData(value: unknown) {
  return pick(value, ["lead_stage", "value", "currency"]);
}
export function safeDeliveryPlan(value: unknown) {
  const source = record(value);
  return { sales_plan: safePlan(source.salesPlan), ...pick(source, ["scheduleFollowUp"]) };
}
export function safeFileName(value: string | null) {
  return value?.split(/[\\/]/).pop() || null;
}
