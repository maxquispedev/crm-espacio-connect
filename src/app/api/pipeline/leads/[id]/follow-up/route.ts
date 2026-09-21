import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import {
  cancelPendingFollowUps,
  patchLeadFollowUp,
  scheduleManualFollowUp,
} from "@/server/sales/follow-ups";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const postSchema = z.object({
  dueAt: z.string().datetime(),
});

export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  const dueAt = new Date(body.data.dueAt);
  const result = await scheduleManualFollowUp({
    organizationId: session.organizationId,
    leadId: id,
    dueAt,
  });

  if (!result.ok) {
    return scheduleErrorResponse(result.error);
  }

  publish(session.organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: result.job.conversationId } },
  });

  return Response.json({
    ok: true,
    nextFollowUpAt: result.job.dueAt.toISOString(),
  });
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const lead = await loadLead(session.organizationId, id);
  if (!lead) return apiError(404, "not_found", "Lead no encontrado");

  await cancelPendingFollowUps({
    organizationId: session.organizationId,
    leadId: id,
    reason: "cancelled_by_operator",
  });
  await patchLeadFollowUp(session.organizationId, id, {
    nextFollowUpAt: null,
    updatedAt: new Date(),
  });

  await publishLeadConversation(session.organizationId, lead.contactId);

  return Response.json({ ok: true });
});

function scheduleErrorResponse(
  error:
    | "due_in_past"
    | "lead_not_found"
    | "conversation_not_found"
    | "human_lane"
    | "handoff_active"
): Response {
  if (error === "lead_not_found") {
    return apiError(404, "not_found", "Lead no encontrado");
  }
  if (error === "due_in_past") {
    return apiError(422, "due_in_past", "La fecha de seguimiento debe ser futura");
  }
  if (error === "conversation_not_found") {
    return apiError(422, "conversation_not_found", "No hay conversación real para este lead");
  }
  if (error === "human_lane") {
    return apiError(409, "human_lane", "No se puede programar: atención humana activa");
  }
  return apiError(
    409,
    "handoff_active",
    "No se puede programar: la conversación está en atención humana"
  );
}

async function loadLead(organizationId: string, leadId: string) {
  const db = getDb();
  const rows = await db
    .select({ id: schema.lead.id, contactId: schema.lead.contactId })
    .from(schema.lead)
    .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.id, leadId)))
    .limit(1);
  return rows[0] ?? null;
}

async function publishLeadConversation(
  organizationId: string,
  contactId: string
): Promise<void> {
  const db = getDb();
  const convRows = await db
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.contactId, contactId),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  if (convRows[0]) {
    publish(organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: convRows[0].id } },
    });
  }
}
