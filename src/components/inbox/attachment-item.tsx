"use client";

import {
  AlertTriangle,
  FileText,
  Music2,
  Video,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type PendingAttachment,
  formatBytes,
  humanAttachType,
} from "./helpers";

/**
 * 004 — Tarjeta individual de la cola de adjuntos del composer.
 * Presentacional: no conoce el endpoint ni el sender. Toda mutación viaja por
 * callbacks. La previsualización usa el Object URL guardado en
 * `attachment.previewUrl`; ese Object URL se libera fuera de aquí (en
 * `useAttachmentQueue` al remover/vaciar/desmontar).
 */
export function AttachmentItem({
  attachment,
  selected,
  onSelect,
  onRemove,
}: {
  attachment: PendingAttachment;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { file, kind, previewUrl, willSendAsDocument, error } = attachment;
  const labelType = humanAttachType(kind);
  const stateLabel = error ? `error: ${error}` : "pendiente de enviar";
  const ariaLabel = `Adjuntar ${labelType}, ${file.name}, ${formatBytes(
    file.size
  )}, ${stateLabel}`;

  return (
    <li
      role="listitem"
      aria-label={ariaLabel}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      tabIndex={0}
      className={cn(
        "group relative flex w-[120px] shrink-0 cursor-pointer flex-col gap-1 rounded-md border bg-secondary/40 p-2 transition-colors",
        selected
          ? "border-brand ring-2 ring-brand-soft"
          : "border-border hover:border-text-3/40",
        error && "border-danger"
      )}
    >
      {/* Preview */}
      <div className="relative h-[72px] w-full overflow-hidden rounded bg-background/60">
        {previewUrl && kind === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={file.name}
            className="h-full w-full object-cover"
          />
        )}
        {previewUrl && kind === "video" && (
          <video
            src={previewUrl}
            className="h-full w-full object-cover"
            preload="metadata"
            muted
            playsInline
          />
        )}
        {previewUrl && kind === "audio" && (
          <div className="flex h-full w-full items-center justify-center">
            <audio
              src={previewUrl}
              controls
              preload="metadata"
              className="w-full"
            />
          </div>
        )}
        {kind === "document" && (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-text-2">
            <FileText className="h-6 w-6" strokeWidth={1.5} />
            <span className="text-[10px] uppercase tracking-wide opacity-70">
              {humanAttachType("document")}
            </span>
          </div>
        )}

        {/* Indicadores de tipo sobre el preview */}
        {kind === "video" && (
          <div className="pointer-events-none absolute right-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-medium text-white">
            <Video className="inline h-3 w-3" strokeWidth={2} />
          </div>
        )}
        {kind === "audio" && (
          <div className="pointer-events-none absolute right-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-medium text-white">
            <Music2 className="inline h-3 w-3" strokeWidth={2} />
          </div>
        )}
      </div>

      {/* Nombre + tamaño */}
      <div className="min-w-0">
        <p
          className="truncate text-xs font-medium text-foreground"
          title={file.name}
        >
          {file.name}
        </p>
        <p className="text-[10px] text-text-3">{formatBytes(file.size)}</p>
      </div>

      {/* Badge "se envía como documento" */}
      {willSendAsDocument && (
        <p className="flex items-center gap-1 rounded bg-warning-soft px-1 py-0.5 text-[10px] font-medium text-warning-text">
          <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={1.7} />
          Se envía como documento
        </p>
      )}

      {/* Botón X — siempre visible en este corte. Estados terminales y
          reintento llegan con el commit 2 (T205–T206). */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={`Quitar ${file.name}`}
        className="absolute right-1 top-1 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-background/90 p-1 text-text-2 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </li>
  );
}