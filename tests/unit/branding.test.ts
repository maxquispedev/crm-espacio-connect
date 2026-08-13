import { describe, expect, it } from "vitest";
import {
  ACCENT_PRESETS,
  accentCssVariables,
  isValidHex,
  normalizeBranding,
  resolveAccentSet,
  resolveAccentSetDark,
} from "@/lib/branding";

describe("white-label: acento", () => {
  it("preset devuelve el set exacto del handoff", () => {
    expect(resolveAccentSet("#3f5972")).toEqual(ACCENT_PRESETS["#3f5972"]!.set);
    expect(resolveAccentSet("#5f5470").soft).toBe("#e6e1ec");
  });

  it("color personalizado deriva hover/soft/tint/text", () => {
    const s = resolveAccentSet("#7a3b5e");
    expect(isValidHex(s.hover)).toBe(true);
    expect(isValidHex(s.soft)).toBe(true);
    expect(isValidHex(s.tint)).toBe(true);
    expect(s.hover).not.toBe(s.accent);
  });

  it("color demasiado claro se oscurece para contraste con texto blanco", () => {
    const s = resolveAccentSet("#ffee88"); // amarillo pálido, ilegible con blanco
    expect(s.accent).not.toBe("#ffee88");
    // el resultado debe ser notablemente más oscuro
    const lum = parseInt(s.accent.slice(1, 3), 16);
    expect(lum).toBeLessThan(0xd0);
  });

  it("hex inválido cae al default", () => {
    expect(resolveAccentSet("rojo")).toEqual(ACCENT_PRESETS["#3f5972"]!.set);
  });
});

describe("white-label: normalización", () => {
  it("nombre vacío o nulo → default 'Vocero'; se recorta a 30", () => {
    expect(normalizeBranding(null).name).toBe("Vocero");
    expect(normalizeBranding({ name: "   " }).name).toBe("Vocero");
    expect(normalizeBranding({ name: "x".repeat(50) }).name).toHaveLength(30);
  });

  it("acento inválido → default", () => {
    expect(normalizeBranding({ accent: "azul" }).accent).toBe("#3f5972");
    expect(normalizeBranding({ accent: "#3F6B66" }).accent).toBe("#3f6b66");
  });
});

describe("white-label: acento en dark", () => {
  it("conserva el acento base y deriva soft/tint más oscuros", () => {
    const light = resolveAccentSet("#3f5972");
    const dark = resolveAccentSetDark("#3f5972");
    expect(dark.accent).toBe(light.accent);
    expect(dark.hover).toBe(light.hover);
    expect(dark.soft).not.toBe(light.soft);
    expect(dark.tint).not.toBe(light.tint);
    expect(isValidHex(dark.soft)).toBe(true);
    expect(isValidHex(dark.text)).toBe(true);
  });

  it("inyecta reglas :root:not(.dark) y :root.dark, no un :root desnudo", () => {
    const css = accentCssVariables("#3f5972");
    expect(css).toContain(":root:not(.dark){");
    expect(css).toContain(":root.dark{");
    expect(css).not.toMatch(/(?:^|[^{]):root\{/);
    expect(css).toContain("--accent-soft:");
  });
});
