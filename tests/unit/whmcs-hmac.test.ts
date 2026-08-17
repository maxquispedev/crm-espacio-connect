import { describe, expect, it } from "vitest";
import {
  signWhmcsPayload,
  verifyWhmcsHmac,
  WHMCS_TIMESTAMP_TOLERANCE_SEC,
} from "@/server/integrations/whmcs/hmac";

const SECRET = "whmcs-secret-de-prueba-32ch";
const BODY = JSON.stringify({ event: "invoice.created", invoiceId: 1296 });

describe("verifyWhmcsHmac", () => {
  it("firma válida dentro de la ventana → ok", () => {
    const now = 1_700_000_000;
    const { timestamp, signature } = signWhmcsPayload(BODY, SECRET, now);
    expect(
      verifyWhmcsHmac({
        rawBody: BODY,
        timestampHeader: timestamp,
        signatureHeader: signature,
        secret: SECRET,
        nowSec: now,
      })
    ).toEqual({ ok: true });
  });

  it("firma inválida → invalid", () => {
    const now = 1_700_000_000;
    const { timestamp } = signWhmcsPayload(BODY, SECRET, now);
    expect(
      verifyWhmcsHmac({
        rawBody: BODY,
        timestampHeader: timestamp,
        signatureHeader: "sha256=deadbeef",
        secret: SECRET,
        nowSec: now,
      })
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("timestamp expirado → expired", () => {
    const now = 1_700_000_000;
    const old = now - WHMCS_TIMESTAMP_TOLERANCE_SEC - 1;
    const { timestamp, signature } = signWhmcsPayload(BODY, SECRET, old);
    expect(
      verifyWhmcsHmac({
        rawBody: BODY,
        timestampHeader: timestamp,
        signatureHeader: signature,
        secret: SECRET,
        nowSec: now,
      })
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("timestamp futuro fuera de tolerancia → expired", () => {
    const now = 1_700_000_000;
    const future = now + WHMCS_TIMESTAMP_TOLERANCE_SEC + 5;
    const { timestamp, signature } = signWhmcsPayload(BODY, SECRET, future);
    const result = verifyWhmcsHmac({
        rawBody: BODY,
        timestampHeader: timestamp,
        signatureHeader: signature,
        secret: SECRET,
        nowSec: now,
      });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("header ausente o secreto corto → no procesa", () => {
    expect(
      verifyWhmcsHmac({
        rawBody: BODY,
        timestampHeader: "1700000000",
        signatureHeader: null,
        secret: SECRET,
        nowSec: 1_700_000_000,
      })
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      verifyWhmcsHmac({
        rawBody: BODY,
        timestampHeader: "1700000000",
        signatureHeader: "sha256=ab",
        secret: undefined,
        nowSec: 1_700_000_000,
      })
    ).toEqual({ ok: false, reason: "missing_secret" });
  });

  it("body distinto al firmado → invalid", () => {
    const now = 1_700_000_000;
    const { timestamp, signature } = signWhmcsPayload(BODY, SECRET, now);
    expect(
      verifyWhmcsHmac({
        rawBody: "{}",
        timestampHeader: timestamp,
        signatureHeader: signature,
        secret: SECRET,
        nowSec: now,
      })
    ).toEqual({ ok: false, reason: "invalid" });
  });
});
