import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resetEnvCache } from "@/lib/env";
import { evaluateJev, type JevEvaluateInput } from "@/server/sales/client";
import { validJevRaw } from "./sales-fixtures";

function stubBaseEnv() {
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
  vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
}

const EMPTY_STATE: JevEvaluateInput["state"] = {
  product: {} as never,
  commercial_policy: {} as never,
  crm_state: {
    pipeline_stage: null,
    automation_lane: "auto",
    demo_shown: false,
    price_presented: false,
    payment_instructions_sent: false,
    human_requested: false,
    follow_up_count: 0,
  },
  conversation: [],
};

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

describe("evaluateJev (adapter)", () => {
  beforeEach(() => {
    stubBaseEnv();
    resetEnvCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetEnvCache();
  });

  it("configuración incompleta → not_configured y no llama fetch", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "k");
    vi.stubEnv("TYPESAFE_JEV_ENDPOINT", "");
    vi.stubEnv("JEV_MODEL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await evaluateJev({ state: EMPTY_STATE });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POST al endpoint de env, no a un path hardcodeado, y no loguea la key", async () => {
    const endpoint = "https://jev.test.example/evaluate";
    const apiKey = "test-jev-key-must-not-appear-in-logs";
    vi.stubEnv("TYPESAFE_API_KEY", apiKey);
    vi.stubEnv("TYPESAFE_JEV_ENDPOINT", endpoint);
    vi.stubEnv("JEV_MODEL", "jev-v2");
    resetEnvCache();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validJevRaw("present_price")), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await evaluateJev({
      state: {
        ...EMPTY_STATE,
        crm_state: { ...EMPTY_STATE.crm_state, pipeline_stage: "Nuevo" },
        conversation: [{ from: "lead", text: "hola" }],
      },
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toBe(endpoint);
    expect(String(fetchMock.mock.calls[0]![0])).not.toContain("/v1/systemone");
    const logged = JSON.stringify(errorSpy.mock.calls) + JSON.stringify(logSpy.mock.calls);
    expect(logged).not.toContain(apiKey);
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("el cliente no hardcodea /v1/systemone", () => {
    const src = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../src/server/sales/client.ts"
      ),
      "utf8"
    );
    expect(src).not.toMatch(/\/v1\/systemone/);
  });

  it("429 → retry → success y no espera el backoff real", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "retry-key-secret");
    vi.stubEnv("TYPESAFE_JEV_ENDPOINT", "https://jev.test.example/evaluate");
    vi.stubEnv("JEV_MODEL", "jev-v2");
    resetEnvCache();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("slow down", {
          status: 429,
          headers: { "retry-after": "2" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(validJevRaw()), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await evaluateJev({ state: EMPTY_STATE }, { sleep });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("529 → retry → success", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "k");
    vi.stubEnv("TYPESAFE_JEV_ENDPOINT", "https://jev.test.example/evaluate");
    vi.stubEnv("JEV_MODEL", "jev-v2");
    resetEnvCache();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 529 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(validJevRaw()), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await evaluateJev({ state: EMPTY_STATE }, { sleep });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("400 → no retry", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "k");
    vi.stubEnv("TYPESAFE_JEV_ENDPOINT", "https://jev.test.example/evaluate");
    vi.stubEnv("JEV_MODEL", "jev-v2");
    resetEnvCache();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response("bad request", { status: 400 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await evaluateJev({ state: EMPTY_STATE }, { sleep });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("provider_error");
    expect(result.detail).toContain("400");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("401 → no retry", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "k");
    vi.stubEnv("TYPESAFE_JEV_ENDPOINT", "https://jev.test.example/evaluate");
    vi.stubEnv("JEV_MODEL", "jev-v2");
    resetEnvCache();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response("unauthorized", { status: 401 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await evaluateJev({ state: EMPTY_STATE }, { sleep });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("provider_error");
    expect(result.detail).toContain("401");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("HTTP 200 con body inválido → invalid_response sin retry", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "k");
    vi.stubEnv("TYPESAFE_JEV_ENDPOINT", "https://jev.test.example/evaluate");
    vi.stubEnv("JEV_MODEL", "jev-v2");
    resetEnvCache();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ model: "x" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await evaluateJev({ state: EMPTY_STATE }, { sleep });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_response");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("timeout/transient → retry según política", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "k");
    vi.stubEnv("TYPESAFE_JEV_ENDPOINT", "https://jev.test.example/evaluate");
    vi.stubEnv("JEV_MODEL", "jev-v2");
    resetEnvCache();

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce(
        new Response(JSON.stringify(validJevRaw()), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await evaluateJev({ state: EMPTY_STATE }, { sleep });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("API key no se loguea en retries 429", async () => {
    const apiKey = "retry-secret-must-not-appear";
    vi.stubEnv("TYPESAFE_API_KEY", apiKey);
    vi.stubEnv("TYPESAFE_JEV_ENDPOINT", "https://jev.test.example/evaluate");
    vi.stubEnv("JEV_MODEL", "jev-v2");
    resetEnvCache();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(validJevRaw()), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await evaluateJev(
      { state: EMPTY_STATE },
      { sleep: async () => undefined }
    );

    const logged = [
      JSON.stringify(errorSpy.mock.calls),
      JSON.stringify(logSpy.mock.calls),
      JSON.stringify(infoSpy.mock.calls),
      JSON.stringify(warnSpy.mock.calls),
    ].join("");
    expect(logged).not.toContain(apiKey);
    errorSpy.mockRestore();
    logSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
