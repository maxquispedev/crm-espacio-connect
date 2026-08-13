import { describe, expect, it, vi } from "vitest";
import {
  parseSyncHistoryArgs,
  runSyncHistoryCommand,
  type SyncHistoryCommandDeps,
} from "@/server/whatsapp/sync-history-command";

function deps(
  overrides: Partial<SyncHistoryCommandDeps> = {}
): SyncHistoryCommandDeps {
  return {
    findOrgBySlug: vi.fn().mockResolvedValue({
      id: "org_1",
      slug: "negocio",
      name: "Negocio",
    }),
    findOrgById: vi.fn().mockResolvedValue({
      id: "org_1",
      slug: "negocio",
      name: "Negocio",
    }),
    listConnectedOrgs: vi.fn().mockResolvedValue([
      { id: "org_1", slug: "negocio", name: "Negocio" },
    ]),
    requestSync: vi.fn().mockResolvedValue({
      ok: true,
      phoneNumberId: "PN1",
      result: {
        contacts: { ok: true, syncType: "smb_app_state_sync", requestId: "r1" },
        history: { ok: true, syncType: "history", requestId: "r2" },
      },
    }),
    ...overrides,
  };
}

describe("parseSyncHistoryArgs", () => {
  it("acepta slug e id", () => {
    expect(parseSyncHistoryArgs(["--org-slug=negocio"])).toEqual({
      orgSlug: "negocio",
    });
    expect(parseSyncHistoryArgs(["--organization-id=org_1"])).toEqual({
      organizationId: "org_1",
    });
  });

  it("sin flags → objeto vacío (usar la org única conectada)", () => {
    expect(parseSyncHistoryArgs([])).toEqual({});
  });
});

describe("runSyncHistoryCommand", () => {
  it("sin flags y una sola org conectada → dispara ambos syncs", async () => {
    const d = deps();
    const result = await runSyncHistoryCommand({}, d);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.phoneNumberId).toBe("PN1");
    expect(d.requestSync).toHaveBeenCalledWith("org_1");
  });

  it("varias orgs sin flag → ambiguous, no dispara sync", async () => {
    const d = deps({
      listConnectedOrgs: vi.fn().mockResolvedValue([
        { id: "org_1", slug: "a", name: "A" },
        { id: "org_2", slug: "b", name: "B" },
      ]),
    });
    const result = await runSyncHistoryCommand({}, d);
    expect(result.status).toBe("aborted");
    if (result.status !== "aborted") return;
    expect(result.reason).toBe("ambiguous");
    expect(d.requestSync).not.toHaveBeenCalled();
  });

  it("org sin credenciales → not_connected", async () => {
    const d = deps({
      requestSync: vi.fn().mockResolvedValue({ ok: false, code: "not_connected" }),
    });
    const result = await runSyncHistoryCommand({ orgSlug: "negocio" }, d);
    expect(result.status).toBe("aborted");
    if (result.status !== "aborted") return;
    expect(result.reason).toBe("not_connected");
  });
});
