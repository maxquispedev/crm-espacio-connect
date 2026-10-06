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
  ne: (col: string, value: unknown) => ({ kind: "ne", col, value }),
  and: (...clauses: unknown[]) => ({ kind: "and", clauses }),
  or: (...clauses: unknown[]) => ({ kind: "or", clauses }),
  isNull: (col: string) => ({ kind: "null", col }),
  isNotNull: (col: string) => ({ kind: "notNull", col }),
  inArray: (col: string, values: unknown[]) => ({ kind: "in", col, values }),
  asc: (c: unknown) => ({ col: c, direction: 1 }),
  desc: (c: unknown) => ({ col: c, direction: -1 }),
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
  pipelineStage: [],
  salesFollowUpJob: [],
};

const tablesTouched: string[] = [];

function resetTables(): void {
  for (const k of Object.keys(tables)) tables[k] = [];
  tablesTouched.length = 0;
}

type Clause =
  | { kind: "eq" | "ne"; col: string; value: unknown }
  | { kind: "and"; clauses: Clause[] }
  | { kind: "or"; clauses: Clause[] }
  | { kind: "null" | "notNull"; col: string }
  | { kind: "sql" }
  | undefined;

function valueOf(row: Row, col: string): unknown {
  if (col in row) return row[col];
  return row[col.slice(col.indexOf(".") + 1)];
}

function evalClause(clause: Clause | undefined, row: Row): boolean {
  if (!clause) return true;
  if (clause.kind === "ne") return valueOf(row, clause.col) !== clause.value;
  if (clause.kind === "eq") {
    const right = typeof clause.value === "string" && clause.value.includes(".")
      ? valueOf(row, clause.value) : clause.value;
    return valueOf(row, clause.col) === right;
  }
  if (clause.kind === "null") return valueOf(row, clause.col) == null;
  if (clause.kind === "notNull") return valueOf(row, clause.col) != null;
  if (clause.kind === "and") return clause.clauses.every((c) => evalClause(c, row));
  if (clause.kind === "or") return clause.clauses.some((c) => evalClause(c, row));
  return true;
}

function qualified(table: string, row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [`${table}.${key}`, value]));
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
    ...(table === "lead" ? {
      automationLane: "auto", demoShownAt: null, pricePresentedAt: null,
      paymentInstructionsSentAt: null, humanRequestedAt: null,
      nextFollowUpAt: null, followUpCount: 0, followUpReason: null,
      lastJevEvaluatedAt: null, lastJevDecision: null, lastJevError: null,
      lastJevPlaybookVersionId: null, lastJevPlaybookSchemaVersion: null,
    } : {}),
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
      out[key] = valueOf(row, ref);
    } else if (ref && typeof ref === "object") {
      const table = tableNameOf(ref);
      const prefix = `${table}.`;
      const entries = Object.entries(row).filter(([k]) => k.startsWith(prefix));
      out[key] = entries.length ? Object.fromEntries(entries.map(([k, v]) => [k.slice(prefix.length), v])) : null;
    }
  }
  return out;
}

const fakeDb = {
  select(projection?: Record<string, unknown>) {
    let table = "unknown";
    let clause: Clause;
    let ordering: { col: string; direction: number } | undefined;
    let cap = Infinity;
    const joins: { table: string; clause: Clause; left: boolean }[] = [];
    const q: Record<string, unknown> = {
      for() { return q; },
      from(t: unknown) {
        table = tableNameOf(t);
        return q;
      },
      where(c: Clause) {
        clause = c;
        return q;
      },
      orderBy(order: { col: string; direction: number }) { ordering = order; return q; },
      limit(n: number) { cap = n; return q; },
      innerJoin(t: unknown, c: Clause) {
        joins.push({ table: tableNameOf(t), clause: c, left: false }); return q;
      },
      leftJoin(t: unknown, c: Clause) {
        joins.push({ table: tableNameOf(t), clause: c, left: true }); return q;
      },
      then(
        resolve: (rows: Row[]) => unknown,
        reject?: (e: unknown) => unknown
      ): Promise<unknown> {
        let joined = bucket(table).map((r) => ({ ...r, ...qualified(table, r) }));
        for (const join of joins) {
          joined = joined.flatMap((r) => {
            const matches = bucket(join.table)
              .map((other) => ({ ...r, ...qualified(join.table, other) }))
              .filter((candidate) => evalClause(join.clause, candidate));
            return matches.length ? matches : join.left ? [r] : [];
          });
        }
        let matched = joined.filter((r) => evalClause(clause, r));
        if (ordering) {
          const { col, direction } = ordering;
          matched.sort((a, b) => {
            const av = valueOf(a, col) as number;
            const bv = valueOf(b, col) as number;
            return (av < bv ? -1 : av > bv ? 1 : 0) * direction;
          });
        }
        matched = matched.slice(0, cap);
        const rows = projection ? matched.map((r) => project(r, projection))
          : matched.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.includes("."))));
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return q;
  },

  transaction: async (run: (tx: object) => Promise<unknown>): Promise<unknown> => run(fakeDb),

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

  delete(t: unknown) {
    const table = tableNameOf(t);
    return { where(clause: Clause) {
      const hits = bucket(table).filter((r) => evalClause(clause, r));
      tables[table] = bucket(table).filter((r) => !hits.includes(r));
      if (table === "contact") {
        const ids = hits.map((r) => r.id);
        const convIds = bucket("conversation").filter((r) => ids.includes(r.contactId)).map((r) => r.id);
        tables.lead = bucket("lead").filter((r) => !ids.includes(r.contactId));
        tables.conversation = bucket("conversation").filter((r) => !convIds.includes(r.id));
        for (const child of ["message", "conversionEvent"]) {
          tables[child] = bucket(child).filter((r) => !convIds.includes(r.conversationId));
        }
        for (const c of bucket("agentTestCase")) {
          if (convIds.includes(c.conversationId)) c.conversationId = null;
        }
      }
      return Promise.resolve(hits);
    } };
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

const sendCapiEvent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/meta/capi", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/capi")>();
  return { ...original, sendCapiEvent };
});

const runAgentTurn = vi.hoisted(() => vi.fn());
vi.mock("@/server/ai/pipeline", () => ({ runAgentTurn }));

const runSalesOrchestratorTurn = vi.hoisted(() => vi.fn());
vi.mock("@/server/sales/orchestrator", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/sales/orchestrator")>();
  return { ...original, runSalesOrchestratorTurn };
});
const evaluateJev = vi.hoisted(() => vi.fn());
vi.mock("@/server/sales/client", () => ({ evaluateJev }));
const writeSalesReply = vi.hoisted(() => vi.fn());
vi.mock("@/server/sales/writer", () => ({ writeSalesReply }));
vi.mock("@/lib/api", () => ({
  withAuth: (handler: (session: unknown) => Promise<Response>) =>
    () => handler({ organizationId: "org_lab" }),
}));

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

import { makeDecision } from "./sales-fixtures";
import { GET as getBoard } from "@/app/api/pipeline/board/route";
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

/**
 * `ConfigV1` mínimo pero REALISTA.
 *
 * Antes estas fixtures usaban `config: {}`, algo que el loader real nunca
 * devuelve: `rowToConfig` valida la fila con `parseConfigV1` y solo emite
 * un `ConfigV1` completo. Desde el corte 3 el builder mapea
 * `config.product` y `config.commercial_policy` de forma explícita, así que
 * la fixture debe traer los 6 campos de producto y los 9 de política.
 */
const LAB_CONFIG = {
  schema_version: "1.0",
  product: {
    name: "Producto de laboratorio",
    one_liner: "One liner del laboratorio",
    who_it_is_for: ["Audience del laboratorio"],
    core_jobs: ["Job del laboratorio"],
    not_the_product: ["No es el producto del laboratorio"],
    how_it_starts: "Arranque del laboratorio",
  },
  commercial_policy: {
    defaultChannel: "WhatsApp",
    goal: "Objetivo del laboratorio",
    automationFirst: "Automatización del laboratorio",
    autoClose: "Cierre automático del laboratorio",
    humanHandoff: "Escalamiento del laboratorio",
    futureInterest: "Interés futuro del laboratorio",
    noResponse: "Sin respuesta del laboratorio",
    disqualification: "Descalificación del laboratorio",
    evidenceRule: "Evidencia del laboratorio",
  },
  offer: { setup: 0, monthlyBase: 247 },
  writer: {},
  jev_questions: {},
  priorities: { primary: [], secondary: [], tertiary: [] },
  prohibitions: [],
  handoff: {},
  urgency_rules: null,
};

function seedPublished(id: string | null): void {
  getPublishedConfigForOrg.mockResolvedValue(
    id ? { id, schema_version: "1.0", version_number: 1, status: "published", config: LAB_CONFIG } : null
  );
}

function seedDraft(id: string | null): void {
  getDraftConfigForOrg.mockResolvedValue(
    id ? { id, schema_version: "1.0", version_number: 2, status: "draft", config: LAB_CONFIG } : null
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
  sendCapiEvent.mockReset();
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
  runSalesOrchestratorTurn.mockImplementation(async (input, opts) => {
    const original = await vi.importActual<typeof import("@/server/sales/orchestrator")>("@/server/sales/orchestrator");
    await original.runSalesOrchestratorTurn(input, opts);
  });
  evaluateJev.mockReset();
  writeSalesReply.mockReset();
  evaluateJev.mockResolvedValue({ ok: true, decision: makeDecision({ nextAction: "show_operations_demo" }), snapshot: {} });
  writeSalesReply.mockResolvedValue({ ok: true, text: "Demo sandbox" });
  vi.stubEnv("ATRIBUCION", "on");
  tables.pipelineStage!.push(
    { id: "other", organizationId: "other_org", kind: "open", position: -10, name: "Otra org" },
    { id: "won", organizationId: ORG, kind: "won", position: -1, name: "Cliente" },
    { id: "chat", organizationId: ORG, kind: "open", position: 1, name: "En conversación" },
    { id: "new", organizationId: ORG, kind: "open", position: 0, name: "Nuevo" },
  );
  getConfigByVersionId.mockImplementation(async (_org, id) => ({ id, config: LAB_CONFIG, schema_version: "1.0", version_number: 1 }));
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
    const convs = runSalesOrchestratorTurn.mock.calls.map((call) => call[0].conversation);
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
      config: LAB_CONFIG,
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
    expect(sendCapiEvent).not.toHaveBeenCalled();
    // 2. Cero filas en la cola durable de follow-ups.
    expect(tables.salesFollowUpJob).toHaveLength(0);
    expect(scheduleNextFollowUp).not.toHaveBeenCalled();
    // 3. El guard CAPI impide emisión real; sus skips se limpian por cascada.
    expect(tables.conversionEvent).toHaveLength(0);
    expect(tablesTouched).not.toContain("capiSettings");
  });

  it("crea lead limpio antes del primer turno; ambos modos y corridas repetidas son independientes", async () => {
    seedProfile(true); seedPublished("pub"); seedDraft("draft");
    const original = await vi.importActual<typeof import("@/server/sales/orchestrator")>("@/server/sales/orchestrator");
    const initial: Row[] = [];
    const contacts: Row[] = [];
    const seen = new Set<string>();
    runSalesOrchestratorTurn.mockImplementation(async (input, opts) => {
      const lead = tables.lead!.find((r) => r.contactId === input.conversation.contactId);
      expect(lead).toBeDefined(); // regresión: NO puede retornar por leadId=null
      if (!seen.has(String(lead!.id))) {
        seen.add(String(lead!.id)); initial.push({ ...lead! });
        contacts.push({ ...tables.contact!.find((r) => r.id === lead!.contactId)! });
      }
      await original.runSalesOrchestratorTurn(input, opts);
    });
    const { runIds } = await startRunWithMode(ORG, "both");
    await Promise.all(runIds.map(waitForRunDone));
    await waitForRunDone(await startRun(ORG));
    expect(initial).toHaveLength(18);
    expect(new Set(contacts.map((c) => c.waIdentity)).size).toBe(18);
    for (const c of contacts) expect(c.archivedAt).toBeInstanceOf(Date);
    for (const lead of initial) {
      expect(lead.stageId).toBe("new"); // primera open del tenant por position
      expect(lead.automationLane).toBe("auto");
      expect(lead.followUpCount).toBe(0);
      for (const key of ["demoShownAt", "pricePresentedAt", "paymentInstructionsSentAt",
        "humanRequestedAt", "nextFollowUpAt", "followUpReason", "lastJevDecision",
        "lastJevEvaluatedAt", "lastJevError", "lastJevPlaybookVersionId", "lastJevPlaybookSchemaVersion"]) {
        expect(lead[key]).toBeNull();
      }
    }
    for (const c of tables.agentTestCase!) {
      // Caso normal, Jev válido: los tres actuals jamás quedan vacíos.
      expect(c.actualNextAction).toBe("show_operations_demo");
      expect(c.actualLane).toBe("auto");
      expect(c.actualHandoff).toBe(false);
      expect(c.conversationId).toBeNull();
    }
    for (const table of ["contact", "lead", "conversation", "message"]) expect(tables[table]).toHaveLength(0);
    // Builder y writer leen historial/outbound y facts durables del turno anterior.
    // Sin recurso configurado, el fallback textual no cuenta como demo entregada.
    expect(evaluateJev.mock.calls.some(([input]) =>
      input.state.conversation.some((t: { from: string }) => t.from === "seller")
      && input.state.crm_state.demo_shown === false)).toBe(true);
    expect(graphRequest).not.toHaveBeenCalled();
    expect(sendCapiEvent).not.toHaveBeenCalled();
  });

  it("board excluye sandbox y contactos reales archivados mientras conserva tarjetas normales del tenant", async () => {
    seedProfile(true); seedPublished("pub");
    tables.contact!.push(
      { id: "live", organizationId: ORG, archivedAt: null, name: "Real" },
      { id: "archived", organizationId: ORG, archivedAt: new Date(), name: "Archivado" },
      { id: "foreign", organizationId: "other_org", archivedAt: null },
    );
    tables.lead!.push(
      { id: "liveLead", organizationId: ORG, contactId: "live", stageId: "new", position: 0 },
      { id: "archivedLead", organizationId: ORG, contactId: "archived", stageId: "new", position: 0 },
      { id: "foreignLead", organizationId: "other_org", contactId: "foreign", stageId: "other", position: 0 },
    );
    judgeCase.mockImplementation(async () => {
      expect(tables.contact!.some((c) => String(c.waIdentity).startsWith("lab:"))).toBe(true);
      const response = await getBoard();
      const board = await response.json();
      expect(board.leads.map((l: { id: string }) => l.id)).toEqual(["liveLead"]);
      return { status: "done", verdict: { veredicto: "verde", hallazgos: [] } };
    });
    await waitForRunDone(await startRun(ORG));
    expect(judgeCase).toHaveBeenCalledTimes(6);
    expect(tables.contact!.map((c) => c.id)).toEqual(["live", "archived", "foreign"]);
    expect(tables.lead!.map((c) => c.id)).toEqual(["liveLead", "archivedLead", "foreignLead"]);
  });

  it("sin etapa open del tenant falla explícitamente y limpia setup parcial", async () => {
    seedProfile(true); seedPublished("pub");
    tables.pipelineStage = tables.pipelineStage!.filter((s) => s.organizationId !== ORG || s.kind !== "open");
    const runId = await startRun(ORG);
    await vi.waitFor(() => {
      const run = tables.agentTestRun!.find((r) => r.id === runId);
      expect(run?.status).toBe("failed");
      expect(run?.error).toContain("lab_sales_open_stage_not_found");
    });
    expect(evaluateJev).not.toHaveBeenCalled();
    for (const table of ["contact", "lead", "conversation", "message"]) expect(tables[table]).toHaveLength(0);
  });

  it.each(["returned", "thrown"])("judge falla (%s): conserva transcript/outcomes/version y limpia artefactos", async (mode) => {
    seedProfile(true); seedPublished("pub");
    if (mode === "thrown") judgeCase.mockRejectedValue(new Error("judge unavailable"));
    else judgeCase.mockResolvedValue({ status: "judge_failed", detail: "judge unavailable" });
    const runId = await startRun(ORG);
    await vi.waitFor(() => expect(tables.agentTestRun!.find((r) => r.id === runId)?.status)
      .toBe(mode === "thrown" ? "failed" : "done"));
    const c = tables.agentTestCase!.find((r) => r.runId === runId)!;
    expect(c.status).toBe("judge_failed");
    expect(c.actualNextAction).toBe("show_operations_demo");
    expect(c.actualLane).toBe("auto");
    expect(c.actualHandoff).toBe(false);
    expect(c.playbookVersionId).toBe("pub");
    expect((c.transcript as Row[]).some((t) => t.role === "agente")).toBe(true);
    expect(c.conversationId).toBeNull();
    for (const table of ["contact", "lead", "conversation", "message"]) expect(tables[table]).toHaveLength(0);
  });

  it("persiste los outcomes observados (actual_*) para comparar contra lo esperado", async () => {
    seedProfile(true);
    seedPublished("spv_publicada_v1");
    evaluateJev.mockResolvedValue({
      ok: true, decision: makeDecision({ nextAction: "schedule_call" }), snapshot: {},
    });

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
    for (const c of cases) {
      expect((c.transcript as Row[]).some((t) => t.role === "agente")).toBe(true);
      expect(c.actualNextAction).not.toBeNull();
      expect(c.actualLane).not.toBeNull();
      expect(typeof c.actualHandoff).toBe("boolean");
    }
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

// These tests isolate legacy business/flag contracts; 017 safety has real-module regressions.
vi.mock("@/server/ai/turn-safety", async original => ({
  ...await original<object>(),
  captureTurnToken: async (organizationId: string, conversationId: string) => ({ organizationId, conversationId, inboundMessageId: "msg_1", manualMessageId: null }),
  readTurnInbound: async () => ({ id: "msg_1", type: "text" }),
  isTurnCurrent: async () => true,
  withCurrentTurn: async (_token: unknown, effect: (db: unknown) => Promise<unknown>) => effect(fakeDb),
}));
