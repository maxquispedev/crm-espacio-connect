/**
 * Preferencia de apariencia del usuario (dispositivo), independiente de la org.
 * Cookie legible en SSR + script blocking para resolver `system` sin FOUC.
 */

export const THEME_COOKIE = "vocero.theme";
export const THEME_RESOLVED_COOKIE = "vocero.theme-resolved";
export const THEME_MAX_AGE = 60 * 60 * 24 * 365;

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;

export function isThemePreference(
  value: string | undefined | null
): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function parseThemePreference(
  value: string | undefined | null
): ThemePreference {
  return isThemePreference(value) ? value : "system";
}

export function isResolvedTheme(
  value: string | undefined | null
): value is ResolvedTheme {
  return value === "light" || value === "dark";
}

/**
 * Resuelve la clase `dark` para SSR: light/dark explícitos; `system` usa la
 * última resolución persistida (el script la actualiza) o claro por defecto.
 */
export function resolvedThemeFromCookies(
  preference: ThemePreference,
  resolvedCookie: string | undefined | null
): ResolvedTheme {
  if (preference === "light" || preference === "dark") return preference;
  return isResolvedTheme(resolvedCookie) ? resolvedCookie : "light";
}

export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean
): ResolvedTheme {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}

function cookieHeader(name: string, value: string): string {
  return `${name}=${value}; Path=/; Max-Age=${THEME_MAX_AGE}; SameSite=Lax`;
}

export function themeCookieHeader(preference: ThemePreference): string {
  return cookieHeader(THEME_COOKIE, preference);
}

export function resolvedCookieHeader(resolved: ResolvedTheme): string {
  return cookieHeader(THEME_RESOLVED_COOKIE, resolved);
}

function readCookie(name: string): string {
  const parts = `; ${document.cookie}`.split(`; ${name}=`);
  if (parts.length < 2) return "";
  return parts.pop()?.split(";").shift() ?? "";
}

/** Aplica clase `dark` + color-scheme sin tocar otras clases (p. ej. la fuente). */
export function applyResolvedClass(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
}

export function applyThemePreference(preference: ThemePreference): void {
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveTheme(preference, systemDark);
  document.cookie = themeCookieHeader(preference);
  document.cookie = resolvedCookieHeader(resolved);
  applyResolvedClass(resolved);
}

export function readThemePreference(): ThemePreference {
  return parseThemePreference(readCookie(THEME_COOKIE));
}

/**
 * Script blocking para `<head>`. Usa classList (no reemplaza className) para
 * conservar `--font-geist`. Actualiza la cookie resuelta para el siguiente SSR.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var c=document.cookie;function g(n){var p="; "+c;var s=p.split("; "+n+"=");if(s.length<2)return "";return s.pop().split(";").shift()}var p=g("${THEME_COOKIE}");if(p!=="light"&&p!=="dark"&&p!=="system")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=d?"dark":"light";document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=r;document.cookie="${THEME_RESOLVED_COOKIE}="+r+"; Path=/; Max-Age=${THEME_MAX_AGE}; SameSite=Lax"}catch(e){}})();`;
