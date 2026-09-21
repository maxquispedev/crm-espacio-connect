import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistClientHumanRequest } from "@/server/sales/explicit-handoff";

const leadPatches: Record<string, unknown>[] = [];
const whereArgs: unknown[] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        leadPatches.push(patch);
        return {
          where: (condition: unknown) => {
            whereArgs.push(condition);
            return Promise.resolve([]);
          },
        };
      },
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

describe("persistClientHumanRequest", () => {
  beforeEach(() => {
    leadPatches.length = 0;
    whereArgs.length = 0;
  });

  it("persiste lane human y humanRequestedAt de forma tenant-safe", async () => {
    await persistClientHumanRequest({
      organizationId: "org_1",
      contactId: "ct_1",
    });
    expect(leadPatches).toHaveLength(1);
    expect(leadPatches[0]?.automationLane).toBe("human");
    expect(leadPatches[0]?.humanRequestedAt).toBeInstanceOf(Date);
    expect(whereArgs).toHaveLength(1);
    expect(JSON.stringify(whereArgs[0])).toContain("org_1");
    expect(JSON.stringify(whereArgs[0])).toContain("ct_1");
  });

  it("sin lead no lanza", async () => {
    await expect(
      persistClientHumanRequest({
        organizationId: "org_missing",
        contactId: "ct_none",
      })
    ).resolves.toBeUndefined();
  });
});
