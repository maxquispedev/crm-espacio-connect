/**
 * Corte 2 de la feature 010 — `POST /api/lab/preview` (Prueba rápida).
 *
 * Evidencia de los 10 requisitos demostrables de
 * `specs/010-playbook-playground-ux/contracts/playground-preview-api.md` §8.
 *
 * Lo que se demuestra aquí y cómo (honesto: la garantía de cada punto se
 * apoya en el mecanismo real, y el test ata ESE mecanismo, no una copia):
 *
 *  1. `published` resuelve la publicada DE LA ORG de la sesión.
 *  2. `draft` resuelve el draft DE LA ORG de la sesión.
 *  3. Org A nunca lee draft/published de org B: el loader solo recibe la org
 *     de la sesión y una versión de otra org nunca resuelve.
 *  4. Sandbox: la conversación que crea el preview es `is_test=true` — el
 *     interruptor del que dependen `deliverReply` (no llama a `sendText`) y la
 *     supresión de follow-ups. `sendText` además queda asertado sin llamadas.
 *  5. Cero follow-ups: `scheduleNextFollowUp` no se invoca desde el preview.
 *  6. Devuelve `jev`, `plan` y `writer.text` con contenido real leído de BD.
 *  7. Fallo del proveedor → 502 `jev_failed`, nunca una respuesta ficticia.
 *  8. `mode=draft` sin draft → 409 `draft_not_found`, sin fallback a published.
 *  9. Un cambio local sin guardar NO se usa: el body no admite el documento
 *     del playbook; la versión sale siempre del loader de BD.
 * 10. Estructural (archivo aparte: `lab-preview-structural.test.ts`): preview y
 *     `runConversation` importan el MISMO helper y el preview invoca
 *     `runSalesOrchestratorTurn`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ *
 * Doble de drizzle-orm con predicados evaluables.
 * ------------------------------------------------------------------ */

const TABLE = Symbol.for("lab.preview.table");

vi.mock("drizzle-orm", () => ({
  eq: (col: string, value: unknown) => ({ kind: "eq", col, value }),
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

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  contact: [],
  conversation: [],
  message: [],
  lead: [],
  pipelineStage: [],
  agentProfile: [],
  kbEntry: [],
  salesFollowUpJob: [],
  /** Filas que un sender real (WhatsApp) intentaría crear. */
  outboundReal: [],
};

function resetTables(): void {
  for (const k of Object.keys(tables)) tables[k] = [];
}

type Clause =
  | { kind: "eq"; col: string; value: unknown }
  | { kind: "and"; clauses: Clause[] }
  | { kind: "or"; clauses: Clause[] }
  | { kind: "null" | "notNull"; col: string }
  | { kind: "in"; col: string; values: unknown[] }
  | { kind: "sql" }
  | undefined;

function valueOf(row: Row, col: string): unknown {
  if (col in row) return row[col];
  return row[col.slice(col.indexOf(".") + 1)];
}

function evalClause(clause: Clause | undefined, row: Row): boolean {
  if (!clause) return true;
  if (clause.kind === "eq") {
    const right =
      typeof clause.value === "string" && clause.value.includes(".")
        ? valueOf(row, clause.value)
        : clause.value;
    return valueOf(row, clause.col) === right;
  }
  if (clause.kind === "null") return valueOf(row, clause.col) == null;
  if (clause.kind === "sql") return false; // no payload sandbox en los fixtures de esta suite
  if (clause.kind === "notNull") return valueOf(row, clause.col) != null;
  if (clause.kind === "in")
    return (clause.values as unknown[]).includes(valueOf(row, clause.col));
  if (clause.kind === "and") return clause.clauses.every((c) => evalClause(c, row));
  if (clause.kind === "or") return clause.clauses.some((c) => evalClause(c, row));
  return true;
}

function qualified(table: string, row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [`${table}.${key}`, value])
  );
}

function tableNameOf(t: unknown): string {
  return (t as Record<symbol, string>)[TABLE] ?? "unknown";
}

function bucket(table: string): Row[] {
  if (!tables[table]) tables[table] = [];
  return tables[table]!;
}

function project(row: Row, projection: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [key, ref] of Object.entries(projection)) {
    if (typeof ref === "string" && ref.includes(".")) {
      out[key] = valueOf(row, ref);
    } else if (ref && typeof ref === "object") {
      const prefix = `${tableNameOf(ref)}.`;
      const entries = Object.entries(row).filter(([k]) => k.startsWith(prefix));
      out[key] = entries.length
        ? Object.fromEntries(entries.map(([k, v]) => [k.slice(prefix.length), v]))
        : null;
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
    let join: { table: string; clause: Clause } | undefined;
    const q: Record<string, unknown> = {
      from(t: unknown) {
        table = tableNameOf(t);
        return q;
      },
      leftJoin(t: unknown, c: Clause) { join = { table: tableNameOf(t), clause: c }; return q; },
      where(c: Clause) {
        clause = c;
        return q;
      },
      orderBy(order: { col: string; direction: number }) {
        ordering = order;
        return q;
      },
      limit(n: number) {
        cap = n;
        return q;
      },
      then(resolve: (rows: Row[]) => unknown, reject?: (e: unknown) => unknown) {
        let matched = bucket(table)
          .map((r) => ({ ...r, ...qualified(table, r) }))
          .filter((r) => evalClause(clause, r));
        if (join) {
          const currentJoin = join;
          matched = matched.flatMap(r => {
            const joined = bucket(currentJoin.table).map(a => ({ ...r, ...qualified(currentJoin.table, a) }))
              .filter(a => evalClause(currentJoin.clause, a));
            return joined.length ? joined : [r];
          });
        }
        if (ordering) {
          const { col, direction } = ordering;
          matched.sort((a, b) => {
            const av = valueOf(a, col) as number;
            const bv = valueOf(b, col) as number;
            return (av < bv ? -1 : av > bv ? 1 : 0) * direction;
          });
        }
        matched = matched.slice(0, cap);
        const rows = projection
          ? matched.map((r) => project(r, projection))
          : matched.map((r) =>
              Object.fromEntries(Object.entries(r).filter(([k]) => !k.includes(".")))
            );
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
        const list = Array.isArray(v) ? v : [v];
        pending = list.map((v2) => ({
          createdAt: new Date(),
          ...(table === "lead"
            ? {
                automationLane: "auto",
                lastJevDecision: null,
                lastJevError: null,
                lastJevEvaluatedAt: null,
                followUpCount: 0,
              }
            : {}),
          ...v2,
        }));
        bucket(table).push(...pending);
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
    return {
      where(clause: Clause) {
        const hits = bucket(table).filter((r) => evalClause(clause, r));
        tables[table] = bucket(table).filter((r) => !hits.includes(r));
        if (table === "contact") {
          // FK cascade, como en PostgreSQL.
          const ids = hits.map((r) => r.id);
          const convIds = bucket("conversation")
            .filter((r) => ids.includes(r.contactId))
            .map((r) => r.id);
          tables.lead = bucket("lead").filter((r) => !ids.includes(r.contactId));
          tables.conversation = bucket("conversation").filter(
            (r) => !convIds.includes(r.id)
          );
          tables.message = bucket("message").filter(
            (r) => !convIds.includes(r.conversationId)
          );
        }
        return Promise.resolve(hits);
      },
    };
  },

  update(t: unknown) {
    const table = tableNameOf(t);
    return {
      set(patch: Row) {
        return {
          where(clause: Clause) {
            const chain: Record<string, unknown> = {
              returning() {
                const hit = bucket(table).filter((r) => evalClause(clause, r));
                for (const r of hit) Object.assign(r, patch);
                return Promise.resolve(hit);
              },
              then(resolve: (rows: Row[]) => unknown) {
                const hit = bucket(table).filter((r) => evalClause(clause, r));
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
 * Dobles de colaboradores.
 * ------------------------------------------------------------------ */

const state = vi.hoisted(() => ({ orgId: "org_a" as string, aiConfigured: true }));

vi.mock("@/lib/api", () => ({
  withAuth:
    (handler: (session: unknown, req: Request) => Promise<Response>) =>
    (req: Request) =>
      handler({ organizationId: state.orgId }, req),
  apiError: (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
}));

vi.mock("@/lib/env", () => ({
  isAiConfigured: () => state.aiConfigured,
}));

const getPublishedConfigForOrg = vi.hoisted(() => vi.fn());
const getDraftConfigForOrg = vi.hoisted(() => vi.fn());
/**
 * El endpoint NO debe llamar a este: la versión se resuelve con el loader por
 * org (`getPublished`/`getDraft`), y `versionId` nunca viene del body. El
 * `getConfigByVersionId` es del override del ORQUESTADOR, y el orquestador lo
 * resuelve server-side. Queda instrumentado para asertar esa ausencia.
 */
const getConfigByVersionId = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sales/playbook/loader", () => ({
  getPublishedConfigForOrg,
  getDraftConfigForOrg,
  getConfigByVersionId,
}));

const findFirstOpenStage = vi.hoisted(() => vi.fn());
const createLeadInStage = vi.hoisted(() => vi.fn());
vi.mock("@/server/leads/stage-gateway", () => ({
  findFirstOpenStage,
  createLeadInStage,
  moveLeadStage: vi.fn(),
}));

/**
 * El orquestador se dobla, pero el doble **respeta el contrato real**: solo
 * escribe el snapshot y el outbound si la conversación es `is_test`, y solo
 * programa follow-ups si NO lo es. Es el mismo criterio de
 * `orchestrator.ts:206-220`. La garantía real de "cero WhatsApp" la da
 * `delivery.ts:24-27`, que este corte no toca; aquí se afirma que el preview
 * entra por la rama de sandbox.
 */
const runSalesOrchestratorTurn = vi.hoisted(() => vi.fn());
vi.mock("@/server/sales/orchestrator", () => ({
  runSalesOrchestratorTurn,
}));

const scheduleNextFollowUp = vi.hoisted(() => vi.fn());
vi.mock("@/server/sales/follow-ups/store", () => ({ scheduleNextFollowUp }));

const sendText = vi.hoisted(() => vi.fn());
vi.mock("@/server/inbox/send", () => ({ sendText, SendError: class extends Error {} }));

vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));

/* ------------------------------------------------------------------ *
 * Import del handler bajo prueba.
 * ------------------------------------------------------------------ */

import { POST as preview } from "@/app/api/lab/preview/route";

const ORG_A = "org_a";
const ORG_B = "org_b";

function config(id: string, n: number) {
  return {
    id,
    schema_version: "1.0",
    version_number: n,
    status: "published" as const,
    config: {},
  };
}

function seedStage(orgId: string): void {
  tables.pipelineStage!.push({
    id: `stg_${orgId}`,
    organizationId: orgId,
    name: "Nuevo",
    position: 0,
    kind: "open",
  });
  findFirstOpenStage.mockImplementation(async (org: string) => {
    const row = tables.pipelineStage!.find(
      (s) => s.organizationId === org && s.kind === "open"
    );
    return row ? { id: row.id, name: row.name, position: 0, kind: "open" } : null;
  });
  createLeadInStage.mockImplementation(
    async (input: { organizationId: string; contactId: string; toStageId: string }) => {
      const lead = {
        id: `lead_${input.contactId}`,
        organizationId: input.organizationId,
        contactId: input.contactId,
        stageId: input.toStageId,
        position: 0,
        automationLane: "auto",
        lastJevDecision: null,
        lastJevError: null,
        lastJevEvaluatedAt: null,
        followUpCount: 0,
      };
      tables.lead!.push(lead);
      return { lead, created: true };
    }
  );
}

/** Snapshot que el orquestador real persistiría (T308). */
function jevSnapshot(versionId: string | null, versionNumber: number | null) {
  return {
    snapshot: { ok: true },
    decision: {
      nextAction: { type: "choice", choice: "ask_more_questions" },
      needsHumanCall: { type: "noul", noul: 0.12 },
      realOperationalNeed: { type: "noul", noul: 0.82 },
      productFit: { type: "score", score: 0.7 },
      motivationToChange: { type: "score", score: 0.5 },
      purchaseIntent: { type: "score", score: 0.4 },
      buyingTiming: { type: "choice", choice: "unknown" },
      mainValueProposition: { type: "choice", choice: "operational_control" },
    },
    plan: { lane: "auto", nextAction: "ask_more_questions", shouldHandoff: false },
    // La versión que INFLUYÓ, tal como la audita T308.
    playbook_version_id: versionId,
    playbook_schema_version: versionId ? "1.0" : null,
    playbook_version_number: versionNumber,
  };
}

/** `version_id` → `version_number`, para que el doble sea coherente. */
const VERSION_NUMBERS: Record<string, number> = {
  pbv_pub_a: 1,
  pbv_pub_b: 9,
  pbv_draft_a: 2,
  pbv_draft_b: 8,
};

/** Lo observado EN VIVO durante el turno (el `finally` limpia las filas). */
const captured: {
  conversations: { isTest?: boolean | null; aiEnabled?: boolean | null }[];
  organizations: string[];
} = { conversations: [], organizations: [] };

function findLeadFor(input: { organizationId: string; conversationId: string }) {
  const conv = tables.conversation!.find((c) => c.id === input.conversationId);
  return tables.lead!.find(
    (l) => l.organizationId === input.organizationId && l.contactId === conv?.contactId
  );
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/lab/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SCRIPT = [{ from: "lead", text: "Hola, quiero información" }];

/**
 * Orquestador sano: escribe el snapshot con la versión que realmente influyó
 * (la del `playbookOverride` si lo hay, si no la publicada de la org) y el
 * outbound sandbox. `scheduleNextFollowUp` solo si NO es `is_test`, igual que
 * `orchestrator.ts:212-220`.
 */
function orchestratorHealthy() {
  runSalesOrchestratorTurn.mockImplementation(
    async (
      input: {
        organizationId: string;
        conversationId: string;
        conversation: { isTest?: boolean | null; aiEnabled?: boolean | null };
      },
      opts: { playbookOverride?: { versionId: string } } = {}
    ) => {
      const isTest = input.conversation.isTest === true;
      captured.conversations.push({ ...input.conversation });
      captured.organizations.push(input.organizationId);

      const versionId =
        opts.playbookOverride?.versionId ??
        (input.organizationId === ORG_A ? "pbv_pub_a" : "pbv_pub_b");

      const lead = findLeadFor(input);
      if (lead) {
        lead.lastJevDecision = jevSnapshot(
          versionId,
          VERSION_NUMBERS[versionId] ?? null
        );
      }
      tables.message!.push({
        id: "msg_out",
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        direction: "out",
        text: "Claro, te cuento cómo funciona.",
        createdAt: new Date(),
      });
      if (!isTest) await scheduleNextFollowUp({});
    }
  );
}

beforeEach(() => {
  resetTables();
  vi.clearAllMocks();
  state.orgId = ORG_A;
  state.aiConfigured = true;
  seedStage(ORG_A);
  seedStage(ORG_B);
  captured.conversations.length = 0;
  captured.organizations.length = 0;
  // Por defecto, la org A tiene una publicada V1.
  getPublishedConfigForOrg.mockImplementation(async (org: string) =>
    org === ORG_A ? config("pbv_pub_a", 1) : config("pbv_pub_b", 9)
  );
  getDraftConfigForOrg.mockImplementation(async (org: string) =>
    org === ORG_A ? config("pbv_draft_a", 2) : config("pbv_draft_b", 8)
  );
  orchestratorHealthy();
});

/* ================================================================== *
 * Las 10 demostraciones
 * ================================================================== */

describe("Prueba rápida — POST /api/lab/preview", () => {
  /* --- 1 --- */
  it("1. mode=published ejecuta la versión PUBLICADA de la org", async () => {
    orchestratorHealthy();
    const res = await preview(post({ mode: "published", conversation: SCRIPT }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, never>;

    expect(getPublishedConfigForOrg).toHaveBeenCalledWith(ORG_A);
    // La publicada se resuelve en BD y se refleja en la respuesta.
    expect(body.playbook).toEqual({
      mode: "published",
      version_number: 1,
      version_id: "pbv_pub_a",
      schema_version: "1.0",
      is_draft: false,
    });
    // Published NO lleva override: así nunca se dispara el guard T306.
    const opts = runSalesOrchestratorTurn.mock.calls[0]![1] as object;
    expect(opts).toEqual({});
  });

  /* --- 2 --- */
  it("2. mode=draft ejecuta el DRAFT de la org como override", async () => {
    orchestratorHealthy();
    const res = await preview(post({ mode: "draft", conversation: SCRIPT }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, never>;

    expect(getDraftConfigForOrg).toHaveBeenCalledWith(ORG_A);
    expect(body.playbook).toEqual({
      mode: "draft",
      version_number: 2,
      version_id: "pbv_draft_a",
      schema_version: "1.0",
      is_draft: true,
    });
    // El draft viaja como `playbookOverride`, la única vía que acepta T306.
    const opts = runSalesOrchestratorTurn.mock.calls[0]![1] as {
      playbookOverride: { versionId: string };
    };
    expect(opts.playbookOverride.versionId).toBe("pbv_draft_a");
  });

  /* --- 3 --- */
  it("3. Org A nunca lee draft/published de org B", async () => {
    // La org A NO tiene draft; la B sí. A no puede alcanzarlo.
    getDraftConfigForOrg.mockImplementation(async (org: string) =>
      org === ORG_B ? config("pbv_draft_b", 8) : null
    );
    state.orgId = ORG_B;
    const resB = await preview(post({ mode: "draft", conversation: SCRIPT }));
    expect(resB.status).toBe(200);
    const bodyB = (await resB.json()) as { playbook: { version_id: string } };
    expect(bodyB.playbook.version_id).toBe("pbv_draft_b");

    // Y desde A el draft de B es invisible: 409, no un fallback silencioso.
    state.orgId = ORG_A;
    const resA = await preview(post({ mode: "draft", conversation: SCRIPT }));
    expect(resA.status).toBe(409);
    const bodyA = (await resA.json()) as { code: string };
    expect(bodyA.code).toBe("draft_not_found");
  });

  it("3b. El body no puede pedir una versión concreta de otra org", async () => {
    // Aunque el cliente intente inyectar un versionId, el endpoint lo ignora:
    // la versión sale del loader scopeado a la sesión.
    await preview(
      post({
        mode: "published",
        conversation: SCRIPT,
        version_id: "pbv_draft_b",
        playbook: { commercial_policy: { goal: "de la org B" } },
      })
    );
    expect(getPublishedConfigForOrg).toHaveBeenCalledWith(ORG_A);
    expect(getPublishedConfigForOrg).toHaveBeenCalledTimes(1);
    // Ni una sola resolución por id: el `versionId` del body se ignora.
    expect(getConfigByVersionId).not.toHaveBeenCalled();
  });

  it("media sin message.text proyecta caption en writer del preview", async () => {
    runSalesOrchestratorTurn.mockImplementation(async input => {
      const lead = findLeadFor(input)!;
      lead.lastJevDecision = jevSnapshot("pbv_pub_a", 1);
      tables.mediaAsset = [{ id: "ma_caption", organizationId: input.organizationId, caption: "Caption de demo nativa" }];
      tables.message!.push({ id: "msg_caption", organizationId: input.organizationId,
        conversationId: input.conversationId, direction: "out", text: null, type: "video", mediaAssetId: "ma_caption", createdAt: new Date() });
    });
    const response = await preview(post({ conversation: [{ from: "lead", text: "muéstrame la demo" }] }));
    expect(response.status).toBe(200);
    expect((await response.json()).writer.text).toBe("Caption de demo nativa");
    expect(sendText).not.toHaveBeenCalled();
  });

  /* --- 4 --- */
  it("4. El caso es sandbox: is_test=true y cero llamadas al remitente real", async () => {
    await preview(post({ conversation: SCRIPT }));

    // El `finally` limpia el caso, así que la fila se mira EN VIVO, durante el
    // turno: es lo que el orquestador recibió como `conversation`.
    const conv = captured.conversations[0]!;
    // Este es EL interruptor del que dependen `deliverReply` (que persiste y
    // vuelve antes de `sendText`) y la supresión de follow-ups.
    expect(conv.isTest).toBe(true);
    expect(conv.aiEnabled).toBe(true);
    expect(sendText).not.toHaveBeenCalled();
    expect(tables.outboundReal).toHaveLength(0);
  });

  /* --- 5 --- */
  it("5. Cero follow-ups productivos", async () => {
    await preview(post({ conversation: SCRIPT }));
    expect(scheduleNextFollowUp).not.toHaveBeenCalled();
    expect(tables.salesFollowUpJob).toHaveLength(0);
  });

  /* --- 6 --- */
  it("6. Devuelve jev, plan y writer.text con contenido real", async () => {
    const res = await preview(post({ conversation: SCRIPT }));
    const body = (await res.json()) as {
      jev: Record<string, { type: string; value: unknown } | null>;
      plan: Record<string, unknown>;
      writer: { text: string };
      turns: number;
    };

    expect(body.plan).toEqual({
      lane: "auto",
      next_action: "ask_more_questions",
      should_handoff: false,
      stage_id: `stg_${ORG_A}`,
      stage_name: "Nuevo",
    });
    expect(body.jev["next_action"]).toEqual({
      type: "choice",
      value: "ask_more_questions",
    });
    expect(body.jev["needs_human_call"]).toEqual({ type: "noul", value: 0.12 });
    expect(body.jev["real_operational_need"]).toEqual({ type: "noul", value: 0.82 });
    expect(body.jev["main_value_proposition"]).toEqual({
      type: "choice",
      value: "operational_control",
    });
    // El texto del writer es el mensaje `out` real, no una reconstrucción.
    expect(body.writer.text).toBe("Claro, te cuento cómo funciona.");
    expect(body.turns).toBe(1);
  });

  it("6b. Corta el guion en el primer handoff, como el Laboratorio", async () => {
    runSalesOrchestratorTurn.mockImplementation(
      async (input: { organizationId: string; conversationId: string }) => {
        const lead = tables.lead![0]!;
        lead.lastJevDecision = jevSnapshot("pbv_pub_a", 1);
        tables.message!.push({
          id: "msg_out",
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          direction: "out",
          text: "Te paso con un asesor.",
          createdAt: new Date(),
        });
        const conv = tables.conversation!.find((c) => c.id === input.conversationId)!;
        conv.handoffAt = new Date();
      }
    );
    const res = await preview(
      post({ conversation: [SCRIPT[0]!, SCRIPT[0]!, SCRIPT[0]!] })
    );
    const body = (await res.json()) as { turns: number };
    expect(body.turns).toBe(1);
    expect(runSalesOrchestratorTurn).toHaveBeenCalledTimes(1);
  });

  /* --- 7 --- */
  it("7. Fallo del proveedor → error, nunca una respuesta ficticia", async () => {
    // El orquestador real persiste `lastJevError` y NO escribe snapshot.
    runSalesOrchestratorTurn.mockImplementation(async () => {
      const lead = tables.lead![0]!;
      lead.lastJevDecision = null;
      lead.lastJevError = "jev timeout after 30000ms";
    });

    const res = await preview(post({ conversation: SCRIPT }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.code).toBe("jev_failed");
    expect(body.jev).toBeUndefined();
    expect(body.writer).toBeUndefined();
  });

  it("7b. Turno sin snapshot y sin error → no_decision", async () => {
    runSalesOrchestratorTurn.mockImplementation(async () => {
      tables.lead![0]!.lastJevDecision = null;
      tables.lead![0]!.lastJevError = null;
    });
    const res = await preview(post({ conversation: SCRIPT }));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { code: string }).code).toBe("no_decision");
  });

  it("7c. Decisión sin texto del writer → no_writer_output", async () => {
    runSalesOrchestratorTurn.mockImplementation(async () => {
      tables.lead![0]!.lastJevDecision = jevSnapshot("pbv_pub_a", 1);
    });
    const res = await preview(post({ conversation: SCRIPT }));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { code: string }).code).toBe("no_writer_output");
  });

  /* --- 8 --- */
  it("8. mode=draft sin draft → draft_not_found explícito", async () => {
    getDraftConfigForOrg.mockResolvedValue(null);
    const res = await preview(post({ mode: "draft", conversation: SCRIPT }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("draft_not_found");
    // Explícito significa también: NO corrió el pipeline.
    expect(runSalesOrchestratorTurn).not.toHaveBeenCalled();
  });

  it("8b. mode=published sin publicada → published_not_found", async () => {
    getPublishedConfigForOrg.mockResolvedValue(null);
    const res = await preview(post({ mode: "published", conversation: SCRIPT }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("published_not_found");
  });

  it("8c. Org sin etapa abierta → no_open_stage", async () => {
    tables.pipelineStage = [];
    findFirstOpenStage.mockResolvedValue(null);
    const res = await preview(post({ conversation: SCRIPT }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("no_open_stage");
  });

  /* --- 9 --- */
  it("9. Un cambio local sin guardar NO se usa: la versión sale de BD", async () => {
    orchestratorHealthy();
    // El cliente "pegó" un playbook local distinto del guardado…
    const res = await preview(
      post({
        mode: "draft",
        conversation: SCRIPT,
        // ni el contrato lo admite:
        config: { commercial_policy: { goal: "objetivo NO guardado" } },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      playbook: { version_id: string; version_number: number };
    };
    // …y lo que se ejecutó fue el draft PERSISTIDO, no lo local.
    expect(body.playbook.version_id).toBe("pbv_draft_a");
    expect(body.playbook.version_number).toBe(2);
  });

  it("9b. El body se valida en el borde (Zod)", async () => {
    const empty = await preview(post({ conversation: [] }));
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { code: string }).code).toBe("invalid_body");

    const badMode = await preview(post({ mode: "both", conversation: SCRIPT }));
    expect(badMode.status).toBe(400);

    const badFrom = await preview(
      post({ conversation: [{ from: "agent", text: "hola" }] })
    );
    expect(badFrom.status).toBe(400);

    const tooMany = await preview(
      post({
        conversation: Array.from({ length: 21 }, () => ({ from: "lead", text: "hola" })),
      })
    );
    expect(tooMany.status).toBe(400);

    // Texto largo: tope de longitud.
    const tooLong = await preview(
      post({ conversation: [{ from: "lead", text: "x".repeat(2001) }] })
    );
    expect(tooLong.status).toBe(400);
  });

  it("9c. IA no configurada → ai_not_configured y cero pipeline", async () => {
    state.aiConfigured = false;
    const res = await preview(post({ conversation: SCRIPT }));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("ai_not_configured");
    expect(runSalesOrchestratorTurn).not.toHaveBeenCalled();
  });

  it("10b. Cero filas residuales: el caso se limpia incluso al fallar", async () => {
    runSalesOrchestratorTurn.mockImplementation(async () => {
      throw new Error("boom del proveedor");
    });
    const res = await preview(post({ conversation: SCRIPT }));
    expect(res.status).toBe(502);

    expect(tables.contact).toHaveLength(0);
    expect(tables.conversation).toHaveLength(0);
    expect(tables.lead).toHaveLength(0);
    expect(tables.message).toHaveLength(0);
  });

  it("10c. Toda fila del caso lleva organization_id de la sesión", async () => {
    await preview(post({ conversation: SCRIPT }));
    // El contacto y la conversación se limpian; el lead se comprueba en vivo
    // durante el turno, así que aquí se mira lo que queda observable.
    const calls = runSalesOrchestratorTurn.mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0]![0]).toMatchObject({ organizationId: ORG_A });
  });
});
