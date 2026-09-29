"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { customAlphabet } from "nanoid";
import { CheckCircle2, ListChecks } from "lucide-react";
import {
  AUDIO_MAX,
  DOC_MAX,
  IMAGE_MAX,
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
  | { type: "clearSent" }
  | { type: "select"; id: string | null }
  | { type: "updateStatus"; id: string; status: AttachStatus; error?: string | null }
  /** Acepta el re-tag video→document y desbloquea el envío. */
  | { type: "confirmVideoAsDocument"; id: string }
  /** Transita `failed → pending` (limpia error) para reintentar el envío. */
  | { type: "retry"; id: string }
  /** Marca el captionOwner como ya enviado con su caption. */
  | { type: "markCaptionConsumed"; id: string };

export type QueueState = {
  attachments: PendingAttachment[];
  selectedId: string | null;
};

/**
 * 004 (cortes 2d + 2e) — Maneja `remove` con la regla de transferencia de
 * `captionOwner`:
 *   - Si el adjunto eliminado NO era captionOwner, o su caption YA había
 *     viajado (`captionConsumed=true`), solo lo quitamos.
 *   - Si era captionOwner con caption aún NO consumido, lo quitamos y
 *     transferimos la propiedad al primer adjunto restante elegible
 *     (captionConsumed=false explícito, para que el caption viaje con
 *     ese nuevo dueño cuando se envíe).
 *
 * Reglas duras:
 *   - Nunca transferimos a un adjunto que ya tiene `captionOwner=true`
 *     (defensivo: en la práctica solo hay un dueño a la vez, pero si el
 *     estado viniera corrupto, no creamos dueños duplicados).
 *   - 004 (corte 2e, FIX-2) — Nunca transferimos a un adjunto en estado
 *     `sent` ni `sending`: son terminales y ya NO pueden recibir un
 *     futuro envío. Un sent residual en la cola NO debe absorber el
 *     caption que aún no viajó; debe saltarse al siguiente candidato
 *     que sí pueda enviarse después.
 *   - 004 (corte 2e) — Candidato válido: status `pending` o `failed`.
 *     `needsVideoAsDocumentConfirm=true` NO excluye al candidato: el
 *     adjunto está bloqueado temporalmente pero podrá enviarse cuando
 *     el operador confirme, momento en el que el caption deberá
 *     viajar con él exactamente una vez.
 *   - Si no queda ningún candidato (caso de cola de un solo elemento o
 *     todos los restantes son sent/sending), simplemente quitamos sin
 *     transferir.
 *
 * Exportada para poder testear la regla sin React. Es una función pura.
 */
export function applyRemoveWithCaptionTransfer(
  state: QueueState,
  id: string
): QueueState {
  const removed = state.attachments.find((a) => a.id === id);
  // Id inexistente: no-op (defensivo). El reducer garantiza esto pero
  // cubrimos el caso por si alguien llama a esta helper directamente.
  if (!removed) return state;

  const remaining = state.attachments.filter((a) => a.id !== id);
  // selectedId queda null si el id eliminado era el seleccionado.
  const nextSelectedId =
    state.selectedId === id ? null : state.selectedId;

  // ¿Hay que transferir captionOwner?
  const shouldTransfer =
    removed.captionOwner === true && removed.captionConsumed === false;

  if (!shouldTransfer) {
    return {
      ...state,
      attachments: remaining,
      selectedId: nextSelectedId,
    };
  }

  // Encontrar el primer adjunto restante que:
  //   - NO sea ya captionOwner (defensivo: evita dueños duplicados)
  //   - NO esté en estado terminal (sent/sending) — esos ya no recibirán
  //     un futuro envío (corte 2e).
  // El adjunto puede estar bloqueado por needsVideoAsDocumentConfirm;
  // sigue siendo válido porque podrá enviarse tras la confirmación.
  // captionConsumed=false explícito: el caption aún no viajó y debe
  // viajar con el nuevo dueño en su próximo envío.
  const newOwnerIdx = remaining.findIndex(
    (a) =>
      a.captionOwner !== true &&
      a.status !== "sent" &&
      a.status !== "sending"
  );
  if (newOwnerIdx === -1) {
    // No hay candidato (caso borde: el único captionOwner es el que se
    // eliminó, o todos los restantes son sent/sending). Solo quitamos,
    // sin transferir.
    return {
      ...state,
      attachments: remaining,
      selectedId: nextSelectedId,
    };
  }

  const transferred = remaining.map((a, i) =>
    i === newOwnerIdx
      ? { ...a, captionOwner: true, captionConsumed: false }
      : a
  );
  return {
    ...state,
    attachments: transferred,
    selectedId: nextSelectedId,
  };
}

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
      // 004 (corte 2d) — `remove` puede transferir la propiedad del caption
      // si el eliminado era el captionOwner y su caption aún no se había
      // consumido. La lógica vive en `applyRemoveWithCaptionTransfer` para
      // poder probarla de forma aislada sin tocar React.
      return applyRemoveWithCaptionTransfer(state, action.id);
    case "clear":
      return { attachments: [], selectedId: null };
    case "clearSent":
      return {
        ...state,
        attachments: state.attachments.filter((a) => a.status !== "sent"),
        selectedId:
          state.selectedId &&
          state.attachments.find(
            (a) => a.id === state.selectedId && a.status === "sent"
          )
            ? null
            : state.selectedId,
      };
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
    case "markCaptionConsumed":
      return {
        ...state,
        attachments: state.attachments.map((a) =>
          a.id === action.id && a.captionOwner
            ? { ...a, captionConsumed: true }
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
/* Mensajes de rechazo (cliente, soft — el servidor sigue siendo SoT)  */
/* ------------------------------------------------------------------ */

/**
 * Genera un mensaje legible para `classifyForQueue` cuando devuelve `null`.
 * Refleja los límites del backend (`MEDIA_LIMITS`); NO los relaja.
 */
export function rejectionReason(file: { type: string; size: number }): string {
  if (file.size <= 0) return "Archivo vacío";
  const mime = file.type || "";
  if (file.size > DOC_MAX) {
    return `Excede el límite de ${formatBytes(DOC_MAX)} (documento)`;
  }
  if (mime.startsWith("image/") && file.size > IMAGE_MAX) {
    return `Excede el límite de ${formatBytes(IMAGE_MAX)} (imagen)`;
  }
  if (mime.startsWith("audio/") && file.size > AUDIO_MAX) {
    return `Excede el límite de ${formatBytes(AUDIO_MAX)} (audio)`;
  }
  return "Tipo de archivo no soportado";
}

/* ------------------------------------------------------------------ */
/* Resumen de progreso (helper puro, testeable)                       */
/* ------------------------------------------------------------------ */

export type QueueSummary = {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  sending: number;
  blocked: number;
};

/* ------------------------------------------------------------------ */
/* Submit del composer — fuente de verdad para la rama de submit       */
/* ------------------------------------------------------------------ */

/**
 * 004 (cortes 2d + 2e) — Modo de submit que debe ejecutar el compositor:
 *   - `"queue"` si hay adjuntos listos para enviar (no bloqueados y en
 *     estado pending/failed). En este caso el compositor entra a
 *     `submitQueue()`.
 *   - `"text"` si NO hay adjuntos pendientes/fallidos sin resolver pero
 *     hay texto en el textarea. En este caso el compositor envía texto
 *     plano por `onSend(value)`.
 *   - `"noop"` si no hay nada que enviar: ni adjuntos listos para
 *     enviar, ni texto, ni adjuntos bloqueados esperando confirmación
 *     del operador (que es el caso nuevo del corte 2e: si TODO lo
 *     pendiente/fallido está bloqueado por `needsVideoAsDocumentConfirm`,
 *     el operador primero debe confirmar o quitar el adjunto; no se
 *     envía el textarea como texto independiente).
 *
 * Reglas críticas (regresiones arregladas en cortes 2d y 2e):
 *   - Corte 2d: Adjuntos con `status="sent"` NO cuentan como "listos"
 *     (ya están terminales). Si solo queda un sent residual y el
 *     operador escribe texto, la rama debe ir a `"text"`, NO a `"queue"`
 *     (el bug anterior usaba
 *     `attachments.some(a => !a.needsVideoAsDocumentConfirm)` que
 *     consideraba sent como listo y mandaba `submitQueue()` a un bucle
 *     vacío que retornaba sin enviar el texto).
 *   - Corte 2d: Adjuntos con `needsVideoAsDocumentConfirm=true` se
 *     excluyen explícitamente del cómputo de "listos": bloqueados = no
 *     cuentan como listos aunque su status sea pending.
 *   - Corte 2e (FIX-1): Si existe AL MENOS un adjunto pending/failed
 *     pero TODOS están bloqueados por `needsVideoAsDocumentConfirm`,
 *     la rama es `"noop"`. Antes este caso caía en `"text"` y el botón
 *     Enviar estaba visualmente disabled por `canSubmit=false`, pero
 *     `submit()` seguía esa rama por Enter y enviaba el texto sin
 *     que el operador hubiera confirmado o quitado el adjunto bloqueado.
 *     Ahora botón y Enter coinciden: ambos devuelven `"noop"`.
 *   - Corte 2e: un `sent` residual NO bloquea el envío de texto (sigue
 *     cayendo en `"text"`). La regla "todos los pending/failed
 *     bloqueados" solo se cumple si HAY pending/failed pendientes de
 *     resolver; si la cola solo tiene sent residuales, el camino es
 *     "text" (es exactamente el caso del fix 2d).
 *
 * Esta helper es la única fuente de verdad que `composer.submit()`
 * consulta; el cálculo de `canSubmit` del botón y la decisión de la
 * rama de submit usan exactamente este mismo filtro para que el botón
 * y la acción no se contradigan.
 */
export type SubmitMode = "queue" | "text" | "noop";

export function decideSubmitMode(
  attachments: PendingAttachment[],
  text: string
): SubmitMode {
  const readyToSend = attachments.filter(
    (a) =>
      a.needsVideoAsDocumentConfirm === false &&
      (a.status === "pending" || a.status === "failed")
  );
  if (readyToSend.length > 0) return "queue";
  // 004 (corte 2e, FIX-1) — todos los pending/failed están bloqueados por
  // needsVideoAsDocumentConfirm: NO permitir enviar el textarea como texto
  // independiente. El operador primero debe confirmar ("Enviar como documento")
  // o quitar el adjunto. Enter y botón deben coincidir (ambos "noop").
  const hasUnresolved = attachments.some(
    (a) => a.status === "pending" || a.status === "failed"
  );
  if (hasUnresolved && readyToSend.length === 0) return "noop";
  if (text.trim().length > 0) return "text";
  return "noop";
}

/* ------------------------------------------------------------------ */
/* Cleanup del happy path del envío                                    */
/* ------------------------------------------------------------------ */

/**
 * 004 (corte 2e, FIX-3) — Helper que centraliza la decisión de permitir
 * mutaciones sobre la cola de adjuntos. Mientras `sending=true` no se debe
 * poder añadir, eliminar, ni modificar adjuntos para que la captura del
 * bucle de envío no quede desincronizada con attachments añadidos o
 * quitados a media corrida (regresión: `q.clear()` del happy path podía
 * borrar un archivo nuevo que nunca perteneció al envío original).
 *
 * Esta helper existe como punto único de consulta para:
 *   - Los handlers del composer (`ingestFiles`, `handleDragEnter`,
 *     `handleDrop`, `onPaste` con archivos, `fileRef` onChange).
 *   - Los botones que mutan estado en `AttachmentItem` (X de remove,
 *     Reintentar, Enviar como documento).
 *   - Los botones globales en `AttachmentQueueList` (Limpiar enviados,
 *     Limpiar todo).
 *
 * `sending` proviene del state local del composer (`setSending(true)`
 * se activa al inicio de `submitQueue`/`submit()` rama texto y se
 * desactiva en el `finally`). Es ortogonal al `submitInFlight` ref
 * (que cubre el caso de doble-submit concurrente): durante un envío
 * NO se debe poder tocar la cola.
 *
 * Función pura para poder probarla sin React (ver tests).
 */
export function canMutateQueue(sending: boolean): boolean {
  return !sending;
}

/**
 * 004 (corte 2d) — Recorre los adjuntos del momento de captura y revoca
 * TODAS sus previews, sin filtrar por status. Es la primitive que el
 * compositor invoca tras `shouldAutoClearQueue === true`, encapsulada
 * para que se pueda probar la semántica "no dejar Object URLs
 * huérfanas" sin levantar React.
 *
 * Por qué existe este helper:
 *   - El callback `q.clearSent()` del hook filtra por `status === "sent"`,
 *     pero la captura `const q = queueRef.current` se hace ANTES de
 *     `runQueueSend`. Si entre esa captura y la llamada a `clearSent()`
 *     el `state.attachments` del closure sigue siendo el de pre-envío
 *     (todos pending), el filtro deja la lista vacía y NO revoca nada,
 *     dejando Object URLs huérfanas aunque el reducer luego elimine los
 *     sent.
 *   - `q.clear()` revoca todo lo del closure, pero al invocarlo desde
 *     fuera del componente sigue dependiendo del estado capturado.
 *   - Este helper recurre explícitamente a la lista de adjuntos que el
 *     compositor pasó al bucle (los "originales") y revoca sin filtrar
 *     por status. Aunque el closure sea stale, los `previewUrl` siguen
 *     siendo válidos y deben liberarse.
 *
 * Devuelve el número de Object URLs revocadas, útil para tests.
 */
export function revokeAllPreviews(attachments: PendingAttachment[]): number {
  let count = 0;
  for (const a of attachments) {
    if (a.previewUrl) {
      revokePreviewUrl(a);
      count += 1;
    }
  }
  return count;
}

/** Cuenta cuántos adjuntos están en cada estado. */
export function summarize(attachments: PendingAttachment[]): QueueSummary {
  let sent = 0;
  let failed = 0;
  let pending = 0;
  let sending = 0;
  let blocked = 0;
  for (const a of attachments) {
    if (a.needsVideoAsDocumentConfirm) blocked += 1;
    if (a.status === "sent") sent += 1;
    else if (a.status === "failed") failed += 1;
    else if (a.status === "sending") sending += 1;
    else if (a.status === "pending") pending += 1;
  }
  return {
    total: attachments.length,
    sent,
    failed,
    pending,
    sending,
    blocked,
  };
}

/** Texto corto del progreso para mostrar inline. */
export function progressLabel(s: QueueSummary): string {
  if (s.total === 0) return "";
  if (s.failed > 0 && s.sent + s.failed === s.total) {
    return `${s.sent}/${s.total} enviados · ${s.failed} con error`;
  }
  if (s.sent === s.total) return `${s.sent}/${s.total} enviados`;
  if (s.sent > 0 || s.sending > 0) {
    return `${s.sent}/${s.total} enviados`;
  }
  return `${s.total} adjunto${s.total === 1 ? "" : "s"} en cola`;
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
  clearSent: () => void;
  select: (id: string | null) => void;
  selectNext: () => void;
  selectPrev: () => void;
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
  /** Marca el `captionOwner` como ya enviado con caption (idempotente). */
  markCaptionConsumed: (id: string) => void;
  /** Adjuntos en estado `pending`/`failed` que ya pueden enviarse (no bloqueados). */
  readyToSend: PendingAttachment[];
  /** Adjuntos bloqueados por `needsVideoAsDocumentConfirm`. */
  needsVideoAsDocumentConfirmCount: number;
  /** Resumen agregado para mostrar progreso. */
  summary: QueueSummary;
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
      // captionOwner es durable: solo lo fijamos si la cola NO tiene ya un
      // propietario. Si ya existe uno (p. ej. un adjunto previo falló y
      // seguimos en la misma sesión de cola), los nuevos adjuntos NO se
      // convierten en propietarios — el caption sigue siendo del primero.
      const hasOwner = state.attachments.some((a) => a.captionOwner);
      let nextIsOwner = !hasOwner;
      for (const file of fresh) {
        const classified = classifyForQueue(file);
        if (!classified) {
          rejected.push({
            file,
            reason: rejectionReason(file),
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
          captionOwner: nextIsOwner,
          captionConsumed: false,
        };
        accepted.push(att);
        nextIsOwner = false;
      }
      if (accepted.length > 0) {
        dispatch({ type: "add", items: accepted });
      }
      return { accepted, rejected };
    },
    [state.attachments]
  );

  const remove = useCallback(
    (id: string) => {
      // 004 (corte 2d) — leemos de `attachmentsRef.current` (no del closure
      // de `state.attachments`) para que la revocación sea robusta frente a
      // captures obsoletos. El compositor agarra `q = queueRef.current` antes
      // de un envío async; si entre el grab y la llamada el state cambió, el
      // ref SIEMPRE apunta al último estado renderizado y la URL que vamos a
      // revocar es la del adjunto que el caller realmente está eliminando.
      const att = attachmentsRef.current.find((a) => a.id === id);
      if (att) revokePreviewUrl(att);
      dispatch({ type: "remove", id });
    },
    []
  );

  const clear = useCallback(() => {
    // 004 (corte 2d) — usa `attachmentsRef.current` (sin deps) para que el
    // callback sea estable y la revocación NO se pierda cuando el compositor
    // captura una referencia del queue previa a una corrida de envío. Ver
    // `clearQueueOnSuccess` para el contrato del happy path.
    for (const a of attachmentsRef.current) revokePreviewUrl(a);
    dispatch({ type: "clear" });
  }, []);

  const clearSent = useCallback(() => {
    // 004 (corte 2d) — mismo patrón: lee del ref estable para no perder
    // revocaciones por closures stale.
    for (const a of attachmentsRef.current) {
      if (a.status === "sent") revokePreviewUrl(a);
    }
    dispatch({ type: "clearSent" });
  }, []);

  const select = useCallback((id: string | null) => {
    dispatch({ type: "select", id });
  }, []);

  const selectNext = useCallback(() => {
    const ids = state.attachments.map((a) => a.id);
    if (ids.length === 0) return;
    const cur = state.selectedId;
    const idx = cur ? ids.indexOf(cur) : -1;
    const next = ids[(idx + 1) % ids.length];
    if (next) dispatch({ type: "select", id: next });
  }, [state.attachments, state.selectedId]);

  const selectPrev = useCallback(() => {
    const ids = state.attachments.map((a) => a.id);
    if (ids.length === 0) return;
    const cur = state.selectedId;
    const idx = cur ? ids.indexOf(cur) : ids.length;
    const prev = ids[(idx - 1 + ids.length) % ids.length];
    if (prev) dispatch({ type: "select", id: prev });
  }, [state.attachments, state.selectedId]);

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

  const markCaptionConsumed = useCallback((id: string) => {
    dispatch({ type: "markCaptionConsumed", id });
  }, []);

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

  const summary = useMemo<QueueSummary>(
    () => summarize(state.attachments),
    [state.attachments]
  );

  return {
    attachments: state.attachments,
    selectedId: state.selectedId,
    addFiles,
    remove,
    clear,
    clearSent,
    select,
    selectNext,
    selectPrev,
    confirmVideoAsDocument,
    retry,
    updateStatus,
    markCaptionConsumed,
    readyToSend,
    needsVideoAsDocumentConfirmCount,
    summary,
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
  /**
   * Caption del textarea. Su aplicación al captionOwner se decide a partir de
   * los flags `captionOwner`/`captionConsumed` de cada adjunto (no de un
   * contador local), de modo que retries posteriores respeten lo ya enviado.
   */
  caption: string | null;
  /**
   * Notifica que el `captionOwner` acaba de enviarse CON caption (éxito).
   * Quien controla la cola debe persistir `captionConsumed=true` para
   * impedir que retries de OTROS adjuntos re-envíen el caption.
   */
  onCaptionConsumed?: (id: string) => void;
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
 * Decide si la cola puede limpiarse automáticamente tras una pasada de
 * envío: cuando (a) no hay adjuntos en `failed`, (b) no quedan bloqueos por
 * `needsVideoAsDocumentConfirm` en la población original y (c) al menos un
 * adjunto pasó a `sent`. Es una función pura para poder probarla sin React.
 *
 * Regla operativa: NO basta con que el bucle no haya fallado; hay que
 * confirmar contra los adjuntos que formaban parte del intento, porque un
 * fallo anterior todavía puede estar pendiente de reintento (`pending`) sin
 * haber sido procesado por esta pasada.
 */
export function shouldAutoClearQueue(
  result: SubmitQueueResult,
  attempted: PendingAttachment[]
): boolean {
  if (result.failed > 0) return false;
  if (result.sent === 0) return false;
  const stillBlocked = attempted.some((a) => a.needsVideoAsDocumentConfirm);
  if (stillBlocked) return false;
  return true;
}

/**
 * Recorre la cola secuencialmente (`for await`) y para cada adjunto
 * transita `pending/failed → sending → sent|failed` según el resultado.
 * Características garantizadas:
 *  - **Un fallo no aborta el resto**: cada `sendOne` se ejecuta en su propio
 *    try/catch (vía `onStatus`) y el bucle continúa.
 *  - **Caption durable**: solo el `captionOwner` con `captionConsumed=false`
 *    recibe `caption`; tras éxito se invoca `onCaptionConsumed` para
 *    persistir el flag en la cola. Retries posteriores de OTROS adjuntos
 *    (o del propio, si falló) respetan el estado durable.
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
    // La decisión de qué adjunto recibe el caption viene del estado durable
    // de la cola (captionOwner/captionConsumed), NO de un contador local:
    // así, retries de este mismo u otros adjuntos no re-envían el caption
    // que ya viajó con el primero.
    const isCaptionOwner = att.captionOwner && !att.captionConsumed;
    const thisCaption =
      isCaptionOwner && opts.caption ? opts.caption : null;
    const err = await opts.sendOne(att, thisCaption);
    if (err) {
      opts.onStatus(att.id, "failed", err);
      failed += 1;
    } else {
      opts.onStatus(att.id, "sent");
      if (isCaptionOwner && opts.onCaptionConsumed) {
        opts.onCaptionConsumed(att.id);
      }
      sent += 1;
    }
  }
  return { sent, failed, skipped };
}

/* ------------------------------------------------------------------ */
/* Presentación                                                      */
/* ------------------------------------------------------------------ */

/**
 * Cola horizontal con scroll, pensada para mostrarse sobre el textarea.
 * Muestra un header con el conteo y progreso inline ("3 adjuntos · 12 MB ·
 * 1/3 enviados") y ofrece "Limpiar enviados" cuando aplica.
 *
 * 004 (corte 2e, FIX-3) — `disabled` deshabilita los botones globales
 * "Limpiar enviados" y "Limpiar todo" para que no se pueda mutar la cola
 * mientras hay un envío en vuelo. Cada `AttachmentItem` recibe también
 * este flag para deshabilitar sus botones individuales.
 */
export function AttachmentQueueList({
  attachments,
  selectedId,
  onSelect,
  onRemove,
  onClearAll,
  onClearSent,
  onConfirmVideoAsDocument,
  onRetry,
  onSelectNext,
  onSelectPrev,
  disabled = false,
}: {
  attachments: PendingAttachment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onClearSent?: () => void;
  /** Acepta el re-tag video→document para un adjunto concreto. */
  onConfirmVideoAsDocument?: (id: string) => void;
  /** Reintenta el envío de un adjunto en estado `failed`. */
  onRetry?: (id: string) => void;
  onSelectNext?: () => void;
  onSelectPrev?: () => void;
  /** 004 (corte 2e, FIX-3) — `true` durante un envío en vuelo: deshabilita
   * los botones globales y se propaga a cada `AttachmentItem` para
   * deshabilitar también los botones individuales. */
  disabled?: boolean;
}) {
  if (attachments.length === 0) return null;

  const summary = summarize(attachments);
  const totalBytes = attachments.reduce((acc, a) => acc + a.file.size, 0);
  const label = progressLabel(summary);
  const allSent = summary.sent === summary.total && summary.total > 0;
  const showClearSent = allSent && onClearSent;

  return (
    <div className="mb-2" data-testid="attachment-queue">
      {/* Header con resumen + acciones globales */}
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-text-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <ListChecks className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
          <span className="font-medium text-text-2">
            {attachments.length} adjunto{attachments.length === 1 ? "" : "s"}
          </span>
          <span aria-hidden="true">·</span>
          <span className="text-text-3">{formatBytes(totalBytes)}</span>
          {label && (
            <>
              <span aria-hidden="true">·</span>
              <span
                className={
                  summary.failed > 0 ? "text-danger-text" : "text-success-text"
                }
                aria-live="polite"
              >
                {label}
              </span>
            </>
          )}
          {allSent && (
            <CheckCircle2
              className="h-3.5 w-3.5 shrink-0 text-success"
              strokeWidth={1.7}
              aria-hidden="true"
            />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {showClearSent && (
            <button
              type="button"
              onClick={onClearSent}
              disabled={disabled}
              aria-label="Quitar adjuntos enviados de la cola"
              className="rounded px-2 py-1 text-[11px] font-medium text-text-3 transition-colors hover:bg-secondary hover:text-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50"
            >
              Limpiar enviados
            </button>
          )}
          {!allSent && attachments.length > 1 && (
            <button
              type="button"
              onClick={onClearAll}
              disabled={disabled}
              aria-label="Limpiar toda la cola de adjuntos"
              className="rounded px-2 py-1 text-[11px] font-medium text-text-3 transition-colors hover:bg-secondary hover:text-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50"
            >
              Limpiar todo
            </button>
          )}
        </div>
      </div>

      <ul
        role="list"
        aria-live="polite"
        aria-label={`${attachments.length} adjunto${
          attachments.length === 1 ? "" : "s"
        } en cola`}
        className="flex max-w-full flex-1 flex-nowrap items-stretch gap-2 overflow-x-auto pb-1"
      >
        {attachments.map((att, i) => (
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
            onPrev={onSelectPrev ? () => onSelectPrev() : undefined}
            onNext={onSelectNext ? () => onSelectNext() : undefined}
            positionLabel={`${i + 1} de ${attachments.length}`}
            disabled={disabled}
          />
        ))}
      </ul>
    </div>
  );
}

// `fileKey` ya está exportado arriba.