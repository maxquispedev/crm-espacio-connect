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
  | { type: "updateStatus"; id: string; status: AttachStatus; error?: string | null };

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
 * (`addFiles`, `remove`, `clear`, `select`) y libera todos los Object URLs
 * cuando el componente que lo usa se desmonta. La pre-validación es suave;
 * el servidor sigue siendo la fuente de verdad.
 */
export function useAttachmentQueue(): {
  attachments: PendingAttachment[];
  selectedId: string | null;
  addFiles: (files: File[]) => AddFilesResult;
  remove: (id: string) => void;
  clear: () => void;
  select: (id: string | null) => void;
  /** Primera entrada pending/failed; útil para que el composer decida qué enviar. */
  firstToSend: PendingAttachment | null;
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

  const firstToSend = useMemo<PendingAttachment | null>(() => {
    return (
      state.attachments.find(
        (a) => a.status === "pending" || a.status === "failed"
      ) ?? null
    );
  }, [state.attachments]);

  return {
    attachments: state.attachments,
    selectedId: state.selectedId,
    addFiles,
    remove,
    clear,
    select,
    firstToSend,
  };
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
}: {
  attachments: PendingAttachment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
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