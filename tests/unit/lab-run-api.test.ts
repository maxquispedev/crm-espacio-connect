/**
 * T604/T605 — API del Laboratorio comercial (Corte 6, Feature 008).
 *
 * Cubre la superficie HTTP nueva:
 *   - `POST /api/lab/runs` acepta `playbook_mode`
 *     (`published` default · `draft` · `archived:<id>` · `both` · `legacy`)
 *     y devuelve 202 con `runId` + `runIds`;
 *   - `playbook_mode` inválido → 422 (no cuelga, no arranca nada);
 *   - `archived:<id>` inexistente → 422 `playbook_version_not_found`;
 *   - conflicto de concurrencia → 409 `run_in_progress`;
 *   - IA sin configurar → 409 `ai_not_configured`;
 *   - `PATCH /api/lab/cases/:id/expected` guarda outcomes esperados con los
 *     catálogos CERRADOS del motor, rechaza valores inválidos (422), y no
 *     filtra casos de otra organización (404).
 *
 * El `parsePlaybookMode` y las clases de error son los REALES del runner:
 * solo se dobla `startRunWithMode` (y los colaboradores pesados del runner)
 * para que importar el módulo no arrastre BD ni pipeline.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ *
 * Doble de drizzle-orm con predicados evaluables.
 * ------------------------------------------------------------------ */

vi.mock("drizzle-orm", () => ({
  eq: (col: string, value: unknown) => ({ kind: "eq", col, value }),
  and: (...clauses: unknown[]) => ({ kind: "and", clauses }),
  or: (...clauses: unknown[]) => ({ kind: "or", clauses }),
  asc: (c: unknown) => c,
  desc: (c: unknown) => c,
  sql: Object.assign(
    (strings: TemplateStringsArray) => ({ kind: "sql", text: strings.join("?") }),
    { raw: (s: string) => ({ kind: "sql", text: s }) }
  ),
}));

const TABLE = Symbol.for("lab.api.test.table");
type Row = Record<string, unknown>;
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
  return true;
}

const db: Record<string, Row[]> = {
  agentTestRun: [],
  agentTestCase: [],
};

function bucket(table: string): Row[] {
  if (!db[table]) db[table] = [];
  return db[table]!;
}
function tableNameOf(t: unknown): string {
  return (t as Record<symbol, string>)[TABLE] ?? "unknown";
}
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
      orderBy: () => q,
      limit: () => q,
      innerJoin: () => q,
      then(resolve: (rows: Row[]) => unknown, reject?: (e: unknown) => unknown) {
        const matched = bucket(table).filter((r) => evalClause(clause, r));
        return Promise.resolve(
          projection ? matched.map((r) => project(r, projection)) : matched
        ).then(resolve, reject);
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
            const hit = bucket(table).filter((r) => evalClause(clause, r));
            for (const r of hit) Object.assign(r, patch);
            const chain: Record<string, unknown> = {
              returning: () => Promise.resolve(hit),
              then: (resolve: (rows: Row[]) => unknown) =>
                Promise.resolve(hit).then(resolve),
            };
            return chain;
          },
        };
      },
    };
  },
  insert(t: unknown) {
    const table = tableNameOf(t);
    let pending: Row[] = [];
    const q: Record<string, unknown> = {
      values(v: Row | Row[]) {
        pending = Array.isArray(v) ? v : [v];
        bucket(table).push(...pending);
        return q;
      },
      returning: () => Promise.resolve(pending),
      then: (resolve: (rows: Row[]) => unknown) => Promise.resolve(pending).then(resolve),
    };
    return q;
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
 * Auth + entorno + runner.
 * ------------------------------------------------------------------ */

const fakeSession = { user: { id: "u_a" }, organizationId: "org_a" };
let currentSession: typeof fakeSession = fakeSession;

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    withAuth: <
      Args extends unknown[],
      R extends Response
    >(
      handler: (
        session: typeof fakeSession,
        request: Request,
        ...args: Args
      ) => Promise<R> | R
    ) => {
      return async (request: Request, ctx?: unknown) => {
        const args = ctx !== undefined ? ([ctx] as unknown as Args) : ([] as unknown as Args);
        return handler(currentSession, request, ...args);
      };
    },
  };
});

const isAiConfigured = vi.hoisted(() => vi.fn());
vi.mock("@/lib/env", async () => {
  const actual = await vi.importActual<typeof import("@/lib/env")>("@/lib/env");
  return { ...actual, isAiConfigured };
});

// Colaboradores pesados del runner: solo para que importar el módulo real
// (y con él `parsePlaybookMode` y las clases de error) sea barato.
vi.mock("@/server/ai/pipeline", () => ({ runAgentTurn: vi.fn() }));
vi.mock("@/server/sales/orchestrator", () => ({
  runSalesOrchestratorTurn: vi.fn(),
}));
vi.mock("@/lib/sales/playbook/loader", () => ({
  getPublishedConfigForOrg: vi.fn().mockResolvedValue(null),
  getDraftConfigForOrg: vi.fn().mockResolvedValue(null),
  getConfigByVersionId: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));
vi.mock("@/server/ai/prompts", () => ({ renderKb: () => "kb" }));

const startRunWithMode = vi.hoisted(() => vi.fn());
vi.mock("@/server/lab/runner", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/lab/runner")>();
  return { ...actual, startRunWithMode };
});

import { PlaybookVersionNotFoundError, RunConflictError } from "@/server/lab/runner";
import { POST as postRuns } from "@/app/api/lab/runs/route";
import { PATCH as patchExpected } from "@/app/api/lab/cases/[id]/expected/route";
import { GET as getRunDetail } from "@/app/api/lab/runs/[id]/route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/lab/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/lab/cases/x/expected", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const k of Object.keys(db)) db[k] = [];
  currentSession = fakeSession;
  isAiConfigured.mockReset().mockReturnValue(true);
  startRunWithMode.mockReset().mockResolvedValue({ runIds: ["run_1"] });
});

describe("POST /api/lab/runs — playbook_mode (T605)", () => {
  it("sin body → usa 'published' por defecto y responde 202", async () => {
    const res = (await postRuns(
      new Request("http://localhost/api/lab/runs", { method: "POST" }))) as Response;
    expect(res.status).toBe(202);
    expect(startRunWithMode).toHaveBeenCalledWith("org_a", "published");
    const body = await res.json();
    expect(body.runId).toBe("run_1");
    expect(body.playbookMode).toBe("published");
  });

  it("acepta draft / archived:<id> / both / legacy", async () => {
    for (const mode of ["draft", "archived:spv_1", "both", "legacy"]) {
      startRunWithMode.mockClear();
      const res = (await postRuns(jsonRequest({ playbook_mode: mode }))) as Response;
      expect(res.status).toBe(202);
      expect(startRunWithMode).toHaveBeenCalledWith("org_a", mode);
    }
  });

  it("'both' devuelve los dos runIds (published + draft)", async () => {
    startRunWithMode.mockResolvedValue({ runIds: ["run_pub", "run_draft"] });
    const res = (await postRuns(jsonRequest({ playbook_mode: "both" }))) as Response;
    const body = await res.json();
    expect(res.status).toBe(202);
    expect(body.runIds).toEqual(["run_pub", "run_draft"]);
    expect(body.runId).toBe("run_pub");
  });

  it("playbook_mode inválido → 422 y NO arranca ninguna corrida", async () => {
    const res = (await postRuns(
      jsonRequest({ playbook_mode: "archivada" }))) as Response;
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("invalid_playbook_mode");
    expect(startRunWithMode).not.toHaveBeenCalled();
  });

  it("archived:<id> inexistente → 422 playbook_version_not_found", async () => {
    startRunWithMode.mockRejectedValue(
      new PlaybookVersionNotFoundError("spv_nope")
    );
    const res = (await postRuns(
      jsonRequest({ playbook_mode: "archived:spv_nope" }))) as Response;
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("playbook_version_not_found");
  });

  it("corrida en curso del mismo modo → 409 run_in_progress", async () => {
    startRunWithMode.mockRejectedValue(new RunConflictError("ocupado"));
    const res = (await postRuns(jsonRequest({ playbook_mode: "draft" }))) as Response;
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("run_in_progress");
  });

  it("IA sin configurar → 409 ai_not_configured (no toca el runner)", async () => {
    isAiConfigured.mockReturnValue(false);
    const res = (await postRuns(jsonRequest({ playbook_mode: "both" }))) as Response;
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("ai_not_configured");
    expect(startRunWithMode).not.toHaveBeenCalled();
  });

  it("body no-JSON → degrada a 'published' en vez de romper", async () => {
    const res = (await postRuns(
      new Request("http://localhost/api/lab/runs", { method: "POST" }))) as Response;
    expect(res.status).toBe(202);
    expect(startRunWithMode).toHaveBeenCalledWith("org_a", "published");
  });
});

describe("PATCH /api/lab/cases/:id/expected — outcomes esperados (T604)", () => {
  beforeEach(() => {
    db.agentTestCase!.push({
      id: "case_a",
      organizationId: "org_a",
      runId: "run_1",
      persona: "v1_academia_natacion_consultora",
      status: "done",
      expectedNextAction: null,
      expectedLane: null,
      expectedHandoff: null,
      actualNextAction: "ask_more_questions",
      actualLane: "auto",
      actualHandoff: false,
    });
  });

  it("guarda los tres outcomes esperados y los devuelve con los observados", async () => {
    const res = (await patchExpected(
      patchRequest({
        expected_next_action: "present_price",
        expected_lane: "auto",
        expected_handoff: false,
      }),
      { params: Promise.resolve({ id: "case_a" }) }
    )) as Response;
    expect(res.status).toBe(200);
    const { case: c } = await res.json();
    expect(c.expectedNextAction).toBe("present_price");
    expect(c.expectedLane).toBe("auto");
    expect(c.expectedHandoff).toBe(false);
    // Los outcomes observados NO se tocan: son del motor.
    expect(c.actualNextAction).toBe("ask_more_questions");

    const row = db.agentTestCase!.find((r) => r.id === "case_a")!;
    expect(row.expectedNextAction).toBe("present_price");
  });

  it("null limpia el esperado (la UI vuelve a mostrar '—')", async () => {
    const res = (await patchExpected(
      patchRequest({ expected_next_action: null, expected_lane: null, expected_handoff: null }),
      { params: Promise.resolve({ id: "case_a" }) }
    )) as Response;
    expect(res.status).toBe(200);
    const { case: c } = await res.json();
    expect(c.expectedNextAction).toBeNull();
    expect(c.expectedLane).toBeNull();
    expect(c.expectedHandoff).toBeNull();
  });

  it("valor fuera del catálogo cerrado del motor → 422 y no persiste", async () => {
    const res = (await patchExpected(
      patchRequest({ expected_lane: "inventada" }),
      { params: Promise.resolve({ id: "case_a" }) }
    )) as Response;
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("validation_failed");
    expect(db.agentTestCase!.find((r) => r.id === "case_a")!.expectedLane).toBeNull();
  });

  it("next_action fuera del set de 7 → 422", async () => {
    const res = (await patchExpected(
      patchRequest({ expected_next_action: "cerrar_ya" }),
      { params: Promise.resolve({ id: "case_a" }) }
    )) as Response;
    expect(res.status).toBe(422);
  });

  it("patch vacío → 422 empty_patch", async () => {
    const res = (await patchExpected(patchRequest({}), {
      params: Promise.resolve({ id: "case_a" }),
    })) as Response;
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("empty_patch");
  });

  it("caso de otra organización → 404 (tenant isolation)", async () => {
    currentSession = { user: { id: "u_b" }, organizationId: "org_b" };
    const res = (await patchExpected(patchRequest({ expected_lane: "auto" }), {
      params: Promise.resolve({ id: "case_a" }),
    })) as Response;
    expect(res.status).toBe(404);
    expect(db.agentTestCase!.find((r) => r.id === "case_a")!.expectedLane).toBeNull();
  });
});

describe("GET /api/lab/runs/:id — expone versión y outcomes (T602/T604)", () => {
  it("devuelve playbook_version_id, expected y actual por caso", async () => {
    db.agentTestRun!.push({
      id: "run_1",
      organizationId: "org_a",
      status: "done",
      score: 100,
      error: null,
      playbookMode: "draft",
      startedAt: new Date(),
      finishedAt: new Date(),
    });
    db.agentTestCase!.push({
      id: "case_a",
      organizationId: "org_a",
      runId: "run_1",
      persona: "legacy_pide_humano",
      status: "done",
      veredicto: "verde",
      hallazgos: [],
      transcript: [],
      playbookVersionId: "spv_draft",
      playbookSchemaVersion: "1.0",
      expectedNextAction: "present_price",
      expectedLane: "auto",
      expectedHandoff: false,
      actualNextAction: "present_price",
      actualLane: "auto",
      actualHandoff: false,
    });

    const res = (await getRunDetail(
      new Request("http://localhost/api/lab/runs/run_1"),
      { params: Promise.resolve({ id: "run_1" }) }
    )) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.playbookMode).toBe("draft");
    const c = body.cases[0];
    expect(c.playbookVersionId).toBe("spv_draft");
    expect(c.playbookSchemaVersion).toBe("1.0");
    // Coinciden los tres → la UI pinta ✅ en los tres.
    expect(c.expectedNextAction).toBe(c.actualNextAction);
    expect(c.expectedLane).toBe(c.actualLane);
    expect(c.expectedHandoff).toBe(c.actualHandoff);
    // Etiqueta legible tolerando el key legacy persistido.
    expect(c.personaLabel).toBe("Pide un humano");
  });

  it("corrida de otra organización → 404", async () => {
    db.agentTestRun!.push({
      id: "run_1",
      organizationId: "org_b",
      status: "done",
      startedAt: new Date(),
    });
    const res = (await getRunDetail(
      new Request("http://localhost/api/lab/runs/run_1"),
      { params: Promise.resolve({ id: "run_1" }) }
    )) as Response;
    expect(res.status).toBe(404);
  });
});
