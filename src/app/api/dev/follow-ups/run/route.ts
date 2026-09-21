import { eq } from "drizzle-orm";
import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { mockGuard } from "@/lib/dev-guard";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { WINDOW_MS } from "@/server/inbox/window";
import { runDueFollowUps } from "@/server/sales/follow-ups/worker";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  expire: z.boolean().optional(),
  closeWindow: z.boolean().optional(),
  leadId: z.string().min(1).optional(),
});

/**
 * Arnés E2E (solo mocks): vence jobs pending de la org y corre un tick.
 * `closeWindow` retrocede `lastInboundAt` para ejercitar plantilla/bloqueo.
 */
export const POST = withAuth(async (session, req: Request) => {
  const guard = mockGuard();
  if (guard) return guard;

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const now = new Date();
  const orgId = session.organizationId;

  if (body.data.closeWindow && body.data.leadId) {
    const leads = await db
      .select({ contactId: schema.lead.contactId })
      .from(schema.lead)
      .where(
        scoped(
          schema.lead.organizationId,
          orgId,
          eq(schema.lead.id, body.data.leadId)
        )
      )
      .limit(1);
    const contactId = leads[0]?.contactId;
    if (contactId) {
      await db
        .update(schema.conversation)
        .set({
          lastInboundAt: new Date(now.getTime() - WINDOW_MS - 60_000),
          updatedAt: now,
        })
        .where(
          scoped(
            schema.conversation.organizationId,
            orgId,
            eq(schema.conversation.contactId, contactId),
            eq(schema.conversation.isTest, false)
          )
        );
    }
  }

  if (body.data.expire !== false) {
    await db
      .update(schema.salesFollowUpJob)
      .set({ dueAt: now, updatedAt: now })
      .where(
        scoped(
          schema.salesFollowUpJob.organizationId,
          orgId,
          eq(schema.salesFollowUpJob.status, "pending"),
          body.data.leadId
            ? eq(schema.salesFollowUpJob.leadId, body.data.leadId)
            : undefined
        )
      );
  }

  const processed = await runDueFollowUps();
  return Response.json({ ok: true, processed });
});
