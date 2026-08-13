import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";

function stubBaseEnv() {
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
  vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
  vi.stubEnv("META_GRAPH_API_VERSION", "v25.0");
  vi.stubEnv("META_GRAPH_BASE_URL", "https://graph.test.local");
  vi.stubEnv("META_APP_ID", "111222333");
  vi.stubEnv("META_APP_SECRET", "app-secret-de-prueba");
  resetEnvCache();
}

describe("exchangeOAuthCode", () => {
  beforeEach(() => {
    stubBaseEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetEnvCache();
  });

  it("canje exitoso → access_token (sin loguear secretos)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "EAAG-from-code", token_type: "bearer" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { exchangeOAuthCode } = await import("@/lib/meta/client");
    const token = await exchangeOAuthCode("auth-code-ok");
    expect(token).toBe("EAAG-from-code");

    const calledUrl = String(fetchMock.mock.calls[0]![0]);
    expect(calledUrl).toContain("/oauth/access_token");
    expect(calledUrl).toContain("client_id=111222333");
    expect(calledUrl).toContain("code=auth-code-ok");
    expect(calledUrl).toContain("client_secret=app-secret-de-prueba");
    expect(calledUrl).not.toContain("Bearer");
  });

  it("code inválido → MetaApiError 4xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message: "Invalid verification code format",
              type: "OAuthException",
              code: 100,
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        )
      )
    );

    const { exchangeOAuthCode } = await import("@/lib/meta/client");
    await expect(exchangeOAuthCode("code-invalid")).rejects.toMatchObject({
      name: "MetaApiError",
      status: 400,
    });
  });

  it("respuesta Meta sin access_token → invalid_response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ token_type: "bearer" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        )
      )
    );

    const { exchangeOAuthCode } = await import("@/lib/meta/client");
    await expect(exchangeOAuthCode("code-ok")).rejects.toMatchObject({
      name: "MetaApiError",
      type: "invalid_response",
    });
  });

  it("redactOAuthPayload oculta access_token y code", async () => {
    const { redactOAuthPayload } = await import("@/lib/meta/client");
    expect(
      redactOAuthPayload({
        access_token: "EAAG-secreto",
        code: "abc",
        token_type: "bearer",
      })
    ).toEqual({
      access_token: "[redacted]",
      code: "[redacted]",
      token_type: "bearer",
    });
  });
});
