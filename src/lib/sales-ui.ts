import type { AutomationLane } from "@/lib/types";

/** Etiquetas operativas de lane (panel de contacto). */
export const LANE_LABELS: Record<AutomationLane, string> = {
  auto: "Automático",
  auto_close: "Cierre automático",
  wait: "En espera",
  human: "Atención humana",
  stop: "Detenido",
};

/** Etiquetas cortas para tarjetas del pipeline. `auto` no se pinta. */
export const LANE_SHORT_LABELS: Record<
  Exclude<AutomationLane, "auto">,
  string
> = {
  auto_close: "Cierre",
  wait: "Espera",
  human: "Humano",
  stop: "Detenido",
};

export const FOLLOW_UP_REASON_LABELS: Record<string, string> = {
  awaiting_reply: "Esperando respuesta",
  after_demo: "Seguimiento de demo",
  after_price: "Seguimiento de propuesta",
  scheduled_wait: "Seguimiento programado",
  no_reply_exhausted: "Dormido por falta de respuesta",
  template_required: "Bloqueado: falta plantilla",
  follow_up_failed: "Error de seguimiento",
};

/** STOP + silencio agotado: no es perdido comercialmente. */
export function isDormantSales(sales: {
  lane: AutomationLane;
  followUpReason: string | null;
}): boolean {
  return sales.lane === "stop" && sales.followUpReason === "no_reply_exhausted";
}

export function followUpReasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  return FOLLOW_UP_REASON_LABELS[reason] ?? reason;
}

/** Lane operativa: DORMANT se pinta como Dormido, no Detenido/Perdido. */
export function operationalLaneLabel(sales: {
  lane: AutomationLane;
  followUpReason: string | null;
}): string {
  if (isDormantSales(sales)) return "Dormido";
  return LANE_LABELS[sales.lane];
}

export function operationalLaneShortLabel(sales: {
  lane: AutomationLane;
  followUpReason: string | null;
}): string | null {
  if (isDormantSales(sales)) return "Dormido";
  if (sales.lane === "auto") return null;
  return LANE_SHORT_LABELS[sales.lane];
}

export const NEXT_ACTION_LABELS: Record<string, string> = {
  ask_more_questions: "Preguntar más",
  show_operations_demo: "Mostrar demo operativa",
  show_online_enrollment_demo: "Mostrar demo de matrícula",
  present_price: "Presentar precio",
  schedule_call: "Agendar llamada",
  schedule_follow_up: "Programar seguimiento",
  disqualify: "Descalificar",
};

export const BUYING_TIMING_LABELS: Record<string, string> = {
  now: "Ahora",
  soon: "Pronto",
  future_season: "Temporada futura",
  unknown: "Desconocido",
  no_current_plan: "Sin plan actual",
};

const PRODUCT_FIT_LABELS = [
  "Sin encaje",
  "Encaje débil",
  "Encaje moderado",
  "Encaje fuerte",
  "Encaje muy fuerte",
] as const;

const PURCHASE_INTENT_LABELS = [
  "Muy baja",
  "Baja",
  "Media",
  "Alta",
  "Muy alta",
] as const;

/**
 * Convierte un score Jev V2 (continuo 0..4, 5 criterios) a etiqueta humana.
 * nearest criterion: round + clamp. No interpreta 0..1.
 */
export function labelForScore(
  score: number,
  kind: "product_fit" | "purchase_intent"
): string {
  const labels =
    kind === "product_fit" ? PRODUCT_FIT_LABELS : PURCHASE_INTENT_LABELS;
  return labels[scoreIndex(score, labels.length)] ?? String(score);
}

/** Necesidad operativa: umbral de exhibición 0.5, no el umbral del resolver. */
export function labelForNoul(noul: number): string {
  return noul >= 0.5 ? "Sí" : "No";
}

/** Texto secundario/tooltip para una probabilidad 0–1. */
export function percentHint(value: number | undefined | null): string | undefined {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return undefined;
  }
  return `${Math.round(value * 100)}%`;
}

function scoreIndex(score: number, n: number): number {
  if (n <= 0) return 0;
  if (!Number.isFinite(score)) return 0;
  const maxIndex = n - 1;
  return Math.min(maxIndex, Math.max(0, Math.round(score)));
}
