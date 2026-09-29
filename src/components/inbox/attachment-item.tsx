"use client";

import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
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
 *
 * Layout horizontal compacto (preview izquierda + info derecha) para que la
 * tarjeta comunique estado y acciones incluso a 100 px de ancho en móvil.
 */
export function AttachmentItem({
  attachment,
  selected,
  onSelect,
  onRemove,
  onConfirmVideoAsDocument,
  onRetry,
  onPrev,
  onNext,
  positionLabel,
  disabled = false,
}: {
  attachment: PendingAttachment;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  /** Cuando `needsVideoAsDocumentConfirm=true`, abre el banner de aceptación. */
  onConfirmVideoAsDocument?: () => void;
  /** Cuando `status="failed"`, ofrece reintento del envío. */
  onRetry?: () => void;
  /** Navegación explícita por teclado. */
  onPrev?: () => void;
  onNext?: () => void;
  /** "1 de 3" opcional, para que el lector de pantalla anounce contexto. */
  positionLabel?: string;
  /** 004 (corte 2e, FIX-3) — `true` durante un envío en vuelo: deshabilita
   * X (remove), Reintentar, Confirmar video→document y bloquea la tecla
   * Delete/Backspace para que no haya forma de mutar la cola mientras
   * el composer está enviando. */
  disabled?: boolean;
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
  const ariaLabel = positionLabel
    ? `Adjuntar ${labelType} ${positionLabel}, ${file.name}, ${formatBytes(
        file.size
      )}, ${stateLabel}`
    : `Adjuntar ${labelType}, ${file.name}, ${formatBytes(
        file.size
      )}, ${stateLabel}`;

  // Bloqueado = aún no confirmado por el operador (video >16MB en cola).
  const isBlocked = needsVideoAsDocumentConfirm && status === "pending";

  // Variant ring por estado: clarity > decoración.
  const stateRing =
    status === "failed"
      ? "ring-1 ring-danger/60 border-danger"
      : status === "sent"
        ? "border-success/50 bg-success/5"
        : selected
          ? "border-brand ring-2 ring-brand-soft"
          : "border-border hover:border-text-3/40";

  return (
    <li
      role="listitem"
      aria-label={ariaLabel}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
          return;
        }
        if (e.key === "ArrowLeft" && onPrev) {
          e.preventDefault();
          onPrev();
          return;
        }
        if (e.key === "ArrowRight" && onNext) {
          e.preventDefault();
          onNext();
          return;
        }
        if ((e.key === "Delete" || e.key === "Backspace") && status !== "sent") {
          // 004 (corte 2e, FIX-3) — bloquea borrado por teclado durante un
          // envío en vuelo para que no haya forma de mutar la cola.
          if (disabled) {
            e.preventDefault();
            return;
          }
          // No permite borrar lo ya enviado (estado terminal; evita pérdidas).
          e.preventDefault();
          onRemove();
        }
      }}
      tabIndex={0}
      className={cn(
        "group relative flex h-[112px] w-[160px] shrink-0 cursor-pointer gap-2 rounded-md border bg-secondary/40 p-2 transition-colors",
        stateRing,
        status === "sending" && "opacity-70"
      )}
    >
      {/* Preview */}
      <div className="relative h-full w-[88px] shrink-0 overflow-hidden rounded bg-background/60">
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

        {/* Indicadores de tipo sobre el preview (esquina superior derecha) */}
        {kind === "video" && (
          <div
            className="pointer-events-none absolute right-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-medium text-white"
            aria-hidden="true"
          >
            <Video className="inline h-3 w-3" strokeWidth={2} />
          </div>
        )}
        {kind === "audio" && (
          <div
            className="pointer-events-none absolute right-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-medium text-white"
            aria-hidden="true"
          >
            <Music2 className="inline h-3 w-3" strokeWidth={2} />
          </div>
        )}

        {/* Indicadores de estado (esquina superior izquierda) */}
        {status === "sending" && (
          <div
            className="pointer-events-none absolute left-1 top-1 flex items-center gap-1 rounded bg-black/70 px-1 py-0.5 text-[10px] font-medium text-white shadow-sm"
            aria-hidden="true"
          >
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            <span>Enviando</span>
          </div>
        )}
        {status === "sent" && (
          <div
            className="pointer-events-none absolute left-1 top-1 flex items-center gap-1 rounded bg-success px-1 py-0.5 text-[10px] font-medium text-white shadow-sm"
            aria-hidden="true"
          >
            <Check className="h-3 w-3" strokeWidth={2.5} />
            <span>Enviado</span>
          </div>
        )}
      </div>

      {/* Info + acciones (derecha) */}
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div className="min-w-0">
          <p
            className="line-clamp-2 break-all text-[11px] font-medium leading-tight text-foreground"
            title={file.name}
          >
            {file.name}
          </p>
          <p className="mt-0.5 text-[10px] text-text-3">{formatBytes(file.size)}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-text-4">
            {labelType}
          </p>
        </div>

        {/* 004 — Confirmación explícita video→documento. */}
        {needsVideoAsDocumentConfirm && status === "pending" && (
          <div className="mt-1 flex flex-col gap-1 rounded border border-warning-border bg-warning-soft p-1 text-[10px] text-warning-text">
            <p className="leading-tight">
              Excede 16 MB de video. ¿Enviar como documento?
            </p>
            {onConfirmVideoAsDocument && (
              <button
                type="button"
                onClick={(e) => {
                  if (disabled) return; // 004 (corte 2e, FIX-3)
                  e.stopPropagation();
                  onConfirmVideoAsDocument();
                }}
                disabled={disabled}
                aria-label={`Enviar ${file.name} como documento`}
                className="flex min-h-[28px] flex-1 items-center justify-center rounded bg-warning-text px-1.5 py-0.5 text-[10px] font-semibold text-warning-soft transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning-text disabled:cursor-not-allowed disabled:opacity-50"
              >
                Enviar como documento
              </button>
            )}
          </div>
        )}

        {/* Badge "se envía como documento" cuando ya está confirmado o es doc nativo */}
        {willSendAsDocument && !needsVideoAsDocumentConfirm && status !== "sent" && (
          <p className="mt-1 flex items-center gap-1 rounded bg-warning-soft px-1 py-0.5 text-[10px] font-medium text-warning-text">
            <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={1.7} />
            Como documento
          </p>
        )}

        {/* 004 — Botón de reintento para estado `failed`. */}
        {status === "failed" && onRetry && (
          <div className="mt-1 flex flex-col gap-1">
            {error && (
              <p
                className="line-clamp-2 break-all text-[10px] leading-tight text-danger"
                title={error}
              >
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={(e) => {
                if (disabled) return; // 004 (corte 2e, FIX-3)
                e.stopPropagation();
                onRetry();
              }}
              disabled={disabled}
              aria-label={`Reintentar envío de ${file.name}`}
              className="flex min-h-[28px] items-center justify-center gap-1 rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-medium text-danger transition-colors hover:bg-danger/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" strokeWidth={2} />
              Reintentar
            </button>
          </div>
        )}
      </div>

      {/* Botón X — visible siempre que la tarjeta sea interactiva
          (oculto si está bloqueado porque la confirmación tiene su propio botón;
          oculto si está sent porque es estado terminal, salvo que sea la única
          tarjeta, donde sigue mostrándose para limpiar).
          004 (corte 2e, FIX-3) — deshabilitado durante un envío en vuelo. */}
      {!isBlocked && (
        <button
          type="button"
          onClick={(e) => {
            if (disabled) return; // 004 (corte 2e, FIX-3)
            e.stopPropagation();
            onRemove();
          }}
          disabled={disabled}
          aria-label={`Quitar ${file.name} de la cola`}
          className={cn(
            "absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-text-2 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50",
            // Estado sent: opacity baja para no distraer; sigue siendo focable.
            status === "sent"
              ? "opacity-50 group-hover:opacity-100"
              : "opacity-100"
          )}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}

      {/* Botones de navegación explícita por teclado (visibles al hover/focus).
          Cubren 44×44 px reales (área cliqueable extendida con padding). */}
      {onPrev && (
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          aria-label="Adjunto anterior"
          className="absolute -left-3 top-1/2 z-10 hidden h-11 w-6 -translate-y-1/2 items-center justify-center rounded-r bg-background/85 text-text-2 opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:flex"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}
      {onNext && (
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          aria-label="Adjunto siguiente"
          className="absolute -right-3 top-1/2 z-10 hidden h-11 w-6 -translate-y-1/2 items-center justify-center rounded-l bg-background/85 text-text-2 opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:flex"
        >
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}
    </li>
  );
}