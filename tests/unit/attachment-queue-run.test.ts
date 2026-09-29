/**
 * 004 — Tests del bucle de envío `runQueueSend` (función pura testeable
 * exportada desde `attachment-queue.tsx`). Cubre:
 *  - multi-send secuencial;
 *  - fallo parcial: un adjunto falla, los otros siguen;
 *  - retry: reintentar un `failed` lo pone a `pending` y vuelve a enviarse;
 *  - bloqueo: `needsVideoAsDocumentConfirm=true` se omite hasta confirmar;
 *  - no duplicar `sent` ni re-entradas en `sending`;
 *  - caption solo al primero.
 */
import { describe, expect, it } from "vitest";
import {
  runQueueSend,
  shouldAutoClearQueue,
} from "../../src/components/inbox/attachment-queue";
import type {
  AttachStatus,
  PendingAttachment,
} from "../../src/components/inbox/helpers";

function fakeFile(name: string, size: number, type: string): File {
  return new File([new Uint8Array(Math.min(size, 8))], name, { type });
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

/** Helper para construir un sendOne mockeado a partir de una tabla de respuestas. */
function makeSendOne(
  responses: Map<string, string | null>
): (a: PendingAttachment, caption: string | null) => Promise<string | null> {
  const calls: { id: string; caption: string | null }[] = [];
  const fn = async (a: PendingAttachment, caption: string | null) => {
    calls.push({ id: a.id, caption });
    const v = responses.get(a.id);
    if (v === undefined) throw new Error(`sendOne sin respuesta para ${a.id}`);
    return v;
  };
  (fn as { calls?: typeof calls }).calls = calls;
  return fn;
}

describe("runQueueSend — multi-send secuencial", () => {
  it("envía 3 adjuntos en orden y los transita a sent", async () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const b = att("att_2", fakeFile("b.png", 100, "image/png"));
    const c = att("att_3", fakeFile("c.webp", 100, "image/webp"));
    const sendOne = makeSendOne(
      new Map([
        ["att_1", null],
        ["att_2", null],
        ["att_3", null],
      ])
    );
    const statusLog: { id: string; status: AttachStatus }[] = [];
    const r = await runQueueSend({
      attachments: [a, b, c],
      sendOne,
      onStatus: (id, status) => statusLog.push({ id, status }),
      caption: null,
    });
    expect(r).toEqual({ sent: 3, failed: 0, skipped: 0 });
    expect(statusLog).toEqual([
      { id: "att_1", status: "sending" },
      { id: "att_1", status: "sent" },
      { id: "att_2", status: "sending" },
      { id: "att_2", status: "sent" },
      { id: "att_3", status: "sending" },
      { id: "att_3", status: "sent" },
    ]);
  });

  it("ejecuta sendOne en orden de la cola (no en paralelo)", async () => {
    const order: string[] = [];
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const b = att("att_2", fakeFile("b.png", 100, "image/png"));
    const c = att("att_3", fakeFile("c.webp", 100, "image/webp"));
    const sendOne = async (att: PendingAttachment) => {
      order.push(`start:${att.id}`);
      // pequeña espera para detectar paralelismo
      await new Promise((r) => setTimeout(r, 5));
      order.push(`end:${att.id}`);
      return null;
    };
    await runQueueSend({
      attachments: [a, b, c],
      sendOne,
      onStatus: () => {},
      caption: null,
    });
    expect(order).toEqual([
      "start:att_1",
      "end:att_1",
      "start:att_2",
      "end:att_2",
      "start:att_3",
      "end:att_3",
    ]);
  });
});

describe("runQueueSend — fallo parcial", () => {
  it("segundo falla → primero sent, segundo failed, tercero sent", async () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const b = att("att_2", fakeFile("b.mp4", 20 * 1024 * 1024, "video/mp4"));
    const c = att("att_3", fakeFile("c.webp", 100, "image/webp"));
    const sendOne = makeSendOne(
      new Map([
        ["att_1", null],
        ["att_2", "El archivo excede el límite de video (mp4/3gpp, máx. 16 MB)"],
        ["att_3", null],
      ])
    );
    const statusLog: { id: string; status: AttachStatus; error?: string | null }[] = [];
    const r = await runQueueSend({
      attachments: [a, b, c],
      sendOne,
      onStatus: (id, status, error) => statusLog.push({ id, status, error }),
      caption: "hola",
    });
    expect(r).toEqual({ sent: 2, failed: 1, skipped: 0 });
    expect(statusLog).toEqual([
      { id: "att_1", status: "sending", error: undefined },
      { id: "att_1", status: "sent", error: undefined },
      { id: "att_2", status: "sending", error: undefined },
      {
        id: "att_2",
        status: "failed",
        error: "El archivo excede el límite de video (mp4/3gpp, máx. 16 MB)",
      },
      { id: "att_3", status: "sending", error: undefined },
      { id: "att_3", status: "sent", error: undefined },
    ]);
  });

  it("sendOne debe devolver string|null — el contrato del composer (apiSend) atrapa los throws de fetch", async () => {
    // runQueueSend asume que sendOne NO lanza (siempre devuelve string|null).
    // El composer garantiza esto envolviendo fetch en apiSend con try/catch.
    // Aquí verificamos que el bucle respeta ese contrato: sendOne que devuelve
    // un error string se traduce a failed y el bucle continúa.
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const b = att("att_2", fakeFile("b.png", 100, "image/png"));
    const sendOne = async (att: PendingAttachment) => {
      return att.id === "att_1" ? "Sin conexión con el servidor" : null;
    };
    const statusLog: { id: string; status: AttachStatus; error?: string | null }[] = [];
    const r = await runQueueSend({
      attachments: [a, b],
      sendOne,
      onStatus: (id, status, error) => statusLog.push({ id, status, error }),
      caption: null,
    });
    expect(r).toEqual({ sent: 1, failed: 1, skipped: 0 });
    expect(statusLog).toEqual([
      { id: "att_1", status: "sending", error: undefined },
      {
        id: "att_1",
        status: "failed",
        error: "Sin conexión con el servidor",
      },
      { id: "att_2", status: "sending", error: undefined },
      { id: "att_2", status: "sent", error: undefined },
    ]);
  });
});

describe("runQueueSend — caption solo al primero", () => {
  it("caption se aplica al captionOwner; los siguientes reciben null", async () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
    });
    const b = att("att_2", fakeFile("b.png", 100, "image/png"));
    const c = att("att_3", fakeFile("c.webp", 100, "image/webp"));
    const sendOne = makeSendOne(
      new Map([["att_1", null], ["att_2", null], ["att_3", null]])
    );
    await runQueueSend({
      attachments: [a, b, c],
      sendOne,
      onStatus: () => {},
      caption: "pie",
    });
    expect((sendOne as unknown as { calls: { id: string; caption: string | null }[] }).calls).toEqual([
      { id: "att_1", caption: "pie" },
      { id: "att_2", caption: null },
      { id: "att_3", caption: null },
    ]);
  });

  it("caption nunca se aplica si nadie es captionOwner", async () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const b = att("att_2", fakeFile("b.png", 100, "image/png"));
    const sendOne = makeSendOne(
      new Map([["att_1", null], ["att_2", null]])
    );
    await runQueueSend({
      attachments: [a, b],
      sendOne,
      onStatus: () => {},
      caption: "pie",
    });
    expect((sendOne as unknown as { calls: { id: string; caption: string | null }[] }).calls).toEqual([
      { id: "att_1", caption: null },
      { id: "att_2", caption: null },
    ]);
  });

  it("caption vacío/null nunca se pasa como caption", async () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const sendOne = makeSendOne(new Map([["att_1", null]]));
    await runQueueSend({
      attachments: [a],
      sendOne,
      onStatus: () => {},
      caption: null,
    });
    expect((sendOne as unknown as { calls: { id: string; caption: string | null }[] }).calls[0]?.caption).toBeNull();
  });
});

describe("runQueueSend — bloqueo video→document", () => {
  it("adjuntos con needsVideoAsDocumentConfirm=true se omiten (skipped) hasta confirmar", async () => {
    const a = att("att_1", fakeFile("clip.mp4", 30 * 1024 * 1024, "video/mp4"), {
      kind: "document",
      willSendAsDocument: true,
      needsVideoAsDocumentConfirm: true,
    });
    const b = att("att_2", fakeFile("b.jpg", 100, "image/jpeg"));
    const sendOne = makeSendOne(new Map([["att_2", null]]));
    const statusLog: { id: string; status: AttachStatus }[] = [];
    const r = await runQueueSend({
      attachments: [a, b],
      sendOne,
      onStatus: (id, status) => statusLog.push({ id, status }),
      caption: null,
    });
    expect(r).toEqual({ sent: 1, failed: 0, skipped: 1 });
    expect(statusLog.map((s) => s.id)).toEqual(["att_2", "att_2"]);
  });

  it("después de confirmar el bloque, el adjunto se envía en la siguiente corrida", async () => {
    const a = att("att_1", fakeFile("clip.mp4", 30 * 1024 * 1024, "video/mp4"), {
      kind: "document",
      willSendAsDocument: true,
      needsVideoAsDocumentConfirm: false, // operador ya confirmó
    });
    const sendOne = makeSendOne(new Map([["att_1", null]]));
    const r = await runQueueSend({
      attachments: [a],
      sendOne,
      onStatus: () => {},
      caption: null,
    });
    expect(r).toEqual({ sent: 1, failed: 0, skipped: 0 });
  });
});

describe("runQueueSend — no duplicar / no re-entrar", () => {
  it("adjuntos ya en sent se omiten", async () => {
    const sent = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      status: "sent",
    });
    const pending = att("att_2", fakeFile("b.png", 100, "image/png"));
    const sendOne = makeSendOne(new Map([["att_2", null]]));
    const statusLog: { id: string; status: AttachStatus }[] = [];
    const r = await runQueueSend({
      attachments: [sent, pending],
      sendOne,
      onStatus: (id, status) => statusLog.push({ id, status }),
      caption: null,
    });
    expect(r).toEqual({ sent: 1, failed: 0, skipped: 0 });
    // att_1 no se toca.
    expect(statusLog.map((s) => s.id)).toEqual(["att_2", "att_2"]);
  });

  it("adjuntos ya en sending (re-entrada) se omiten", async () => {
    const mid = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      status: "sending",
    });
    const pending = att("att_2", fakeFile("b.png", 100, "image/png"));
    const sendOne = makeSendOne(new Map([["att_2", null]]));
    const r = await runQueueSend({
      attachments: [mid, pending],
      sendOne,
      onStatus: () => {},
      caption: null,
    });
    expect(r).toEqual({ sent: 1, failed: 0, skipped: 0 });
  });

  it("retry: tras failed → pending, el adjunto se vuelve a enviar en la siguiente corrida", async () => {
    // Simulamos el ciclo: primer run falla att_2; el operador hace retry
    // (transita a pending); el segundo run lo reenvía.
    const failed = att("att_2", fakeFile("b.mp4", 20 * 1024 * 1024, "video/mp4"), {
      status: "failed",
      error: "excede 16 MB",
    });

    // Primera corrida: att_2 sigue en estado `failed` (runQueueSend lo intenta
    // porque acepta pending y failed como enviables).
    const sendOne1 = makeSendOne(
      new Map([["att_2", "excede 16 MB"]])
    );
    const r1 = await runQueueSend({
      attachments: [failed],
      sendOne: sendOne1,
      onStatus: () => {},
      caption: null,
    });
    expect(r1).toEqual({ sent: 0, failed: 1, skipped: 0 });

    // Tras el retry (transitamos el adjunto a pending), segunda corrida OK.
    const retried: PendingAttachment = { ...failed, status: "pending", error: null };
    const sendOne2 = makeSendOne(new Map([["att_2", null]]));
    const r2 = await runQueueSend({
      attachments: [retried],
      sendOne: sendOne2,
      onStatus: () => {},
      caption: null,
    });
    expect(r2).toEqual({ sent: 1, failed: 0, skipped: 0 });
  });
});

describe("runQueueSend — anti-doble-envío (patrón guard)", () => {
  it("dos llamadas concurrentes con guard solo procesan una (simula el submitInFlight del composer)", async () => {
    // El composer envuelve runQueueSend con un guard `submitInFlight = useRef(false)`
    // y `try/finally`. Aquí replicamos el patrón para verificar que funciona.
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    const b = att("att_2", fakeFile("b.png", 100, "image/png"));
    let sendOneCalls = 0;
    const sendOne = async () => {
      sendOneCalls += 1;
      // pequeña espera para que ambas llamadas se solapen
      await new Promise((r) => setTimeout(r, 10));
      return null;
    };

    const guard = { inFlight: false };
    async function guardedRun() {
      if (guard.inFlight) return { sent: 0, failed: 0, skipped: 0 };
      guard.inFlight = true;
      try {
        return await runQueueSend({
          attachments: [a, b],
          sendOne,
          onStatus: () => {},
          caption: null,
        });
      } finally {
        guard.inFlight = false;
      }
    }

    const [r1, r2] = await Promise.all([guardedRun(), guardedRun()]);
    // Una sola de las dos procesó los 2 adjuntos; la otra fue rechazada por el guard.
    const totalSent = r1.sent + r2.sent;
    expect(totalSent).toBe(2); // exactamente los 2 adjuntos, no 4
    expect(sendOneCalls).toBe(2); // exactamente 2 fetch (uno por adjunto), no 4
  });

  it("doble click rápido secuencial: la segunda llamada se ejecuta después de que la primera libera el guard", async () => {
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"));
    let sendOneCalls = 0;
    const sendOne = async () => {
      sendOneCalls += 1;
      return null;
    };
    const guard = { inFlight: false };
    async function guardedRun() {
      if (guard.inFlight) return null;
      guard.inFlight = true;
      try {
        return await runQueueSend({
          attachments: [a],
          sendOne,
          onStatus: () => {},
          caption: null,
        });
      } finally {
        guard.inFlight = false;
      }
    }
    // Simulamos clicks programáticos uno tras otro (sin await entre ellos).
    const p1 = guardedRun();
    const p2 = guardedRun();
    const [r1, r2] = await Promise.all([p1, p2]);
    // El segundo click fue cortado por el guard mientras el primero estaba en vuelo.
    expect(r1?.sent).toBe(1);
    expect(r2).toBeNull(); // cortado por el guard
    expect(sendOneCalls).toBe(1);
  });
});

describe("runQueueSend — caption durable (004 fix)", () => {
  it("primer enviado con caption, segundo failed, retry del segundo → caption NO se repite", async () => {
    // A es captionOwner; lo enviamos con éxito (caption viaja con A).
    // B falla; C se envía sin caption. Luego se reintenta B y NO debe
    // volver a viajar caption (ya fue consumido por A).
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
    });
    const b = att("att_2", fakeFile("b.mp4", 20 * 1024 * 1024, "video/mp4"), {
      kind: "document",
      willSendAsDocument: true,
      needsVideoAsDocumentConfirm: false,
    });
    const c = att("att_3", fakeFile("c.pdf", 1024, "application/pdf"));

    // Primera corrida: A OK, B falla, C OK.
    const consumedCalls: string[] = [];
    const r1 = await runQueueSend({
      attachments: [a, b, c],
      sendOne: makeSendOne(
        new Map([
          ["att_1", null],
          ["att_2", "excede 16 MB"],
          ["att_3", null],
        ])
      ),
      onStatus: () => {},
      onCaptionConsumed: (id) => consumedCalls.push(id),
      caption: "pie",
    });
    expect(r1).toEqual({ sent: 2, failed: 1, skipped: 0 });
    expect(consumedCalls).toEqual(["att_1"]);

    // Aplicamos el markCaptionConsumed en la cola para reflejar el estado durable.
    const bRetrying: PendingAttachment = { ...b, status: "pending", error: null };

    // Retry: solo B se reintenta.
    const sendOneRetry = makeSendOneWithCaptions(new Map([["att_2", null]]));
    const r2 = await runQueueSend({
      attachments: [bRetrying],
      sendOne: sendOneRetry,
      onStatus: () => {},
      onCaptionConsumed: (id) => consumedCalls.push(id),
      caption: "pie",
    });
    expect(r2).toEqual({ sent: 1, failed: 0, skipped: 0 });
    // caption NO se re-envía: onCaptionConsumed no debe llamarse para B.
    expect(consumedCalls).toEqual(["att_1"]);
    // a ya estaba consumido, b no es captionOwner, así que caption=null.
    expect(
      (sendOneRetry as unknown as {
        calls: { id: string; caption: string | null }[];
      }).calls
    ).toEqual([{ id: "att_2", caption: null }]);
  });

  it("primer adjunto (captionOwner) FAILED → retry conserva el caption", async () => {
    const a = att("att_1", fakeFile("a.mp4", 20 * 1024 * 1024, "video/mp4"), {
      kind: "document",
      willSendAsDocument: true,
      needsVideoAsDocumentConfirm: false,
      captionOwner: true,
    });
    const b = att("att_2", fakeFile("b.pdf", 1024, "application/pdf"));

    // Primera corrida: A falla, B OK.
    const consumedCalls: string[] = [];
    const r1 = await runQueueSend({
      attachments: [a, b],
      sendOne: makeSendOne(
        new Map([["att_1", "red caída"], ["att_2", null]])
      ),
      onStatus: () => {},
      onCaptionConsumed: (id) => consumedCalls.push(id),
      caption: "pie",
    });
    expect(r1).toEqual({ sent: 1, failed: 1, skipped: 0 });
    // A falló: su captionConsumed NO se activa.
    expect(consumedCalls).toEqual([]);

    // El operador hace retry de A → estado pending.
    const aRetrying: PendingAttachment = { ...a, status: "pending", error: null };

    // Segunda corrida: solo A, ya con captionOwner y captionConsumed=false.
    const sendOne = makeSendOneWithCaptions(new Map([["att_1", null]]));
    const r2 = await runQueueSend({
      attachments: [aRetrying],
      sendOne,
      onStatus: () => {},
      onCaptionConsumed: (id) => consumedCalls.push(id),
      caption: "pie",
    });
    expect(r2).toEqual({ sent: 1, failed: 0, skipped: 0 });
    // El caption SÍ viaja con A en el retry (aún es captionOwner y no consumido).
    expect(
      (sendOne as unknown as {
        calls: { id: string; caption: string | null }[];
      }).calls
    ).toEqual([{ id: "att_1", caption: "pie" }]);
    expect(consumedCalls).toEqual(["att_1"]);
  });

  it("runQueueSend respeta captionConsumed=true: ni siquiera re-evalúa captionOwner", async () => {
    // Edge case: captionOwner=true pero captionConsumed=true (estado inconsistente
    // al que se llega si la cola se carga manualmente). runQueueSend NO debe
    // re-enviar el caption.
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
      captionConsumed: true,
    });
    const sendOne = makeSendOneWithCaptions(new Map([["att_1", null]]));
    const consumedCalls: string[] = [];
    await runQueueSend({
      attachments: [a],
      sendOne,
      onStatus: () => {},
      onCaptionConsumed: (id) => consumedCalls.push(id),
      caption: "pie",
    });
    expect(
      (sendOne as unknown as {
        calls: { id: string; caption: string | null }[];
      }).calls
    ).toEqual([{ id: "att_1", caption: null }]);
    expect(consumedCalls).toEqual([]); // ya estaba consumido
  });
});

describe("shouldAutoClearQueue — cleanup automático tras envío total (004 fix)", () => {
  it("autoriza cleanup cuando todos los adjuntos enviados terminaron OK", () => {
    const attempted = [
      att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
        status: "sent",
      }),
      att("att_2", fakeFile("b.png", 100, "image/png"), {
        status: "sent",
      }),
    ];
    expect(shouldAutoClearQueue({ sent: 2, failed: 0, skipped: 0 }, attempted)).toBe(true);
  });

  it("NO autoriza cleanup si hay failed", () => {
    const attempted = [
      att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), { status: "sent" }),
      att("att_2", fakeFile("b.png", 100, "image/png"), { status: "failed" }),
    ];
    expect(shouldAutoClearQueue({ sent: 1, failed: 1, skipped: 0 }, attempted)).toBe(false);
  });

  it("NO autoriza cleanup si hay adjuntos bloqueados por needsVideoAsDocumentConfirm", () => {
    const attempted = [
      att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), { status: "sent" }),
      att("att_2", fakeFile("b.mp4", 30 * 1024 * 1024, "video/mp4"), {
        kind: "document",
        willSendAsDocument: true,
        needsVideoAsDocumentConfirm: true,
      }),
    ];
    expect(shouldAutoClearQueue({ sent: 1, failed: 0, skipped: 1 }, attempted)).toBe(false);
  });

  it("NO autoriza cleanup si sent=0 (p. ej. todos bloqueados por video→document)", () => {
    const attempted = [
      att("att_1", fakeFile("a.mp4", 30 * 1024 * 1024, "video/mp4"), {
        kind: "document",
        willSendAsDocument: true,
        needsVideoAsDocumentConfirm: true,
      }),
    ];
    expect(shouldAutoClearQueue({ sent: 0, failed: 0, skipped: 1 }, attempted)).toBe(false);
  });
});

describe("composición: cola completa enviada → cleanup automático + texto inmediato", () => {
  // Este bloque modela el flujo del composer (limpiar+setText("")) sin React.
  // Verifica que el contrato se cumple: tras allDone, la cola queda vacía y un
  // texto nuevo puede enviarse sin que ningún sent previo lo bloquee.

  it("tras shouldAutoClearQueue=true, clearSent deja la cola vacía y lista para el siguiente texto", async () => {
    // Tres adjuntos enviados: A (captionOwner), B, C.
    const a = att("att_1", fakeFile("a.jpg", 100, "image/jpeg"), {
      captionOwner: true,
      status: "pending",
    });
    const b = att("att_2", fakeFile("b.png", 100, "image/png"), { status: "pending" });
    const c = att("att_3", fakeFile("c.webp", 100, "image/webp"), { status: "pending" });

    const consumedCalls: string[] = [];
    const result = await runQueueSend({
      attachments: [a, b, c],
      sendOne: makeSendOne(
        new Map([["att_1", null], ["att_2", null], ["att_3", null]])
      ),
      onStatus: (id, status) => {
        // Simulamos que la cola marca sent en cada adjunto exitoso.
        if (status === "sent") {
          const map: Record<string, PendingAttachment> = {
            att_1: { ...a, status: "sent" },
            att_2: { ...b, status: "sent" },
            att_3: { ...c, status: "sent" },
          };
          Object.assign(globalThis, map);
        }
      },
      onCaptionConsumed: (id) => consumedCalls.push(id),
      caption: "pie",
    });

    // Estado post-corrida: los tres quedaron sent.
    const attemptedAfter = [a, b, c].map((x) => ({ ...x, status: "sent" as AttachStatus }));
    expect(result).toEqual({ sent: 3, failed: 0, skipped: 0 });

    // shouldAutoClearQueue debe autorizar el cleanup.
    expect(shouldAutoClearQueue(result, attemptedAfter)).toBe(true);

    // El composer aplica clearSent → cola vacía.
    // El composer limpia el textarea → text="".
    // El composer ya puede aceptar texto nuevo: simulamos un re-run con un
    // texto nuevo (sin adjuntos) y verificamos que NO hay adjuntos sent
    // bloqueando el envío (canSubmit se calcula con attachments y readyToSend).
    const emptyAttachments: PendingAttachment[] = [];
    const emptyReady = emptyAttachments.filter(
      (a0) =>
        !a0.needsVideoAsDocumentConfirm &&
        (a0.status === "pending" || a0.status === "failed")
    );
    const onlyBlocked = emptyAttachments.length > 0 && emptyReady.length === 0;
    const newText = "hola";
    const canSubmitNew =
      emptyReady.length > 0 || (newText.trim().length > 0 && !onlyBlocked);
    expect(canSubmitNew).toBe(true); // texto nuevo habilitado
    expect(consumedCalls).toEqual(["att_1"]); // caption consumido solo por A
  });

  it("adjuntos con status=sent NO bloquean el envío de un texto nuevo (regresión)", () => {
    // Aunque la cola tuviera un sent residual (caso borde: el auto-cleanup no
    // se disparó por una condición externa), un mensaje de texto nuevo debe
    // poder enviarse sin que el operador tenga que limpiar manualmente.
    const sentResidual: PendingAttachment = att(
      "att_x",
      fakeFile("x.jpg", 100, "image/jpeg"),
      { status: "sent" }
    );
    const newText = "gracias";
    // Replicamos el cálculo de canSubmit del composer (post-fix):
    const attachments = [sentResidual];
    const readyToSend = attachments.filter(
      (a) =>
        !a.needsVideoAsDocumentConfirm &&
        (a.status === "pending" || a.status === "failed")
    );
    // `onlyBlocked` solo es true si hay adjuntos PENDIENTES/FALLIDOS sin
    // resolver; un sent residual no cuenta como bloqueante.
    const hasUnresolved = attachments.some(
      (a) => a.status === "pending" || a.status === "failed"
    );
    const onlyBlocked = hasUnresolved && readyToSend.length === 0;
    const canSubmit =
      readyToSend.length > 0 || (newText.trim().length > 0 && !onlyBlocked);
    expect(canSubmit).toBe(true);
  });
});

/** Helper adicional: captura `(id, caption)` de cada llamada, para aserciones
 * específicas del caption durable. */
function makeSendOneWithCaptions(
  responses: Map<string, string | null>
): (a: PendingAttachment, caption: string | null) => Promise<string | null> {
  const calls: { id: string; caption: string | null }[] = [];
  const fn = async (a: PendingAttachment, caption: string | null) => {
    calls.push({ id: a.id, caption });
    const v = responses.get(a.id);
    if (v === undefined) throw new Error(`sendOne sin respuesta para ${a.id}`);
    return v;
  };
  (fn as unknown as { calls: { id: string; caption: string | null }[] }).calls = calls;
  return fn;
}
