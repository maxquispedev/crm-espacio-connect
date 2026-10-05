import type { JevQuestions } from "./questions";
import type { VendeVelozProduct } from "./vende-veloz";
import type { SalesPlan } from "./resolve-plan";

export const ATTENDANCE_KNOWLEDGE = "Control de asistencia: registro de asistencia de alumnos y control/consumo de sesiones cuando corresponda. Búsqueda por DNI, nombre o apellido y confirmación del registro.";
export const COMMERCIAL_EVIDENCE_RULE = "Antes de responder una pregunta material de fit, funcionalidad, implementación, integración o condición comercial, comprobar evidencia en producto, oferta, política o KB disponible. Con evidencia suficiente responder normalmente; si falta contexto de la academia obtenerlo con UNA pregunta (ask_more_questions). Si falta evidencia sobre la capacidad o condición consultada, elegir schedule_call / needs_human_call=true: HANDOFF HUMANO SILENCIOSO, sin outbound ni mensaje de incertidumbre o transición. No inventar, no decir no sé, no tengo confirmado, creo ni tendría que consultar. Una capacidad documentada no requiere handoff solo por ser asistencia, integración o API.";

/** Refuerzo de Published antiguas únicamente para el producto confirmado. */
export function withAttendanceKnowledge(product: VendeVelozProduct): VendeVelozProduct {
  if (product.name !== "Vende Veloz 365") return product;
  return { ...product, core_jobs: [...new Set([...(product.core_jobs ?? []), ATTENDANCE_KNOWLEDGE])] } as unknown as VendeVelozProduct;
}

/** No cambia keys/opciones ni muta el contrato canónico. */
export function withCommercialEvidenceQuestions(questions: JevQuestions): JevQuestions {
  return Object.fromEntries(Object.entries(questions).map(([key, question]) => [key,
    key === "next_action" || key === "needs_human_call"
      ? { ...question, instructions: `${question.instructions} ${COMMERCIAL_EVIDENCE_RULE}` }
      : question])) as JevQuestions;
}

/** CRM conserva autoridad de efectos; el writer solo informa ausencia de evidencia. */
export function commercialEvidenceHandoff(plan: SalesPlan, reason: "unknown" | "writer_unavailable"): SalesPlan {
  return { ...plan, lane: "human", nextAction: "schedule_call", shouldReply: false,
    shouldHandoff: true, handoffReason: "commercial", paymentDeliveryAuthorized: false,
    desiredPipelineSemantic: plan.desiredPipelineSemantic === null ? null : "interested", factUpdates: {}, followUpDirective: { kind: "none" },
    commercialEvidenceReason: reason };
}
