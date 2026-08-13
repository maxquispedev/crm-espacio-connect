import { describe, expect, it } from "vitest";
import {
  parseThemePreference,
  resolveTheme,
  resolvedThemeFromCookies,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_COOKIE,
  THEME_RESOLVED_COOKIE,
} from "@/lib/theme";

describe("tema: preferencia", () => {
  it("parsea light/dark/system y cae a system si es inválido", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference(undefined)).toBe("system");
    expect(parseThemePreference("oscuro")).toBe("system");
  });

  it("system sigue prefers-color-scheme; light/dark son explícitos", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("SSR: light/dark ignoran la cookie resuelta; system la usa", () => {
    expect(resolvedThemeFromCookies("dark", "light")).toBe("dark");
    expect(resolvedThemeFromCookies("light", "dark")).toBe("light");
    expect(resolvedThemeFromCookies("system", "dark")).toBe("dark");
    expect(resolvedThemeFromCookies("system", undefined)).toBe("light");
  });

  it("el script blocking usa classList y las cookies de tema", () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("classList.toggle");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(THEME_COOKIE);
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(THEME_RESOLVED_COOKIE);
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("prefers-color-scheme: dark");
  });
});
