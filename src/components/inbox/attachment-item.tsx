"use client";

import {
  AlertTriangle,
  Check,
  FileText,
  Loader2,
  Music2,
  RotateCcw,
  Video,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type PendingAttachment,
  formatAttachStatus,
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
  onConfirmVideoAsDocument,
  onRetry,
}: {
  attachment: PendingAttachment;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  /** Cuando `needsVideoAsDocumentConfirm=true`, abre el banner de aceptación. */
  onConfirmVideoAsDocument?: () => void;
  /** Cuando `status="failed"`, ofrece reintento del envío. */
  onRetry?: () => void;
}) {
  const {
    file,
    kind,
    previewUrl,
    willSendAsDocument,
    needsVideoAsDocumentConfirm,
    status,
    error,
  } = attachment;
  const labelType = humanAttachType(kind);
  const stateLabel = error
    ? `error: ${error}`
    : `${formatAttachStatus(status)}${
        needsVideoAsDocumentConfirm
          ? ", requiere confirmación para enviar como documento"
          : ""
      }`;
  const ariaLabel = `Adjuntar ${labelType}, ${file.name}, ${formatBytes(
    file.size
  )}, ${stateLabel}`;

  // Bloqueado = aún no confirmado por el operador (video >16MB en cola).
  const isBlocked = needsVideoAsDocumentConfirm && status === "pending";

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
        status === "failed" && "border-danger",
        status === "sent" && "border-success/60 bg-success/5",
        status === "sending" && "opacity-70"
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

        {/* Indicadores de estado (esquina izquierda) */}
        {status === "sending" && (
          <div
            className="pointer-events-none absolute left-1 top-1 flex items-center gap-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-medium text-white"
            aria-hidden="true"
          >
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
          </div>
        )}
        {status === "sent" && (
          <div
            className="pointer-events-none absolute left-1 top-1 flex items-center gap-1 rounded bg-success/85 px-1 py-0.5 text-[10px] font-medium text-white"
            aria-hidden="true"
          >
            <Check className="h-3 w-3" strokeWidth={2.5} />
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

      {/* 004 — Confirmación explícita video→documento. */}
      {needsVideoAsDocumentConfirm && status === "pending" && (
        <div className="flex flex-col gap-1 rounded border border-warning-border bg-warning-soft p-1.5 text-[10px] text-warning-text">
          <p className="leading-snug">
            Excede el límite de video (16 MB). ¿Enviarlo como documento?
          </p>
          {onConfirmVideoAsDocument && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onConfirmVideoAsDocument();
                }}
                aria-label={`Enviar ${file.name} como documento`}
                className="flex min-h-[28px] flex-1 items-center justify-center rounded bg-warning-text px-1.5 py-0.5 text-[10px] font-medium text-warning-soft transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning-text"
              >
                Enviar como documento
              </button>
            </div>
          )}
        </div>
      )}

      {/* Badge "se envía como documento" cuando ya está confirmado o es doc nativo */}
      {willSendAsDocument && !needsVideoAsDocumentConfirm && (
        <p className="flex items-center gap-1 rounded bg-warning-soft px-1 py-0.5 text-[10px] font-medium text-warning-text">
          <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={1.7} />
          Se envía como documento
        </p>
      )}

      {/* 004 — Botón de reintento para estado `failed`. */}
      {status === "failed" && onRetry && (
        <div className="flex flex-col gap-1">
          {error && (
            <p
              className="line-clamp-2 text-[10px] leading-tight text-danger"
              title={error}
            >
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
            aria-label={`Reintentar envío de ${file.name}`}
            className="flex min-h-[28px] items-center justify-center gap-1 rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-medium text-danger transition-colors hover:bg-danger/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            <RotateCcw className="h-3 w-3" strokeWidth={2} />
            Reintentar
          </button>
        </div>
      )}

      {/* Botón X — oculto si está bloqueado (la confirmación tiene su propio botón)
          y oculto si está `sent` (estado terminal; eliminar es válido pero el
          operador suele querer conservarlo para verificar el preview). */}
      {!isBlocked && status !== "sent" && (
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
      )}
    </li>
  );
}