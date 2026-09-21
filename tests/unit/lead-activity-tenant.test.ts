import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * onLeadActivity debe scoped por organizationId en SELECT y UPDATE.
 */

const resetFollowUpsOnInbound = vi.hoisted(() => vi.fn());
const whereArgs: unknown[] = [];

vi.mock("@/server/sales/follow-ups/store", () => ({
  resetFollowUpsOnInbound: (...args: unknown[]) =>
    resetFollowUpsOnInbound(...args),
}));

vi.mock("@/lib/db/ids", () => ({ newId: () => "ld_new" }));

vi.mock("@/lib/db/tenant", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db/tenant")>();
  return {
    ...original,
    scoped: (
      organizationColumn: unknown,
      organizationId: string,
      ...conditions: unknown[]
    ) => {
      whereArgs.push({ organizationColumn, organizationId, conditions });
      return original.scoped(
        organizationColumn as never,
        organizationId,
        ...(conditions as never[])
      );
    },
  };
});

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) {
    chain[m] = (arg?: unknown) => {
      if (m === "where" && arg !== undefined) {
        // already captured via scoped spy
      }
      return chain;
    };
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

const selectQueue: unknown[][] = [];
const updateWheres: unknown[] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    update: () => ({
      set: () => ({
        where: (clause: unknown) => {
          updateWheres.push(clause);
          return Promise.resolve([]);
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => Promise.resolve([]),
      }),
    }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy(
          {},
          { get: (_t2, col) => `${String(tableName)}.${String(col)}` }
        ),
    }
  ),
}));

describe("onLeadActivity tenant safety", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    whereArgs.length = 0;
    updateWheres.length = 0;
    resetFollowUpsOnInbound.mockReset();
  });

  it("SELECT y UPDATE de lead existente pasan organizationId vía scoped", async () => {
    selectQueue.push([{ id: "ld_1" }]);
    const { onLeadActivity } = await import("@/server/inbox/lead-activity");
    await onLeadActivity("org_tenant", "ct_1", new Date("2026-09-20T12:00:00Z"));

    expect(whereArgs.length).toBeGreaterThanOrEqual(2);
    expect(whereArgs.every((w) => (w as { organizationId: string }).organizationId === "org_tenant")).toBe(
      true
    );
    expect(resetFollowUpsOnInbound).toHaveBeenCalledWith({
      organizationId: "org_tenant",
      leadId: "ld_1",
    });
  });
});
