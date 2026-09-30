import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CAPI_EVENT_NAMES,
  PARTNER_AGENT,
  buildCapiPayload,
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
 * El contrato con Meta para `business_messaging` exige:
 *
 *  - `ctwa_clid` viaja RAW (sin trim, sin lowercase, sin hashing) tal cual
 *    fue entregado por el referral de Meta.
 *  - `whatsapp_business_account_id` se envía intacto (es un identificador
 *    de cuenta comercial, no de usuario).
 *  - Body top-level `partner_agent` con la constante del proyecto.
 *  - Body con `data[]` que contiene el evento.
 *  - Acuse válido = `events_received >= 1`. Cualquier otra cosa es fallo.
 *
 * Cubre:
 *  - payload exacto (campos, action_source, messaging_channel, user_data
 *    solo con ctwa_clid + whatsapp_business_account_id);
 *  - catálogo cerrado (solo QualifiedLead / Purchase);
 *  - ctwa_clid RAW: entra como "ARAaB_clic" y sale EXACTAMENTE "ARAaB_clic";
 *  - sin hashing del ctwa_clid;
 *  - whatsapp_business_account_id sale intacto;
 *  - body top-level contiene `partner_agent === "espacio-connect"`;
 *  - body contiene `data[]` con el evento;
 *  - no aparecen phone/email/name en el payload;
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

  it("user_data SOLO lleva ctwa_clid (RAW) + WABA ID", () => {
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
    // ctwa_clid viaja EXACTAMENTE como entró: sin trim, sin lowercase, sin hashing.
    expect(payload.user_data.ctwa_clid).toBe("ClickId-ABC");
    // whatsapp_business_account_id NO se hashea.
    expect(payload.user_data.whatsapp_business_account_id).toBe("9876543210");
  });

  it("ctwa_clid viaja RAW: entra como 'ARAaB_clic' y sale EXACTAMENTE igual", () => {
    // Test principal exigido por la hotfix: el ctwa_clid NO se transforma.
    const ctwa = "ARAaB_clic";
    const payload = buildCapiPayload({
      eventName: "QualifiedLead",
      eventTime: new Date(),
      ctwaClid: ctwa,
      whatsappBusinessAccountId: "WABA-1",
      customData: { lead_stage: "qualified" },
    });
    expect(payload.user_data.ctwa_clid).toBe(ctwa);
  });

  it("NO existe hashing del ctwa_clid (no es hex SHA-256)", () => {
    // Defensa contra una regresión que reintroduzca SHA-256: nunca debe
    // salir un digest hex de 64 chars en minúsculas.
    const payload = buildCapiPayload({
      eventName: "QualifiedLead",
      eventTime: new Date(),
      ctwaClid: "ARAaB_clic",
      whatsappBusinessAccountId: "WABA-1",
      customData: { lead_stage: "qualified" },
    });
    const value = payload.user_data.ctwa_clid ?? "";
    expect(value).not.toMatch(/^[a-f0-9]{64}$/);
    expect(value).not.toMatch(/^[A-Fa-f0-9]{64}$/);
  });

  it("ctwa_clid NO sufre trim ni lowercase", () => {
    // Defensa contra trim+lowercase: case y whitespace se preservan.
    const payload = buildCapiPayload({
      eventName: "QualifiedLead",
      eventTime: new Date(),
      ctwaClid: "  ARAaB_CliC  ",
      whatsappBusinessAccountId: "W",
      customData: { lead_stage: "qualified" },
    });
    expect(payload.user_data.ctwa_clid).toBe("  ARAaB_CliC  ");
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

describe("CAPI payload - partner_agent top-level", () => {
  it("constante del proyecto es 'espacio-connect'", () => {
    expect(PARTNER_AGENT).toBe("espacio-connect");
  });

  it("body top-level contiene partner_agent === 'espacio-connect'", async () => {
    // Capturamos el body que el adapter envía a Meta y verificamos su forma.
    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({ events_received: 1, fbtrace_id: "fbtrace_1" }),
        { status: 200 }
      )
    ) as typeof fetch;
    try {
      await sendCapiEvent({
        datasetId: "DSET",
        accessToken: "tok",
        payload: buildCapiPayload({
          eventName: "QualifiedLead",
          eventTime: new Date(),
          ctwaClid: "ARAaB_clic",
          whatsappBusinessAccountId: "WABA-1",
          customData: { lead_stage: "qualified" },
        }),
      });
    } finally {
      global.fetch = originalFetch;
    }

    // Re-llamamos con un fetch espía para inspeccionar el body realmente
    // enviado. (El primer call ya consumió el mock; el segundo es el
    // que capturamos.)
    let capturedBody: unknown = null;
    const spyFetch = (async (
      _url: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> => {
      capturedBody = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(
        JSON.stringify({ events_received: 1, fbtrace_id: "fbtrace_2" }),
        { status: 200 }
      );
    }) as typeof fetch;
    global.fetch = spyFetch;
    try {
      await sendCapiEvent({
        datasetId: "DSET",
        accessToken: "tok",
        payload: buildCapiPayload({
          eventName: "QualifiedLead",
          eventTime: new Date(),
          ctwaClid: "ARAaB_clic",
          whatsappBusinessAccountId: "WABA-1",
          customData: { lead_stage: "qualified" },
        }),
      });
    } finally {
      global.fetch = originalFetch;
    }

    expect(capturedBody).not.toBeNull();
    const body = capturedBody as {
      data?: unknown[];
      partner_agent?: string;
    };
    expect(body.partner_agent).toBe("espacio-connect");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data?.length).toBe(1);
  });

  it("body contiene data[] con el evento y ctwa_clid RAW", async () => {
    let capturedBody: unknown = null;
    const originalFetch = global.fetch;
    global.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> => {
      capturedBody = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(
        JSON.stringify({ events_received: 1, fbtrace_id: "fbtrace_3" }),
        { status: 200 }
      );
    }) as typeof fetch;
    try {
      await sendCapiEvent({
        datasetId: "DSET",
        accessToken: "tok",
        payload: buildCapiPayload({
          eventName: "Purchase",
          eventTime: new Date("2026-09-29T18:00:00Z"),
          ctwaClid: "ARAaB_clic",
          whatsappBusinessAccountId: "9876543210",
          customData: { lead_stage: "won", value: 450.5, currency: "MXN" },
        }),
      });
    } finally {
      global.fetch = originalFetch;
    }

    const body = capturedBody as {
      data: Array<Record<string, unknown>>;
      partner_agent: string;
    };
    expect(body.data).toHaveLength(1);
    const event = body.data[0]!;
    expect(event.event_name).toBe("Purchase");
    expect(event.action_source).toBe("business_messaging");
    expect(event.messaging_channel).toBe("whatsapp");
    expect(event.user_data).toEqual({
      ctwa_clid: "ARAaB_clic",
      whatsapp_business_account_id: "9876543210",
    });
    expect(event.custom_data).toEqual({
      lead_stage: "won",
      value: 450.5,
      currency: "MXN",
    });
    expect(body.partner_agent).toBe("espacio-connect");
  });

  it("NO aparecen phone/email/name en el body enviado a Meta", async () => {
    let capturedBody: unknown = null;
    const originalFetch = global.fetch;
    global.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> => {
      capturedBody = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(
        JSON.stringify({ events_received: 1, fbtrace_id: "fbtrace_4" }),
        { status: 200 }
      );
    }) as typeof fetch;
    try {
      await sendCapiEvent({
        datasetId: "DSET",
        accessToken: "tok",
        payload: buildCapiPayload({
          eventName: "QualifiedLead",
          eventTime: new Date(),
          ctwaClid: "ARAaB_clic",
          whatsappBusinessAccountId: "WABA-1",
          customData: { lead_stage: "qualified" },
        }),
      });
    } finally {
      global.fetch = originalFetch;
    }

    const raw = JSON.stringify(capturedBody);
    // Defensa contra PII accidental: ni la palabra "phone" ni "email" ni
    // "name" deben aparecer como clave de user_data.
    expect(raw).not.toContain("phone");
    expect(raw).not.toContain("email");
    expect(raw).not.toContain("\"name\"");
    expect(raw).not.toContain("'name'");

    // user_data solo lleva ctwa_clid + whatsapp_business_account_id.
    const body = capturedBody as {
      data: Array<{ user_data: Record<string, unknown> }>;
    };
    const userDataKeys = Object.keys(body.data[0]!.user_data).sort();
    expect(userDataKeys).toEqual([
      "ctwa_clid",
      "whatsapp_business_account_id",
    ]);
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
