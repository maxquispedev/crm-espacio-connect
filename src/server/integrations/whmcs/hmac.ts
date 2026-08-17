import { createHmac } from "node:crypto";
import { safeEqual } from "@/server/inbox/webhook";

/** Tolerancia de reloj: ±5 minutos. */
export const WHMCS_TIMESTAMP_TOLERANCE_SEC = 5 * 60;

export type WhmcsHmacFailure = "missing_secret" | "invalid" | "expired";

export type WhmcsHmacResult =
  | { ok: true }
  | { ok: false; reason: WhmcsHmacFailure };

/**
 * HMAC SHA-256 de `<timestamp>.<rawBody>`, header `sha256=<hex>`.
 * Comparación constant-time vía `safeEqual`. Sin secreto → rechazo (no hay
 * modo "desactivado" como el webhook de Meta).
 */
export function verifyWhmcsHmac(input: {
  rawBody: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  secret: string | undefined;
  nowSec?: number;
}): WhmcsHmacResult {
  const secret = input.secret?.trim();
  if (!secret || secret.length < 16) {
    return { ok: false, reason: "missing_secret" };
  }

  const tsRaw = input.timestampHeader?.trim() ?? "";
  if (!/^[0-9]{10,12}$/.test(tsRaw)) {
    return { ok: false, reason: "invalid" };
  }
  const ts = Number(tsRaw);
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > WHMCS_TIMESTAMP_TOLERANCE_SEC) {
    return { ok: false, reason: "expired" };
  }

  const header = input.signatureHeader?.trim() ?? "";
  if (!header.toLowerCase().startsWith("sha256=")) {
    return { ok: false, reason: "invalid" };
  }
  const provided = header.slice("sha256=".length).trim().toLowerCase();
  const expected = createHmac("sha256", secret)
    .update(`${tsRaw}.${input.rawBody}`, "utf8")
    .digest("hex");
  if (!safeEqual(provided, expected)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true };
}

/** Firma un body para tests / self-test. */
export function signWhmcsPayload(
  rawBody: string,
  secret: string,
  timestampSec: number
): { timestamp: string; signature: string } {
  const timestamp = String(timestampSec);
  const signature = `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex")}`;
  return { timestamp, signature };
}
