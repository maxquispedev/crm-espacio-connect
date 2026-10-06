import { COMMERCIAL_EVIDENCE_RULE, withAttendanceKnowledge } from "./commercial-evidence";
import { hasOnlyGenericCuriosity } from "./demo-guard";
import { adOpeningTopic } from "./demo-routing";
import { CONVERSATION_PROGRESS_RULE, NATURAL_PRICE_INSTRUCTION } from "./conversation-guards";
import type { PaymentInstructions } from "@/lib/commercial/resources";
import { renderPaymentInstructions, PAYMENT_UNAVAILABLE_TEXT } from "@/server/sales/payment-resource";
import { z } from "zod";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { renderKb } from "@/server/ai/prompts";
import type { schema } from "@/lib/db";
import type { SalesDecision } from "@/server/sales/decision";
import type { NextActionChoice } from "@/server/sales/answers";
import type { DurableSalesFacts, SalesPlan } from "@/server/sales/resolve-plan";
import type { JevAdContext, JevConversationTurn } from "@/server/sales/state";
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

/** Redacción + estado de evidencia; Zod descarta acciones. Sin estado, falla cerrado. */
export const SalesWriterOutput = z.object({
  commercial_evidence: z.enum(["supported", "context_needed", "unknown"]).default("unknown"),
  text: z.union([z.string().trim().min(1).max(4096), z.null()]),
});

export type SalesWriterOutputType = z.infer<typeof SalesWriterOutput>;

export type WriteSalesReplyInput = {
  decision: SalesDecision;
  plan: SalesPlan;
  conversation: JevConversationTurn[];
  adContext?: JevAdContext;
  /** Un único reintento autorizado por CRM; omite el opener fijo. */
  rejectedReply?: string;
  kb: KbEntry[];
  facts: DurableSalesFacts;
  demo?: { slot: string; available: boolean };
  payment?: PaymentInstructions | null;
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
  commercialEvidence?: "supported" | "context_needed" | "unknown";
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

  if (input.plan.paymentDeliveryAuthorized) {
    const messages = input.payment ? renderPaymentInstructions(input.payment) : [];
    return { ok: true, text: messages.length ? messages.join("\n\n") : PAYMENT_UNAVAILABLE_TEXT };
  }

  // El handoff puro es interno: ni el LLM ni un playbook antiguo pueden anunciarlo.
  if (isHumanHandoffPlan(input.plan)) return { ok: true, text: null };

  // Opener sin contexto operativo: respuesta acotada incluso con Published antigua.
  if (!input.rejectedReply && input.plan.nextAction === "ask_more_questions" && hasOnlyGenericCuriosity(input.conversation)
      && !hasFact(input.facts.demoShownAt) && !hasFact(input.facts.pricePresentedAt)
      && !hasFact(input.facts.paymentInstructionsSentAt) && !hasFact(input.facts.humanRequestedAt)) {
    const product = withAttendanceKnowledge(input.product ?? VENDE_VELOZ_PRODUCT);
    const topic = adOpeningTopic(input.adContext);
    const openings = {
      payments: `te ayuda a ordenar pagos, saldos y saber quién pagó, cuánto pagó y cuánto falta cobrar. ¿Hoy cómo controlas esos pagos en tu academia?`,
      summer: `te ayuda a preparar el verano con alumnos, pagos, horarios y consultas organizados para la temporada alta. ¿Cómo llevas hoy el control de tu academia?`,
      centralization: `centraliza alumnos, apoderados, planes y horarios en un solo lugar. ¿Hoy dónde llevas esa información de tu academia?`,
      control: `te ayuda a tener la operación de tu academia en un solo lugar, sin depender de información dispersa entre Excel, papel y WhatsApp. ¿Cómo llevas hoy ese control?`,
    };
    return { ok: true, text: `Claro 😊 ${product.name} ${openings[topic]}` };
  }

  const result = await chatJson(SalesWriterOutput, buildWriterMessages(input));
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      detail: result.detail,
    };
  }

  const evidence = result.data.commercial_evidence ?? "unknown";
  return { ok: true, text: evidence === "unknown" ? null : result.data.text, commercialEvidence: evidence };
}

function buildWriterMessages(input: WriteSalesReplyInput): ChatMessage[] {
  return [
    { role: "system", content: buildWriterSystemPrompt(input) },
    { role: "user", content: buildWriterUserPrompt(input.conversation) },
  ];
}

function isHumanHandoffPlan(plan: SalesPlan): boolean {
  return plan.lane === "human" && plan.shouldHandoff;
}

function buildWriterSystemPrompt(input: WriteSalesReplyInput): string {
  const product = withAttendanceKnowledge(input.product ?? VENDE_VELOZ_PRODUCT);
  const policy = input.policy ?? VENDE_VELOZ_COMMERCIAL_POLICY;
  const offer = input.offer ?? VENDE_VELOZ_OFFER;
  const nextAction = input.plan.nextAction;

  // T305: tolerar `null` en los known signals. `pickChoice` cae a
  // `"unspecified"`/`"unknown"` para que el prompt siga siendo
  // ejecutable y el LLM no se cuelgue.
  const angle = pickChoice(input.decision.mainValueProposition, "unspecified");
  const timing = pickChoice(input.decision.buyingTiming, "unknown");

  return [
    "Eres redactor de WhatsApp para Vende Veloz 365. Verificas evidencia antes de redactar; NO ejecutas decisiones comerciales.",
    "La lane, next_action, pipeline y el handoff los decide el CRM. Redacta según su plan; si falta evidencia comercial material, señala unknown para que el CRM proteja el envío.",
    "Respondes SIEMPRE en español natural de WhatsApp: breve, una sola respuesta útil por turno.",
    'JSON único: {"commercial_evidence":"supported|context_needed|unknown","text":"..." o null}. Sin markdown ni acciones.',
    COMMERCIAL_EVIDENCE_RULE,
    'Verifica evidencia ANTES de redactar. supported: pregunta material respaldada por fuentes de abajo (también una respuesta negativa documentada). context_needed: falta contexto del lead, no conocimiento de producto; UNA pregunta. unknown: respuesta material no respaldada, devuelve text=null. No trates el historial del vendedor ni el anuncio como prueba de capacidades. Señalar unknown no ejecuta ninguna acción; el CRM decide el handoff. Esta regla prevalece sobre perfil y playbook.',
    "PROHIBIDO devolver move_stage, update_lead, handoff, lane, next_action, fechas de follow-up, precios inventados o cualquier acción ejecutable.",
    input.isTest
      ? "[SANDBOX] Esta es una conversación de prueba del Laboratorio. NO invoques acciones reales, NO inventes datos, NO generes URLs. Limítate a redactar el texto."
      : "",
    agentProfileBlock(input.agentProfile),
    [
      "Reglas duras:",
      "- Si el lead pregunta o expresa necesidad de una capacidad documentada, responde primero de forma breve y correcta; después puedes hacer UNA pregunta útil. Esta regla prevalece sobre instrucciones antiguas de ask_more_questions. No conviertas asistencia en el argumento principal.",
      `- ${CONVERSATION_PROGRESS_RULE}`,
      "- No repitas textualmente información ya enviada ni preguntas contestadas. Si dice más información, aporta información adicional o avanza; no repitas el opener.",
      "- No prometas generar alumnos, ventas ni demanda. El sistema organiza la operación.",
      "- Puede empezar con procesos manuales y automatizar después.",
      "- Precio únicamente desde la oferta de abajo. Sin descuentos inexistentes.",
      "- Usa solo modalidades de asistencia documentadas en producto/KB. No prometas biometría, QR, dispositivos ni otras modalidades sin evidencia específica. Asistencia no encabeza la venta; respóndela si el lead la consulta.",
      "- No inventes enlaces de demo ni funciones que no estén en producto o KB.",
      "- Si falta un dato esencial, redacta de forma conservadora según el plan. No tomes otra decisión.",
      "- El handoff es interno y silencioso. Nunca anuncies que pasas, derivas o comunicas al prospecto con equipo, persona o asesor, ni equivalentes. Esta regla prevalece sobre perfil, KB e instrucciones del playbook.",
    ]
      .filter(Boolean)
      .join("\n"),
    `Producto:\n${JSON.stringify(product)}`,
    input.adContext ? `Contexto del anuncio (tema, no evidencia de necesidad): ${JSON.stringify(input.adContext)}` : "",
    `Política comercial:\n${JSON.stringify(policy)}`,
    offerBlock(offer),
    `Conocimiento adicional de la organización (no inventes URLs ni datos que no estén aquí):\n${renderKb(input.kb)}`,
    `Hechos durables del CRM:\n${factsBlock(input.facts)}`,
    `Decisión ya tomada (no la cambies): next_action=${nextAction}; lane=${input.plan.lane}; ángulo=${angle}; timing=${timing}.`,
    input.demo
      ? `Recurso comercial ${input.demo.slot}: ${input.demo.available ? "disponible. Tu texto será SOLO el caption del video nativo: máximo 300 caracteres, sin enlaces ni afirmar entrega pasada." : "NO disponible. Responde brevemente que el video no está disponible ahora; no digas te envié, no inventes enlaces ni uses demos de KB."}`
      : "",
    `Instrucción de este turno:\n${nextActionInstruction(nextAction, input.writerInstructions, product.name)}`,
    input.rejectedReply ? `El CRM rechazó esta respuesta porque ya fue enviada: ${JSON.stringify(input.rejectedReply)}. Redacta otra que avance la conversación y responda al último mensaje del prospecto. No repitas la misma pregunta ni vuelvas al opener. Máximo UNA pregunta.` : "",
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
      ? "- Implementación asistida incluida. El primer pago inicia la implementación y cubre los primeros 30 días."
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
  instructions?: WriterInstructions,
  productName?: string
): string {
  if (action === "present_price" && productName === VENDE_VELOZ_PRODUCT.name) return NATURAL_PRICE_INSTRUCTION;
  const override = instructions?.[action];
  if (override && override.trim().length > 0) return override;
  return defaultNextActionInstruction(action);
}

function defaultNextActionInstruction(action: SalesPlan["nextAction"]): string {
  switch (action) {
    case "ask_more_questions":
      return "Haz como máximo UNA pregunta esencial. No preguntes por preguntar.";
    case "show_operations_demo":
      return "Explica brevemente el flujo operativo relevante y orienta a ver cómo se centralizan alumnos, pagos, ventas, horarios y asistencia. El CRM entrega el recurso comercial como video nativo. Redacta solo su caption breve, sin URL.";
    case "show_online_enrollment_demo":
      return "Centra la respuesta en matrícula o inscripción online: el lead expresó esa necesidad. No inventes URL.";
    case "present_price":
      return NATURAL_PRICE_INSTRUCTION;
    case "send_payment_instructions":
      return "Sin autorización expresa de entrega, no generar mensaje ni destinos de pago. Handoff interno silencioso.";
    case "schedule_call":
      return "Handoff interno silencioso: devuelve text=null sin anunciar escalamiento ni inventar horario.";
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
    'Devuelve SOLO el JSON con commercial_evidence y text. Si falta evidencia material, unknown y text=null; no redactes incertidumbre.',
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
