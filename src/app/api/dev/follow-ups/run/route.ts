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
 * Sonda de solo lectura para el self-test (Corte 6, T608): cuenta los jobs
 * de follow-up de la organización separando los de conversaciones sandbox.
 *
 * Es la forma de VERIFICAR en vivo el "cero efectos residuales": una
 * corrida del Laboratorio (`is_test=true`) debe terminar con
 * `sandboxJobs = 0`, porque el orquestador suprime `scheduleNextFollowUp`.
 * Va tras `mockGuard()`: 404 incondicional fuera del entorno de pruebas.
 */
export const GET = withAuth(async (session) => {
  const guard = mockGuard();
  if (guard) return guard;

  const db = getDb();
  const orgId = session.organizationId;

  const jobs = await db
    .select({
      id: schema.salesFollowUpJob.id,
      conversationId: schema.salesFollowUpJob.conversationId,
      status: schema.salesFollowUpJob.status,
    })
    .from(schema.salesFollowUpJob)
    .where(scoped(schema.salesFollowUpJob.organizationId, orgId));

  const testConvIds = new Set<string>();
  if (jobs.length > 0) {
    const convs = await db
      .select({ id: schema.conversation.id, isTest: schema.conversation.isTest })
      .from(schema.conversation)
      .where(scoped(schema.conversation.organizationId, orgId));
    for (const c of convs) {
      if (c.isTest) testConvIds.add(c.id);
    }
  }

  const isSandbox = (j: { conversationId: string | null }) =>
    j.conversationId !== null && testConvIds.has(j.conversationId);

  return Response.json({
    totalJobs: jobs.length,
    sandboxJobs: jobs.filter(isSandbox).length,
    realJobs: jobs.filter((j) => !isSandbox(j)).length,
    pendingJobs: jobs.filter((j) => j.status === "pending").length,
  });
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
