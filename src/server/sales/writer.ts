import { z } from "zod";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { renderKb } from "@/server/ai/prompts";
import type { schema } from "@/lib/db";
import type { SalesDecision } from "@/server/sales/decision";
import type { NextActionChoice } from "@/server/sales/answers";
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

/**
 * Forma del bloque `offer` que el playbook publicado (`ConfigV1`)
 * inyecta al writer. Estructuralmente compatible con `VendeVelozOffer`
 * cuando el playbook trae los campos completos; cuando trae un subset,
 * el writer cae al default VENDE_VELOZ_OFFER.
 */
export type OfferBlock = VendeVelozOffer;

/**
 * Forma del bloque `writer.instructions` del playbook. Mapea cada
 * `NextActionChoice` a la instrucción textual que el writer debe
 * usar. Si el playbook no define alguna clave, el writer usa su
 * default interno.
 */
export type WriterInstructions = Partial<Record<NextActionChoice, string>>;

/**
 * Forma mínima del `agent_profile` que el writer necesita. Es un
 * subset del row real (`agentProfile` de schema.ts): solo los 3
 * campos que se inyectan en el prompt (T309). Mantenerlo pequeño
 * evita acoplar el writer a la BD y permite tests con stubs.
 */
export type AgentProfileContext = {
  tone?: string | null;
  instructions?: string | null;
  escalationRules?: string | null;
};

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
  /**
   * Override del bloque oferta del playbook. Si llega `null`, se
   * considera "sin override" y se usa VENDE_VELOZ_OFFER. Si llega un
   * objeto, se usa tal cual (estructuralmente compatible con
   * VendeVelozOffer).
   */
  offer?: VendeVelozOffer | null;
  /**
   * Override de instrucciones por `next_action`. El writer prefiere
   * las instrucciones del playbook sobre las internas cuando ambas
   * existan. Si no llega, fallback al set interno.
   */
  writerInstructions?: WriterInstructions;
  /**
   * Si es true, se renderiza un prompt con guardas extra para que el
   * LLM NO ejecute acciones y NO inventar datos. Es la única señal
   * que el writer recibe sobre el sandbox; la decisión completa del
   * sandbox (incluida la supresión de follow-ups) la hace el
   * orquestador (T308).
   */
  isTest?: boolean;
  /**
   * T309 — agent_profile de la organización. Si llega, el writer
   * inyecta `tone`, `instructions` y `escalationRules` en el system
   * prompt como instrucciones no negociables por encima del bloque
   * de reglas duras. Si NO llega, el comportamiento es el actual
   * (sin perfil = fallback por defecto).
   */
  agentProfile?: AgentProfileContext | null;
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
 *
 * Corte 3 — Acepta:
 *   - `offer` (override del playbook, opcional).
 *   - `writerInstructions` (override del playbook, opcional).
 *   - `isTest` (guard de sandbox).
 *
 * Tolera:
 *   - `decision.mainValueProposition === null` → omite línea de ángulo.
 *   - `decision.buyingTiming === null` → omite línea de timing.
 *   - En ambos casos, si `decision.mainValueProposition` o
 *     `decision.buyingTiming` vienen `null`, las funciones `pick*`
 *     devuelven `"unspecified"` y `"unknown"` respectivamente para que
 *     el prompt siga siendo ejecutable.
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

const HUMAN_HANDOFF_INSTRUCTION =
  "Redacta una transición breve a atención humana. No muestres demo, no hagas preguntas comerciales, no presentes precio ni sigas otra next_action. No inventes una hora si no fue acordada en la conversación.";

function isHumanHandoffPlan(plan: SalesPlan): boolean {
  return plan.lane === "human" && plan.shouldHandoff;
}

function buildWriterSystemPrompt(input: WriteSalesReplyInput): string {
  const product = input.product ?? VENDE_VELOZ_PRODUCT;
  const policy = input.policy ?? VENDE_VELOZ_COMMERCIAL_POLICY;
  const offer = input.offer ?? VENDE_VELOZ_OFFER;
  const nextAction = input.plan.nextAction;
  const humanHandoff = isHumanHandoffPlan(input.plan);

  // T305: tolerar `null` en los known signals. `pickChoice` cae a
  // `"unspecified"`/`"unknown"` para que el prompt siga siendo
  // ejecutable y el LLM no se cuelgue.
  const angle = pickChoice(input.decision.mainValueProposition, "unspecified");
  const timing = pickChoice(input.decision.buyingTiming, "unknown");

  return [
    "Eres redactor de WhatsApp para Vende Veloz 365. NO decides nada comercial.",
    "La lane, next_action, pipeline y el handoff ya están decididos por el CRM. Tú solo escribes el mensaje.",
    "Respondes SIEMPRE en español natural de WhatsApp: breve, una sola respuesta útil por turno.",
    "JSON único: {\"text\":\"...\"} o {\"text\":null}. Sin markdown, sin otras claves.",
    "PROHIBIDO devolver move_stage, update_lead, handoff, lane, next_action, fechas de follow-up, precios inventados o cualquier acción ejecutable.",
    input.isTest
      ? "[SANDBOX] Esta es una conversación de prueba del Laboratorio. NO invoques acciones reales, NO inventes datos, NO generes URLs. Limítate a redactar el texto."
      : "",
    agentProfileBlock(input.agentProfile),
    [
      "Reglas duras:",
      "- No conviertas el chat en cuestionario. No repitas preguntas ya respondidas.",
      "- No prometas generar alumnos, ventas ni demanda. El sistema organiza la operación.",
      "- Puede empezar con procesos manuales y automatizar después.",
      "- Precio únicamente desde la oferta de abajo. Sin descuentos inexistentes.",
      "- No inventes enlaces de demo ni funciones que no estén en producto o KB.",
      "- Si falta un dato esencial, redacta de forma conservadora según el plan. No tomes otra decisión.",
      humanHandoff
        ? "- Este turno es handoff humano: PROHIBIDO demo, precio, preguntas o ejecutar el next_action original de Jev."
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    `Producto:\n${JSON.stringify(product)}`,
    `Política comercial:\n${JSON.stringify(policy)}`,
    offerBlock(offer),
    `Conocimiento adicional de la organización (no inventes URLs ni datos que no estén aquí):\n${renderKb(input.kb)}`,
    `Hechos durables del CRM:\n${factsBlock(input.facts)}`,
    humanHandoff
      ? `Decisión ya tomada (no la cambies): lane=human; handoff=true. Jev sugirió next_action=${nextAction} pero NO lo ejecutes en este mensaje; ángulo=${angle}; timing=${timing}.`
      : `Decisión ya tomada (no la cambies): next_action=${nextAction}; lane=${input.plan.lane}; ángulo=${angle}; timing=${timing}.`,
    `Instrucción de este turno:\n${humanHandoff ? HUMAN_HANDOFF_INSTRUCTION : nextActionInstruction(nextAction, input.writerInstructions)}`,
  ].join("\n\n");
}

function offerBlock(offer: VendeVelozOffer): string {
  // `setup: 0` significa implementación asistida incluida. Renderizar
  // "- Implementación: S/0 una sola vez" mandaría un precio falso al lead
  // (DV-7 del corte 2), así que la línea cambia por completo.
  const setup: number = offer.setup;
  return [
    "Oferta vigente (única fuente de precio):",
    setup === 0
      ? "- Implementación asistida incluida, sin costo de setup."
      : `- Implementación: S/${setup} una sola vez.`,
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

/**
 * Devuelve la instrucción textual para una `next_action`. Prioriza el
 * override del playbook (si existe) sobre el default interno.
 */
function nextActionInstruction(
  action: SalesPlan["nextAction"],
  instructions?: WriterInstructions
): string {
  const override = instructions?.[action];
  if (override && override.trim().length > 0) return override;
  return defaultNextActionInstruction(action);
}

function defaultNextActionInstruction(action: SalesPlan["nextAction"]): string {
  switch (action) {
    case "ask_more_questions":
      return "Haz como máximo UNA pregunta esencial. No preguntes por preguntar.";
    case "show_operations_demo":
      return "Explica brevemente el flujo operativo relevante y orienta a ver cómo se centralizan alumnos, pagos, ventas, horarios y asistencia. Si la KB tiene un recurso real de demo, úsalo. Nunca inventes una URL.";
    case "show_online_enrollment_demo":
      return "Centra la respuesta en matrícula o inscripción online: el lead expresó esa necesidad. No inventes URL.";
    case "present_price":
      return "Presenta la oferta vigente con claridad: la implementación asistida está incluida y no tiene costo de setup; el primer mes se paga por adelantado; S/247/mes hasta 50 alumnos activos; +S/1 por alumno activo desde el 51; sin permanencia obligatoria. Sin descuentos inventados y sin briefing de contrato.";
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
          .map((turn) => `${turn.from === "lead" ? "LEAD" : "VENDEDOR"}: ${turn.text}`)
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

/**
 * T309 — Render del agent_profile como bloque del system prompt.
 * Solo se incluye cuando el orquestador lo pasa explícitamente Y
 * tiene al menos un campo no vacío. Las reglas del agent_profile son
 * no negociables: se inyectan ANTES de las reglas duras del writer,
 * de modo que si entran en conflicto gana el perfil del cliente.
 */
function agentProfileBlock(profile: AgentProfileContext | null | undefined): string {
  if (!profile) return "";
  const tone = profile.tone?.trim();
  const instructions = profile.instructions?.trim();
  const escalation = profile.escalationRules?.trim();
  if (!tone && !instructions && !escalation) return "";

  const lines: string[] = ["Perfil del agente (cliente; no negociable):"];
  if (tone) lines.push(`- Tono: ${tone}`);
  if (instructions) lines.push(`- Instrucciones: ${instructions}`);
  if (escalation) lines.push(`- Reglas de escalamiento: ${escalation}`);
  return lines.join("\n");
}

/**
 * Extrae el `choice` de un `NormalizedAnswer` con forma `{type:'choice',
 * choice, ...}` o devuelve el fallback. Maneja `null` (T305) y shapes
 * inesperados sin lanzar.
 */
function pickChoice(
  answer:
    | {
        type: "choice";
        choice: string;
        confidence?: number;
        probabilities?: Record<string, number>;
      }
    | null,
  fallback: string
): string {
  if (!answer) return fallback;
  if (answer.type !== "choice") return fallback;
  if (typeof answer.choice !== "string" || answer.choice.length === 0) return fallback;
  return answer.choice;
}
