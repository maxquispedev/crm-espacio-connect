import type { SalesFollowUpReason } from "@/lib/types";
import type { SalesPlan } from "@/server/sales/resolve-plan";

/** Máximo de mensajes comerciales por secuencia automática. */
export const MAX_FOLLOW_UP_ATTEMPTS = 3;

/** Máximo de retries técnicos del mismo job (no consume otro intento comercial). */
export const MAX_RUN_ATTEMPTS = 3;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Delays relativos por intento (1-indexed).
 * Intento N se ancla al mensaje anterior de la secuencia, no a un cron absoluto.
 */
export const FOLLOW_UP_DELAY_MS = {
  awaiting_reply: {
    1: 6 * HOUR_MS,
    2: 18 * HOUR_MS,
    3: 48 * HOUR_MS,
  },
  after_demo: {
    1: 20 * HOUR_MS,
    2: 52 * HOUR_MS,
    3: 96 * HOUR_MS,
  },
  after_price: {
    1: 20 * HOUR_MS,
    2: 52 * HOUR_MS,
    3: 96 * HOUR_MS,
  },
} as const;

export type AutomaticFollowUpReason = Exclude<
  SalesFollowUpReason,
  "scheduled_wait"
>;

type FollowUpPlan = Pick<SalesPlan, "lane" | "nextAction" | "shouldReply">;

/**
 * Clasifica la secuencia automática según el plan ya resuelto.
 * No llama a Jev. Devuelve null si la lane no admite secuencia automática.
 */
export function classifyFollowUpReason(
  plan: FollowUpPlan
): AutomaticFollowUpReason | null {
  if (plan.lane !== "auto" && plan.lane !== "auto_close") return null;
  if (plan.nextAction === "present_price") return "after_price";
  if (
    plan.nextAction === "show_operations_demo" ||
    plan.nextAction === "show_online_enrollment_demo"
  ) {
    return "after_demo";
  }
  return "awaiting_reply";
}

/**
 * Delay hasta el intento comercial `attemptNumber`.
 * `scheduled_wait` no calcula fecha: la da el CRM de forma explícita.
 */
export function nextFollowUpDelay(
  reason: SalesFollowUpReason,
  attemptNumber: number
): number | null {
  if (reason === "scheduled_wait") return null;
  if (!isCommercialAttemptNumber(attemptNumber)) return null;
  return FOLLOW_UP_DELAY_MS[reason][attemptNumber];
}

/**
 * Tras completar `attemptNumber`, ¿queda otro intento comercial?
 * `scheduled_wait` es one-shot: nunca encadena.
 */
export function hasMoreCommercialAttempts(
  reason: SalesFollowUpReason,
  attemptNumber: number
): boolean {
  if (reason === "scheduled_wait") return false;
  if (!isCommercialAttemptNumber(attemptNumber)) return false;
  return attemptNumber < MAX_FOLLOW_UP_ATTEMPTS;
}

/**
 * ¿Programar secuencia automática después de una respuesta enviada?
 * WAIT no programa aquí (la fecha manual es `scheduled_wait` externa).
 * HUMAN / STOP nunca programan.
 */
export function shouldStartFollowUp(plan: FollowUpPlan): boolean {
  if (plan.lane === "human" || plan.lane === "stop" || plan.lane === "wait") {
    return false;
  }
  if (plan.lane !== "auto" && plan.lane !== "auto_close") return false;
  return plan.shouldReply;
}

/**
 * Reactivar DORMANT (STOP por silencio) solo si el pipeline sigue abierto.
 * STOP comercial (`lost`) no vuelve a `auto` por un inbound.
 */
export function shouldReactivateDormant(input: {
  lane: string;
  followUpReason: string | null;
  pipelineKind: "open" | "won" | "lost" | null;
}): boolean {
  return (
    input.lane === "stop" &&
    input.followUpReason === "no_reply_exhausted" &&
    input.pipelineKind === "open"
  );
}

function isCommercialAttemptNumber(
  attemptNumber: number
): attemptNumber is 1 | 2 | 3 {
  return (
    attemptNumber === 1 || attemptNumber === 2 || attemptNumber === 3
  );
}
