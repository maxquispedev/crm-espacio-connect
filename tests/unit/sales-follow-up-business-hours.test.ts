import { afterEach, describe, expect, it } from "vitest";
import {
  BUSINESS_HOURS_END_MINUTE,
  BUSINESS_HOURS_START_MINUTE,
  FOLLOW_UP_TIME_ZONE,
  OUTSIDE_BUSINESS_HOURS,
  applyBusinessHours,
  isAutomaticFollowUpReason,
  isWithinBusinessHours,
  nextAllowedInstant,
} from "@/server/sales/follow-ups/business-hours";

/**
 * 018 — Ventana comercial de follow-ups automáticos.
 *
 * `America/Lima` es UTC-5 todo el año (sin horario de verano), así que las
 * horas locales son fijas y estas cadenas se pueden leer a ojo:
 * 08:59 local = 13:59Z · 09:00 = 14:00Z · 19:59 = 00:59Z+1 · 20:00 = 01:00Z+1
 * · 02:00 = 07:00Z · 07:40 = 12:40Z.
 */
const lima = (iso: string) => new Date(iso);

const TZ_ENV = process.env.TZ;
const OPERATOR_TZ_ENV = process.env.OPERATOR_TIMEZONE;

afterEach(() => {
  if (TZ_ENV === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_ENV;
  if (OPERATOR_TZ_ENV === undefined) delete process.env.OPERATOR_TIMEZONE;
  else process.env.OPERATOR_TIMEZONE = OPERATOR_TZ_ENV;
});

describe("018 · ventana comercial", () => {
  it("la zona es America/Lima y la ventana es [09:00, 20:00)", () => {
    expect(FOLLOW_UP_TIME_ZONE).toBe("America/Lima");
    expect(BUSINESS_HOURS_START_MINUTE).toBe(9 * 60);
    expect(BUSINESS_HOURS_END_MINUTE).toBe(20 * 60);
    expect(OUTSIDE_BUSINESS_HOURS).toBe("outside_business_hours");
  });

  it("08:59 → el próximo instante permitido es 09:00 del mismo día", () => {
    const at = lima("2026-09-20T13:59:00Z"); // 08:59 local
    expect(isWithinBusinessHours(at)).toBe(false);
    expect(nextAllowedInstant(at).toISOString()).toBe("2026-09-20T14:00:00.000Z");
  });

  it("09:00 exacto sí se permite (límite inferior incluido)", () => {
    const at = lima("2026-09-20T14:00:00Z");
    expect(isWithinBusinessHours(at)).toBe(true);
    expect(nextAllowedInstant(at).toISOString()).toBe("2026-09-20T14:00:00.000Z");
  });

  it("15:00 y 19:59 se permiten sin moverse", () => {
    expect(isWithinBusinessHours(lima("2026-09-20T20:00:00Z"))).toBe(true); // 15:00
    expect(nextAllowedInstant(lima("2026-09-20T20:00:00Z")).toISOString()).toBe(
      "2026-09-20T20:00:00.000Z"
    );
    const late = lima("2026-09-21T00:59:59.500Z"); // 19:59:59.500 local
    expect(isWithinBusinessHours(late)).toBe(true);
    expect(nextAllowedInstant(late).toISOString()).toBe("2026-09-21T00:59:59.500Z");
  });

  it("20:00 y 20:01 quedan fuera: el límite superior es EXCLUSIVO", () => {
    const at20 = lima("2026-09-21T01:00:00Z"); // 20:00 local
    expect(isWithinBusinessHours(at20)).toBe(false);
    expect(nextAllowedInstant(at20).toISOString()).toBe("2026-09-21T14:00:00.000Z");

    const at2001 = lima("2026-09-21T01:01:00Z"); // 20:01 local
    expect(isWithinBusinessHours(at2001)).toBe(false);
    expect(nextAllowedInstant(at2001).toISOString()).toBe("2026-09-21T14:00:00.000Z");
  });

  it("madrugada y primera hora se difieren a las 09:00 del mismo día", () => {
    expect(nextAllowedInstant(lima("2026-09-20T07:00:00Z")).toISOString()).toBe(
      "2026-09-20T14:00:00.000Z"
    ); // 02:00 local
    expect(nextAllowedInstant(lima("2026-09-20T12:40:00Z")).toISOString()).toBe(
      "2026-09-20T14:00:00.000Z"
    ); // 07:40 local
    expect(nextAllowedInstant(lima("2026-09-20T14:00:00Z")).toISOString()).toBe(
      "2026-09-20T14:00:00.000Z"
    ); // 09:00 local: no se mueve
  });

  it("cruce de día, de mes y de año", () => {
    // 23:59 local → 09:00 del día siguiente
    expect(nextAllowedInstant(lima("2026-09-21T04:59:00Z")).toISOString()).toBe(
      "2026-09-21T14:00:00.000Z"
    );
    // Última noche del mes: 20:30 local del 30 → 09:00 local del 31.
    expect(nextAllowedInstant(lima("2026-10-01T01:30:00Z")).toISOString()).toBe(
      "2026-10-01T14:00:00.000Z"
    );
    // Y al revés: 23:59 local del 30 (2026-10-01T04:59Z) → 09:00 del 31, con la
    // fecha local precisa aunque el timestamp UTC ya sea del mes siguiente.
    expect(nextAllowedInstant(lima("2026-10-01T04:59:00Z")).toISOString()).toBe(
      "2026-10-01T14:00:00.000Z"
    );
    // Fin de año: 20:30 local del 31 → 09:00 local del 1 de enero.
    expect(nextAllowedInstant(lima("2027-01-01T01:30:00Z")).toISOString()).toBe(
      "2027-01-01T14:00:00.000Z"
    );
  });

  it("un timestamp UTC de madrugada en Lima se reconoce como noche", () => {
    // 2026-03-10T02:00Z son las 21:00 del 9 en Lima: fuera de ventana, y el
    // desfase hace que el día local sea el anterior al del timestamp.
    const night = lima("2026-03-10T02:00:00Z");
    expect(isWithinBusinessHours(night)).toBe(false);
    expect(nextAllowedInstant(night).toISOString()).toBe("2026-03-10T14:00:00.000Z");

    // 2026-03-10T12:00Z son las 07:00 del 10 en Lima: 09:00 del MISMO día local.
    const dawn = lima("2026-03-10T12:00:00Z");
    expect(isWithinBusinessHours(dawn)).toBe(false);
    expect(nextAllowedInstant(dawn).toISOString()).toBe("2026-03-10T14:00:00.000Z");

    // 2026-03-10T14:00Z son las 09:00 exactas de Lima.
    expect(isWithinBusinessHours(lima("2026-03-10T14:00:00Z"))).toBe(true);
  });

  it("el normalizado es idempotente y conserva milisegundos", () => {
    const once = nextAllowedInstant(lima("2026-09-20T07:00:00.123Z"));
    expect(once.toISOString()).toBe("2026-09-20T14:00:00.123Z");
    expect(nextAllowedInstant(once).getTime()).toBe(once.getTime());
  });

  it("el veredicto NO depende de la zona del proceso ni de OPERATOR_TIMEZONE", () => {
    process.env.TZ = "Asia/Tokyo";
    process.env.OPERATOR_TIMEZONE = "Europe/Madrid";
    const night = lima("2026-09-20T07:00:00Z"); // 02:00 Lima / 16:00 Tokio
    expect(isWithinBusinessHours(night)).toBe(false);
    expect(nextAllowedInstant(night).toISOString()).toBe("2026-09-20T14:00:00.000Z");
  });

  it("invierno y verano dan lo mismo: 09:00 local siempre es 14:00Z", () => {
    // Lima no tiene horario de verano; la ventana no se mueve con las estaciones.
    expect(nextAllowedInstant(lima("2026-01-14T08:00:00Z")).toISOString()).toBe(
      "2026-01-14T14:00:00.000Z"
    );
    expect(nextAllowedInstant(lima("2026-07-14T08:00:00Z")).toISOString()).toBe(
      "2026-07-14T14:00:00.000Z"
    );
  });
});

describe("018 · qué razones cubre la política", () => {
  it("las automáticas sí; scheduled_wait es fecha del operador", () => {
    expect(isAutomaticFollowUpReason("awaiting_reply")).toBe(true);
    expect(isAutomaticFollowUpReason("after_demo")).toBe(true);
    expect(isAutomaticFollowUpReason("after_price")).toBe(true);
    expect(isAutomaticFollowUpReason("scheduled_wait")).toBe(false);
  });

  it("applyBusinessHours normaliza las automáticas y respeta la manual", () => {
    const threeAm = lima("2026-09-20T08:00:00Z"); // 03:00 local
    for (const reason of ["awaiting_reply", "after_demo", "after_price"] as const) {
      expect(applyBusinessHours(reason, threeAm).toISOString()).toBe(
        "2026-09-20T14:00:00.000Z"
      );
    }
    // El operador que eligió las 03:00 sigue obtiéndolas: no es decisión de la máquina.
    expect(applyBusinessHours("scheduled_wait", threeAm).toISOString()).toBe(
      "2026-09-20T08:00:00.000Z"
    );
  });

  it("applyBusinessHours no toca un due_at ya válido", () => {
    const good = lima("2026-09-20T20:30:00Z"); // 15:30 local
    expect(applyBusinessHours("awaiting_reply", good).getTime()).toBe(good.getTime());
    expect(applyBusinessHours("scheduled_wait", good).getTime()).toBe(good.getTime());
  });
});