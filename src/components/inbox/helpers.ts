/** Utilidades de presentación de la bandeja. */

export function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export function formatRemaining(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const MEDIA_LABELS: Record<string, string> = {
  image: "Imagen",
  audio: "Audio",
  video: "Video",
  document: "Documento",
  sticker: "Sticker",
  location: "Ubicación",
  contacts: "Contacto compartido",
  template: "Plantilla",
};

export function mediaLabel(type: string): string {
  return MEDIA_LABELS[type] ?? "Contenido";
}

/** 008 — Tamaño humano de un adjunto. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function previewText(preview: string | null): string {
  if (!preview) return "";
  return MEDIA_LABELS[preview] ? `📎 ${MEDIA_LABELS[preview]}` : preview;
}

/* ------------------------------------------------------------------ */
/* 004 — Cola local de adjuntos del composer                          */
/* ------------------------------------------------------------------ */

/**
 * Límite del cliente para que un video se siga enviando como `kind=video`.
 * Por encima de este tamaño, el cliente lo re-taggea como `application/octet-stream`
 * y lo envía como `kind=document` (la Cloud API rechaza video > 16 MB).
 * Coincide con `MEDIA_LIMITS.video.maxBytes` del servidor.
 */
export const VIDEO_MAX_AS_VIDEO = 16 * 1024 * 1024;

/** Límite duro del cliente: coincide con `MEDIA_LIMITS.document.maxBytes`. */
export const DOC_MAX = 100 * 1024 * 1024;

export type AttachKind = "image" | "audio" | "video" | "document";

export type AttachStatus = "pending" | "sending" | "sent" | "failed";

/**
 * Estado local de un adjunto encolado en el composer. NO se persiste en BD;
 * existe solo mientras la cola esté visible. `previewUrl` se construye con
 * `URL.createObjectURL(file)` y se libera con `URL.revokeObjectURL` al
 * remover, vaciar o desmontar el composer.
 */
export type PendingAttachment = {
  /** id local con prefijo `att_`; nunca se persiste ni se envía al backend. */
  id: string;
  file: File;
  /** Object URL para `<img>`/`<video>`/`<audio>`; `null` para documentos. */
  previewUrl: string | null;
  /** tipo visual; difiere del kind de envío solo en el caso video→document. */
  kind: AttachKind;
  /** MIME que viajará al servidor (puede ser `application/octet-stream`). */
  effectiveMime: string;
  /** true cuando un video >16MB se re-taggea como documento. */
  willSendAsDocument: boolean;
  status: AttachStatus;
  error: string | null;
};

/**
 * Sustrato mínimo que `classifyForQueue` necesita para decidir. Acepta un
 * `File` real o cualquier `{ type, size }` (útil para tests con tamaños
 * arbitrarios sin construir blobs de 30 MB).
 */
export type ClassifiableFile = {
  type: string;
  size: number;
};

/**
 * Decide el kind, MIME efectivo y `willSendAsDocument` antes de encolar.
 * Devuelve `null` cuando el archivo excede el límite duro de 100 MB o su
 * MIME no es utilizable. Esta es una **pre-validación cliente suave**:
 * el servidor sigue siendo la fuente de verdad (FR-15 / NF-1).
 */
export function classifyForQueue(
  file: ClassifiableFile
): {
  kind: AttachKind;
  effectiveMime: string;
  willSendAsDocument: boolean;
} | null {
  if (file.size > DOC_MAX) return null;
  if (file.size <= 0) return null;

  const mime = file.type || "";

  if (mime.startsWith("image/")) {
    // El servidor reasignará image/bmp a document; el cliente lo muestra
    // como imagen porque el preview visual sí es de imagen.
    return {
      kind: "image",
      effectiveMime: mime || "image/jpeg",
      willSendAsDocument: false,
    };
  }

  if (mime.startsWith("audio/")) {
    return {
      kind: "audio",
      effectiveMime: mime || "audio/mpeg",
      willSendAsDocument: false,
    };
  }

  if (mime.startsWith("video/")) {
    if (file.size > VIDEO_MAX_AS_VIDEO) {
      // >16MB: la Cloud API rechaza video. El cliente lo re-taggea como
      // documento preservando el nombre original.
      return {
        kind: "document",
        effectiveMime: "application/octet-stream",
        willSendAsDocument: true,
      };
    }
    return { kind: "video", effectiveMime: mime, willSendAsDocument: false };
  }

  // Cualquier otro tipo (incluido MIME ausente) entra como documento.
  return {
    kind: "document",
    effectiveMime: mime || "application/octet-stream",
    willSendAsDocument: false,
  };
}

/** Etiqueta humana del estado (a11y, aria-label). */
export function formatAttachStatus(s: AttachStatus): string {
  switch (s) {
    case "pending":
      return "pendiente";
    case "sending":
      return "enviando";
    case "sent":
      return "enviado";
    case "failed":
      return "con error";
  }
}

/** Etiqueta humana del tipo de adjunto. */
export function humanAttachType(k: AttachKind): string {
  return MEDIA_LABELS[k] ?? "adjunto";
}
