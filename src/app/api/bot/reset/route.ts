import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { publish } from "@/server/events/bus";
import {
  StageGatewayError,
  moveLeadStage,
} from "@/server/leads/stage-gateway";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
});

/**
 * Reinicio de UNA conversación para la línea de pruebas del operador: IA
 * reactivada (sale del handoff) y lead de vuelta a la primera etapa. El
 * historial del inbox NO se borra: es auditoría. Lo invoca el cerebro externo
 * cuando un número de su allowlist manda `/reset`.
 */
export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const rows = await db
    .select({
      id: schema.conversation.id,
      contactId: schema.conversation.contactId,
    })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  const conv = rows[0];
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");

  await db
    .update(schema.conversation)
    .set({
      aiEnabled: true,
      handoffAt: null,
      handoffReason: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.conversation.id, conv.id));

  // Etapa al inicio del funnel (best-effort: sin etapas no revienta el reset).
  // Corte A — el reset pasa por la puerta única de etapa. Conserva el
  // actor `system` y el motivo legible para futuras trazas.
  try {
    const stageRows = await db
      .select({ id: schema.pipelineStage.id })
      .from(schema.pipelineStage)
      .where(eq(schema.pipelineStage.organizationId, organizationId))
      .orderBy(asc(schema.pipelineStage.position))
      .limit(1);
    const first = stageRows[0];
    const leadRows = await db
      .select({ id: schema.lead.id })
      .from(schema.lead)
      .where(
        and(
          eq(schema.lead.organizationId, organizationId),
          eq(schema.lead.contactId, conv.contactId)
        )
      )
      .limit(1);
    if (first && leadRows[0]) {
      await moveLeadStage({
        organizationId,
        leadId: leadRows[0].id,
        toStageId: first.id,
        actor: "system",
        reason: "bot_reset",
      });
    }
  } catch (err) {
    if (err instanceof StageGatewayError) {
      console.warn(`[bot/reset] reinicio de etapa falló: ${err.message}`);
    } else {
      console.warn(`[bot/reset] reinicio de etapa falló: ${err}`);
    }
  }

  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conv.id } },
  });
  return Response.json({ ok: true });
}
