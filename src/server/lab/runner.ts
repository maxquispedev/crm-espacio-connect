import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  getConfigByVersionId,
  getDraftConfigForOrg,
  getPublishedConfigForOrg,
} from "@/lib/sales/playbook/loader";
import { publish } from "@/server/events/bus";
import { runAgentTurn } from "@/server/ai/pipeline";
import { renderKb } from "@/server/ai/prompts";
import { computeScore, judgeCase } from "@/server/lab/judge";
import {
  PERSONAS_BY_COHORT,
  findPersona,
  type Persona,
  type PersonaCohort,
} from "@/server/lab/personas";
import { runSalesOrchestratorTurn } from "@/server/sales/orchestrator";

/**
 * Runner del Laboratorio (FR-030/FR-034): corrida en segundo plano DENTRO del
 * proceso (sin cola externa), turnos secuenciales con debounce 0, timeout
 * global de 10 minutos, y lock de concurrencia por índice parcial UNIQUE en
 * BD (máx. 1 corrida `running` por organización Y MODO DE PLAYBOOK).
 *
 * Sandbox (FR-031): las conversaciones se crean con is_test=true; el pipeline
 * del agente persiste las respuestas sin tocar la API, y el sender real lanza
 * si algo intenta enviarlas.
 *
 * Corte 6 — Laboratorio comercial (Feature 008):
 *   - La corrida puede apuntar a una versión de playbook CONCRETA
 *     (`published` por defecto, `draft`, `archived:<version_id>`, o `both`
 *     para las dos en paralelo). El override viaja al orquestador por
 *     `runSalesOrchestratorTurn`, que lo valida con `is_test === true`.
 *   - Cada caso persiste `playbook_version_id` y `playbook_schema_version`
 *     para que la comparación Published vs Draft sea auditable.
 *   - Si la organización NO tiene Sales Orchestrator, se corre la cohorte
 *     legacy contra el agente genérico, con `playbook_version_id = null`.
 *   - Cero efectos residuales: `is_test=true` suprime el envío a WhatsApp,
 *     el scheduling de follow-ups y la emisión CAPI (Corte 8 de 007).
 */

const RUN_TIMEOUT_MS = 10 * 60 * 1000;

/** Modos de playbook que el Laboratorio sabe ejecutar. */
export type PlaybookMode = "published" | "draft" | "both" | "legacy";

/** Modo compuesto: `archived:<version_id>`. */
export function archivedMode(versionId: string): string {
  return `archived:${versionId}`;
}

/**
 * Parsea el `playbook_mode` recibido por la API.
 * - `published` | `draft` | `both` → se pasan tal cual.
 * - `archived:<version_id>` → `archived:<version_id>`.
 * - `legacy` → cohorte legacy explícita (agente genérico).
 * - inválido → `null` (la API responde 422).
 */
export function parsePlaybookMode(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return "published";
  if (typeof raw !== "string") return null;
  const mode = raw.trim();
  if (mode === "published" || mode === "draft" || mode === "both" || mode === "legacy") {
    return mode;
  }
  if (mode.startsWith("archived:")) {
    const versionId = mode.slice("archived:".length).trim();
    return versionId.length > 0 ? archivedMode(versionId) : null;
  }
  return null;
}

/** El modo compuesto `archived:` se guarda en la corrida como texto. */
function extractArchivedVersionId(mode: string): string | null {
  return mode.startsWith("archived:") ? mode.slice("archived:".length) : null;
}

export class RunConflictError extends Error {}

/** Se lanza cuando se pide `archived:<id>` y esa versión no existe. */
export class PlaybookVersionNotFoundError extends Error {
  constructor(versionId: string) {
    super(`playbook_version_not_found:${versionId}`);
    this.name = "PlaybookVersionNotFoundError";
  }
}

/** Contexto resuelto de una corrida: qué cohorte y qué versión ejecuta. */
type RunContext = {
  cohort: PersonaCohort;
  personas: Persona[];
  playbookVersionId: string | null;
  playbookSchemaVersion: string | null;
  /** Versión concreta a forzar por override; `null` = publicada en runtime. */
  overrideVersionId: string | null;
};

/**
 * Arranca UNA corrida en modo simple. La ejecuta in-process (fire-and-forget)
 * y devuelve el `runId` de inmediato; el progreso va por SSE.
 */
export async function startRun(
  organizationId: string,
  playbookMode: string = "published"
): Promise<string> {
  const ctx = await resolveRunContext(organizationId, playbookMode);
  const db = getDb();
  let runId: string;
  try {
    const inserted = await db
      .insert(schema.agentTestRun)
      .values({
        id: newId("testRun"),
        organizationId,
        status: "running",
        playbookMode,
      })
      .returning();
    runId = inserted[0]!.id;
  } catch (err) {
    // Violación del índice parcial UNIQUE → ya hay una corrida activa de este modo.
    if (isUniqueViolation(err)) {
      throw new RunConflictError("Ya hay una corrida en curso para este modo");
    }
    throw err;
  }

  await db.insert(schema.agentTestCase).values(
    ctx.personas.map((p) => ({
      id: newId("testCase"),
      organizationId,
      runId,
      persona: p.key,
      status: "pending" as const,
      playbookVersionId: ctx.playbookVersionId,
      playbookSchemaVersion: ctx.playbookSchemaVersion,
    }))
  );

  // Fire-and-forget in-process: el POST regresa ya; el progreso va por SSE.
  void executeRun(runId, organizationId, ctx).catch(async (err) => {
    console.error("[lab] corrida falló:", err);
    await failRun(runId, organizationId, String(err), ctx.personas.length);
  });

  return runId;
}

/**
 * Arranca una corrida simple o, para `both`, DOS corridas en paralelo
 * (published + draft). El lock de BD es por (org, modo), así que ambas
 * conviven legítimamente y se persisten por separado.
 */
export async function startRunWithMode(
  organizationId: string,
  playbookMode: string = "published"
): Promise<{ runIds: string[] }> {
  if (playbookMode !== "both") {
    return { runIds: [await startRun(organizationId, playbookMode)] };
  }
  const runIds = await Promise.all([
    startRun(organizationId, "published"),
    startRun(organizationId, "draft"),
  ]);
  return { runIds };
}

/**
 * Resuelve qué cohorte de personas y qué versión de playbook ejecuta la
 * corrida. Lanza `PlaybookVersionNotFoundError` si se pide un `archived:id`
 * inexistente o de otra organización (tenant-safe vía el loader).
 */
async function resolveRunContext(
  organizationId: string,
  playbookMode: string
): Promise<RunContext> {
  const db = getDb();

  // El pipeline comercial solo aplica si el org tiene el Sales Orchestrator
  // encendido. Si no, corremos la cohorte legacy contra el agente genérico.
  const profileRows = await db
    .select({ enabled: schema.agentProfile.salesOrchestratorEnabled })
    .from(schema.agentProfile)
    .where(
      scoped(schema.agentProfile.organizationId, organizationId)
    )
    .limit(1);
  const salesEnabled = profileRows[0]?.enabled === true;

  if (playbookMode === "legacy" || !salesEnabled) {
    return {
      cohort: "legacy",
      personas: PERSONAS_BY_COHORT.legacy,
      playbookVersionId: null,
      playbookSchemaVersion: null,
      overrideVersionId: null,
    };
  }

  const archivedVersionId = extractArchivedVersionId(playbookMode);

  if (archivedVersionId) {
    const loaded = await getConfigByVersionId(organizationId, archivedVersionId);
    if (!loaded) throw new PlaybookVersionNotFoundError(archivedVersionId);
    return {
      cohort: "sales",
      personas: PERSONAS_BY_COHORT.sales,
      playbookVersionId: loaded.id,
      playbookSchemaVersion: loaded.schema_version,
      overrideVersionId: loaded.id,
    };
  }

  if (playbookMode === "draft") {
    const draft = await getDraftConfigForOrg(organizationId);
    // Sin draft abierto → fallback a publicada (no a constantes): el draft
    // es opcional y su ausencia no debe degradar la corrida.
    if (!draft) return publishedContext(organizationId);
    return {
      cohort: "sales",
      personas: PERSONAS_BY_COHORT.sales,
      playbookVersionId: draft.id,
      playbookSchemaVersion: draft.schema_version,
      overrideVersionId: draft.id,
    };
  }

  return publishedContext(organizationId);
}

async function publishedContext(organizationId: string): Promise<RunContext> {
  const published = await getPublishedConfigForOrg(organizationId);
  // Sin publicada, el runtime degrada a VENDE_VELOZ_* y el caso queda
  // con playbook_version_id = null: visible, no ambiguo.
  return {
    cohort: "sales",
    personas: PERSONAS_BY_COHORT.sales,
    playbookVersionId: published?.id ?? null,
    playbookSchemaVersion: published?.schema_version ?? null,
    overrideVersionId: published?.id ?? null,
  };
}

async function executeRun(
  runId: string,
  organizationId: string,
  ctx: RunContext
): Promise<void> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("timeout de 10 minutos superado")),
      RUN_TIMEOUT_MS
    )
  );
  try {
    await Promise.race([runAllCases(runId, organizationId, ctx), timeout]);
  } catch (err) {
    await failRun(runId, organizationId, String(err), ctx.personas.length);
  }
}

async function runAllCases(
  runId: string,
  organizationId: string,
  ctx: RunContext
): Promise<void> {
  const db = getDb();
  const cases = await db
    .select()
    .from(schema.agentTestCase)
    .where(eq(schema.agentTestCase.runId, runId))
    .orderBy(asc(schema.agentTestCase.createdAt));

  const kbEntries = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId));
  const kbText = renderKb(kbEntries);

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];
  const behaviorText = profile
    ? [
        `Nombre: ${profile.name}`,
        profile.tone ? `Tono: ${profile.tone}` : null,
        profile.instructions ? `Instrucciones: ${profile.instructions}` : null,
        profile.escalationRules ? `Escalado: ${profile.escalationRules}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  let done = 0;
  const total = cases.length;
  publishProgress(organizationId, runId, "running", done, total);

  for (const testCase of cases) {
    const persona = findPersona(testCase.persona);
    if (!persona) continue;

    await db
      .update(schema.agentTestCase)
      .set({ status: "running" })
      .where(eq(schema.agentTestCase.id, testCase.id));

    const { transcript, conversationId, actual } = await runConversation(
      organizationId,
      persona,
      ctx
    );

    const outcome = await judgeCase({
      personaKey: persona.key,
      transcript,
      kbText,
      behaviorText,
    });

    await db
      .update(schema.agentTestCase)
      .set({
        conversationId,
        transcript,
        status: outcome.status,
        veredicto: outcome.status === "done" ? outcome.verdict.veredicto : null,
        hallazgos: outcome.status === "done" ? outcome.verdict.hallazgos : null,
        // Outcomes observados por el motor (T604). Se leen del snapshot
        // durable del lead, que el orquestador escribe en cada turno.
        actualNextAction: actual?.nextAction ?? null,
        actualLane: actual?.lane ?? null,
        actualHandoff: actual?.handoff ?? null,
      })
      .where(eq(schema.agentTestCase.id, testCase.id));

    done += 1;
    publishProgress(organizationId, runId, "running", done, total);
  }

  const finalCases = await db
    .select({
      status: schema.agentTestCase.status,
      veredicto: schema.agentTestCase.veredicto,
    })
    .from(schema.agentTestCase)
    .where(eq(schema.agentTestCase.runId, runId));
  const score = computeScore(finalCases);

  await getDb()
    .update(schema.agentTestRun)
    .set({ status: "done", score, finishedAt: new Date() })
    .where(eq(schema.agentTestRun.id, runId));
  publishProgress(organizationId, runId, "done", done, total, score);
}

/** Outcomes del último turno comercial observado en el caso. */
export type ActualOutcome = {
  nextAction: string | null;
  lane: string | null;
  handoff: boolean | null;
};

/**
 * Conversa el guion completo contra el pipeline real; corta al primer handoff.
 *
 * Corte 6: si la cohorte es `sales`, cada turno pasa por
 * `runSalesOrchestratorTurn` con `playbookOverride` (validado por el
 * orquestador con `is_test=true`). Si es `legacy`, se usa el agente genérico.
 */
async function runConversation(
  organizationId: string,
  persona: Persona,
  ctx: RunContext
): Promise<{
  transcript: { role: "cliente" | "agente"; text: string }[];
  conversationId: string;
  actual: ActualOutcome;
}> {
  const db = getDb();

  // Contacto sintético ARCHIVADO (no aparece en la lista ni genera leads).
  const contactId = await upsertTestContact(organizationId, persona);

  const convId = newId("conversation");
  await db.insert(schema.conversation).values({
    id: convId,
    organizationId,
    contactId,
    isTest: true,
    aiEnabled: true,
  });

  for (const line of persona.script) {
    const now = new Date();
    await db.insert(schema.message).values({
      id: newId("message"),
      organizationId,
      conversationId: convId,
      direction: "in",
      type: "text",
      text: line,
      status: "delivered",
      waTimestamp: now,
    });
    await db
      .update(schema.conversation)
      .set({ lastInboundAt: now, lastMessageAt: now, updatedAt: now })
      .where(eq(schema.conversation.id, convId));

    // Turno REAL, secuencial y sin debounce (FR-030).
    if (ctx.cohort === "sales") {
      const conversation = await loadConversation(convId);
      if (conversation) {
        await runSalesOrchestratorTurn(
          { organizationId, conversationId: convId, conversation },
          // `undefined` cuando no hay override: el orquestador usa la
          // publicada por su cuenta y no dispara el guard de producción.
          ctx.overrideVersionId
            ? { playbookOverride: { versionId: ctx.overrideVersionId } }
            : {}
        );
      }
    } else {
      await runAgentTurn(convId);
    }

    const convRows = await db
      .select({ handoffAt: schema.conversation.handoffAt })
      .from(schema.conversation)
      .where(eq(schema.conversation.id, convId))
      .limit(1);
    if (convRows[0]?.handoffAt) break; // primer handoff → fin del guion
  }

  const messages = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, convId))
    .orderBy(asc(schema.message.createdAt));

  return {
    conversationId: convId,
    transcript: messages
      .filter((m) => m.text)
      .map((m) => ({
        role: m.direction === "in" ? ("cliente" as const) : ("agente" as const),
        text: m.text!,
      })),
    actual: await readActualOutcome(organizationId, contactId),
  };
}

async function loadConversation(conversationId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Lee el último outcome comercial del lead del caso desde su snapshot
 * durable (`lead.last_jev_decision.plan`). Es la misma fuente que el
 * orquestador escribe en cada turno, así que no depende de memoria del
 * proceso. Si no hay lead o no hay snapshot → `null` en los tres campos
 * (la UI lo muestra como "—", no como un fallo).
 */
async function readActualOutcome(
  organizationId: string,
  contactId: string
): Promise<ActualOutcome> {
  const db = getDb();
  const rows = await db
    .select({
      lane: schema.lead.automationLane,
      decision: schema.lead.lastJevDecision,
    })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return { nextAction: null, lane: null, handoff: null };

  const plan = (row.decision as { plan?: unknown } | null)?.plan as
    | {
        nextAction?: unknown;
        lane?: unknown;
        shouldHandoff?: unknown;
      }
    | undefined;

  return {
    nextAction:
      typeof plan?.nextAction === "string" ? plan.nextAction : null,
    lane: typeof plan?.lane === "string" ? plan.lane : (row.lane ?? null),
    handoff:
      typeof plan?.shouldHandoff === "boolean" ? plan.shouldHandoff : null,
  };
}

async function upsertTestContact(
  organizationId: string,
  persona: Persona
): Promise<string> {
  const db = getDb();
  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      phone: persona.phone,
      waIdentity: persona.phone,
      name: persona.contactName,
      archivedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [schema.contact.organizationId, schema.contact.waIdentity],
    })
    .returning();
  if (inserted[0]) return inserted[0].id;
  const rows = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.phone, persona.phone)
      )
    )
    .limit(1);
  return rows[0]!.id;
}

async function failRun(
  runId: string,
  organizationId: string,
  error: string,
  total: number
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.agentTestRun)
    .set({ status: "failed", error, finishedAt: new Date() })
    .where(eq(schema.agentTestRun.id, runId));
  publishProgress(organizationId, runId, "failed", 0, total);
}

function publishProgress(
  organizationId: string,
  runId: string,
  status: string,
  done: number,
  total: number,
  score?: number | null
): void {
  publish(organizationId, {
    type: "lab.run",
    data: { runId, status, progress: { done, total }, score },
  });
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "23505" || e.cause?.code === "23505";
}
