import { schema } from "@/lib/db";
import type { AutomationLane, ContactSalesDto, SalesSnapshotDto } from "@/lib/types";
import { AUTOMATION_LANES } from "@/server/sales/lanes";

type LeadRow = typeof schema.lead.$inferSelect;

const NEXT_ACTIONS = new Set([
  "ask_more_questions",
  "show_operations_demo",
  "show_online_enrollment_demo",
  "present_price",
  "schedule_call",
  "schedule_follow_up",
  "disqualify",
]);

const BUYING_TIMINGS = new Set([
  "now",
  "soon",
  "future_season",
  "unknown",
  "no_current_plan",
]);

/**
 * DTO operativo del estado comercial. No incluye snapshot crudo ni probabilities.
 */
export function serializeLeadSalesState(lead: LeadRow): ContactSalesDto {
  return {
    lane: isLane(lead.automationLane) ? lead.automationLane : "auto",
    lastEvaluatedAt: lead.lastJevEvaluatedAt?.toISOString() ?? null,
    demoShownAt: lead.demoShownAt?.toISOString() ?? null,
    pricePresentedAt: lead.pricePresentedAt?.toISOString() ?? null,
    nextFollowUpAt: lead.nextFollowUpAt?.toISOString() ?? null,
    followUpCount: lead.followUpCount,
    followUpReason: lead.followUpReason,
    snapshot: extractSnapshot(lead.lastJevDecision),
  };
}

function extractSnapshot(raw: unknown): SalesSnapshotDto | null {
  if (!isRecord(raw)) return null;
  const decision = isRecord(raw.decision) ? raw.decision : null;
  if (!decision) return null;

  const nextAction = readChoice(decision.nextAction, NEXT_ACTIONS);
  const buyingTiming = readChoice(decision.buyingTiming, BUYING_TIMINGS);
  const realOperationalNeed = readNoul(decision.realOperationalNeed);
  const productFit = readScore(decision.productFit);
  const purchaseIntent = readScore(decision.purchaseIntent);

  if (
    !nextAction &&
    !buyingTiming &&
    !realOperationalNeed &&
    !productFit &&
    !purchaseIntent
  ) {
    return null;
  }

  return {
    nextAction: nextAction?.choice ?? null,
    buyingTiming: buyingTiming?.choice ?? null,
    realOperationalNeed: realOperationalNeed?.noul ?? null,
    productFit: productFit?.score ?? null,
    purchaseIntent: purchaseIntent?.score ?? null,
    nextActionConfidence: nextAction?.confidence,
    buyingTimingConfidence: buyingTiming?.confidence,
    realOperationalNeedConfidence: realOperationalNeed?.confidence,
    productFitConfidence: productFit?.confidence,
    purchaseIntentConfidence: purchaseIntent?.confidence,
  };
}

function readChoice(
  value: unknown,
  allowed: Set<string>
): { choice: string; confidence?: number } | null {
  if (!isRecord(value) || typeof value.choice !== "string") return null;
  if (!allowed.has(value.choice)) return null;
  return { choice: value.choice, confidence: readConfidence(value.confidence) };
}

function readNoul(
  value: unknown
): { noul: number; confidence?: number } | null {
  if (!isRecord(value) || typeof value.noul !== "number" || !Number.isFinite(value.noul)) {
    return null;
  }
  return { noul: value.noul, confidence: readConfidence(value.confidence) };
}

function readScore(
  value: unknown
): { score: number; confidence?: number } | null {
  if (!isRecord(value) || typeof value.score !== "number" || !Number.isFinite(value.score)) {
    return null;
  }
  return { score: value.score, confidence: readConfidence(value.confidence) };
}

function readConfidence(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isLane(value: string): value is AutomationLane {
  return (AUTOMATION_LANES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
