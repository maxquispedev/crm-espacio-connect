"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { customAlphabet } from "nanoid";
import {
  type AttachStatus,
  type PendingAttachment,
  classifyForQueue,
  formatBytes,
} from "./helpers";
import { AttachmentItem } from "./attachment-item";

/* ------------------------------------------------------------------ */
/* Reducer puro — testeable sin React.                                */
/* ------------------------------------------------------------------ */

export type QueueAction =
  | {
      type: "add";
      items: PendingAttachment[];
    }
  | { type: "remove"; id: string }
  | { type: "clear" }
  | { type: "select"; id: string | null }
  | { type: "updateStatus"; id: string; status: AttachStatus; error?: string | null }
  /** Acepta el re-tag video→document y desbloquea el envío. */
  | { type: "confirmVideoAsDocument"; id: string }
  /** Transita `failed → pending` (limpia error) para reintentar el envío. */
  | { type: "retry"; id: string };

export type QueueState = {
  attachments: PendingAttachment[];
  selectedId: string | null;
};

/**
 * Máquina de estados mínima de la cola. El manejo de Object URLs vive en
 * el hook (porque requiere `URL.revokeObjectURL`), no aquí.
 */
export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case "add":
      return {
        ...state,
        attachments: [...state.attachments, ...action.items],
      };
    case "remove":
      return {
        ...state,
        attachments: state.attachments.filter((a) => a.id !== action.id),
        selectedId:
          state.selectedId === action.id ? null : state.selectedId,
      };
    case "clear":
      return { attachments: [], selectedId: null };
    case "select":
      return { ...state, selectedId: action.id };
    case "updateStatus":
      return {
        ...state,
        attachments: state.attachments.map((a) =>
          a.id === action.id
            ? { ...a, status: action.status, error: action.error ?? null }
            : a
        ),
      };
    case "confirmVideoAsDocument":
      return {
        ...state,
        attachments: state.attachments.map((a) =>
          a.id === action.id
            ? { ...a, needsVideoAsDocumentConfirm: false }
            : a
        ),
      };
    case "retry":
      return {
        ...state,
        attachments: state.attachments.map((a) =>
          a.id === action.id && a.status === "failed"
            ? { ...a, status: "pending", error: null }
            : a
        ),
      };
  }
}

/* ------------------------------------------------------------------ */
/* IDs locales                                                       */
/* ------------------------------------------------------------------ */

const localId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

/** Generador de IDs locales con prefijo `att_`. */
export function newAttachmentId(): string {
  return `att_${localId()}`;
}

/* ------------------------------------------------------------------ */
/* Object URLs — creación y liberación                               */
/* ------------------------------------------------------------------ */

/** Construye un Object URL si la cola debe mostrarlo (no en documents). */
export function makePreviewUrl(
  file: File,
  kind: PendingAttachment["kind"]
): string | null {
  if (kind === "document") return null;
  return URL.createObjectURL(file);
}

/** Libera el Object URL de un adjunto si lo tiene. */
export function revokePreviewUrl(att: PendingAttachment): void {
  if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
}

/* ------------------------------------------------------------------ */
/* Dedup                                                              */
/* ------------------------------------------------------------------ */

/**
 * Identidad razonable de un archivo: nombre + tamaño + lastModified.
 * `lastModified` es 0 en algunos orígenes (p. ej. pegados antiguos); en ese
 * caso se acepta el match por nombre + tamaño. Esto evita pegar/dropear dos
 * veces el mismo adjunto sin filtrar archivos distintos con nombres iguales.
 */
export function fileKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

/** Devuelve los archivos de `incoming` que no están ya en `existing`. */
export function filterDuplicates(
  existing: PendingAttachment[],
  incoming: File[]
): File[] {
  const known = new Set(existing.map((a) => fileKey(a.file)));
  const seenInBatch = new Set<string>();
  const result: File[] = [];
  for (const f of incoming) {
    const key = fileKey(f);
    if (known.has(key)) continue;
    if (seenInBatch.has(key)) continue;
    seenInBatch.add(key);
    result.push(f);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Hook                                                              */
/* ------------------------------------------------------------------ */

export type AddFilesResult = {
  accepted: PendingAttachment[];
  rejected: { file: File; reason: string }[];
};

/**
 * Hook de la cola de adjuntos. Mantiene `attachments`, ofrece acciones
 * (`addFiles`, `remove`, `clear`, `select`, `confirmVideoAsDocument`,
 * `retry`, `updateStatus`) y libera todos los Object URLs cuando el
 * componente que lo usa se desmonta. La pre-validación es suave; el servidor
 * sigue siendo la fuente de verdad.
 */
export function useAttachmentQueue(): {
  attachments: PendingAttachment[];
  selectedId: string | null;
  addFiles: (files: File[]) => AddFilesResult;
  remove: (id: string) => void;
  clear: () => void;
  select: (id: string | null) => void;
  /** Acepta el re-tag video→document; desbloquea el envío del adjunto. */
  confirmVideoAsDocument: (id: string) => void;
  /** Transita `failed → pending` para reintentar el envío. */
  retry: (id: string) => void;
  /** Actualiza estado/error desde el loop de envío del composer. */
  updateStatus: (
    id: string,
    status: AttachStatus,
    error?: string | null
  ) => void;
  /** Adjuntos en estado `pending`/`failed` que ya pueden enviarse (no bloqueados). */
  readyToSend: PendingAttachment[];
  /** Adjuntos bloqueados por `needsVideoAsDocumentConfirm`. */
  needsVideoAsDocumentConfirmCount: number;
} {
  const [state, dispatch] = useReducer(queueReducer, {
    attachments: [],
    selectedId: null,
  });

  // Mantenemos una referencia al array actual para que el cleanup de unmount
  // (que solo se ejecuta una vez) recorra TODOS los adjuntos vivos al momento
  // del desmontaje, no los del primer render.
  const attachmentsRef = useRef<PendingAttachment[]>(state.attachments);
  attachmentsRef.current = state.attachments;

  // Cleanup al desmontar: revoca todas las URLs que sigan vivas.
  useEffect(() => {
    return () => {
      for (const a of attachmentsRef.current) revokePreviewUrl(a);
    };
  }, []);

  const addFiles = useCallback(
    (files: File[]): AddFilesResult => {
      const accepted: PendingAttachment[] = [];
      const rejected: { file: File; reason: string }[] = [];
      const fresh = filterDuplicates(state.attachments, files);
      for (const file of fresh) {
        const classified = classifyForQueue(file);
        if (!classified) {
          rejected.push({
            file,
            reason:
              file.size > 100 * 1024 * 1024
                ? `Excede el límite de ${formatBytes(100 * 1024 * 1024)}`
                : "Tipo de archivo no soportado",
          });
          continue;
        }
        const att: PendingAttachment = {
          id: newAttachmentId(),
          file,
          previewUrl: makePreviewUrl(file, classified.kind),
          ...classified,
          status: "pending",
          error: null,
        };
        accepted.push(att);
      }
      if (accepted.length > 0) {
        dispatch({ type: "add", items: accepted });
      }
      return { accepted, rejected };
    },
    [state.attachments]
  );

  const remove = useCallback((id: string) => {
    const att = state.attachments.find((a) => a.id === id);
    if (att) revokePreviewUrl(att);
    dispatch({ type: "remove", id });
  }, [state.attachments]);

  const clear = useCallback(() => {
    for (const a of state.attachments) revokePreviewUrl(a);
    dispatch({ type: "clear" });
  }, [state.attachments]);

  const select = useCallback((id: string | null) => {
    dispatch({ type: "select", id });
  }, []);

  const confirmVideoAsDocument = useCallback((id: string) => {
    dispatch({ type: "confirmVideoAsDocument", id });
  }, []);

  const retry = useCallback((id: string) => {
    dispatch({ type: "retry", id });
  }, []);

  const updateStatus = useCallback(
    (id: string, status: AttachStatus, error: string | null = null) => {
      dispatch({ type: "updateStatus", id, status, error });
    },
    []
  );

  const readyToSend = useMemo<PendingAttachment[]>(() => {
    return state.attachments.filter(
      (a) =>
        !a.needsVideoAsDocumentConfirm &&
        (a.status === "pending" || a.status === "failed")
    );
  }, [state.attachments]);

  const needsVideoAsDocumentConfirmCount = useMemo<number>(
    () => state.attachments.filter((a) => a.needsVideoAsDocumentConfirm).length,
    [state.attachments]
  );

  return {
    attachments: state.attachments,
    selectedId: state.selectedId,
    addFiles,
    remove,
    clear,
    select,
    confirmVideoAsDocument,
    retry,
    updateStatus,
    readyToSend,
    needsVideoAsDocumentConfirmCount,
  };
}

/* ------------------------------------------------------------------ */
/* Bucle de envío — función pura testeable                          */
/* ------------------------------------------------------------------ */

export type SubmitQueueOptions = {
  /** Adjuntos a intentar enviar (se filtran en orden de aparición). */
  attachments: PendingAttachment[];
  /** Función de envío: devuelve `null` en éxito, mensaje de error en fallo. */
  sendOne: (
    att: PendingAttachment,
    caption: string | null
  ) => Promise<string | null>;
  /** Notificación de transición de estado por adjunto. */
  onStatus: (id: string, status: AttachStatus, error?: string | null) => void;
  /** Caption del textarea; se aplica SOLO al primer adjunto intentado. */
  caption: string | null;
};

export type SubmitQueueResult = {
  /** Número de adjuntos que terminaron en `sent`. */
  sent: number;
  /** Número de adjuntos que terminaron en `failed`. */
  failed: number;
  /** Número de adjuntos bloqueados por `needsVideoAsDocumentConfirm`. */
  skipped: number;
};

/**
 * Recorre la cola secuencialmente (`for await`) y para cada adjunto
 * transita `pending/failed → sending → sent|failed` según el resultado.
 * Características garantizadas:
 *  - **Un fallo no aborta el resto**: cada `sendOne` se ejecuta en su propio
 *    try/catch (vía `onStatus`) y el bucle continúa.
 *  - **Caption solo en el primero**: el primer adjunto que se intenta enviar
 *    recibe `caption`; los siguientes reciben `null`.
 *  - **Bloqueos respetados**: `needsVideoAsDocumentConfirm=true` se ignora
 *    hasta que el operador confirme (no se envía nada por error).
 *  - **No se duplican adjuntos `sent`**: ya están terminales, se omiten.
 *  - **Idempotente en `sending`**: si por algún motivo se llama con un
 *    adjunto ya en `sending`, se omite (defensivo contra re-entradas).
 */
export async function runQueueSend(
  opts: SubmitQueueOptions
): Promise<SubmitQueueResult> {
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let captionConsumed = false;
  for (const att of opts.attachments) {
    if (att.needsVideoAsDocumentConfirm) {
      skipped += 1;
      continue;
    }
    if (att.status === "sent" || att.status === "sending") {
      // sent: ya terminal. sending: defensivo, evitar re-entrada.
      continue;
    }
    opts.onStatus(att.id, "sending");
    const thisCaption =
      !captionConsumed && opts.caption
        ? (captionConsumed = true, opts.caption)
        : null;
    const err = await opts.sendOne(att, thisCaption);
    if (err) {
      opts.onStatus(att.id, "failed", err);
      failed += 1;
    } else {
      opts.onStatus(att.id, "sent");
      sent += 1;
    }
  }
  return { sent, failed, skipped };
}

/* ------------------------------------------------------------------ */
/* Presentación                                                      */
/* ------------------------------------------------------------------ */

/** Cola horizontal con scroll, pensada para mostrarse sobre el textarea. */
export function AttachmentQueueList({
  attachments,
  selectedId,
  onSelect,
  onRemove,
  onClearAll,
  onConfirmVideoAsDocument,
  onRetry,
}: {
  attachments: PendingAttachment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  /** Acepta el re-tag video→document para un adjunto concreto. */
  onConfirmVideoAsDocument?: (id: string) => void;
  /** Reintenta el envío de un adjunto en estado `failed`. */
  onRetry?: (id: string) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="mb-2 flex items-center gap-2">
      <ul
        role="list"
        aria-live="polite"
        aria-label={`${attachments.length} adjunto${
          attachments.length === 1 ? "" : "s"
        } en cola`}
        className="flex max-w-full flex-1 flex-nowrap gap-2 overflow-x-auto pb-1"
      >
        {attachments.map((att) => (
          <AttachmentItem
            key={att.id}
            attachment={att}
            selected={att.id === selectedId}
            onSelect={() => onSelect(att.id)}
            onRemove={() => onRemove(att.id)}
            onConfirmVideoAsDocument={
              onConfirmVideoAsDocument
                ? () => onConfirmVideoAsDocument(att.id)
                : undefined
            }
            onRetry={onRetry ? () => onRetry(att.id) : undefined}
          />
        ))}
      </ul>
      {attachments.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          aria-label="Limpiar toda la cola de adjuntos"
          className="shrink-0 rounded px-2 py-1 text-xs font-medium text-text-3 hover:bg-secondary hover:text-text-2"
        >
          Limpiar todo
        </button>
      )}
    </div>
  );
}

// `fileKey` ya está exportado arriba.