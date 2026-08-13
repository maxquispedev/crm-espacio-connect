import { describe, expect, it } from "vitest";
import {
  buildMessageNewPayload,
  contactLabel,
  messagePreview,
} from "@/server/events/message-new";
import type { MessageDto } from "@/lib/types";

function msg(over: Partial<MessageDto> = {}): MessageDto {
  return {
    id: "msg_1",
    conversationId: "cv_1",
    direction: "in",
    type: "text",
    text: "hola",
    status: "delivered",
    error: null,
    aiGenerated: false,
    origin: "operator",
    media: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    ...over,
  };
}

describe("messagePreview", () => {
  it("usa el texto recortado", () => {
    expect(messagePreview("text", "  hola  ")).toBe("hola");
  });

  it("trunca previews largos", () => {
    const long = "x".repeat(200);
    const preview = messagePreview("text", long);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBe(140);
  });

  it("sin texto → etiqueta por tipo", () => {
    expect(messagePreview("image", null)).toBe("Imagen");
    expect(messagePreview("audio", null, null)).toBe("Audio");
    expect(messagePreview("image", null, "foto de la pieza")).toBe(
      "foto de la pieza"
    );
  });
});

describe("contactLabel", () => {
  it("prioriza el nombre", () => {
    expect(contactLabel({ name: "Ana", phone: "52111" })).toBe("Ana");
  });

  it("sin nombre usa teléfono o fallback", () => {
    expect(contactLabel({ name: "  ", phone: "52111" })).toBe("52111");
    expect(contactLabel({ name: "", phone: null })).toBe("Contacto");
  });
});

describe("buildMessageNewPayload", () => {
  it("inbound enriquecido con org, contacto, preview y message intacto", () => {
    const message = msg({ text: "¿Tienen taladros?" });
    const payload = buildMessageNewPayload({
      organizationId: "org_b",
      organizationName: "Espacio Veloz",
      conversationId: "cv_1",
      contactId: "ct_1",
      contactName: "Ana",
      message,
    });
    expect(payload).toMatchObject({
      organizationId: "org_b",
      organizationName: "Espacio Veloz",
      conversationId: "cv_1",
      contactId: "ct_1",
      contactName: "Ana",
      direction: "in",
      messageId: "msg_1",
      preview: "¿Tienen taladros?",
    });
    expect(payload.message).toEqual(message);
  });

  it("outbound conserva direction=out (el cliente no notifica)", () => {
    const payload = buildMessageNewPayload({
      organizationId: "org_b",
      organizationName: "Espacio Veloz",
      conversationId: "cv_1",
      contactId: "ct_1",
      contactName: "Ana",
      message: msg({ id: "msg_out", direction: "out", text: "ok" }),
    });
    expect(payload.direction).toBe("out");
    expect(payload.messageId).toBe("msg_out");
    expect(payload.preview).toBe("ok");
  });
});
