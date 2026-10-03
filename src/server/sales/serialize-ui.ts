import { BUYING_TIMING_OPTION_KEYS, MAIN_VALUE_PROPOSITION_OPTION_KEYS } from "@/lib/sales/playbook/constants";
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

const BUYING_TIMINGS = new Set<string>(BUYING_TIMING_OPTION_KEYS);

const MAIN_VALUE_PROPOSITIONS = new Set<string>(MAIN_VALUE_PROPOSITION_OPTION_KEYS);

/**
 * DTO operativo del estado comercial. No incluye snapshot crudo ni probabilities.
 *
 * Corte 3 — T305:
 *   - `snapshot.*` solo contiene los campos que tienen valor: si el
 *     playbook apaga una pregunta o el proveedor no la trae, ese
 *     campo NO se serializa (en vez de aparecer como `null`).
 *   - `mainValueProposition` también se serializa opcionalmente.
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
  const mainValueProposition = readChoice(
    decision.mainValueProposition,
    MAIN_VALUE_PROPOSITIONS
  );
  const realOperationalNeed = readNoul(decision.realOperationalNeed);
  const productFit = readScore(decision.productFit);
  const motivationToChange = readScore(decision.motivationToChange);
  const purchaseIntent = readScore(decision.purchaseIntent);

  if (
    !nextAction &&
    !buyingTiming &&
    !mainValueProposition &&
    !realOperationalNeed &&
    !productFit &&
    !motivationToChange &&
    !purchaseIntent
  ) {
    return null;
  }

  const dto: SalesSnapshotDto = {};
  if (nextAction) {
    dto.nextAction = nextAction.choice;
    if (nextAction.confidence !== undefined) {
      dto.nextActionConfidence = nextAction.confidence;
    }
  }
  if (buyingTiming) {
    dto.buyingTiming = buyingTiming.choice;
    if (buyingTiming.confidence !== undefined) {
      dto.buyingTimingConfidence = buyingTiming.confidence;
    }
  }
  if (mainValueProposition) {
    // `mainValueProposition` se incluye como campo del DTO pero NO se
    // declara en el tipo público canónico (mantiene compatibilidad
    // hacia atrás con callers que solo conocen `SalesSnapshotDto`).
    // Se persiste como `mainValueProposition` para que el editor (Corte 4)
    // pueda mostrarlo sin reinterpretar la fila cruda.
    (dto as Record<string, unknown>).mainValueProposition =
      mainValueProposition.choice;
    if (mainValueProposition.confidence !== undefined) {
      (dto as Record<string, unknown>).mainValuePropositionConfidence =
        mainValueProposition.confidence;
    }
  }
  if (realOperationalNeed) {
    dto.realOperationalNeed = realOperationalNeed.noul;
    if (realOperationalNeed.confidence !== undefined) {
      dto.realOperationalNeedConfidence = realOperationalNeed.confidence;
    }
  }
  if (productFit) {
    dto.productFit = productFit.score;
    if (productFit.confidence !== undefined) {
      dto.productFitConfidence = productFit.confidence;
    }
  }
  if (motivationToChange) {
    // Idem `mainValueProposition`: se persiste para el editor (Corte 4).
    (dto as Record<string, unknown>).motivationToChange =
      motivationToChange.score;
    if (motivationToChange.confidence !== undefined) {
      (dto as Record<string, unknown>).motivationToChangeConfidence =
        motivationToChange.confidence;
    }
  }
  if (purchaseIntent) {
    dto.purchaseIntent = purchaseIntent.score;
    if (purchaseIntent.confidence !== undefined) {
      dto.purchaseIntentConfidence = purchaseIntent.confidence;
    }
  }
  return dto;
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
