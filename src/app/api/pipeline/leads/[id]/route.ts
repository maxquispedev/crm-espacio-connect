import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { publish } from "@/server/events/bus";
import {
  StageGatewayError,
  moveLeadStage,
} from "@/server/leads/stage-gateway";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  stageId: z.string().min(1),
  position: z.number().int().min(0),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  // Corte A — el drag/drop del pipeline pasa por la puerta única de etapa.
  // La validación de tenant + destino la hace el gateway; aquí solo
  // traducimos sus errores al contrato HTTP preexistente.
  let result;
  try {
    result = await moveLeadStage({
      organizationId: session.organizationId,
      leadId: id,
      toStageId: body.data.stageId,
      position: body.data.position,
      actor: "human",
      reason: "drag_drop",
    });
  } catch (err) {
    if (err instanceof StageGatewayError) {
      if (err.code === "invalid_stage") {
        return apiError(422, "invalid_stage", "Etapa inexistente");
      }
      if (err.code === "lead_not_found") {
        return apiError(404, "not_found", "Lead no encontrado");
      }
    }
    throw err;
  }

  // Notifica a la bandeja para que la etapa se refleje en vivo (panel de
  // detalles y punto de etapa de la lista) sin recargar.
  const db = getDb();
  const convRows = await db
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, session.organizationId),
        eq(schema.conversation.contactId, result.lead.contactId),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  if (convRows[0]) {
    publish(session.organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: convRows[0].id } },
    });
  }

  return Response.json({ lead: result.lead });
});
