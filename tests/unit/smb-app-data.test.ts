import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetaApiError } from "@/lib/meta/client";
import { resetEnvCache } from "@/lib/env";

const { graphRequest } = vi.hoisted(() => ({
  graphRequest: vi.fn(),
}));

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...actual, graphRequest };
});

function stubEnv() {
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
  vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
  resetEnvCache();
}

describe("requestCoexistenceSync (best-effort)", () => {
  beforeEach(() => {
    stubEnv();
    graphRequest.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("pide agenda y luego historial; no loguea el token", async () => {
    graphRequest.mockResolvedValue({
      messaging_product: "whatsapp",
      request_id: "req_1",
    });
    const { requestCoexistenceSync } = await import(
      "@/server/whatsapp/smb-app-data"
    );
    const result = await requestCoexistenceSync({
      phoneNumberId: "PN1",
      token: "EAAG-super-secreto",
    });
    expect(result.contacts.ok).toBe(true);
    expect(result.history.ok).toBe(true);
    expect(graphRequest).toHaveBeenNthCalledWith(
      1,
      "PN1/smb_app_data",
      expect.objectContaining({
        method: "POST",
        body: {
          messaging_product: "whatsapp",
          sync_type: "smb_app_state_sync",
        },
      })
    );
    expect(graphRequest).toHaveBeenNthCalledWith(
      2,
      "PN1/smb_app_data",
      expect.objectContaining({
        body: {
          messaging_product: "whatsapp",
          sync_type: "history",
        },
      })
    );
    expect(JSON.stringify(result)).not.toContain("EAAG-super-secreto");
  });

  it("un fallo de Meta no lanza y deja el otro sync intentar", async () => {
    graphRequest.mockImplementation(async (_path: string, opts: { body?: { sync_type?: string } }) => {
      if (opts.body?.sync_type === "smb_app_state_sync") {
        throw new MetaApiError("Cannot sync", { status: 400, code: 100 });
      }
      return { messaging_product: "whatsapp", request_id: "req_h" };
    });
    const { requestCoexistenceSync } = await import(
      "@/server/whatsapp/smb-app-data"
    );
    const result = await requestCoexistenceSync({
      phoneNumberId: "PN1",
      token: "tok",
    });
    expect(result.contacts.ok).toBe(false);
    expect(result.contacts.error).toMatch(/Cannot sync/);
    expect(result.history.ok).toBe(true);
    expect(result.history.requestId).toBe("req_h");
  });
});
