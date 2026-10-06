import { withCurrentTurn, StaleTurnError, captureTurnToken, isTurnCurrent, isOpaqueInbound, type TurnToken } from "@/server/ai/turn-safety";
import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv, isAiConfigured } from "@/lib/env";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { publish } from "@/server/events/bus";
import { isWindowOpen } from "@/server/inbox/window";
import { AgentAction, degradeAction, resolveStage, type AgentActionType } from "@/server/ai/actions";
import { applyHandoff, deliverReply } from "@/server/ai/delivery";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { persistClientHumanRequest } from "@/server/sales/explicit-handoff";
import { runSalesOrchestratorTurn } from "@/server/sales/orchestrator";
import { StageGatewayError, moveLeadStage } from "@/server/leads/stage-gateway";
import { reportStageChangeOnMove } from "@/server/attribution/report-on-stage-change";

/**
 * Turno del agente (FR-021..FR-025).
 *
 * Coalesce + lock in-process por conversación: ráfagas de mensajes → UNA
 * respuesta; nunca dos turnos simultáneos; lo que llega durante un turno
 * re-encola exactamente un turno más. Suficiente para el monolito de una
 * instancia (sin colas externas — Constitución II).
 */

type CoalesceEntry = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  pending: boolean;
};

const globalForAgent = globalThis as unknown as {
  __agentCoalesce?: Map<string, CoalesceEntry>;
};

function coalesceMap(): Map<string, CoalesceEntry> {
  if (!globalForAgent.__agentCoalesce) {
    globalForAgent.__agentCoalesce = new Map();
  }
  return globalForAgent.__agentCoalesce;
}

/** Punto de entrada con debounce (mensajes entrantes reales). */
export function scheduleAgentTurn(conversationId: string): void {
  const map = coalesceMap();
  const entry = map.get(conversationId) ?? {
    timer: null,
    running: false,
    pending: false,
  };
  map.set(conversationId, entry);

  if (entry.running) {
    entry.pending = true; // se re-encola al terminar el turno actual
    return;
  }
  if (entry.timer) clearTimeout(entry.timer);
  const delay = getEnv().AGENT_COALESCE_MS;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void executeTurn(conversationId);
  }, delay);
}

async function executeTurn(conversationId: string): Promise<void> {
  const map = coalesceMap();
  const entry = map.get(conversationId);
  if (!entry || entry.running) return;
  entry.running = true;
  try {
    await runAgentTurn(conversationId);
  } catch (err) {
    console.error("[agente] turno falló:", err);
  } finally {
    entry.running = false;
    if (entry.pending) {
      entry.pending = false;
      void executeTurn(conversationId);
    } else {
      map.delete(conversationId);
    }
  }
}

/**
 * Ejecuta UN turno del agente ahora (el Laboratorio lo llama directo, con
 * debounce 0 y sin pasar por el coalesce).
 */
export async function runAgentTurn(conversationId: string): Promise<void> {
  if (!isAiConfigured()) return;

  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const conversation = convRows[0];
  if (!conversation) return;
  const organizationId = conversation.organizationId;

  // Condiciones de silencio: handoff activo o IA apagada en la conversación.
  if (conversation.handoffAt || !conversation.aiEnabled) return;

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) return;
  // El toggle global aplica a conversaciones reales; el Laboratorio evalúa el
  // comportamiento configurado aunque el agente aún no esté encendido.
  if (!conversation.isTest && !profile.enabled) return;

  const token = await captureTurnToken(organizationId, conversationId);
  if (!token) return;
  const current = () => isTurnCurrent(token);

  const history = await db
    .select()
    .from(schema.message)
    .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.conversationId, conversationId)))
    .orderBy(desc(schema.message.createdAt))
    .limit(20);
  history.reverse();
  const lastInbound = history.find((m) => m.id === token.inboundMessageId);
  if (!lastInbound) return;
  if (isOpaqueInbound(lastInbound.type)) {
    await applyHandoff(conversationId, organizationId, "unsupported_media", undefined, { ...token, allowOpaqueInbound: true });
    return;
  }

  // Ventana cerrada: el agente JAMÁS envía texto libre → handoff 'ventana'.
  if (!conversation.isTest && !isWindowOpen(conversation.lastInboundAt)) {
    await applyHandoff(conversationId, organizationId, "ventana");
    return;
  }

  // Patrón de respaldo ANTES del LLM (FR-022). No pasa por Jev.
  if (lastInbound.text && matchesHandoffIntent(lastInbound.text)) {
    if (!await current()) return;
    await persistClientHumanRequest({
      organizationId,
      contactId: conversation.contactId,
    });
    if (await current()) await applyHandoff(conversationId, organizationId, "cliente", undefined, token);
    return;
  }

  if (profile.salesOrchestratorEnabled) {
    await runSalesOrchestratorTurn({
      organizationId,
      conversationId,
      conversation,
      turnToken: { ...token, sales: true },
    });
    return;
  }

  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
  const stages = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt({ profile, kb, stages }),
    },
    ...history
      .filter((m) => m.text && !(m.direction === "in" && isOpaqueInbound(m.type)) && !(m.direction === "out" && ["pending", "failed"].includes(m.status)))
      .map((m) => ({
        role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
        content: m.text!,
      })),
  ];

  const result = await chatJson(AgentAction, messages);
  if (!result.ok) {
    if (result.error === "not_configured") return;
    // Fallo persistente del proveedor o salida imposible → escalar (FR-022).
    console.error(`[agente] fallo del proveedor (raw): ${result.detail}`);
    if (await current()) await applyHandoff(conversationId, organizationId, "error", undefined, token);
    return;
  }

  if (!await current()) return;
  let action: AgentActionType = result.data;

  if (action.action === "move_stage") {
    const stage = resolveStage(action.stage, stages);
    if (!stage) {
      action = degradeAction(action);
    } else {
      // Corte A — la acción move_stage del agente inline pasa por la puerta
      // única de etapa con actor `agent`. Conserva `lastActivityAt` exacto.
      if (!await current()) return;
      await moveLeadToStage(organizationId, conversation.contactId, stage.id, token);
      publish(organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: conversationId } },
      });
      if (action.reply) {
        await deliverReply(conversation, action.reply, { token });
      }
      return;
    }
  }

  switch (action.action) {
    case "none":
      return;
    case "reply":
      await deliverReply(conversation, action.text, { token });
      return;
    case "update_lead": {
      if (!await current()) return;
      await appendLeadNote(organizationId, conversation.contactId, action.note, token);
      if (action.reply) await deliverReply(conversation, action.reply, { token });
      return;
    }
    case "handoff": {
      if (action.farewell) {
        await deliverReply(conversation, action.farewell, { token });
      }
      if (await current()) await applyHandoff(conversationId, organizationId, "modelo", undefined, token);
      return;
    }
  }
}

export { applyHandoff } from "@/server/ai/delivery";

async function moveLeadToStage(
  organizationId: string,
  contactId: string,
  stageId: string,
  token: TurnToken
): Promise<void> {
  const db = getDb();
  // El gateway necesita el leadId; resolvemos por contactId con scope de
  // tenant. Si el contacto no tiene lead todavía, el agente no puede mover
  // etapa: lo deja en manos del Laboratorio / de la próxima inbound.
  const rows = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.contactId, contactId)))
    .limit(1);
  const lead = rows[0];
  if (!lead || !await isTurnCurrent(token)) return;
  try {
    const result = await moveLeadStage({
      organizationId,
      leadId: lead.id,
      toStageId: stageId,
      lastActivityAt: new Date(),
      actor: "agent",
      reason: "ai_move_stage",
      turnToken: token,
    });

    // 007 — Corte B: tras el commit exitoso del gateway, engancha CAPI.
    // El agente inline (Zod agent) también pasa por la misma puerta que
    // el drag/drop humano y que Jev. Best-effort absoluto.
    if (result.moved) {
      const nextStage = await loadStageKindAndName(organizationId, stageId);
      if (nextStage) {
        void reportStageChangeOnMove({
          organizationId,
          leadId: lead.id,
          moved: true,
          fromStageId: result.fromStageId,
          toStageId: stageId,
          toStageName: nextStage.name,
          toStageKind: nextStage.kind,
        });
      }
    }
  } catch (err) {
    if (err instanceof StaleTurnError) return;
    if (err instanceof StageGatewayError) {
      console.warn(`[ai/pipeline] move_stage rechazado: ${err.message}`);
      return;
    }
    throw err;
  }
}

async function loadStageKindAndName(
  organizationId: string,
  stageId: string
): Promise<{ name: string; kind: "open" | "won" | "lost" } | null> {
  const db = getDb();
  const rows = await db
    .select({
      name: schema.pipelineStage.name,
      kind: schema.pipelineStage.kind,
    })
    .from(schema.pipelineStage)
    .where(
      scoped(
        schema.pipelineStage.organizationId,
        organizationId,
        eq(schema.pipelineStage.id, stageId)
      )
    )
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return { name: r.name, kind: r.kind };
}

async function appendLeadNote(
  organizationId: string,
  contactId: string,
  note: string,
  token: TurnToken
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.contact.id, notes: schema.contact.notes })
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId)))
    .limit(1);
  const contact = rows[0];
  if (!contact || !await isTurnCurrent(token)) return;
  const stamped = `[IA] ${note}`;
  await withCurrentTurn(token, async tx => { await tx
    .update(schema.contact)
    .set({
      notes: contact.notes ? `${contact.notes}\n${stamped}` : stamped,
      updatedAt: new Date(),
    })
    .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contact.id))); });
}
