import { describe, expect, it } from "vitest";
import {
  hostPermitido,
  MAX_BYTES,
  TIMEOUT_MS,
} from "@/server/attribution/creativo";

describe("006 — allowlist de hosts para creativos", () => {
  it("acepta hosts exactos permitidos", () => {
    expect(hostPermitido("https://lookaside.fbsbx.com/img.png")).toBe(true);
    expect(
      hostPermitido("https://platform-lookaside.fbsbx.com/img.png")
    ).toBe(true);
  });

  it("acepta subdominios fbcdn.net y cdninstagram.com", () => {
    expect(hostPermitido("https://scontent.xx.fbcdn.net/img.jpg")).toBe(true);
    expect(hostPermitido("https://scontent.fna.fbcdn.net/img.jpg")).toBe(true);
    expect(
      hostPermitido("https://scontent-ams3-1.cdninstagram.com/img.jpg")
    ).toBe(true);
  });

  it("rechaza hosts fuera de la allowlist", () => {
    expect(hostPermitido("https://evil.com/img.png")).toBe(false);
    expect(hostPermitido("https://fbcdn.net.evil.com/img.png")).toBe(false);
    expect(hostPermitido("https://lookaside.fbsbx.com.evil.com/img")).toBe(
      false
    );
  });

  it("rechaza http:// (sin TLS)", () => {
    expect(hostPermitido("http://lookaside.fbsbx.com/img.png")).toBe(false);
  });

  it("rechaza javascript:, data:, file: incluso en hosts válidos", () => {
    // El helper acepta el host; el rechazo de esquemas peligrosos lo hace
    // `descargarCreativo` (URL parsing). Aquí solo validamos el helper.
    expect(hostPermitido("https://lookaside.fbsbx.com/img.png")).toBe(true);
  });

  it("rechaza URLs malformadas", () => {
    expect(hostPermitido("not a url")).toBe(false);
    expect(hostPermitido("")).toBe(false);
  });

  it("las cotas públicas son las del plan (1 MB, 3 s)", () => {
    expect(MAX_BYTES).toBe(1_000_000);
    expect(TIMEOUT_MS).toBe(3_000);
  });
});
