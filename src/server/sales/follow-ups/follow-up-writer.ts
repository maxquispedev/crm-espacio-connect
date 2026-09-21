import { z } from "zod";
import { chatJson, type ChatMessage } from "@/lib/ai";
import type { SalesFollowUpReason } from "@/lib/types";
import type { schema } from "@/lib/db";
import { renderKb } from "@/server/ai/prompts";
import type { SalesDecision } from "@/server/sales/decision";
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

/** Única forma permitida: texto. Sin null, sin acciones ejecutables. */
export const FollowUpWriterOutput = z.object({
  text: z.string().trim().min(1).max(4096),
});

export type FollowUpWriterOutputType = z.infer<typeof FollowUpWriterOutput>;

export type WriteFollowUpInput = {
  conversation: JevConversationTurn[];
  reason: SalesFollowUpReason;
  attemptNumber: number;
  lastDecision?: SalesDecision | null;
  lastJevSnapshot?: unknown;
  kb?: KbEntry[];
  pricePresented?: boolean;
  product?: VendeVelozProduct;
  policy?: VendeVelozCommercialPolicy;
  offer?: VendeVelozOffer;
};

export type FollowUpWriterSuccess = {
  ok: true;
  text: string;
};

export type FollowUpWriterFailure = {
  ok: false;
  error: "not_configured" | "provider_error" | "invalid_output";
  detail: string;
};

export type FollowUpWriterResult = FollowUpWriterSuccess | FollowUpWriterFailure;

/**
 * Redacta un follow-up de texto libre. Solo se usa con ventana WhatsApp abierta.
 * No llama a Jev. No decide lane, pipeline ni handoff. Si el LLM falla, no inventa texto.
 */
export async function writeFollowUpText(
  input: WriteFollowUpInput
): Promise<FollowUpWriterResult> {
  const result = await chatJson(
    FollowUpWriterOutput,
    buildFollowUpMessages(input)
  );
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      detail: result.detail,
    };
  }
  return { ok: true, text: result.data.text };
}

function buildFollowUpMessages(input: WriteFollowUpInput): ChatMessage[] {
  return [
    { role: "system", content: buildFollowUpSystemPrompt(input) },
    { role: "user", content: buildFollowUpUserPrompt(input) },
  ];
}

function buildFollowUpSystemPrompt(input: WriteFollowUpInput): string {
  const product = input.product ?? VENDE_VELOZ_PRODUCT;
  const policy = input.policy ?? VENDE_VELOZ_COMMERCIAL_POLICY;
  const offer = input.offer ?? VENDE_VELOZ_OFFER;
  const pricePresented = Boolean(input.pricePresented);
  const kb = input.kb ?? [];

  return [
    "Eres redactor de WhatsApp para Vende Veloz 365. Este turno es un seguimiento por silencio.",
    "NO decides nada comercial. NO reevalúas al lead. NO llamas a Jev. Solo escribes UN mensaje corto.",
    "Respondes SIEMPRE en español natural de WhatsApp, como una persona del equipo, no como un bot.",
    "JSON único: {\"text\":\"...\"}. Sin markdown, sin otras claves, sin text null.",
    [
      "Reglas duras:",
      "- Un solo mensaje. Corto. Máximo UNA pregunta o CTA.",
      "- No menciones que es un seguimiento automático, ni cadencias, ni que 'el sistema' escribe.",
      "- No copies el último mensaje del vendedor. Parafrasea o retoma el hilo con algo nuevo y breve.",
      "- No inventes funciones, módulos, plazos ni URLs. Si la KB no tiene un recurso, no lo inventes.",
      "- No cambies el precio. No ofrezcas descuentos. No presentes una oferta nueva.",
      "- No prometas generar alumnos, ventas ni demanda.",
      "- No decidas handoff, pipeline ni lane. No pidas hablar con un humano por tu cuenta.",
      "- No conviertas el chat en cuestionario.",
      pricePresented
        ? "- El precio YA se presentó: puedes aludir a lo ya dicho, sin repetir un pitch completo ni cambiar cifras."
        : "- El precio NO se ha presentado: PROHIBIDO introducirlo, cotizar o hablar de S/497 / S/197 en este follow-up.",
      reasonInstruction(input.reason, input.attemptNumber),
    ].join("\n"),
    `Producto:\n${JSON.stringify(product)}`,
    `Política comercial:\n${JSON.stringify(policy)}`,
    offerContextBlock(offer, pricePresented),
    `Conocimiento adicional de la organización (no inventes URLs ni datos que no estén aquí):\n${renderKb(kb)}`,
    frozenDecisionBlock(input),
  ].join("\n\n");
}

function reasonInstruction(
  reason: SalesFollowUpReason,
  attemptNumber: number
): string {
  const attempt = `Este es el intento comercial ${attemptNumber}.`;
  switch (reason) {
    case "after_demo":
      return `- ${attempt} Retoma con naturalidad tras haber mostrado cómo funciona el sistema. No vuelvas a 'presentar' la demo como si fuera la primera vez.`;
    case "after_price":
      return `- ${attempt} Retoma tras haber presentado la propuesta económica. No reescribas toda la oferta. Pregunta si quieren avanzar o si quedó alguna duda.`;
    case "scheduled_wait":
      return `- ${attempt} Es una reactivación one-shot en la fecha acordada. Saluda el hilo, no encadenes presión, y espera respuesta.`;
    case "awaiting_reply":
      return `- ${attempt} El lead no respondió al último mensaje comercial. Retoma el hilo con suavidad, sin perseguir.`;
  }
}

function offerContextBlock(
  offer: VendeVelozOffer,
  pricePresented: boolean
): string {
  if (!pricePresented) {
    return "Oferta: existe, pero NO la uses en este mensaje. El precio aún no se presentó al lead.";
  }
  return [
    "Oferta vigente (ya presentada; no la cambies ni inventes descuentos):",
    `- Implementación: S/${offer.setup} una sola vez.`,
    `- Mensualidad: S/${offer.monthlyBase} hasta ${offer.includedActiveStudents} alumnos activos.`,
    `- Desde el alumno activo ${offer.includedActiveStudents + 1}: +S/${offer.extraPerActiveStudent} por alumno activo.`,
    `- Jamás prometer: ${offer.neverPromise.join(", ")}.`,
  ].join("\n");
}

function frozenDecisionBlock(input: WriteFollowUpInput): string {
  const fromDecision = input.lastDecision
    ? {
        next_action: input.lastDecision.nextAction.choice,
        angle: input.lastDecision.mainValueProposition.choice,
        timing: input.lastDecision.buyingTiming.choice,
      }
    : snapshotHints(input.lastJevSnapshot);

  if (!fromDecision) {
    return `Contexto congelado: reason=${input.reason}; intento=${input.attemptNumber}. No hay decisión Jev reciente. No inventes una nueva evaluación.`;
  }

  return [
    "Contexto congelado de la última decisión (NO lo cambies, NO lo reevalúes):",
    `reason=${input.reason}; intento=${input.attemptNumber}; next_action=${fromDecision.next_action}; ángulo=${fromDecision.angle}; timing=${fromDecision.timing}.`,
  ].join("\n");
}

function snapshotHints(
  snapshot: unknown
): { next_action: string; angle: string; timing: string } | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const rec = snapshot as Record<string, unknown>;
  const next =
    pickChoice(rec.next_action) ??
    pickChoice(rec.nextAction) ??
    (typeof rec.nextAction === "string" ? rec.nextAction : null);
  const angle =
    pickChoice(rec.main_value_proposition) ??
    pickChoice(rec.mainValueProposition);
  const timing = pickChoice(rec.buying_timing) ?? pickChoice(rec.buyingTiming);
  if (!next && !angle && !timing) return null;
  return {
    next_action: next ?? "unknown",
    angle: angle ?? "unknown",
    timing: timing ?? "unknown",
  };
}

function pickChoice(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && "choice" in value) {
    const choice = (value as { choice: unknown }).choice;
    return typeof choice === "string" ? choice : null;
  }
  return null;
}

function buildFollowUpUserPrompt(input: WriteFollowUpInput): string {
  const transcript =
    input.conversation.length === 0
      ? "(sin mensajes aún)"
      : input.conversation
          .map((turn) => `${turn.from === "lead" ? "LEAD" : "VENDEDOR"}: ${turn.text}`)
          .join("\n");

  const lastSeller = [...input.conversation]
    .reverse()
    .find((turn) => turn.from === "seller");

  return [
    "Conversación cronológica:",
    transcript,
    lastSeller
      ? `Último mensaje del vendedor (NO lo copies):\n${lastSeller.text}`
      : "No hay mensaje previo del vendedor.",
    "Redacta SOLO el JSON {\"text\":\"...\"} de este seguimiento. Un mensaje. Una pregunta o CTA como máximo.",
  ].join("\n\n");
}
