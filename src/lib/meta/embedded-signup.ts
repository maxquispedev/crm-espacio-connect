/**
 * Parser del postMessage WA_EMBEDDED_SIGNUP (sesión de Facebook JS SDK).
 * Sin I/O: unit-testeable. No inventa IDs.
 */

const TRUSTED_HOST_SUFFIXES = [
  ".facebook.com",
  ".instagram.com",
  ".whatsapp.com",
  ".meta.com",
] as const;

const TRUSTED_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "web.facebook.com",
  "business.facebook.com",
  "staticxx.facebook.com",
  "instagram.com",
  "www.instagram.com",
  "whatsapp.com",
  "www.whatsapp.com",
  "meta.com",
  "www.meta.com",
]);

export function isTrustedMetaOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (TRUSTED_HOSTS.has(host)) return true;
    return TRUSTED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  } catch {
    return false;
  }
}

export type EmbeddedSignupSession = {
  event: string;
  wabaId: string | null;
  phoneNumberId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readId(
  bag: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const raw = bag[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  }
  return null;
}

function parsePayload(data: unknown): unknown {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
  return data;
}

/**
 * Extrae waba_id / phone_number_id del evento WA_EMBEDDED_SIGNUP.
 * Acepta `data` como objeto o JSON string (formato del SDK).
 */
export function parseEmbeddedSignupMessage(
  origin: string,
  data: unknown
): EmbeddedSignupSession | null {
  if (!isTrustedMetaOrigin(origin)) return null;
  const payload = asRecord(parsePayload(data));
  if (!payload || payload.type !== "WA_EMBEDDED_SIGNUP") return null;

  const event = typeof payload.event === "string" ? payload.event : "UNKNOWN";
  const bag = asRecord(payload.data) ?? {};
  const nested = asRecord(bag.data) ?? {};

  const wabaId =
    readId(bag, ["waba_id", "wabaId"]) ?? readId(nested, ["waba_id", "wabaId"]);
  const phoneNumberId =
    readId(bag, ["phone_number_id", "phoneNumberId"]) ??
    readId(nested, ["phone_number_id", "phoneNumberId"]);

  return { event, wabaId, phoneNumberId };
}
