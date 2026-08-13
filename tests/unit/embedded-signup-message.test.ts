import { describe, expect, it } from "vitest";
import {
  isTrustedMetaOrigin,
  parseEmbeddedSignupMessage,
} from "@/lib/meta/embedded-signup";

describe("isTrustedMetaOrigin", () => {
  it("acepta orígenes oficiales de Facebook/Meta por https", () => {
    expect(isTrustedMetaOrigin("https://www.facebook.com")).toBe(true);
    expect(isTrustedMetaOrigin("https://web.facebook.com")).toBe(true);
    expect(isTrustedMetaOrigin("https://business.facebook.com")).toBe(true);
  });

  it("rechaza http, orígenes ajenos y strings inválidos", () => {
    expect(isTrustedMetaOrigin("http://www.facebook.com")).toBe(false);
    expect(isTrustedMetaOrigin("https://evil.example")).toBe(false);
    expect(isTrustedMetaOrigin("https://facebook.com.evil.test")).toBe(false);
    expect(isTrustedMetaOrigin("not-a-url")).toBe(false);
  });
});

describe("parseEmbeddedSignupMessage", () => {
  const origin = "https://www.facebook.com";

  it("extrae waba_id y phone_number_id de WA_EMBEDDED_SIGNUP", () => {
    const parsed = parseEmbeddedSignupMessage(origin, {
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { waba_id: "WABA1", phone_number_id: "PN1" },
    });
    expect(parsed).toEqual({
      event: "FINISH",
      wabaId: "WABA1",
      phoneNumberId: "PN1",
    });
  });

  it("acepta el payload como JSON string (formato del SDK)", () => {
    const parsed = parseEmbeddedSignupMessage(
      origin,
      JSON.stringify({
        type: "WA_EMBEDDED_SIGNUP",
        event: "FINISH",
        data: { waba_id: "W2", phone_number_id: "P2" },
      })
    );
    expect(parsed?.wabaId).toBe("W2");
    expect(parsed?.phoneNumberId).toBe("P2");
  });

  it("no inventa IDs si Meta no los manda", () => {
    const parsed = parseEmbeddedSignupMessage(origin, {
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: {},
    });
    expect(parsed).toEqual({
      event: "FINISH",
      wabaId: null,
      phoneNumberId: null,
    });
  });

  it("ignora otros tipos y orígenes no confiables", () => {
    expect(
      parseEmbeddedSignupMessage(origin, { type: "OTHER", data: { waba_id: "x" } })
    ).toBeNull();
    expect(
      parseEmbeddedSignupMessage("https://evil.test", {
        type: "WA_EMBEDDED_SIGNUP",
        event: "FINISH",
        data: { waba_id: "W", phone_number_id: "P" },
      })
    ).toBeNull();
  });
});
