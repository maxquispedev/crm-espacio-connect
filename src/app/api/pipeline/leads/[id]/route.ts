import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import {
  StageGatewayError,
  moveLeadStage,
} from "@/server/leads/stage-gateway";
import { reportStageChangeOnMove } from "@/server/attribution/report-on-stage-change";

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

  // 007 — Corte B: tras el commit exitoso del gateway, engancha CAPI.
  // Best-effort absoluto: nunca afecta la respuesta al usuario ni rompe el
  // drag/drop. Si Meta rechaza, la fila queda como `failed` consultable.
  if (result.moved) {
    const toStageName = await loadStageKindAndName(
      session.organizationId,
      result.toStageId
    );
    if (toStageName) {
      void reportStageChangeOnMove({
        organizationId: session.organizationId,
        leadId: result.lead.id,
        moved: true,
        fromStageId: result.fromStageId,
        toStageId: result.toStageId,
        toStageName: toStageName.name,
        toStageKind: toStageName.kind,
      });
    }
  }

  return Response.json({ lead: result.lead });
});

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
