import { asc, eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { personaLabel } from "@/server/lab/personas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();
  const runs = await db
    .select()
    .from(schema.agentTestRun)
    .where(
      scoped(
        schema.agentTestRun.organizationId,
        session.organizationId,
        eq(schema.agentTestRun.id, id)
      )
    )
    .limit(1);
  const run = runs[0];
  if (!run) return apiError(404, "not_found", "Corrida no encontrada");

  const cases = await db
    .select()
    .from(schema.agentTestCase)
    .where(eq(schema.agentTestCase.runId, id))
    .orderBy(asc(schema.agentTestCase.createdAt));

  return Response.json({
    run: {
      id: run.id,
      status: run.status,
      score: run.score,
      error: run.error,
      playbookMode: run.playbookMode,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
    },
    cases: cases.map((c) => ({
      id: c.id,
      persona: c.persona,
      personaLabel: personaLabel(c.persona),
      status: c.status,
      veredicto: c.veredicto,
      hallazgos: c.hallazgos ?? [],
      transcript: c.transcript ?? [],
      // Corte 6 — trazabilidad + comparación Published vs Draft.
      playbookVersionId: c.playbookVersionId,
      playbookSchemaVersion: c.playbookSchemaVersion,
      expectedNextAction: c.expectedNextAction,
      expectedLane: c.expectedLane,
      expectedHandoff: c.expectedHandoff,
      actualNextAction: c.actualNextAction,
      actualLane: c.actualLane,
      actualHandoff: c.actualHandoff,
    })),
  });
});
