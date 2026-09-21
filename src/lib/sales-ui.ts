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
