/**
 * 004 — Tests del helper `classifyForQueue` y compañía.
 * Lógica pura, sin React ni DOM. La fuente de verdad sigue siendo el servidor
 * (NF-1); aquí solo se valida la decisión cliente de "qué mostrar / cómo enviar".
 */
import { describe, expect, it } from "vitest";
import {
  DOC_MAX,
  VIDEO_MAX_AS_VIDEO,
  classifyForQueue,
  formatAttachStatus,
  humanAttachType,
} from "../../src/components/inbox/helpers";

/** `classifyForQueue` solo mira `type` y `size`; pasamos un objeto mínimo. */
function fakeFile(name: string, size: number, type: string) {
  // `name` solo se usa en los mensajes de error de producción; aquí es ignorado.
  void name;
  return { type, size };
}

describe("classifyForQueue", () => {
  it("acepta imagen con MIME estándar y respeta effectiveMime", () => {
    const r = classifyForQueue(fakeFile("foto.jpg", 1 * 1024 * 1024, "image/jpeg"));
    expect(r).toEqual({
      kind: "image",
      effectiveMime: "image/jpeg",
      willSendAsDocument: false,
      needsVideoAsDocumentConfirm: false,
    });
  });

  it("acepta imagen webp y png dentro del límite", () => {
    expect(classifyForQueue(fakeFile("a.webp", 100, "image/webp"))?.kind).toBe("image");
    expect(classifyForQueue(fakeFile("a.png", 100, "image/png"))?.kind).toBe("image");
  });

  it("acepta audio con MIME estándar", () => {
    const r = classifyForQueue(fakeFile("voz.ogg", 5 * 1024 * 1024, "audio/ogg"));
    expect(r?.kind).toBe("audio");
    expect(r?.effectiveMime).toBe("audio/ogg");
    expect(r?.needsVideoAsDocumentConfirm).toBe(false);
  });

  it("acepta video mp4 dentro del límite como video (16 MB exacto incluido)", () => {
    const r = classifyForQueue(
      fakeFile("clip.mp4", VIDEO_MAX_AS_VIDEO, "video/mp4")
    );
    expect(r?.kind).toBe("video");
    expect(r?.willSendAsDocument).toBe(false);
    expect(r?.needsVideoAsDocumentConfirm).toBe(false);
  });

  it("re-taggea video > 16 MB como documento y exige confirmación explícita", () => {
    const r = classifyForQueue(
      fakeFile("clip.mp4", VIDEO_MAX_AS_VIDEO + 1, "video/mp4")
    );
    expect(r).toEqual({
      kind: "document",
      effectiveMime: "application/octet-stream",
      willSendAsDocument: true,
      needsVideoAsDocumentConfirm: true,
    });
  });

  it("re-taggea video entre 16 MB y 100 MB manteniendo willSendAsDocument=true y pide confirmación", () => {
    const r = classifyForQueue(
      fakeFile("clip.mp4", 30 * 1024 * 1024, "video/mp4")
    );
    expect(r?.kind).toBe("document");
    expect(r?.effectiveMime).toBe("application/octet-stream");
    expect(r?.willSendAsDocument).toBe(true);
    expect(r?.needsVideoAsDocumentConfirm).toBe(true);
  });

  it("rechaza cualquier archivo > 100 MB (null)", () => {
    expect(
      classifyForQueue(fakeFile("huge.pdf", DOC_MAX + 1, "application/pdf"))
    ).toBeNull();
    expect(
      classifyForQueue(fakeFile("huge.mp4", DOC_MAX + 1, "video/mp4"))
    ).toBeNull();
    expect(
      classifyForQueue(fakeFile("huge.mp4", DOC_MAX + 1, "video/mp4"))
    ).toBeNull();
  });

  it("acepta cualquier archivo ≤ 100 MB que no sea image/audio/video como documento", () => {
    const r = classifyForQueue(fakeFile("reporte.pdf", 5 * 1024 * 1024, "application/pdf"));
    expect(r?.kind).toBe("document");
    expect(r?.effectiveMime).toBe("application/pdf");
    expect(r?.willSendAsDocument).toBe(false);
    expect(r?.needsVideoAsDocumentConfirm).toBe(false);
  });

  it("MIME vacío cae como documento con application/octet-stream", () => {
    const r = classifyForQueue(fakeFile("bin", 1024, ""));
    expect(r).toEqual({
      kind: "document",
      effectiveMime: "application/octet-stream",
      willSendAsDocument: false,
      needsVideoAsDocumentConfirm: false,
    });
  });

  it("rechaza archivos vacíos (size 0)", () => {
    expect(classifyForQueue(fakeFile("zero", 0, "image/png"))).toBeNull();
  });

  it("acepta video de exactamente 16 MB sin re-tag (frontera inclusiva)", () => {
    const r = classifyForQueue(
      fakeFile("clip.mp4", VIDEO_MAX_AS_VIDEO, "video/mp4")
    );
    expect(r?.kind).toBe("video");
    expect(r?.needsVideoAsDocumentConfirm).toBe(false);
  });

  it("re-taggea video de exactamente 16 MB + 1 byte y pide confirmación", () => {
    const r = classifyForQueue(
      fakeFile("clip.mp4", VIDEO_MAX_AS_VIDEO + 1, "video/mp4")
    );
    expect(r?.kind).toBe("document");
    expect(r?.willSendAsDocument).toBe(true);
    expect(r?.needsVideoAsDocumentConfirm).toBe(true);
  });

  it("acepta documento de exactamente 100 MB (frontera inclusiva)", () => {
    const r = classifyForQueue(
      fakeFile("doc.pdf", DOC_MAX, "application/pdf")
    );
    expect(r?.kind).toBe("document");
  });
});

describe("formatAttachStatus", () => {
  it("traduce estados a etiquetas humanas en español", () => {
    expect(formatAttachStatus("pending")).toBe("pendiente");
    expect(formatAttachStatus("sending")).toBe("enviando");
    expect(formatAttachStatus("sent")).toBe("enviado");
    expect(formatAttachStatus("failed")).toBe("con error");
  });
});

describe("humanAttachType", () => {
  it("traduce tipos a etiquetas humanas", () => {
    expect(humanAttachType("image")).toBe("Imagen");
    expect(humanAttachType("audio")).toBe("Audio");
    expect(humanAttachType("video")).toBe("Video");
    expect(humanAttachType("document")).toBe("Documento");
  });
});