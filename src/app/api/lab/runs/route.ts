import { desc } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAiConfigured } from "@/lib/env";
import {
  PlaybookVersionNotFoundError,
  RunConflictError,
  parsePlaybookMode,
  startRunWithMode,
} from "@/server/lab/runner";

export const dynamic = "force-dynamic";

/** Historial de corridas con delta de score vs la anterior (FR-033). */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const runs = await db
    .select()
    .from(schema.agentTestRun)
    .where(scoped(schema.agentTestRun.organizationId, session.organizationId))
    .orderBy(desc(schema.agentTestRun.startedAt))
    .limit(50);

  const withDelta = runs.map((run, i) => {
    const prev = runs
      .slice(i + 1)
      .find((r) => r.status === "done" && r.score !== null);
    return {
      id: run.id,
      status: run.status,
      score: run.score,
      error: run.error,
      playbookMode: run.playbookMode,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      delta:
        run.status === "done" && run.score !== null && prev?.score != null
          ? run.score - prev.score
          : null,
    };
  });
  return Response.json({ runs: withDelta, aiConfigured: isAiConfigured() });
});

export const POST = withAuth(async (session, req: Request) => {
  if (!isAiConfigured()) {
    return apiError(
      409,
      "ai_not_configured",
      "Configura tu proveedor de IA para correr el Laboratorio"
    );
  }

  // Corte 6 (T605): `playbook_mode` elige contra qué versión corre.
  // `published` por defecto; `draft`; `archived:<version_id>`; `both`.
  let rawMode: unknown;
  try {
    const body = (await req.json()) as unknown;
    if (body && typeof body === "object") {
      rawMode = (body as { playbook_mode?: unknown }).playbook_mode;
    }
  } catch {
    // Body vacío o no-JSON: se usa el default (`published`).
    rawMode = undefined;
  }

  const playbookMode = parsePlaybookMode(rawMode);
  if (!playbookMode) {
    return apiError(
      422,
      "invalid_playbook_mode",
      "playbook_mode debe ser 'published', 'draft', 'both', 'legacy' o 'archived:<version_id>'"
    );
  }

  try {
    const { runIds } = await startRunWithMode(
      session.organizationId,
      playbookMode
    );
    return Response.json(
      { runId: runIds[0], runIds, playbookMode },
      { status: 202 }
    );
  } catch (err) {
    if (err instanceof RunConflictError) {
      return apiError(
        409,
        "run_in_progress",
        "Ya hay una corrida en curso para este modo; espera a que termine"
      );
    }
    if (err instanceof PlaybookVersionNotFoundError) {
      return apiError(
        422,
        "playbook_version_not_found",
        "La versión de playbook indicada no existe en tu organización"
      );
    }
    throw err;
  }
});
