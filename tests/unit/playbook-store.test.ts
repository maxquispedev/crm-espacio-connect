/**
 * Store del Sales Playbook — CRUD, índices parciales UNIQUE,
 * tenant isolation (cross-org → null), rollback, publish.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DraftAlreadyOpenError,
  PlaybookVersionNotFoundError,
  createDraft,
  getDraftVersionForOrg,
  getPlaybookForOrg,
  getPublishedVersionForOrg,
  getVersionById,
  listVersionsForOrg,
  publishDraft,
  rollbackToVersion,
  updateDraft,
  _countDraftsForPlaybook,
  _countPublishedForPlaybook,
} from "@/lib/sales/playbook/store";
import { VENDE_VELOZ_PLAYBOOK_V1 } from "@/lib/sales/playbook/v1";
import type { ConfigV1 } from "@/lib/sales/playbook/schema";

/* ============================================================
 * In-memory store mock con índices parciales UNIQUE
 * ============================================================ */

interface Store {
  organization: Record<string, unknown>[];
  sales_playbook: Record<string, unknown>[];
  sales_playbook_version: Record<string, unknown>[];
}

const store: Store = {
  organization: [],
  sales_playbook: [],
  sales_playbook_version: [],
};

function reset() {
  store.organization.length = 0;
  store.sales_playbook.length = 0;
  store.sales_playbook_version.length = 0;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `id_${idCounter.toString().padStart(4, "0")}`;
}

/* ============================================================
 * UNIQUE INDEX enforcement (emulado en memoria para tests)
 * ============================================================ */

function checkPublishedUnique(playbookId: string, ignoreId?: string) {
  for (const v of store.sales_playbook_version) {
    if (
      v.playbookId === playbookId &&
      v.status === "published" &&
      v.id !== ignoreId
    ) {
      throw new Error("unique_violation: sales_playbook_version_published_uq");
    }
  }
}

function checkDraftUnique(playbookId: string, ignoreId?: string) {
  for (const v of store.sales_playbook_version) {
    if (
      v.playbookId === playbookId &&
      v.status === "draft" &&
      v.id !== ignoreId
    ) {
      throw new Error("unique_violation: sales_playbook_version_draft_uq");
    }
  }
}

function checkVersionNumberUnique(
  playbookId: string,
  versionNumber: number,
  ignoreId?: string
) {
  for (const v of store.sales_playbook_version) {
    if (
      v.playbookId === playbookId &&
      v.versionNumber === versionNumber &&
      v.id !== ignoreId
    ) {
      throw new Error(
        "unique_violation: sales_playbook_version_playbook_number_uq"
      );
    }
  }
}

/* ============================================================
 * Table proxy: convierte a string → nombre de tabla real.
 * Permite usar `store[schema.salesPlaybookVersion]` directamente.
 * Convierte camelCase del schema → snake_case del store.
 * ============================================================ */

function camelToSnake(s: string): string {
  return s.replace(/([A-Z])/g, "_$1").toLowerCase();
}

function makeTableProxy(schemaName: string) {
  const snakeName = camelToSnake(schemaName);
  return new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === Symbol.toPrimitive) return () => snakeName;
        if (key === "tableName") return snakeName;
        return `${snakeName}.${String(key)}`;
      },
    }
  ) as unknown;
}

/* ============================================================
 * DB stub
 * ============================================================ */

function makeDbStub() {
  return {
    select: (selectArgs?: unknown) => {
      // Detectar `select({ n: ... })` (count) o `select({ x: max(...) })`.
      const argsObj =
        typeof selectArgs === "object" && selectArgs !== null
          ? (selectArgs as Record<string, unknown>)
          : null;
      const isCount = argsObj !== null && "n" in argsObj;
      const maxKey =
        argsObj === null
          ? null
          : Object.keys(argsObj).find(
              (k) =>
                typeof argsObj[k] === "object" &&
                argsObj[k] !== null &&
                (argsObj[k] as { fn?: string }).fn === "max"
            ) ?? null;
      return {
        from: (tableProxy: unknown) => {
          const tname = String(tableProxy) as keyof Store;
          return {
            where: (cond: unknown) => {
              const eqs = extractAllEq(cond);
              const rows = (): Record<string, unknown>[] =>
                applyEqFilters(store[tname], eqs);
              const chain = {
                limit: (n: number) => rows().slice(0, n),
                orderBy: () => rows().slice().sort(
                  (a, b) =>
                    ((b.versionNumber as number) ?? 0) -
                    ((a.versionNumber as number) ?? 0)
                ),
              };
              // Hacer el chain thenable para soportar `await` directo.
              (chain as unknown as { then: unknown }).then = (
                resolve: (v: Record<string, unknown>[]) => void
              ) => {
                if (isCount) {
                  Promise.resolve([{ n: rows().length }]).then(resolve);
                } else if (maxKey !== null) {
                  // max(versionNumber) sobre las filas filtradas.
                  const maxVal = rows().reduce(
                    (acc: number, r) =>
                      Math.max(acc, (r.versionNumber as number) ?? 0),
                    0
                  );
                  Promise.resolve([{ [maxKey]: maxVal }]).then(resolve);
                } else {
                  Promise.resolve(rows()).then(resolve);
                }
              };
              return chain;
            },
          };
        },
      };
    },
    insert: (tableProxy: unknown) => {
      const tname = String(tableProxy) as keyof Store;
      return {
        values: (row: Record<string, unknown>) => {
          if (tname === "sales_playbook_version") {
            // Índice parcial: solo bloquea si el NUEVO row tiene el
            // mismo status que un row existente del mismo playbook.
            if (row.status === "published") {
              checkPublishedUnique(
                row.playbookId as string,
                row.id as string | undefined
              );
            }
            if (row.status === "draft") {
              checkDraftUnique(
                row.playbookId as string,
                row.id as string | undefined
              );
            }
            checkVersionNumberUnique(
              row.playbookId as string,
              row.versionNumber as number,
              row.id as string | undefined
            );
          }
          store[tname].push(row);
          return {
            returning: () => Promise.resolve([row]),
          };
        },
      };
    },
    update: (tableProxy: unknown) => {
      const tname = String(tableProxy) as keyof Store;
      return {
        set: (patch: Record<string, unknown>) => {
          // Patches se aplican AL LLAMAR `.where(cond)`, no en
          // `.returning()`. Esto cubre tanto el fire-and-forget
          // (`await tx.update().set().where()` sin returning) como
          // el patrón con `.returning()`.
          const updated: Record<string, unknown>[] = [];
          const chain = {
            where: (cond: unknown) => {
              const eqs = extractAllEq(cond);
              for (const row of store[tname]) {
                const match =
                  eqs.length === 0 ||
                  eqs.every(({ col, val }) => {
                    const parts = col.split(".");
                    const colName = parts[parts.length - 1] ?? col;
                    return row[colName] === val;
                  });
                if (match) {
                  Object.assign(row, patch);
                  updated.push(row);
                }
              }
              return {
                returning: () => Promise.resolve([...updated]),
              };
            },
          };
          return chain;
        },
      };
    },
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
      const snapshot = JSON.parse(JSON.stringify(store));
      try {
        return await fn(makeDbStub());
      } catch (err) {
        store.organization = snapshot.organization;
        store.sales_playbook = snapshot.sales_playbook;
        store.sales_playbook_version = snapshot.sales_playbook_version;
        throw err;
      }
    },
  };
}

/**
 * Extrae TODOS los pares `eq(col, val)` del cond (recursivo en arrays).
 * Devuelve un array de `{col, val}` para que el stub pueda aplicar
 * filtros exactos sobre cualquier columna.
 */
function extractAllEq(cond: unknown): Array<{ col: string; val: unknown }> {
  const out: Array<{ col: string; val: unknown }> = [];
  function walk(c: unknown) {
    if (Array.isArray(c)) {
      for (const x of c) walk(x);
      return;
    }
    if (typeof c === "object" && c !== null) {
      const obj = c as Record<string, unknown>;
      if (
        typeof obj.col === "string" &&
        "val" in obj &&
        (obj.col.includes(".") || true)
      ) {
        out.push({ col: obj.col, val: obj.val });
      }
    }
  }
  walk(cond);
  return out;
}

/**
 * Aplica los filtros `eq()` extraídos del cond sobre las filas.
 * Solo matchea por igualdad exacta (no LIKE / not).
 */
function applyEqFilters(
  rows: Record<string, unknown>[],
  eqs: Array<{ col: string; val: unknown }>
): Record<string, unknown>[] {
  if (eqs.length === 0) return rows;
  return rows.filter((row) => {
    for (const { col, val } of eqs) {
      // El col tiene formato "tableName.columnName".
      const parts = col.split(".");
      const colName = parts[parts.length - 1] ?? col;
      if (row[colName] !== val) return false;
    }
    return true;
  });
}

function _extractOrgId(cond: unknown): string | null {
  const eqs = extractAllEq(cond);
  for (const { col, val } of eqs) {
    if (
      typeof val === "string" &&
      (col.includes("organization_id") || col.includes("organizationId"))
    ) {
      return val;
    }
  }
  return null;
}

function _extractId(cond: unknown): string | null {
  if (Array.isArray(cond)) {
    for (const c of cond) {
      const id = _extractId(c);
      if (id) return id;
    }
  }
  if (typeof cond === "object" && cond !== null) {
    const obj = cond as Record<string, unknown>;
    if (typeof obj.val === "string" && typeof obj.col === "string") {
      if (obj.col.endsWith(".id")) {
        return obj.val;
      }
    }
  }
  return null;
}

vi.mock("@/lib/db", () => ({
  getDb: () => makeDbStub(),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) => makeTableProxy(tableName as keyof Store),
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
  desc: (col: unknown) => ({ col, dir: "desc" }),
  max: (col: unknown) => ({ fn: "max", col }),
}));

beforeEach(() => {
  reset();
  idCounter = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/* ============================================================
 * Helpers
 * ============================================================ */

function seedOrgWithPlaybook(orgId: string) {
  store.organization.push({ id: orgId });
  const playbookId = nextId();
  store.sales_playbook.push({
    id: playbookId,
    organizationId: orgId,
    slug: "vende-veloz-365",
    label: "Test PB",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return playbookId;
}

function cloneV1(): ConfigV1 {
  return JSON.parse(JSON.stringify(VENDE_VELOZ_PLAYBOOK_V1));
}

/* ============================================================
 * Tests
 * ============================================================ */

describe("store del Sales Playbook — CRUD + invariantes", () => {
  it("getPlaybookForOrg devuelve null para org sin playbook", async () => {
    const r = await getPlaybookForOrg("org_empty");
    expect(r).toBeNull();
  });

  it("createDraft calcula version_number=max+1", async () => {
    const playbookId = seedOrgWithPlaybook("org_a");
    store.sales_playbook_version.push(
      {
        id: "id_0001",
        organizationId: "org_a",
        playbookId,
        versionNumber: 1,
        status: "archived",
      },
      {
        id: "id_0002",
        organizationId: "org_a",
        playbookId,
        versionNumber: 2,
        status: "published",
      }
    );

    const draft = await createDraft("org_a", {
      notes: "nuevo draft",
      createdBy: "user_1",
      config: cloneV1(),
    });
    expect(draft.versionNumber).toBe(3);
    expect(draft.status).toBe("draft");
  });

  it("createDraft lanza DraftAlreadyOpenError si ya hay draft abierto", async () => {
    const playbookId = seedOrgWithPlaybook("org_a");
    store.sales_playbook_version.push({
      id: "id_existing",
      organizationId: "org_a",
      playbookId,
      versionNumber: 1,
      status: "draft",
    });

    await expect(
      createDraft("org_a", {
        notes: null,
        createdBy: "user_1",
        config: cloneV1(),
      })
    ).rejects.toBeInstanceOf(DraftAlreadyOpenError);
  });

  it("createDraft crea playbook cabecera si no existe (caso bootstrap manual)", async () => {
    store.organization.push({ id: "org_new" });
    const draft = await createDraft("org_new", {
      notes: "primer draft",
      createdBy: "user_1",
      config: cloneV1(),
    });
    expect(draft.organizationId).toBe("org_new");
    expect(draft.versionNumber).toBe(1);
    expect(store.sales_playbook.length).toBe(1);
  });

  it("updateDraft solo aplica a draft; no-op si no hay draft", async () => {
    const playbookId = seedOrgWithPlaybook("org_a");
    store.sales_playbook_version.push({
      id: "id_pub",
      organizationId: "org_a",
      playbookId,
      versionNumber: 1,
      status: "published",
    });

    const r = await updateDraft("org_a", { notes: "no-op" });
    expect(r).toBeNull();

    store.sales_playbook_version.push({
      id: "id_draft",
      organizationId: "org_a",
      playbookId,
      versionNumber: 2,
      status: "draft",
      notes: "old",
    });
    const updated = await updateDraft("org_a", { notes: "new" });
    expect(updated?.notes).toBe("new");
  });

  it("publishDraft archiva la publicada actual y flipea el draft", async () => {
    const playbookId = seedOrgWithPlaybook("org_a");
    store.sales_playbook_version.push(
      {
        id: "id_pub",
        organizationId: "org_a",
        playbookId,
        versionNumber: 1,
        status: "published",
      },
      {
        id: "id_draft",
        organizationId: "org_a",
        playbookId,
        versionNumber: 2,
        status: "draft",
      }
    );

    const published = await publishDraft("org_a", "release notes", "user_1");
    expect(published.id).toBe("id_draft");
    expect(published.status).toBe("published");
    expect(published.publishedBy).toBe("user_1");

    const archived = store.sales_playbook_version.find(
      (v) => v.id === "id_pub"
    );
    expect(archived?.status).toBe("archived");

    expect(await _countPublishedForPlaybook(playbookId)).toBe(1);
    expect(await _countDraftsForPlaybook(playbookId)).toBe(0);
  });

  it("publishDraft falla si no hay draft abierto", async () => {
    seedOrgWithPlaybook("org_a");
    await expect(
      publishDraft("org_a", null, "user_1")
    ).rejects.toBeInstanceOf(PlaybookVersionNotFoundError);
  });

  it("rollbackToVersion republica una archivada y archiva la actual", async () => {
    const playbookId = seedOrgWithPlaybook("org_a");
    store.sales_playbook_version.push(
      {
        id: "id_v1",
        organizationId: "org_a",
        playbookId,
        versionNumber: 1,
        status: "archived",
        notes: "v1",
      },
      {
        id: "id_v2",
        organizationId: "org_a",
        playbookId,
        versionNumber: 2,
        status: "published",
        notes: "v2",
      }
    );

    const rolled = await rollbackToVersion(
      "org_a",
      "id_v1",
      "volver a v1",
      "user_1"
    );
    expect(rolled.id).toBe("id_v1");
    expect(rolled.status).toBe("published");

    const v2 = store.sales_playbook_version.find((v) => v.id === "id_v2");
    expect(v2?.status).toBe("archived");
    expect(await _countPublishedForPlaybook(playbookId)).toBe(1);
  });

  it("rollbackToVersion cross-org → throws PlaybookVersionNotFoundError", async () => {
    const playbookA = seedOrgWithPlaybook("org_a");
    const playbookB = seedOrgWithPlaybook("org_b");
    store.sales_playbook_version.push(
      {
        id: "id_a",
        organizationId: "org_a",
        playbookId: playbookA,
        versionNumber: 1,
        status: "archived",
      },
      {
        id: "id_b",
        organizationId: "org_b",
        playbookId: playbookB,
        versionNumber: 1,
        status: "published",
      }
    );

    await expect(
      rollbackToVersion("org_a", "id_b", null, "user_1")
    ).rejects.toBeInstanceOf(PlaybookVersionNotFoundError);
  });

  it("getVersionById cross-org → null (tenant isolation)", async () => {
    const playbookA = seedOrgWithPlaybook("org_a");
    const playbookB = seedOrgWithPlaybook("org_b");
    store.sales_playbook_version.push(
      {
        id: "id_a",
        organizationId: "org_a",
        playbookId: playbookA,
        versionNumber: 1,
        status: "published",
      },
      {
        id: "id_b",
        organizationId: "org_b",
        playbookId: playbookB,
        versionNumber: 1,
        status: "published",
      }
    );

    const cross = await getVersionById("org_a", "id_b");
    expect(cross).toBeNull();

    const own = await getVersionById("org_a", "id_a");
    expect(own).not.toBeNull();
    expect(own?.organizationId).toBe("org_a");
  });

  it("getPublishedVersionForOrg / getDraftVersionForOrg respetan tenant", async () => {
    const playbookA = seedOrgWithPlaybook("org_a");
    const playbookB = seedOrgWithPlaybook("org_b");
    store.sales_playbook_version.push(
      {
        id: "id_pub_a",
        organizationId: "org_a",
        playbookId: playbookA,
        versionNumber: 1,
        status: "published",
      },
      {
        id: "id_draft_b",
        organizationId: "org_b",
        playbookId: playbookB,
        versionNumber: 1,
        status: "draft",
      }
    );

    const pubA = await getPublishedVersionForOrg("org_a");
    expect(pubA?.id).toBe("id_pub_a");

    const draftA = await getDraftVersionForOrg("org_a");
    expect(draftA).toBeNull();

    const draftB = await getDraftVersionForOrg("org_b");
    expect(draftB?.id).toBe("id_draft_b");
  });

  it("listVersionsForOrg solo devuelve versiones del tenant", async () => {
    const playbookA = seedOrgWithPlaybook("org_a");
    const playbookB = seedOrgWithPlaybook("org_b");
    store.sales_playbook_version.push(
      {
        id: "id_a1",
        organizationId: "org_a",
        playbookId: playbookA,
        versionNumber: 1,
      },
      {
        id: "id_b1",
        organizationId: "org_b",
        playbookId: playbookB,
        versionNumber: 1,
      },
      {
        id: "id_b2",
        organizationId: "org_b",
        playbookId: playbookB,
        versionNumber: 2,
      }
    );

    const listA = await listVersionsForOrg("org_a");
    expect(listA.length).toBe(1);
    expect(listA.every((v) => v.organizationId === "org_a")).toBe(true);

    const listB = await listVersionsForOrg("org_b");
    expect(listB.length).toBe(2);
    expect(listB.every((v) => v.organizationId === "org_b")).toBe(true);
  });

  it("índice parcial UNIQUE: published único por playbook", async () => {
    const playbookId = seedOrgWithPlaybook("org_a");
    store.sales_playbook_version.push({
      id: "id_pub",
      organizationId: "org_a",
      playbookId,
      versionNumber: 1,
      status: "published",
    });
    expect(() => {
      checkPublishedUnique(playbookId, "id_new");
    }).toThrow(/published_uq/);
  });

  it("índice parcial UNIQUE: draft único por playbook", async () => {
    const playbookId = seedOrgWithPlaybook("org_a");
    store.sales_playbook_version.push({
      id: "id_d",
      organizationId: "org_a",
      playbookId,
      versionNumber: 1,
      status: "draft",
    });
    expect(() => checkDraftUnique(playbookId, "id_new")).toThrow(/draft_uq/);
  });

  it("publishDraft doble consecutivo solo deja una `published`", async () => {
    const playbookId = seedOrgWithPlaybook("org_a");

    const d1 = await createDraft("org_a", {
      notes: "v1",
      createdBy: "u1",
      config: cloneV1(),
    });
    void d1;
    await publishDraft("org_a", null, "u1");
    expect(await _countPublishedForPlaybook(playbookId)).toBe(1);

    await createDraft("org_a", {
      notes: "v2",
      createdBy: "u1",
      config: cloneV1(),
    });
    await publishDraft("org_a", null, "u1");
    expect(await _countPublishedForPlaybook(playbookId)).toBe(1);
    expect(await _countDraftsForPlaybook(playbookId)).toBe(0);
  });

  it("publishDraft concurrente: sin draft → PlaybookVersionNotFoundError", async () => {
    seedOrgWithPlaybook("org_a");
    await expect(
      publishDraft("org_a", null, "u1")
    ).rejects.toBeInstanceOf(PlaybookVersionNotFoundError);
  });
});
