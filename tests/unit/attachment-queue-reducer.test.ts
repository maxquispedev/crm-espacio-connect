/**
 * 004 — Tests del reducer puro de la cola y de `filterDuplicates`.
 * El reducer vive en `attachment-queue.tsx` (módulo "use client" en runtime,
 * pero la función pura no toca el DOM) para que el hook lo reuse sin
 * duplicar la lógica. Aquí lo cubrimos sin React.
 */
import { describe, expect, it } from "vitest";
import {
  filterDuplicates,
  queueReducer,
  type QueueState,
} from "../../src/components/inbox/attachment-queue";
import type { PendingAttachment } from "../../src/components/inbox/helpers";

function fakeFile(name: string, size: number, type: string, lastModified = 0): File {
  const blob = new Blob([new Uint8Array(Math.min(size, 1))], { type });
  return new File([blob], name, { type, lastModified });
}

function att(
  id: string,
  file: File,
  overrides: Partial<PendingAttachment> = {}
): PendingAttachment {
  return {
    id,
    file,
    previewUrl: null,
    kind: "image",
    effectiveMime: file.type || "application/octet-stream",
    willSendAsDocument: false,
    needsVideoAsDocumentConfirm: false,
    status: "pending",
    error: null,
    ...overrides,
  };
}

const empty: QueueState = { attachments: [], selectedId: null };

describe("queueReducer — add", () => {
  it("añade items al final preservando el orden", () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const b = att("att_2", fakeFile("b.png", 100, "image/png"));
    const s1 = queueReducer(empty, { type: "add", items: [a] });
    const s2 = queueReducer(s1, { type: "add", items: [b] });
    expect(s2.attachments.map((x) => x.id)).toEqual(["att_1", "att_2"]);
  });

  it("no modifica selectedId al añadir", () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const s1 = queueReducer(empty, { type: "select", id: "x" });
    const s2 = queueReducer(s1, { type: "add", items: [a] });
    expect(s2.selectedId).toBe("x");
  });
});

describe("queueReducer — remove", () => {
  it("elimina el adjunto con el id dado", () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const b = att("att_2", fakeFile("b.png", 100, "image/png"));
    const s1 = queueReducer(empty, { type: "add", items: [a, b] });
    const s2 = queueReducer(s1, { type: "remove", id: "att_1" });
    expect(s2.attachments.map((x) => x.id)).toEqual(["att_2"]);
  });

  it("limpia selectedId si el id eliminado era el seleccionado", () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const s1 = queueReducer(empty, { type: "add", items: [a] });
    const s2 = queueReducer(s1, { type: "select", id: "att_1" });
    const s3 = queueReducer(s2, { type: "remove", id: "att_1" });
    expect(s3.selectedId).toBeNull();
  });

  it("preserva selectedId si se elimina un id distinto", () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const b = att("att_2", fakeFile("b.png", 100, "image/png"));
    const s1 = queueReducer(empty, { type: "add", items: [a, b] });
    const s2 = queueReducer(s1, { type: "select", id: "att_1" });
    const s3 = queueReducer(s2, { type: "remove", id: "att_2" });
    expect(s3.selectedId).toBe("att_1");
  });
});

describe("queueReducer — clear", () => {
  it("vacía la lista y resetea la selección", () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const s1 = queueReducer(empty, { type: "add", items: [a] });
    const s2 = queueReducer(s1, { type: "select", id: "att_1" });
    const s3 = queueReducer(s2, { type: "clear" });
    expect(s3.attachments).toEqual([]);
    expect(s3.selectedId).toBeNull();
  });
});

describe("queueReducer — select", () => {
  it("asigna y reemplaza selectedId", () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const s0 = queueReducer(empty, { type: "add", items: [a] });
    const s1 = queueReducer(s0, { type: "select", id: "att_1" });
    expect(s1.selectedId).toBe("att_1");
    const s2 = queueReducer(s1, { type: "select", id: null });
    expect(s2.selectedId).toBeNull();
  });
});

describe("queueReducer — updateStatus", () => {
  it("transita pending → sending → sent", () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const s0 = queueReducer(empty, { type: "add", items: [a] });
    const s1 = queueReducer(s0, { type: "updateStatus", id: "att_1", status: "sending" });
    expect(s1.attachments[0]?.status).toBe("sending");
    expect(s1.attachments[0]?.error).toBeNull();
    const s2 = queueReducer(s1, { type: "updateStatus", id: "att_1", status: "sent" });
    expect(s2.attachments[0]?.status).toBe("sent");
  });

  it("transita a failed y guarda el mensaje de error", () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const s0 = queueReducer(empty, { type: "add", items: [a] });
    const s1 = queueReducer(s0, {
      type: "updateStatus",
      id: "att_1",
      status: "failed",
      error: "413 Payload Too Large",
    });
    expect(s1.attachments[0]?.status).toBe("failed");
    expect(s1.attachments[0]?.error).toBe("413 Payload Too Large");
  });

  it("no afecta a otros adjuntos", () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const b = att("att_2", fakeFile("b.png", 100, "image/png"));
    const s0 = queueReducer(empty, { type: "add", items: [a, b] });
    const s1 = queueReducer(s0, {
      type: "updateStatus",
      id: "att_1",
      status: "failed",
      error: "boom",
    });
    expect(s1.attachments[0]?.status).toBe("failed");
    expect(s1.attachments[1]?.status).toBe("pending");
  });
});

describe("queueReducer — confirmVideoAsDocument", () => {
  it("desbloquea un adjunto (needsVideoAsDocumentConfirm=false) preservando el resto", () => {
    const blocked = att("att_1", fakeFile("clip.mp4", 30 * 1024 * 1024, "video/mp4"), {
      kind: "document",
      willSendAsDocument: true,
      needsVideoAsDocumentConfirm: true,
    });
    const other = att("att_2", fakeFile("a.jpg", 100, "image/jpeg"));
    const s1 = queueReducer(empty, { type: "add", items: [blocked, other] });
    const s2 = queueReducer(s1, { type: "confirmVideoAsDocument", id: "att_1" });
    expect(s2.attachments[0]?.needsVideoAsDocumentConfirm).toBe(false);
    expect(s2.attachments[0]?.willSendAsDocument).toBe(true);
    expect(s2.attachments[1]?.id).toBe("att_2");
  });

  it("no afecta a adjuntos no bloqueados", () => {
    const blocked = att("att_1", fakeFile("clip.mp4", 30 * 1024 * 1024, "video/mp4"), {
      kind: "document",
      willSendAsDocument: true,
      needsVideoAsDocumentConfirm: true,
    });
    const plain = att("att_2", fakeFile("a.jpg", 100, "image/jpeg"));
    const s1 = queueReducer(empty, { type: "add", items: [blocked, plain] });
    const s2 = queueReducer(s1, { type: "confirmVideoAsDocument", id: "att_2" });
    expect(s2.attachments[1]?.needsVideoAsDocumentConfirm).toBe(false);
  });
});

describe("queueReducer — retry", () => {
  it("transita failed → pending y limpia el error", () => {
    const failed = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      status: "failed",
      error: "boom",
    });
    const s1 = queueReducer(empty, { type: "add", items: [failed] });
    const s2 = queueReducer(s1, { type: "retry", id: "att_1" });
    expect(s2.attachments[0]?.status).toBe("pending");
    expect(s2.attachments[0]?.error).toBeNull();
  });

  it("no afecta a adjuntos que NO están en failed", () => {
    const sent = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      status: "sent",
    });
    const pending = att("att_2", fakeFile("b.jpg", 100, "image/jpeg"));
    const s1 = queueReducer(empty, { type: "add", items: [sent, pending] });
    const s2 = queueReducer(s1, { type: "retry", id: "att_1" });
    expect(s2.attachments[0]?.status).toBe("sent");
    const s3 = queueReducer(s2, { type: "retry", id: "att_2" });
    // pending ya estaba pending — sin cambio observable (sigue pending).
    expect(s3.attachments[1]?.status).toBe("pending");
  });

  it("no afecta a ids inexistentes", () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const s1 = queueReducer(empty, { type: "add", items: [a] });
    const s2 = queueReducer(s1, { type: "retry", id: "no_existe" });
    expect(s2.attachments).toEqual(s1.attachments);
  });
});

describe("filterDuplicates", () => {
  it("filtra archivos ya presentes en `existing`", () => {
    const fa = fakeFile("a.jpg", 100, "image/jpeg", 123);
    const fb = fakeFile("b.jpg", 100, "image/jpeg", 456);
    const existing = [att("att_1", fa)];
    const incoming = [fa, fb];
    const result = filterDuplicates(existing, incoming);
    expect(result.map((f) => f.name)).toEqual(["b.jpg"]);
  });

  it("filtra duplicados dentro del mismo batch", () => {
    const fa = fakeFile("a.jpg", 100, "image/jpeg", 123);
    const fb = fakeFile("b.jpg", 200, "image/jpeg", 456);
    const incoming = [fa, fa, fb];
    const result = filterDuplicates([], incoming);
    expect(result.map((f) => f.name)).toEqual(["a.jpg", "b.jpg"]);
  });

  it("considera archivos distintos aunque tengan el mismo nombre si cambia tamaño o lastModified", () => {
    const fa = fakeFile("doc.pdf", 100, "application/pdf", 1);
    const fb = fakeFile("doc.pdf", 200, "application/pdf", 2);
    const fc = fakeFile("doc.pdf", 100, "application/pdf", 99);
    const result = filterDuplicates([], [fa, fb, fc]);
    expect(result).toHaveLength(3);
  });

  it("devuelve una lista vacía si todos los archivos ya están en `existing`", () => {
    const fa = fakeFile("a.jpg", 100, "image/jpeg", 1);
    const existing = [att("att_1", fa)];
    expect(filterDuplicates(existing, [fa])).toEqual([]);
  });

  it("preserva el orden de aparición del batch entrante", () => {
    const fa = fakeFile("a.jpg", 100, "image/jpeg", 1);
    const fb = fakeFile("b.jpg", 200, "image/jpeg", 2);
    const fc = fakeFile("c.jpg", 300, "image/jpeg", 3);
    const result = filterDuplicates([], [fc, fa, fb]);
    expect(result.map((f) => f.name)).toEqual(["c.jpg", "a.jpg", "b.jpg"]);
  });
});