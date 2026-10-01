/**
 * T607 — Corte 6: el Laboratorio comercial corre el pipeline REAL.
 *
 * Cubre el contrato completo del runner con el Sales Orchestrator:
 *   - la corrida persiste `playbook_version_id` / `playbook_schema_version`
 *     POR CASO (trazabilidad de la comparación Published vs Draft);
 *   - el override llega al orquestador solo con `is_test=true`;
 *   - cero efectos residuales: sin WhatsApp real, sin filas en
 *     `sales_follow_up_job`, sin CAPI;
 *   - fallback explícito cuando no hay versión publicada
 *     (`playbook_version_id = null`, NO se inventa una);
 *   - la cohorte legacy sigue corriendo contra el agente genérico;
 *   - `playbook_mode: "both"` crea DOS corridas con versiones distintas.
 *
 * La BD es un doble en memoria con predicados `eq`/`and` evaluables, para
 * que el aislamiento por `run_id` / `organization_id` sea REAL y no una
 * simple lista de filas en orden de llamada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ *
 * Doble de drizzle-orm: predicados evaluables sobre filas en memoria.
 * ------------------------------------------------------------------ */

const TABLE = Symbol.for("lab.test.table");

vi.mock("drizzle-orm", () => ({
  eq: (col: string, value: unknown) => ({ kind: "eq", col, value }),
  and: (...clauses: unknown[]) => ({ kind: "and", clauses }),
  or: (...clauses: unknown[]) => ({ kind: "or", clauses }),
  asc: (c: unknown) => c,
  desc: (c: unknown) => c,
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      kind: "sql",
      text: strings.join("?"),
      values,
    }),
    { raw: (s: string) => ({ kind: "sql", text: s, values: [] }) }
  ),
}));

/* ------------------------------------------------------------------ *
 * Estado en memoria.
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  agentTestRun: [],
  agentTestCase: [],
  contact: [],
  conversation: [],
  message: [],
  lead: [],
  kbEntry: [],
  agentProfile: [],
  salesFollowUpJob: [],
};

const tablesTouched: string[] = [];

function resetTables(): void {
  for (const k of Object.keys(tables)) tables[k] = [];
  tablesTouched.length = 0;
}

type Clause =
  | { kind: "eq"; col: string; value: unknown }
  | { kind: "and"; clauses: Clause[] }
  | { kind: "or"; clauses: Clause[] }
  | { kind: "sql" }
  | undefined;

function evalClause(clause: Clause | undefined, row: Row): boolean {
  if (!clause) return true;
  if (clause.kind === "eq") {
    const col = clause.col.slice(clause.col.indexOf(".") + 1);
    return row[col] === clause.value;
  }
  if (clause.kind === "and") return clause.clauses.every((c) => evalClause(c, row));
  if (clause.kind === "or") return clause.clauses.some((c) => evalClause(c, row));
  return true; // sql() es del índice parcial UNIQUE; la BD real lo resuelve
}

function tableNameOf(t: unknown): string {
  return (t as Record<symbol, string>)[TABLE] ?? "unknown";
}

/** Bucket perezoso: una tabla no declarada se crea vacía y queda registrada. */
function bucket(table: string): Row[] {
  if (!tables[table]) tables[table] = [];
  return tables[table]!;
}

function insertRows(table: string, values: Row | Row[]): Row[] {
  tablesTouched.push(table);
  const list = Array.isArray(values) ? values : [values];
  const withDefaults = list.map((v) => ({
    createdAt: new Date(),
    startedAt: new Date(),
    ...v,
  }));
  bucket(table).push(...withDefaults);
  return withDefaults;
}

/**
 * Aplica la proyección de Drizzle: `{ enabled: agentProfile.salesOrchestratorEnabled }`
 * devuelve la fila con la CLAVE del alias (`enabled`) tomando el VALOR de la
 * columna real. Sin esto, `rows[0].enabled` sería `undefined` y el runner
 * degrada a la cohorte legacy sin avisar.
 */
function project(row: Row, projection: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [key, ref] of Object.entries(projection)) {
    if (typeof ref === "string" && ref.includes(".")) {
      out[key] = row[ref.slice(ref.indexOf(".") + 1)];
    }
  }
  return out;
}

const fakeDb = {
  select(projection?: Record<string, unknown>) {
    let table = "unknown";
    let clause: Clause;
    const q: Record<string, unknown> = {
      from(t: unknown) {
        table = tableNameOf(t);
        return q;
      },
      where(c: Clause) {
        clause = c;
        return q;
      },
      orderBy() {
        return q;
      },
      limit() {
        return q;
      },
      innerJoin() {
        return q;
      },
      leftJoin() {
        return q;
      },
      then(
        resolve: (rows: Row[]) => unknown,
        reject?: (e: unknown) => unknown
      ): Promise<unknown> {
        const matched = bucket(table).filter((r) => evalClause(clause, r));
        const rows = projection
          ? matched.map((r) => project(r, projection))
          : matched;
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return q;
  },

  insert(t: unknown) {
    const table = tableNameOf(t);
    let pending: Row[] = [];
    const q: Record<string, unknown> = {
      values(v: Row | Row[]) {
        pending = insertRows(table, v);
        return q;
      },
      onConflictDoNothing() {
        return q;
      },
      returning() {
        return Promise.resolve(pending);
      },
      then(resolve: (rows: Row[]) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(pending).then(resolve, reject);
      },
    };
    return q;
  },

  update(t: unknown) {
    const table = tableNameOf(t);
    return {
      set(patch: Row) {
        return {
          where(clause: Clause) {
            const chain: Record<string, unknown> = {
              returning() {
                const hit = bucket(table).filter((r) =>
                  evalClause(clause, r)
                );
                for (const r of hit) Object.assign(r, patch);
                return Promise.resolve(hit);
              },
              then(resolve: (rows: Row[]) => unknown) {
                const hit = bucket(table).filter((r) =>
                  evalClause(clause, r)
                );
                for (const r of hit) Object.assign(r, patch);
                return Promise.resolve(hit).then(resolve);
              },
            };
            return chain;
          },
        };
      },
    };
  },
};

vi.mock("@/lib/db", () => ({
  getDb: () => fakeDb,
  schema: new Proxy(
    {},
    {
      get: (_t, tableProp) =>
        new Proxy(
          {},
          {
            get: (_t2, colProp) => {
              if (colProp === TABLE) return String(tableProp);
              return `${String(tableProp)}.${String(colProp)}`;
            },
          }
        ),
    }
  ),
}));

/* ------------------------------------------------------------------ *
 * Dobles de los colaboradores externos del runner.
 * ------------------------------------------------------------------ */

const graphRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

const runAgentTurn = vi.hoisted(() => vi.fn());
vi.mock("@/server/ai/pipeline", () => ({ runAgentTurn }));

const runSalesOrchestratorTurn = vi.hoisted(() => vi.fn());
vi.mock("@/server/sales/orchestrator", () => ({ runSalesOrchestratorTurn }));

const getPublishedConfigForOrg = vi.hoisted(() => vi.fn());
const getDraftConfigForOrg = vi.hoisted(() => vi.fn());
const getConfigByVersionId = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sales/playbook/loader", () => ({
  getPublishedConfigForOrg,
  getDraftConfigForOrg,
  getConfigByVersionId,
}));

const scheduleNextFollowUp = vi.hoisted(() => vi.fn());
vi.mock("@/server/sales/follow-ups/store", () => ({ scheduleNextFollowUp }));

const judgeCase = vi.hoisted(() => vi.fn());
vi.mock("@/server/lab/judge", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/lab/judge")>();
  return {
    ...original,
    judgeCase: (input: unknown) => judgeCase(input),
  };
});

vi.mock("@/server/ai/prompts", () => ({ renderKb: () => "kb-simulada" }));
vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));

/* ------------------------------------------------------------------ *
 * Helpers.
 * ------------------------------------------------------------------ */

import {
  PlaybookVersionNotFoundError,
  parsePlaybookMode,
  startRun,
  startRunWithMode,
} from "@/server/lab/runner";

const ORG = "org_lab";

function seedProfile(salesEnabled: boolean): void {
  tables.agentProfile!.push({
    id: "agp_1",
    organizationId: ORG,
    name: "Asistente",
    tone: null,
    instructions: null,
    escalationRules: null,
    salesOrchestratorEnabled: salesEnabled,
  });
}

function seedPublished(id: string | null): void {
  getPublishedConfigForOrg.mockResolvedValue(
    id ? { id, schema_version: "1.0", version_number: 1, status: "published" } : null
  );
}

function seedDraft(id: string | null): void {
  getDraftConfigForOrg.mockResolvedValue(
    id ? { id, schema_version: "1.0", version_number: 2, status: "draft" } : null
  );
}

/** La corrida se ejecuta fire-and-forget: esperamos a que termine. */
async function waitForRunDone(runId: string): Promise<void> {
  await vi.waitFor(
    () => {
      const run = tables.agentTestRun!.find((r) => r.id === runId);
      expect(run?.status).toBe("done");
    },
    { timeout: 5000, interval: 10 }
  );
}

beforeEach(() => {
  resetTables();
  graphRequest.mockReset();
  runAgentTurn.mockReset();
  runSalesOrchestratorTurn.mockReset();
  scheduleNextFollowUp.mockReset();
  judgeCase.mockReset();
  getPublishedConfigForOrg.mockReset();
  getDraftConfigForOrg.mockReset();
  getConfigByVersionId.mockReset();
  judgeCase.mockResolvedValue({
    status: "done",
    verdict: { veredicto: "verde", hallazgos: [] },
  });
  runAgentTurn.mockResolvedValue(undefined);
  runSalesOrchestratorTurn.mockResolvedValue(undefined);
  getConfigByVersionId.mockResolvedValue(null);
});

/* ------------------------------------------------------------------ */

describe("Laboratorio comercial — pipeline real (T607)", () => {
  it("persiste playbook_version_id y playbook_schema_version por caso (published)", async () => {
    seedProfile(true);
    seedPublished("spv_publicada_v1");
    seedDraft(null);

    const runId = await startRun(ORG, "published");
    await waitForRunDone(runId);

    const run = tables.agentTestRun!.find((r) => r.id === runId)!;
    expect(run.playbookMode).toBe("published");

    const cases = tables.agentTestCase!.filter((c) => c.runId === runId);
    expect(cases).toHaveLength(6); // cohorte V1 comercial
    for (const c of cases) {
      expect(c.playbookVersionId).toBe("spv_publicada_v1");
      expect(c.playbookSchemaVersion).toBe("1.0");
      expect(c.persona).toMatch(/^v1_academia_/);
    }
  });

  it("corre el pipeline REAL: cada turno pasa por runSalesOrchestratorTurn con override y is_test=true", async () => {
    seedProfile(true);
    seedPublished("spv_publicada_v1");
    seedDraft(null);

    const runId = await startRun(ORG, "published");
    await waitForRunDone(runId);

    expect(runSalesOrchestratorTurn).toHaveBeenCalled();
    expect(runAgentTurn).not.toHaveBeenCalled();

    // El override viaja explícitamente y NUNCA sin `is_test`:
    // es la precondición del guard T306 del orquestador.
    for (const call of runSalesOrchestratorTurn.mock.calls) {
      const input = call[0] as { conversation: { isTest: boolean } };
      const opts = (call[1] ?? {}) as { playbookOverride?: { versionId: string } };
      expect(input.conversation.isTest).toBe(true);
      expect(opts.playbookOverride?.versionId).toBe("spv_publicada_v1");
    }

    // Las conversaciones creadas por el runner son sandbox.
    const convs = tables.conversation!;
    expect(convs.length).toBeGreaterThan(0);
    for (const conv of convs) expect(conv.isTest).toBe(true);
  });

  it("sin versión publicada → fallback explícito con playbook_version_id = null (no inventa)", async () => {
    seedProfile(true);
    seedPublished(null);
    seedDraft(null);

    const runId = await startRun(ORG, "published");
    await waitForRunDone(runId);

    const cases = tables.agentTestCase!.filter((c) => c.runId === runId);
    expect(cases).toHaveLength(6);
    for (const c of cases) {
      expect(c.playbookVersionId).toBeNull();
      expect(c.playbookSchemaVersion).toBeNull();
    }
    // Sin override: el orquestador resuelve la publicada por su cuenta
    // (y su propio fallback a constantes si no hay ninguna).
    for (const call of runSalesOrchestratorTurn.mock.calls) {
      expect((call[1] ?? {})).toEqual({});
    }
  });

  it("modo draft → corre contra el draft activo con su version_id", async () => {
    seedProfile(true);
    seedPublished("spv_publicada_v1");
    seedDraft("spv_borrador_v2");

    const runId = await startRun(ORG, "draft");
    await waitForRunDone(runId);

    const cases = tables.agentTestCase!.filter((c) => c.runId === runId);
    for (const c of cases) expect(c.playbookVersionId).toBe("spv_borrador_v2");
  });

  it("modo archived:<id> usa exactamente esa versión; si no existe, falla explícito", async () => {
    seedProfile(true);
    seedPublished("spv_publicada_v1");
    getConfigByVersionId.mockResolvedValue({
      id: "spv_vieja",
      schema_version: "1.0",
      version_number: 1,
      status: "archived",
    });

    const runId = await startRun(ORG, "archived:spv_vieja");
    await waitForRunDone(runId);
    const cases = tables.agentTestCase!.filter((c) => c.runId === runId);
    expect(cases[0]!.playbookVersionId).toBe("spv_vieja");

    getConfigByVersionId.mockResolvedValue(null);
    await expect(startRun(ORG, "archived:spv_no_existe")).rejects.toBeInstanceOf(
      PlaybookVersionNotFoundError
    );
  });

  it('playbook_mode "both" → DOS corridas con playbook_version_id distintos', async () => {
    seedProfile(true);
    seedPublished("spv_publicada_v1");
    seedDraft("spv_borrador_v2");

    const { runIds } = await startRunWithMode(ORG, "both");
    expect(runIds).toHaveLength(2);
    await Promise.all(runIds.map(waitForRunDone));

    const modes = runIds
      .map((id) => tables.agentTestRun!.find((r) => r.id === id)!.playbookMode)
      .sort();
    expect(modes).toEqual(["draft", "published"]);

    const versions = runIds.map(
      (id) =>
        tables.agentTestCase!.find((c) => c.runId === id)!.playbookVersionId as string
    );
    expect(new Set(versions)).toEqual(new Set(["spv_publicada_v1", "spv_borrador_v2"]));
  });

  it("sin Sales Orchestrator → cohorte legacy contra el agente genérico, playbook_version_id = null", async () => {
    seedProfile(false);
    seedPublished("spv_publicada_v1");

    const runId = await startRun(ORG, "published");
    await waitForRunDone(runId);

    expect(runAgentTurn).toHaveBeenCalled();
    expect(runSalesOrchestratorTurn).not.toHaveBeenCalled();

    const cases = tables.agentTestCase!.filter((c) => c.runId === runId);
    expect(cases).toHaveLength(6);
    for (const c of cases) {
      expect(c.persona).toMatch(/^legacy_/);
      expect(c.playbookVersionId).toBeNull();
    }
  });

  it("modo legacy explícito fuerza la cohorte legacy aunque el orquestador esté encendido", async () => {
    seedProfile(true);
    seedPublished("spv_publicada_v1");

    const runId = await startRun(ORG, "legacy");
    await waitForRunDone(runId);

    const cases = tables.agentTestCase!.filter((c) => c.runId === runId);
    expect(cases.every((c) => String(c.persona).startsWith("legacy_"))).toBe(true);
    expect(runAgentTurn).toHaveBeenCalled();
  });

  it("cero efectos residuales: sin WhatsApp real, sin sales_follow_up_job y sin CAPI", async () => {
    seedProfile(true);
    seedPublished("spv_publicada_v1");
    seedDraft("spv_borrador_v2");

    const runId = await startRun(ORG, "published");
    await waitForRunDone(runId);

    // 1. Cero invocación al cliente Graph (WhatsApp real).
    expect(graphRequest).not.toHaveBeenCalled();
    // 2. Cero filas en la cola durable de follow-ups.
    expect(tables.salesFollowUpJob).toHaveLength(0);
    expect(scheduleNextFollowUp).not.toHaveBeenCalled();
    // 3. Ninguna tabla de CAPI fue tocada por la corrida.
    expect(tablesTouched).not.toContain("conversionEvent");
    expect(tablesTouched).not.toContain("capiSettings");
  });

  it("persiste los outcomes observados (actual_*) para comparar contra lo esperado", async () => {
    seedProfile(true);
    seedPublished("spv_publicada_v1");
    // El orquestador real escribe el snapshot en `lead`; aquí lo sembramos
    // para verificar que el runner lo lee de la fuente durable. El contacto
    // sale de la MISMA conversación del turno (cada caso tiene el suyo).
    runSalesOrchestratorTurn.mockImplementation(
      async ({ conversation }: { conversation: { contactId: string } }) => {
        tables.lead!.push({
          id: `ld_${conversation.contactId}`,
          organizationId: ORG,
          contactId: conversation.contactId,
          automationLane: "human",
          lastJevDecision: {
            plan: { nextAction: "schedule_call", lane: "human", shouldHandoff: true },
          },
        });
      }
    );

    const runId = await startRun(ORG, "published");
    await waitForRunDone(runId);

    const cases = tables.agentTestCase!.filter((c) => c.runId === runId);
    for (const c of cases) {
      expect(c.actualNextAction).toBe("schedule_call");
      expect(c.actualLane).toBe("human");
      expect(c.actualHandoff).toBe(true);
      // El esperado NO se autocompleta: sigue vacío hasta que el dueño lo declare.
      expect(c.expectedNextAction).toBeUndefined();
      expect(c.expectedLane).toBeUndefined();
      expect(c.expectedHandoff).toBeUndefined();
    }
  });

  it("el juez evalúa el transcript real (incluye respuestas del agente)", async () => {
    seedProfile(true);
    seedPublished("spv_publicada_v1");
    // El orquestador, en sandbox, deja el mensaje saliente del writer.
    runSalesOrchestratorTurn.mockImplementation(async ({ conversationId }: { conversationId: string }) => {
      tables.message!.push({
        id: `msg_out_${conversationId}`,
        organizationId: ORG,
        conversationId,
        direction: "out",
        text: "Con gusto, te muestro cómo funciona la demo de operaciones.",
        createdAt: new Date(Date.now() + 1000),
      });
    });

    const runId = await startRun(ORG, "published");
    await waitForRunDone(runId);

    const judged = judgeCase.mock.calls[0]![0] as {
      transcript: { role: string; text: string }[];
    };
    expect(judged.transcript.length).toBeGreaterThan(0);
    expect(judged.transcript.some((t) => t.role === "cliente")).toBe(true);
    expect(judged.transcript.some((t) => t.role === "agente")).toBe(true);

    const cases = tables.agentTestCase!.filter((c) => c.runId === runId);
    expect(cases[0]!.status).toBe("done");
  });
});

describe("parsePlaybookMode (T605)", () => {
  it("acepta los modos soportados y normaliza vacíos a published", () => {
    expect(parsePlaybookMode(undefined)).toBe("published");
    expect(parsePlaybookMode(null)).toBe("published");
    expect(parsePlaybookMode("")).toBe("published");
    expect(parsePlaybookMode("published")).toBe("published");
    expect(parsePlaybookMode("draft")).toBe("draft");
    expect(parsePlaybookMode("both")).toBe("both");
    expect(parsePlaybookMode("legacy")).toBe("legacy");
    expect(parsePlaybookMode("archived:spv_123")).toBe("archived:spv_123");
  });

  it("rechaza modos inválidos (→ 422 en la API)", () => {
    expect(parsePlaybookMode("archived:")).toBeNull();
    expect(parsePlaybookMode("archivada")).toBeNull();
    expect(parsePlaybookMode("prod")).toBeNull();
    expect(parsePlaybookMode(42)).toBeNull();
    expect(parsePlaybookMode({})).toBeNull();
  });
});
