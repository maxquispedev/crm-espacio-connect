import { z } from "zod";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { renderKb } from "@/server/ai/prompts";
import type { schema } from "@/lib/db";
import type { SalesDecision } from "@/server/sales/decision";
import type { DurableSalesFacts, SalesPlan } from "@/server/sales/resolve-plan";
import type { JevConversationTurn } from "@/server/sales/state";
import type {
  VendeVelozCommercialPolicy,
  VendeVelozOffer,
  VendeVelozProduct,
} from "@/server/sales/vende-veloz";
import {
  VENDE_VELOZ_COMMERCIAL_POLICY,
  VENDE_VELOZ_OFFER,
  VENDE_VELOZ_PRODUCT,
} from "@/server/sales/vende-veloz";

type KbEntry = typeof schema.kbEntry.$inferSelect;

/** Única forma permitida: redacción. Zod descarta cualquier acción ejecutable. */
export const SalesWriterOutput = z.object({
  text: z.union([z.string().trim().min(1).max(4096), z.null()]),
});

export type SalesWriterOutputType = z.infer<typeof SalesWriterOutput>;

export type WriteSalesReplyInput = {
  decision: SalesDecision;
  plan: SalesPlan;
  conversation: JevConversationTurn[];
  kb: KbEntry[];
  facts: DurableSalesFacts;
  product?: VendeVelozProduct;
  policy?: VendeVelozCommercialPolicy;
  offer?: VendeVelozOffer;
};

export type SalesWriterSuccess = {
  ok: true;
  text: string | null;
};

export type SalesWriterFailure = {
  ok: false;
  error: "not_configured" | "provider_error" | "invalid_output";
  detail: string;
};

export type SalesWriterResult = SalesWriterSuccess | SalesWriterFailure;

/**
 * Redacta el mensaje de WhatsApp según un plan ya decidido.
 * No llama a Jev. No mueve pipeline. Si el LLM falla, no inventa texto comercial.
 */
export async function writeSalesReply(
  input: WriteSalesReplyInput
): Promise<SalesWriterResult> {
  if (!input.plan.shouldReply) {
    return { ok: true, text: null };
  }

  const result = await chatJson(SalesWriterOutput, buildWriterMessages(input));
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      detail: result.detail,
    };
  }

  return { ok: true, text: result.data.text };
}

function buildWriterMessages(input: WriteSalesReplyInput): ChatMessage[] {
  return [
    { role: "system", content: buildWriterSystemPrompt(input) },
    { role: "user", content: buildWriterUserPrompt(input.conversation) },
  ];
}

function buildWriterSystemPrompt(input: WriteSalesReplyInput): string {
  const product = input.product ?? VENDE_VELOZ_PRODUCT;
  const policy = input.policy ?? VENDE_VELOZ_COMMERCIAL_POLICY;
  const offer = input.offer ?? VENDE_VELOZ_OFFER;
  const nextAction = input.plan.nextAction;

  return [
    "Eres redactor de WhatsApp para Vende Veloz 365. NO decides nada comercial.",
    "La lane, next_action, pipeline y el handoff ya están decididos por el CRM. Tú solo escribes el mensaje.",
    "Respondes SIEMPRE en español natural de WhatsApp: breve, una sola respuesta útil por turno.",
    "JSON único: {\"text\":\"...\"} o {\"text\":null}. Sin markdown, sin otras claves.",
    "PROHIBIDO devolver move_stage, update_lead, handoff, lane, next_action, fechas de follow-up, precios inventados o cualquier acción ejecutable.",
    [
      "Reglas duras:",
      "- No conviertas el chat en cuestionario. No repitas preguntas ya respondidas.",
      "- No prometas generar alumnos, ventas ni demanda. El sistema organiza la operación.",
      "- Puede empezar con procesos manuales y automatizar después.",
      "- Precio únicamente desde la oferta de abajo. Sin descuentos inexistentes.",
      "- No inventes enlaces de demo ni funciones que no estén en producto o KB.",
      "- Si falta un dato esencial, redacta de forma conservadora según el plan. No tomes otra decisión.",
    ].join("\n"),
    `Producto:\n${JSON.stringify(product)}`,
    `Política comercial:\n${JSON.stringify(policy)}`,
    offerBlock(offer),
    `Conocimiento adicional de la organización (no inventes URLs ni datos que no estén aquí):\n${renderKb(input.kb)}`,
    `Hechos durables del CRM:\n${factsBlock(input.facts)}`,
    `Decisión ya tomada (no la cambies): next_action=${nextAction}; lane=${input.plan.lane}; ángulo=${input.decision.mainValueProposition.choice}; timing=${input.decision.buyingTiming.choice}.`,
    `Instrucción de este turno (${nextAction}):\n${nextActionInstruction(nextAction)}`,
  ].join("\n\n");
}

function offerBlock(offer: VendeVelozOffer): string {
  return [
    "Oferta vigente (única fuente de precio):",
    `- Implementación: S/${offer.setup} una sola vez.`,
    `- Mensualidad: S/${offer.monthlyBase} hasta ${offer.includedActiveStudents} alumnos activos.`,
    `- Desde el alumno activo ${offer.includedActiveStudents + 1}: +S/${offer.extraPerActiveStudent} por alumno activo.`,
    `- La implementación busca ${offer.implementation.purpose}: ${offer.implementation.includes.join(", ")}.`,
    `- Jamás prometer: ${offer.neverPromise.join(", ")}.`,
  ].join("\n");
}

function factsBlock(facts: DurableSalesFacts): string {
  return [
    `lane actual: ${facts.automationLane}`,
    `demo mostrada: ${hasFact(facts.demoShownAt) ? "sí" : "no"}`,
    `precio presentado: ${hasFact(facts.pricePresentedAt) ? "sí" : "no"}`,
    `instrucciones de pago enviadas: ${hasFact(facts.paymentInstructionsSentAt) ? "sí" : "no"}`,
    `humano solicitado: ${hasFact(facts.humanRequestedAt) ? "sí" : "no"}`,
    `seguimientos: ${facts.followUpCount ?? 0}`,
  ].join("\n");
}

function nextActionInstruction(action: SalesPlan["nextAction"]): string {
  switch (action) {
    case "ask_more_questions":
      return "Haz como máximo UNA pregunta esencial. No preguntes por preguntar.";
    case "show_operations_demo":
      return "Explica brevemente el flujo operativo relevante y orienta a ver cómo se centralizan alumnos, pagos, ventas, horarios y asistencia. Si la KB tiene un recurso real de demo, úsalo. Nunca inventes una URL.";
    case "show_online_enrollment_demo":
      return "Centra la respuesta en matrícula o inscripción online: el lead expresó esa necesidad. No inventes URL.";
    case "present_price":
      return "Presenta la oferta vigente con claridad: implementación S/497; S/197/mes hasta 50 activos; +S/1 por alumno activo desde el 51. Sin descuentos inventados.";
    case "schedule_call":
      return "Redacta una transición corta a atención humana. No inventes una hora si no fue acordada en la conversación.";
    case "schedule_follow_up":
      return "Reconoce el timing futuro sin presionar. No inventes una fecha exacta.";
    case "disqualify":
      return "Si corresponde responder, cierra de forma breve y amable. No sigas buscando dolores.";
  }
}

function buildWriterUserPrompt(conversation: JevConversationTurn[]): string {
  const transcript =
    conversation.length === 0
      ? "(sin mensajes aún)"
      : conversation
          .map((turn) => `${turn.from === "lead" ? "LEAD" : "NEGOCIO"}: ${turn.text}`)
          .join("\n");

  return [
    "Conversación cronológica:",
    transcript,
    "Redacta SOLO el JSON {\"text\":\"...\"} de este turno. No cambies la decisión.",
  ].join("\n\n");
}

function hasFact(value: string | Date | null | undefined): boolean {
  return value !== null && value !== undefined && value !== "";
}
