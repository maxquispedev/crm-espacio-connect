import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetaApiError } from "@/lib/meta/client";
import { resetEnvCache } from "@/lib/env";

const { exchangeOAuthCode, graphRequest, insertedRows } = vi.hoisted(() => ({
  exchangeOAuthCode: vi.fn(),
  graphRequest: vi.fn(),
  insertedRows: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/meta/client")>();
  return {
    ...actual,
    exchangeOAuthCode,
    graphRequest,
  };
});

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertedRows.push(v);
        return { onConflictDoUpdate: () => Promise.resolve() };
      },
    }),
  }),
  schema: {
    metaCredentials: { organizationId: "organization_id" },
  },
}));

const TOKEN = "EAAG-token-super-secreto-abcd";

function stubEnv() {
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
  vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
  resetEnvCache();
}

describe("completeEmbeddedSignup", () => {
  beforeEach(() => {
    stubEnv();
    insertedRows.length = 0;
    exchangeOAuthCode.mockReset();
    graphRequest.mockReset();
    exchangeOAuthCode.mockResolvedValue(TOKEN);
    graphRequest.mockImplementation(async (path: string) => {
      if (String(path).includes("subscribed_apps")) {
        return { success: true };
      }
      return {
        display_phone_number: "+52 55 0000 0000",
        verified_name: "Max Quispe",
        id: "pn1",
      };
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("body schema exige code, wabaId y phoneNumberId (sin organizationId)", async () => {
    const { embeddedSignupBodySchema } = await import(
      "@/server/whatsapp/embedded-signup"
    );
    expect(embeddedSignupBodySchema.safeParse({}).success).toBe(false);
    expect(
      embeddedSignupBodySchema.safeParse({ code: "c", wabaId: "w" }).success
    ).toBe(false);
    const parsed = embeddedSignupBodySchema.parse({
      code: "c",
      wabaId: "w",
      phoneNumberId: "p",
      organizationId: "org_atacante",
    });
    expect(parsed).toEqual({ code: "c", wabaId: "w", phoneNumberId: "p" });
    expect("organizationId" in parsed).toBe(false);
  });

  it("guarda cifrado scoped a organizationId de sesión y no devuelve el token", async () => {
    const { completeEmbeddedSignup } = await import(
      "@/server/whatsapp/embedded-signup"
    );
    const result = await completeEmbeddedSignup({
      organizationId: "org_A",
      code: "auth-code",
      wabaId: "WABA1",
      phoneNumberId: "PN1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokenLast4).toBe("abcd");
    expect(result.displayPhoneNumber).toBe("+52 55 0000 0000");
    expect(JSON.stringify(result)).not.toContain(TOKEN);

    expect(insertedRows).toHaveLength(1);
    const row = insertedRows[0]!;
    expect(row.organizationId).toBe("org_A");
    expect(row.wabaId).toBe("WABA1");
    expect(row.phoneNumberId).toBe("PN1");
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    expect(row.tokenCipher).toBeTruthy();

    expect(graphRequest).toHaveBeenCalledWith(
      "WABA1/subscribed_apps",
      expect.objectContaining({ method: "POST", token: TOKEN })
    );
  });

  it("onboarding de org A no escribe org B", async () => {
    const { completeEmbeddedSignup } = await import(
      "@/server/whatsapp/embedded-signup"
    );
    await completeEmbeddedSignup({
      organizationId: "org_A",
      code: "c",
      wabaId: "W1",
      phoneNumberId: "P1",
    });
    expect(insertedRows[0]?.organizationId).toBe("org_A");
    expect(insertedRows[0]?.organizationId).not.toBe("org_B");
  });

  it("OAuth fallido no guarda", async () => {
    exchangeOAuthCode.mockRejectedValue(
      new MetaApiError("Invalid verification code format", { status: 400, code: 100 })
    );
    const { completeEmbeddedSignup } = await import(
      "@/server/whatsapp/embedded-signup"
    );
    const result = await completeEmbeddedSignup({
      organizationId: "org_A",
      code: "code-invalid",
      wabaId: "W1",
      phoneNumberId: "P1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("oauth_failed");
    expect(insertedRows).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("fallo de Graph (número) no guarda", async () => {
    graphRequest.mockRejectedValue(
      new MetaApiError("Invalid OAuth access token", { status: 401, code: 190 })
    );
    const { completeEmbeddedSignup } = await import(
      "@/server/whatsapp/embedded-signup"
    );
    const result = await completeEmbeddedSignup({
      organizationId: "org_A",
      code: "c",
      wabaId: "W1",
      phoneNumberId: "P1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_token");
    expect(insertedRows).toHaveLength(0);
  });

  it("subscribed_apps obligatorio: si falla, no queda conectado", async () => {
    graphRequest.mockImplementation(async (path: string) => {
      if (String(path).includes("subscribed_apps")) {
        throw new MetaApiError("Cannot subscribe app", { status: 400, code: 100 });
      }
      return {
        display_phone_number: "+52 55 0000 0000",
        verified_name: "Max",
        id: "pn1",
      };
    });
    const { completeEmbeddedSignup } = await import(
      "@/server/whatsapp/embedded-signup"
    );
    const result = await completeEmbeddedSignup({
      organizationId: "org_A",
      code: "c",
      wabaId: "WABA-NOSUB",
      phoneNumberId: "P1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("subscribe_failed");
    expect(insertedRows).toHaveLength(0);
  });
});
