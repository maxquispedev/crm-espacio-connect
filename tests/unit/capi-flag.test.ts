import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atribucionEnabled, isCapiEnabled } from "@/server/attribution/flag";

/**
 * Tests de la bandera `ATRIBUCION` (B12 - 007 Corte B).
 *
 * Reglas:
 *  - Apagada por defecto (cualquier valor !== 'on' ⇒ apagada).
 *  - Solo 'on' enciende.
 *  - Vacío / undefined / 'false' / 'OFF' / 'true' apagada.
 *  - Compat: `atribucionEnabled` debe devolver lo mismo que `isCapiEnabled`.
 */

describe("CAPI flag - apagada por defecto", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.ATRIBUCION;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("Sin ATRIBUCION → apagada", () => {
    expect(isCapiEnabled()).toBe(false);
  });

  it("ATRIBUCION='' → apagada", () => {
    process.env.ATRIBUCION = "";
    expect(isCapiEnabled()).toBe(false);
  });

  it("ATRIBUCION='true' → apagada (NO es 'on')", () => {
    process.env.ATRIBUCION = "true";
    expect(isCapiEnabled()).toBe(false);
  });

  it("ATRIBUCION='1' → apagada", () => {
    process.env.ATRIBUCION = "1";
    expect(isCapiEnabled()).toBe(false);
  });

  it("ATRIBUCION='OFF' → apagada", () => {
    process.env.ATRIBUCION = "OFF";
    expect(isCapiEnabled()).toBe(false);
  });

  it("ATRIBUCION='on' → encendida", () => {
    process.env.ATRIBUCION = "on";
    expect(isCapiEnabled()).toBe(true);
  });

  it("atribucionEnabled() === isCapiEnabled()", () => {
    process.env.ATRIBUCION = "on";
    expect(atribucionEnabled()).toBe(true);
    process.env.ATRIBUCION = "";
    expect(atribucionEnabled()).toBe(false);
  });
});
