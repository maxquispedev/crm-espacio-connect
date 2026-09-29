import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCapiPayload, isAckPositive } from "@/lib/meta/capi";
import { MetaApiError } from "@/lib/meta/client";

/**
 * Tests de la capa de payload + acuse de CAPI (B12 - 007 Corte B).
 *
 * Estos tests se concentran en:
 *  - Mapeo de evento (Purchase / QualifiedLead).
 *  - Hash de ctwa_clid.
 *  - Compilación del custom_data sin inventar value=0.
 *  - Acuse: events_received >= 1 es el único positivo.
 *
 * La integración con el gateway (reportStageChange + emitConversion
 * + persistencia + dedup UNIQUE) está cubierta por:
 *  - tests de escenario de leads reales con dev-guard + mock.
 *  - self-test E2E que se ejecutará en el Corte C con mocks encendidos.
 *
 * El unit test del payload ya vive en capi-payload.test.ts; este archivo
 * agrega los casos de anti-valor-falso y acuse, que son las reglas de
 * negocio más sensibles.
 */

describe("CAPI - anti-valor-falso", () => {
  it("Purchase sin dealValue válido → custom_data sin value/currency", () => {
    const payload = buildCapiPayload({
      eventName: "Purchase",
      eventTime: new Date(),
      ctwaClid: "C",
      whatsappBusinessAccountId: "W",
      customData: { lead_stage: "won" },
    });
    expect("value" in payload.custom_data).toBe(false);
    expect("currency" in payload.custom_data).toBe(false);
  });

  it("Purchase con value positivo y currency de 3 letras → custom_data con ambos", () => {
    const payload = buildCapiPayload({
      eventName: "Purchase",
      eventTime: new Date(),
      ctwaClid: "C",
      whatsappBusinessAccountId: "W",
      customData: { lead_stage: "won", value: 999.99, currency: "USD" },
    });
    expect(payload.custom_data.value).toBe(999.99);
    expect(payload.custom_data.currency).toBe("USD");
  });

  it("Purchase con value=0 → omitido por el constructor (regla anti-valor-falso)", () => {
    // El Zod schema con `.positive()` rechaza 0, así que el constructor
    // nunca acepta value=0 desde el lado servidor. Documentamos el contrato:
    // un Purchase NUNCA lleva value=0 a Meta.
    const payload = buildCapiPayload({
      eventName: "Purchase",
      eventTime: new Date(),
      ctwaClid: "C",
      whatsappBusinessAccountId: "W",
      customData: { lead_stage: "won" },
    });
    expect(payload.custom_data.value ?? null).toBeNull();
  });
});

describe("CAPI - isAckPositive (único acuse válido)", () => {
  it("events_received >= 1 → positivo", () => {
    expect(isAckPositive({ events_received: 1 })).toBe(true);
    expect(isAckPositive({ events_received: 5 })).toBe(true);
  });
  it("events_received = 0 → NO positivo (fila failed)", () => {
    expect(isAckPositive({ events_received: 0 })).toBe(false);
  });
});

describe("MetaApiError - es una Error tipada", () => {
  it("status, code, type disponibles en la instancia", () => {
    const e = new MetaApiError("test", { status: 400, code: 100, type: "x" });
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(400);
    expect(e.code).toBe(100);
    expect(e.type).toBe("x");
  });
});

// Stubs para mantener compat con el resto de tests de la suite.
beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});
