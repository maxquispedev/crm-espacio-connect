/**
 * Bootstrap del Sales Playbook — cobertura multi-org determinista.
 *
 * Verifica:
 *  - 2 orgs con salesOrchestratorEnabled=true → ambas reciben su V1,
 *    cada una con su propio playbook_id / version_id. NO cruce de
 *    organization_id.
 *  - 1 org enabled + 1 disabled → solo la enabled se siembra.
 *  - Segunda ejecución del bootstrap → cero duplicados.
 *  - El enumerador de orgs NO usa LIMIT 1: enumera explícitamente
 *    por `agent_profile.salesOrchestratorEnabled=true`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { VENDE_VELOZ_PLAYBOOK_V1 } from "@/lib/sales/playbook/v1";

/* ============================================================
 * In-memory DB mock (multi-org, multi-table, determinista)
 * ============================================================ */

type Row = Record<string, unknown>;

interface Store {
  organization: Row[];
  agent_profile: Row[];
  sales_playbook: Row[];
  sales_playbook_version: Row[];
}

const store: Store = {
  organization: [],
  agent_profile: [],
  sales_playbook: [],
  sales_playbook_version: [],
};

function resetStore() {
  store.organization.length = 0;
  store.agent_profile.length = 0;
  store.sales_playbook.length = 0;
  store.sales_playbook_version.length = 0;
}

let nextIdCounter = 0;
function nextId(): string {
  nextIdCounter += 1;
  return `id_${nextIdCounter.toString().padStart(4, "0")}`;
}

/**
 * Chain reutilizable: ignora `.from/.where` y devuelve siempre
 * una promesa de las filas del store (filtradas cuando aplica).
 * Patrón thenable compatible con `db.select().from(...).where(...)`:
 * se apoya en `Promise.resolve(...).then(resolve)` para que el
 * caller pueda tanto `.limit(n)` como `await` el resultado.
 */
function makeSelectChain(tableName: keyof Store) {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: (n: number) => store[tableName].slice(0, n),
  };
  // Cast a `unknown` para evitar chequeo de la firma de `then` —
  // mismo patrón que `sales-follow-up-store.test.ts`.
  (chain as unknown as { then: unknown }).then = (
    resolve: (v: Row[]) => void
  ) => Promise.resolve(store[tableName]).then(resolve);
  return chain;
}

function makeTransactionStub() {
  return {
    insert: (tableProxy: unknown) => {
      const tname = camelToSnake(String(tableProxy)) as keyof Store;
      return {
        values: (row: Row) => {
          store[tname].push(row);
          return {
            returning: () => Promise.resolve([row]),
          };
        },
      };
    },
    select: () => ({
      from: (tableProxy: unknown) =>
        makeSelectChain(camelToSnake(String(tableProxy)) as keyof Store),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    }),
  };
}

function camelToSnake(s: string): string {
  return s.replace(/([A-Z])/g, "_$1").toLowerCase();
}

/**
 * Aplica filtros eq(col, val) extraídos del cond sobre las filas.
 */
function applyEq(
  rows: Row[],
  eqs: Array<{ col: string; val: unknown }>
): Row[] {
  if (eqs.length === 0) return rows;
  return rows.filter((row) =>
    eqs.every(({ col, val }) => {
      const parts = col.split(".");
      const colName = parts[parts.length - 1] ?? col;
      return row[colName] === val;
    })
  );
}

function extractAllEq(cond: unknown): Array<{ col: string; val: unknown }> {
  const out: Array<{ col: string; val: unknown }> = [];
  function walk(c: unknown) {
    if (Array.isArray(c)) {
      for (const x of c) walk(x);
      return;
    }
    if (typeof c === "object" && c !== null) {
      const obj = c as Record<string, unknown>;
      if (typeof obj.col === "string" && "val" in obj) {
        out.push({ col: obj.col, val: obj.val });
      }
    }
  }
  walk(cond);
  return out;
}

/**
 * Stub de DB que filtra agent_profile por `salesOrchestratorEnabled=true`
 * (vía where(eq(...))). Convierte la key del schema (camelCase) al
 * nombre real del store (snake).
 */
function makeDbStub() {
  return {
    select: () => ({
      from: (tableProxy: unknown) => {
        const tname = camelToSnake(String(tableProxy)) as keyof Store;
        const buildChain = () => {
          let eqs: Array<{ col: string; val: unknown }> = [];
          const run = () => applyEq(store[tname], eqs);
          const chain = {
            where: (cond: unknown) => {
              eqs = extractAllEq(cond);
              return chain;
            },
            limit: (n: number) => run().slice(0, n),
            then: (
              resolve: (v: Row[]) => void,
              reject?: (e: unknown) => void
            ) =>
              new Promise<Row[]>((res, rej) => {
                try {
                  res(run());
                } catch (e) {
                  if (reject) reject(e);
                  else rej(e);
                }
              }).then(resolve, reject),
          };
          return chain;
        };
        return buildChain();
      },
    }),
    insert: (tableProxy: unknown) => {
      const tname = camelToSnake(String(tableProxy)) as keyof Store;
      return {
        values: (row: Row) => {
          store[tname].push(row);
          return {
            returning: () => Promise.resolve([row]),
          };
        },
      };
    },
    transaction: async <T>(
      fn: (tx: ReturnType<typeof makeTransactionStub>) => Promise<T>
    ) => fn(makeTransactionStub()),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    }),
  };
}

vi.mock("@/lib/db", () => ({
  getDb: () => makeDbStub(),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) => {
        const snake = camelToSnake(String(tableName));
        const inner = new Proxy(
          {},
          {
            get: (_t2, col) => {
              if (col === Symbol.toPrimitive) return () => snake;
              return `${snake}.${String(col)}`;
            },
          }
        );
        return inner;
      },
    }
  ),
}));

vi.mock("@/lib/db/ids", () => ({
  newId: () => nextId(),
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ col, val }),
  and: (...args: unknown[]) => args,
  sql: (s: TemplateStringsArray) => s.join(""),
}));

beforeEach(() => {
  resetStore();
  nextIdCounter = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/* ============================================================
 * Helpers
 * ============================================================ */

function findOne<T>(arr: T[], pred: (x: T) => boolean): T | undefined {
  return arr.find(pred);
}

/* ============================================================
 * Tests
 * ============================================================ */

describe("bootstrap del Sales Playbook — multi-org determinista", () => {
  it("2 orgs con salesOrchestratorEnabled=true → ambas reciben V1 con su propio playbook_id y version_id; sin cruce de organization_id", async () => {
    store.organization.push(
      { id: "org_alpha", name: "Alpha" },
      { id: "org_beta", name: "Beta" }
    );
    store.agent_profile.push(
      {
        id: "agp_alpha",
        organizationId: "org_alpha",
        salesOrchestratorEnabled: true,
      },
      {
        id: "agp_beta",
        organizationId: "org_beta",
        salesOrchestratorEnabled: true,
      }
    );

    const { bootstrapAllEnabledOrgs } = await import(
      "@/lib/sales/playbook/bootstrap"
    );
    const result = await bootstrapAllEnabledOrgs();

    expect(result.created.slice().sort()).toEqual(["org_alpha", "org_beta"]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);

    const pbAlpha = findOne(
      store.sales_playbook,
      (r) => r.organizationId === "org_alpha"
    );
    const pbBeta = findOne(
      store.sales_playbook,
      (r) => r.organizationId === "org_beta"
    );
    expect(pbAlpha).toBeDefined();
    expect(pbBeta).toBeDefined();
    expect(pbAlpha!.id).not.toBe(pbBeta!.id);
    expect(pbAlpha!.slug).toBe("vende-veloz-365");

    const vAlpha = findOne(
      store.sales_playbook_version,
      (r) => r.organizationId === "org_alpha"
    );
    const vBeta = findOne(
      store.sales_playbook_version,
      (r) => r.organizationId === "org_beta"
    );
    expect(vAlpha).toBeDefined();
    expect(vBeta).toBeDefined();
    expect(vAlpha!.id).not.toBe(vBeta!.id);
    expect(vAlpha!.versionNumber).toBe(1);
    expect(vBeta!.versionNumber).toBe(1);

    // Ninguna versión cruza organization_id con su playbook.
    for (const v of store.sales_playbook_version) {
      const pb = findOne(
        store.sales_playbook,
        (p) => p.id === v.playbookId
      );
      expect(pb).toBeDefined();
      expect(pb!.organizationId).toBe(v.organizationId);
    }

    // El contenido sembrado es exactamente el V1 validado.
    expect(vAlpha!.schemaVersion).toBe(VENDE_VELOZ_PLAYBOOK_V1.schema_version);
    expect(vAlpha!.status).toBe("published");
    expect(vAlpha!.jevQuestionsJson).toEqual(
      VENDE_VELOZ_PLAYBOOK_V1.jev_questions
    );
  });

  it("1 org enabled + 1 disabled → solo la enabled se siembra", async () => {
    store.organization.push({ id: "org_on" }, { id: "org_off" });
    store.agent_profile.push(
      { organizationId: "org_on", salesOrchestratorEnabled: true },
      { organizationId: "org_off", salesOrchestratorEnabled: false }
    );

    const { bootstrapAllEnabledOrgs } = await import(
      "@/lib/sales/playbook/bootstrap"
    );
    const result = await bootstrapAllEnabledOrgs();

    expect(result.created).toEqual(["org_on"]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(store.sales_playbook.length).toBe(1);
    expect(store.sales_playbook[0]!.organizationId).toBe("org_on");
  });

  it("segunda ejecución del bootstrap → cero duplicados", async () => {
    store.organization.push({ id: "org_only" });
    store.agent_profile.push({
      organizationId: "org_only",
      salesOrchestratorEnabled: true,
    });

    const { bootstrapAllEnabledOrgs } = await import(
      "@/lib/sales/playbook/bootstrap"
    );

    const first = await bootstrapAllEnabledOrgs();
    expect(first.created).toEqual(["org_only"]);
    expect(store.sales_playbook.length).toBe(1);
    expect(store.sales_playbook_version.length).toBe(1);

    const second = await bootstrapAllEnabledOrgs();
    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual(["org_only"]);
    expect(store.sales_playbook.length).toBe(1);
    expect(store.sales_playbook_version.length).toBe(1);
  });

  it("3 orgs enabled y 1 disabled → todas las enabled se siembran, la disabled no", async () => {
    store.organization.push(
      { id: "org_a" },
      { id: "org_b" },
      { id: "org_c" },
      { id: "org_d" }
    );
    store.agent_profile.push(
      { organizationId: "org_a", salesOrchestratorEnabled: true },
      { organizationId: "org_b", salesOrchestratorEnabled: true },
      { organizationId: "org_c", salesOrchestratorEnabled: true },
      { organizationId: "org_d", salesOrchestratorEnabled: false }
    );

    const { bootstrapAllEnabledOrgs } = await import(
      "@/lib/sales/playbook/bootstrap"
    );
    const result = await bootstrapAllEnabledOrgs();

    expect(result.created.slice().sort()).toEqual([
      "org_a",
      "org_b",
      "org_c",
    ]);
    expect(store.sales_playbook.length).toBe(3);
    const orgsInPlaybook = store.sales_playbook
      .map((p) => p.organizationId as string)
      .sort();
    expect(orgsInPlaybook).toEqual(["org_a", "org_b", "org_c"]);
  });

  it("cero orgs con salesOrchestratorEnabled=true → created=[], skipped=[]", async () => {
    store.organization.push({ id: "org_idle" });
    store.agent_profile.push({
      organizationId: "org_idle",
      salesOrchestratorEnabled: false,
    });

    const { bootstrapAllEnabledOrgs } = await import(
      "@/lib/sales/playbook/bootstrap"
    );
    const result = await bootstrapAllEnabledOrgs();

    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(store.sales_playbook).toEqual([]);
    expect(store.sales_playbook_version).toEqual([]);
  });
});
