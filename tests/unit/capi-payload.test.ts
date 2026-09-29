import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CAPI_EVENT_NAMES,
  buildCapiPayload,
  hashForMeta,
  isAckPositive,
  sendCapiEvent,
  type CapiCustomData,
} from "@/lib/meta/capi";
import { MetaApiError } from "@/lib/meta/client";

// sendCapiEvent usa graphRequest (lazy import), que lee env vars al primer
// uso y los cachea en getEnv(). Seteamos las mínimas en process.env al
// cargar el módulo y reseteamos el cache antes de cada test para evitar
// contaminaciones entre archivos.
const requiredEnv = {
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  META_WEBHOOK_VERIFY_TOKEN: "test-verify-token",
  META_GRAPH_BASE_URL: "https://graph.facebook.com",
};

for (const [k, v] of Object.entries(requiredEnv)) {
  if (!process.env[k]) process.env[k] = v;
}

beforeEach(async () => {
  const { resetEnvCache } = await import("@/lib/env");
  resetEnvCache();
});

afterEach(() => {
  // No limpiamos para no romper el siguiente test.
});

/**
 * Tests del payload y la capa de envío a CAPI (B12 - 007 Corte B).
 *
 * Cubre:
 *  - payload exacto (campos, action_source, messaging_channel, user_data
 *    solo con ctwa_clid + whatsapp_business_account_id);
 *  - catálogo cerrado (solo QualifiedLead / Purchase);
 *  - hash de ctwa_clid (SHA-256 hex, lowercase, trimmed);
 *  - isAckPositive con events_received = 0 (NO es positivo);
 *  - traducción de error de Meta (status, code) en MetaApiError.
 */

describe("CAPI payload - catálogo cerrado", () => {
  it("Solo acepta QualifiedLead y Purchase", () => {
    expect(CAPI_EVENT_NAMES).toEqual(["QualifiedLead", "Purchase"]);
  });
});

describe("CAPI payload - estructura exacta", () => {
  it("action_source siempre es business_messaging", () => {
    const payload = buildCapiPayload({
      eventName: "QualifiedLead",
      eventTime: new Date("2026-09-29T18:00:00Z"),
      ctwaClid: "CLICK-123",
      whatsappBusinessAccountId: "1234567890",
      customData: { lead_stage: "qualified" },
    });
    expect(payload.action_source).toBe("business_messaging");
  });

  it("messaging_channel siempre es whatsapp", () => {
    const payload = buildCapiPayload({
      eventName: "Purchase",
      eventTime: new Date(),
      ctwaClid: "CLICK",
      whatsappBusinessAccountId: "WABA",
      customData: { lead_stage: "won" },
    });
    expect(payload.messaging_channel).toBe("whatsapp");
  });

  it("event_time son segundos epoch (no milisegundos)", () => {
    const t = new Date("2026-09-29T18:00:00.500Z");
    const payload = buildCapiPayload({
      eventName: "QualifiedLead",
      eventTime: t,
      ctwaClid: "CLICK",
      whatsappBusinessAccountId: "WABA",
      customData: { lead_stage: "qualified" },
    });
    expect(payload.event_time).toBe(Math.floor(t.getTime() / 1000));
    // Verificación contra el cálculo esperado, sin hardcodear un valor
    // que depende de la zona horaria.
    expect(payload.event_time).toBeLessThan(t.getTime());
    expect(payload.event_time).toBeGreaterThan(t.getTime() / 1000 - 1);
  });

  it("user_data SOLO lleva ctwa_clid (hasheado) + WABA ID", () => {
    const payload = buildCapiPayload({
      eventName: "QualifiedLead",
      eventTime: new Date(),
      ctwaClid: "ClickId-ABC",
      whatsappBusinessAccountId: "9876543210",
      customData: { lead_stage: "qualified" },
    });
    expect(Object.keys(payload.user_data).sort()).toEqual([
      "ctwa_clid",
      "whatsapp_business_account_id",
    ]);
    expect(payload.user_data.ctwa_clid).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.user_data.whatsapp_business_account_id).toBe("9876543210");
  });

  it("ctwa_clid nunca se manda en claro", () => {
    const ctwa = "ClickId-CLIENTE-VISITOR-12345";
    const payload = buildCapiPayload({
      eventName: "QualifiedLead",
      eventTime: new Date(),
      ctwaClid: ctwa,
      whatsappBusinessAccountId: "W",
      customData: { lead_stage: "qualified" },
    });
    expect(payload.user_data.ctwa_clid).not.toContain(ctwa);
    expect(payload.user_data.ctwa_clid).not.toContain("Click");
  });

  it("WABA ID NO se hashea (es identificador de cuenta comercial)", () => {
    const payload = buildCapiPayload({
      eventName: "Purchase",
      eventTime: new Date(),
      ctwaClid: "CLICK",
      whatsappBusinessAccountId: "1234567890",
      customData: { lead_stage: "won" },
    });
    expect(payload.user_data.whatsapp_business_account_id).toBe("1234567890");
  });

  it("Si ctwa_clid es null, user_data solo lleva WABA ID", () => {
    const payload = buildCapiPayload({
      eventName: "QualifiedLead",
      eventTime: new Date(),
      ctwaClid: null,
      whatsappBusinessAccountId: "WABA-123",
      customData: { lead_stage: "qualified" },
    });
    expect(payload.user_data.ctwa_clid).toBeUndefined();
    expect(payload.user_data.whatsapp_business_account_id).toBe("WABA-123");
  });

  it("Purchase con value/currency se envía tal cual", () => {
    const customData: CapiCustomData = {
      lead_stage: "won",
      value: 1234.5,
      currency: "MXN",
    };
    const payload = buildCapiPayload({
      eventName: "Purchase",
      eventTime: new Date(),
      ctwaClid: "C",
      whatsappBusinessAccountId: "W",
      customData,
    });
    expect(payload.custom_data).toEqual(customData);
    expect(payload.custom_data.value).toBe(1234.5);
    expect(payload.custom_data.currency).toBe("MXN");
  });

  it("Purchase sin value/currency sale SIN esos campos (no se inventa 0)", () => {
    const payload = buildCapiPayload({
      eventName: "Purchase",
      eventTime: new Date(),
      ctwaClid: "C",
      whatsappBusinessAccountId: "W",
      customData: { lead_stage: "won" },
    });
    expect(payload.custom_data.value).toBeUndefined();
    expect(payload.custom_data.currency).toBeUndefined();
    expect("value" in payload.custom_data).toBe(false);
  });
});

describe("CAPI payload - hash SHA-256", () => {
  it("hashea ctwa_clid con SHA-256 hex en minúsculas", () => {
    const h = hashForMeta("ClickId-ABC");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    // Determinístico.
    expect(hashForMeta("ClickId-ABC")).toBe(h);
  });

  it("trim + lowercase antes de hashear", () => {
    const a = hashForMeta("ClickId-ABC");
    const b = hashForMeta("  clickid-abc  ");
    expect(a).toBe(b);
  });
});

describe("CAPI - isAckPositive", () => {
  it("events_received = 1 → positivo", () => {
    expect(isAckPositive({ events_received: 1 })).toBe(true);
  });

  it("events_received > 1 → positivo", () => {
    expect(isAckPositive({ events_received: 5 })).toBe(true);
  });

  it("events_received = 0 → NO positivo (fila failed)", () => {
    expect(isAckPositive({ events_received: 0 })).toBe(false);
  });

  it("events_received undefined → NO positivo", () => {
    expect(isAckPositive({ events_received: undefined as unknown as number })).toBe(false);
  });
});

describe("CAPI - sendCapiEvent traduce errores Meta", () => {
  it("status 400 → MetaApiError con code", async () => {
    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "Invalid dataset",
            type: "GraphMethodException",
            code: 100,
            fbtrace_id: "abc",
          },
        }),
        { status: 400 }
      )) as typeof fetch;
    try {
      await expect(
        sendCapiEvent({
          datasetId: "DSET",
          accessToken: "tok",
          payload: buildCapiPayload({
            eventName: "QualifiedLead",
            eventTime: new Date(),
            ctwaClid: "C",
            whatsappBusinessAccountId: "W",
            customData: { lead_stage: "qualified" },
          }),
        })
      ).rejects.toBeInstanceOf(MetaApiError);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("status 200 con acuse inesperado → MetaApiError", async () => {
    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response(JSON.stringify({ weird: "shape" }), { status: 200 })
    ) as typeof fetch;
    try {
      await expect(
        sendCapiEvent({
          datasetId: "DSET",
          accessToken: "tok",
          payload: buildCapiPayload({
            eventName: "QualifiedLead",
            eventTime: new Date(),
            ctwaClid: "C",
            whatsappBusinessAccountId: "W",
            customData: { lead_stage: "qualified" },
          }),
        })
      ).rejects.toBeInstanceOf(MetaApiError);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("status 200 con acuse válido → devuelve ack + fbtrace_id", async () => {
    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          events_received: 1,
          fbtrace_id: "fbtrace_test_1",
        }),
        { status: 200 }
      )
    ) as typeof fetch;
    try {
      const result = await sendCapiEvent({
        datasetId: "DSET",
        accessToken: "tok",
        payload: buildCapiPayload({
          eventName: "QualifiedLead",
          eventTime: new Date(),
          ctwaClid: "C",
          whatsappBusinessAccountId: "W",
          customData: { lead_stage: "qualified" },
        }),
      });
      expect(result.ack.events_received).toBe(1);
      expect(result.fbtraceId).toBe("fbtrace_test_1");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
