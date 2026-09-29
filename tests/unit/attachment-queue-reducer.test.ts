/**
 * 004 — Tests del reducer puro de la cola y de `filterDuplicates`.
 * El reducer vive en `attachment-queue.tsx` (módulo "use client" en runtime,
 * pero la función pura no toca el DOM) para que el hook lo reuse sin
 * duplicar la lógica. Aquí lo cubrimos sin React.
 */
import { describe, expect, it } from "vitest";
import {
  applyRemoveWithCaptionTransfer,
  canMutateQueue,
  filterDuplicates,
  progressLabel,
  queueReducer,
  revokeAllPreviews,
  summarize,
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
    captionOwner: false,
    captionConsumed: false,
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

describe("queueReducer — clearSent", () => {
  it("elimina solo los adjuntos en estado `sent`, preserva `pending` y `failed`", () => {
    const sent = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      status: "sent",
    });
    const pending = att("att_2", fakeFile("b.jpg", 100, "image/jpeg"), {
      status: "pending",
    });
    const failed = att("att_3", fakeFile("c.jpg", 100, "image/jpeg"), {
      status: "failed",
      error: "boom",
    });
    const s1 = queueReducer(empty, { type: "add", items: [sent, pending, failed] });
    const s2 = queueReducer(s1, { type: "clearSent" });
    expect(s2.attachments.map((x) => x.id)).toEqual(["att_2", "att_3"]);
    expect(s2.attachments.map((x) => x.status)).toEqual(["pending", "failed"]);
  });

  it("limpia `selectedId` si el seleccionado era un `sent`", () => {
    const sent = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      status: "sent",
    });
    const pending = att("att_2", fakeFile("b.jpg", 100, "image/jpeg"));
    const s1 = queueReducer(empty, { type: "add", items: [sent, pending] });
    const s2 = queueReducer(s1, { type: "select", id: "att_1" });
    const s3 = queueReducer(s2, { type: "clearSent" });
    expect(s3.selectedId).toBeNull();
    expect(s3.attachments).toHaveLength(1);
  });

  it("preserva `selectedId` si el seleccionado NO era `sent`", () => {
    const sent = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      status: "sent",
    });
    const pending = att("att_2", fakeFile("b.jpg", 100, "image/jpeg"));
    const s1 = queueReducer(empty, { type: "add", items: [sent, pending] });
    const s2 = queueReducer(s1, { type: "select", id: "att_2" });
    const s3 = queueReducer(s2, { type: "clearSent" });
    expect(s3.selectedId).toBe("att_2");
  });

  it("vacía la lista si todos estaban en `sent`", () => {
    const sent1 = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      status: "sent",
    });
    const sent2 = att("att_2", fakeFile("b.jpg", 100, "image/jpeg"), {
      status: "sent",
    });
    const s1 = queueReducer(empty, { type: "add", items: [sent1, sent2] });
    const s2 = queueReducer(s1, { type: "clearSent" });
    expect(s2.attachments).toEqual([]);
  });
});

describe("summarize", () => {
  it("cuenta los adjuntos por estado", () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const b = att("att_2", fakeFile("b.jpg", 100, "image/jpeg"), {
      status: "sending",
    });
    const c = att("att_3", fakeFile("c.jpg", 100, "image/jpeg"), {
      status: "sent",
    });
    const d = att("att_4", fakeFile("d.jpg", 100, "image/jpeg"), {
      status: "failed",
      error: "x",
    });
    const blocked = att(
      "att_5",
      fakeFile("clip.mp4", 30 * 1024 * 1024, "video/mp4"),
      { needsVideoAsDocumentConfirm: true }
    );
    const s = summarize([a, b, c, d, blocked]);
    // `blocked` también cuenta como `pending` mientras su status sigue siendo
    // `pending`. Las dos métricas son ortogonales (estado terminal vs bloqueo
    // de confirmación) y se reportan por separado.
    expect(s).toEqual({
      total: 5,
      sent: 1,
      failed: 1,
      pending: 2,
      sending: 1,
      blocked: 1,
    });
  });

  it("cuenta un adjunto bloqueado aunque su status sea `pending`", () => {
    const blocked = att(
      "att_1",
      fakeFile("clip.mp4", 30 * 1024 * 1024, "video/mp4"),
      { needsVideoAsDocumentConfirm: true, status: "pending" }
    );
    const s = summarize([blocked]);
    expect(s).toEqual({
      total: 1,
      sent: 0,
      failed: 0,
      pending: 1,
      sending: 0,
      blocked: 1,
    });
  });

  it("devuelve contadores en cero para una lista vacía", () => {
    const sum = summarize([]);
    expect(sum).toEqual({
      total: 0,
      sent: 0,
      failed: 0,
      pending: 0,
      sending: 0,
      blocked: 0,
    });
  });
});

describe("progressLabel", () => {
  it("muestra conteo inicial cuando todo está pendiente", () => {
    const s = summarize([
      att("a", fakeFile("a.jpg", 100, "image/jpeg")),
      att("b", fakeFile("b.jpg", 100, "image/jpeg")),
    ]);
    expect(progressLabel(s)).toBe("2 adjuntos en cola");
  });

  it("muestra progreso cuando hay envíos en curso", () => {
    const s = summarize([
      att("a", fakeFile("a.jpg", 100, "image/jpeg"), { status: "sent" }),
      att("b", fakeFile("b.jpg", 100, "image/jpeg"), { status: "sending" }),
      att("c", fakeFile("c.jpg", 100, "image/jpeg")),
    ]);
    expect(progressLabel(s)).toBe("1/3 enviados");
  });

  it("muestra éxito completo sin error", () => {
    const s = summarize([
      att("a", fakeFile("a.jpg", 100, "image/jpeg"), { status: "sent" }),
      att("b", fakeFile("b.jpg", 100, "image/jpeg"), { status: "sent" }),
    ]);
    expect(progressLabel(s)).toBe("2/2 enviados");
  });

  it("muestra el conteo de fallos cuando nada se envió", () => {
    const s = summarize([
      att("a", fakeFile("a.jpg", 100, "image/jpeg"), {
        status: "failed",
        error: "x",
      }),
      att("b", fakeFile("b.jpg", 100, "image/jpeg"), {
        status: "failed",
        error: "y",
      }),
    ]);
    expect(progressLabel(s)).toBe("0/2 enviados · 2 con error");
  });

  it("devuelve vacío si la cola está vacía", () => {
    expect(progressLabel(summarize([]))).toBe("");
  });
});

describe("queueReducer — captionOwner / captionConsumed (004 fix)", () => {
  it("markCaptionConsumed marca SOLO el adjunto target que es captionOwner", () => {
    const owner = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
    });
    const other = att("att_2", fakeFile("b.png", 100, "image/png"));
    const s1 = queueReducer(empty, { type: "add", items: [owner, other] });
    const s2 = queueReducer(s1, {
      type: "markCaptionConsumed",
      id: "att_1",
    });
    expect(s2.attachments[0]?.captionConsumed).toBe(true);
    expect(s2.attachments[0]?.captionOwner).toBe(true);
    // El otro adjunto no debe verse afectado.
    expect(s2.attachments[1]?.captionConsumed).toBe(false);
    expect(s2.attachments[1]?.captionOwner).toBe(false);
  });

  it("markCaptionConsumed es no-op si el id no es captionOwner (defensivo)", () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg")); // captionOwner=false
    const s1 = queueReducer(empty, { type: "add", items: [a] });
    const s2 = queueReducer(s1, {
      type: "markCaptionConsumed",
      id: "att_1",
    });
    expect(s2.attachments[0]?.captionConsumed).toBe(false);
  });

  it("markCaptionConsumed es idempotente: aplicado dos veces no rompe nada", () => {
    const owner = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
    });
    const s1 = queueReducer(empty, { type: "add", items: [owner] });
    const s2 = queueReducer(s1, {
      type: "markCaptionConsumed",
      id: "att_1",
    });
    const s3 = queueReducer(s2, {
      type: "markCaptionConsumed",
      id: "att_1",
    });
    expect(s3.attachments[0]?.captionConsumed).toBe(true);
  });

  it("markCaptionConsumed sobre id inexistente no lanza", () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const s1 = queueReducer(empty, { type: "add", items: [a] });
    const s2 = queueReducer(s1, {
      type: "markCaptionConsumed",
      id: "att_X",
    });
    expect(s2.attachments).toHaveLength(1);
    expect(s2.attachments[0]?.captionConsumed).toBe(false);
  });
});

describe("queueReducer — clearSent post-exitoso (004 fix)", () => {
  it("tras clearSent la cola queda vacía y se puede aceptar texto nuevo", () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      status: "sent",
      captionOwner: true,
      captionConsumed: true,
    });
    const b = att("att_2", fakeFile("b.png", 100, "image/png"), {
      status: "sent",
    });
    const s1 = queueReducer(empty, { type: "add", items: [a, b] });
    const s2 = queueReducer(s1, { type: "clearSent" });
    expect(s2.attachments).toEqual([]);

    // Replicamos el cálculo de canSubmit del composer con la cola vacía:
    // readyToSend = filter(!needsVideoAsDocumentConfirm && (pending||failed))
    const ready = s2.attachments.filter(
      (a0) =>
        !a0.needsVideoAsDocumentConfirm &&
        (a0.status === "pending" || a0.status === "failed")
    );
    const onlyBlocked = s2.attachments.length > 0 && ready.length === 0;
    const newText = "hola";
    const canSubmit = ready.length > 0 || (newText.trim().length > 0 && !onlyBlocked);
    expect(canSubmit).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* applyRemoveWithCaptionTransfer — caption owner transferido          */
/* (004 corte 2d, fix #3)                                              */
/* ------------------------------------------------------------------ */

describe("applyRemoveWithCaptionTransfer — caption owner transfer (004 fix 2d)", () => {
  it("eliminar owner NO consumido → siguiente se convierte en owner", () => {
    const owner = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
    });
    const next = att("att_2", fakeFile("b.png", 100, "image/png"));
    const s1 = queueReducer(empty, { type: "add", items: [owner, next] });
    const s2 = applyRemoveWithCaptionTransfer(s1, "att_1");

    // Owner eliminado.
    expect(s2.attachments.map((x) => x.id)).toEqual(["att_2"]);
    // El siguiente ahora es captionOwner con captionConsumed=false.
    expect(s2.attachments[0]?.captionOwner).toBe(true);
    expect(s2.attachments[0]?.captionConsumed).toBe(false);
  });

  it("eliminar owner CONSUMIDO → NO transfiere (caption ya viajó)", () => {
    // Si el captionOwner ya viajó con caption, eliminarlo NO debe
    // reasignar la propiedad: el caption ya se envió una vez y no debe
    // repetirse en un próximo envío.
    const consumedOwner = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
      captionConsumed: true,
      status: "sent",
    });
    const next = att("att_2", fakeFile("b.png", 100, "image/png"));
    const s1 = queueReducer(empty, {
      type: "add",
      items: [consumedOwner, next],
    });
    const s2 = applyRemoveWithCaptionTransfer(s1, "att_1");

    expect(s2.attachments.map((x) => x.id)).toEqual(["att_2"]);
    // El siguiente sigue sin captionOwner.
    expect(s2.attachments[0]?.captionOwner).toBe(false);
    expect(s2.attachments[0]?.captionConsumed).toBe(false);
  });

  it("eliminar adjunto que NO es owner → no afecta captionOwner existente", () => {
    const owner = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
    });
    const middle = att("att_2", fakeFile("b.png", 100, "image/png"));
    const tail = att("att_3", fakeFile("c.webp", 100, "image/webp"));
    const s1 = queueReducer(empty, { type: "add", items: [owner, middle, tail] });
    const s2 = applyRemoveWithCaptionTransfer(s1, "att_2");

    expect(s2.attachments.map((x) => x.id)).toEqual(["att_1", "att_3"]);
    // Owner intacto.
    expect(s2.attachments[0]?.captionOwner).toBe(true);
    expect(s2.attachments[1]?.captionOwner).toBe(false);
  });

  it("cola de un solo owner → elimina sin transferir (no queda nadie)", () => {
    const sole = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
    });
    const s1 = queueReducer(empty, { type: "add", items: [sole] });
    const s2 = applyRemoveWithCaptionTransfer(s1, "att_1");
    expect(s2.attachments).toEqual([]);
  });

  it("id inexistente → no-op (defensivo)", () => {
    const owner = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
    });
    const s1 = queueReducer(empty, { type: "add", items: [owner] });
    const s2 = applyRemoveWithCaptionTransfer(s1, "att_X");
    expect(s2.attachments).toHaveLength(1);
    expect(s2.attachments[0]?.captionOwner).toBe(true);
  });

  it("selectedId queda null si el id eliminado era el seleccionado", () => {
    const owner = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
    });
    const next = att("att_2", fakeFile("b.png", 100, "image/png"));
    const s1 = queueReducer(empty, { type: "add", items: [owner, next] });
    const s2 = queueReducer(s1, { type: "select", id: "att_1" });
    const s3 = applyRemoveWithCaptionTransfer(s2, "att_1");
    expect(s3.selectedId).toBeNull();
  });

  it("transferencia preserva el orden de la cola y los demás flags", () => {
    const owner = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
      willSendAsDocument: true,
    });
    const candidate = att("att_2", fakeFile("b.png", 100, "image/png"));
    const other = att("att_3", fakeFile("c.webp", 100, "image/webp"));
    const s1 = queueReducer(empty, {
      type: "add",
      items: [owner, candidate, other],
    });
    const s2 = applyRemoveWithCaptionTransfer(s1, "att_1");
    expect(s2.attachments.map((x) => x.id)).toEqual(["att_2", "att_3"]);
    // att_2 ahora es captionOwner pero conserva su status y kind.
    expect(s2.attachments[0]?.captionOwner).toBe(true);
    expect(s2.attachments[0]?.captionConsumed).toBe(false);
    expect(s2.attachments[0]?.kind).toBe("image");
    expect(s2.attachments[1]?.captionOwner).toBe(false);
  });

  it("queueReducer.remove delega en applyRemoveWithCaptionTransfer (coherencia)", () => {
    // Verifica que la acción `remove` del reducer produce exactamente el
    // mismo resultado que llamar a la helper explícitamente. Si alguien
    // cambia el reducer sin pasar por la helper, este test rompe.
    const owner = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
    });
    const next = att("att_2", fakeFile("b.png", 100, "image/png"));
    const s0 = queueReducer(empty, { type: "add", items: [owner, next] });
    const viaReducer = queueReducer(s0, { type: "remove", id: "att_1" });
    const viaHelper = applyRemoveWithCaptionTransfer(s0, "att_1");
    expect(viaReducer).toEqual(viaHelper);
  });
});

/* ------------------------------------------------------------------ */
/* revokeAllPreviews — limpieza robusta en el happy path               */
/* (004 corte 2d, fix #2)                                              */
/* ------------------------------------------------------------------ */

describe("revokeAllPreviews — happy path cleanup (004 fix 2d)", () => {
  it("revoca TODOS los previews, sin filtrar por status", () => {
    // La regresión era: el closure capturado por el composer antes del
    // envío tenía los adjuntos aún en `pending`. Si el cleanup usaba
    // `clearSent` (filtra por status=sent), la revocación no corría y
    // quedaban Object URLs huérfanas aunque el reducer luego quitase los
    // sent. `revokeAllPreviews` no filtra por status: cierra esa puerta.
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      previewUrl: "blob:a",
      status: "pending",
    });
    const b = att("att_2", fakeFile("b.png", 100, "image/png"), {
      previewUrl: "blob:b",
      status: "failed",
      error: "x",
    });
    const c = att("att_3", fakeFile("c.webp", 100, "image/webp"), {
      previewUrl: "blob:c",
      status: "sent",
    });
    const revoked = revokeAllPreviews([a, b, c]);
    expect(revoked).toBe(3);
  });

  it("ignora adjuntos sin previewUrl (p. ej. documentos)", () => {
    const doc = att("att_1", fakeFile("doc.pdf", 1024, "application/pdf"), {
      previewUrl: null,
    });
    const img = att("att_2", fakeFile("a.jpg", 100, "image/jpeg"), {
      previewUrl: "blob:a",
    });
    const revoked = revokeAllPreviews([doc, img]);
    expect(revoked).toBe(1);
  });

  it("devuelve 0 sobre una lista vacía", () => {
    expect(revokeAllPreviews([])).toBe(0);
  });

  it("REGRESIÓN 2d: el filtro por status=sent dejaría previews sin revocar", () => {
    // Simula el bug: si el cleanup usara un filtro tipo `clearSent`, los
    // adjuntos en `pending` (status stale del closure pre-envío) NO se
    // revocarían. La regresión existe solo si se filtra por status; este
    // test demuestra que filtrar por status es incorrecto.
    const stalePending = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      previewUrl: "blob:a",
      status: "pending", // stale: en realidad ya se envió, pero el closure lo ve pending
    });
    // El bug sería: revokeBy(filter a => a.status === "sent") sobre
    // este closure dejaría blob:a sin revocar.
    const wouldBeRevokedByBuggyFilter = [stalePending].filter(
      (a) => a.status === "sent"
    ).length;
    expect(wouldBeRevokedByBuggyFilter).toBe(0); // bug latente
    // El fix correcto (revokeAllPreviews) sí revoca.
    expect(revokeAllPreviews([stalePending])).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* applyRemoveWithCaptionTransfer — nunca transferir a sent/sending    */
/* (004 corte 2e, fix #2)                                              */
/* ------------------------------------------------------------------ */

describe("applyRemoveWithCaptionTransfer — FIX-2, salta sent/sending (004 corte 2e)", () => {
  it("A owner + B sent + C failed → elimina A → C se vuelve owner (B sent se salta)", () => {
    // Caso del prompt: cola [A owner, B sent, C failed] → eliminar A
    // debe transferir captionOwner al PRIMER candidato válido, saltándose
    // el sent (que ya no recibirá un futuro envío).
    const owner = att("att_A", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
      status: "failed",
      error: "x",
    });
    const sent = att("att_B", fakeFile("b.pdf", 1024, "application/pdf"), {
      status: "sent",
    });
    const failed = att("att_C", fakeFile("c.png", 100, "image/png"), {
      status: "failed",
      error: "y",
    });
    const s0 = queueReducer(empty, { type: "add", items: [owner, sent, failed] });

    const s1 = applyRemoveWithCaptionTransfer(s0, "att_A");
    expect(s1.attachments.map((x) => x.id)).toEqual(["att_B", "att_C"]);
    // B (sent) NO se convierte en owner.
    expect(s1.attachments[0]?.captionOwner).toBe(false);
    expect(s1.attachments[0]?.captionConsumed).toBe(false);
    expect(s1.attachments[0]?.status).toBe("sent");
    // C (failed) se vuelve owner con captionConsumed=false (aún no viajó).
    expect(s1.attachments[1]?.captionOwner).toBe(true);
    expect(s1.attachments[1]?.captionConsumed).toBe(false);
    expect(s1.attachments[1]?.status).toBe("failed");
  });

  it("A owner + B sent únicamente → elimina A → nadie se vuelve owner", () => {
    // Caso del prompt: cola [A owner, B sent] → eliminar A. Como B es
    // sent y no puede recibir un futuro envío, NO se transfiere captionOwner
    // (no hay a quién). La cola queda con B sin captionOwner.
    const owner = att("att_A", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
      status: "failed",
      error: "x",
    });
    const sent = att("att_B", fakeFile("b.pdf", 1024, "application/pdf"), {
      status: "sent",
    });
    const s0 = queueReducer(empty, { type: "add", items: [owner, sent] });

    const s1 = applyRemoveWithCaptionTransfer(s0, "att_A");
    expect(s1.attachments.map((x) => x.id)).toEqual(["att_B"]);
    expect(s1.attachments[0]?.captionOwner).toBe(false);
    expect(s1.attachments[0]?.captionConsumed).toBe(false);
  });

  it("A owner + B sending + C pending → elimina A → C se vuelve owner (B sending se salta)", () => {
    // El estado `sending` también se excluye del pool de candidatos.
    // Aunque el envío esté en vuelo, una transferencia de captionOwner
    // no debe apuntar a un sending (es defensivo contra una posible
    // re-entrada y contra la lectura intermedia del queueRef.current).
    const owner = att("att_A", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
      status: "pending",
    });
    const sending = att("att_B", fakeFile("b.png", 100, "image/png"), {
      status: "sending",
    });
    const pending = att("att_C", fakeFile("c.webp", 100, "image/webp"));
    const s0 = queueReducer(empty, {
      type: "add",
      items: [owner, sending, pending],
    });

    const s1 = applyRemoveWithCaptionTransfer(s0, "att_A");
    expect(s1.attachments.map((x) => x.id)).toEqual(["att_B", "att_C"]);
    expect(s1.attachments[0]?.captionOwner).toBe(false);
    expect(s1.attachments[1]?.captionOwner).toBe(true);
    expect(s1.attachments[1]?.captionConsumed).toBe(false);
  });

  it("FIX-2: blocked pending CON needsVideoAsDocumentConfirm=true SIGUE siendo candidato válido", () => {
    // El adjunto bloqueado (video >16MB) está en pending y podrá enviarse
    // tras la confirmación. Sigue siendo un candidato válido para heredar
    // el caption: la idea es que cuando el operador confirme, el caption
    // viaje con ese adjunto exactamente una vez.
    const owner = att("att_A", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
      status: "pending",
    });
    const blocked = att("att_B", fakeFile("clip.mp4", 30 * 1024 * 1024, "video/mp4"), {
      kind: "document",
      willSendAsDocument: true,
      needsVideoAsDocumentConfirm: true,
      status: "pending",
    });
    const s0 = queueReducer(empty, { type: "add", items: [owner, blocked] });

    const s1 = applyRemoveWithCaptionTransfer(s0, "att_A");
    expect(s1.attachments[0]?.id).toBe("att_B");
    expect(s1.attachments[0]?.captionOwner).toBe(true);
    expect(s1.attachments[0]?.captionConsumed).toBe(false);
    // El flag blocked se preserva intacto.
    expect(s1.attachments[0]?.needsVideoAsDocumentConfirm).toBe(true);
  });

  it("FIX-2: sent primero y pending después → salta el sent y va al pending", () => {
    // Variante del primer caso: el sent está antes del candidato válido
    // en la cola. La búsqueda lineal debe saltárselo y elegir el pending.
    const owner = att("att_A", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
      status: "pending",
    });
    const sent = att("att_B", fakeFile("b.pdf", 1024, "application/pdf"), {
      status: "sent",
    });
    const pending = att("att_C", fakeFile("c.png", 100, "image/png"));
    const s0 = queueReducer(empty, {
      type: "add",
      items: [owner, sent, pending],
    });

    const s1 = applyRemoveWithCaptionTransfer(s0, "att_A");
    expect(s1.attachments[0]?.captionOwner).toBe(false); // B sent
    expect(s1.attachments[1]?.captionOwner).toBe(true); // C pending
  });
});

/* ------------------------------------------------------------------ */
/* canMutateQueue — guard de mutaciones durante sending                */
/* (004 corte 2e, fix #3)                                              */
/* ------------------------------------------------------------------ */

describe("canMutateQueue — guard de mutaciones durante sending (004 fix 2e)", () => {
  it("sending=false → permite mutaciones", () => {
    expect(canMutateQueue(false)).toBe(true);
  });

  it("sending=true → bloquea TODA mutación de la cola", () => {
    expect(canMutateQueue(true)).toBe(false);
  });

  // El helper es trivial pero el contrato es importante: cualquier handler
  // del composer que pueda añadir, eliminar o modificar adjuntos debe
  // consultar este guard durante un envío. Si se rompe (p. ej. alguien
  // cambia la firma), el helper deja de ser referenciado y este test
  // actúa como red de seguridad del refactor.
});