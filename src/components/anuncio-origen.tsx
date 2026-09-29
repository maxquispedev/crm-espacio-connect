"use client";

import { Megaphone, FileText, ExternalLink, ImageOff, Video } from "lucide-react";
import type { AnuncioDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 006 (US2, TB01) — Tarjeta reusable del anuncio de origen.
 *
 * Vive en el panel del contacto (debajo del header) y, en variantes más
 * delgadas, como línea secundaria en la lista y en el pipeline.
 *
 * Defensa clave:
 *  - NUNCA muestra el valor de `ctwaClid`; solo sabe si está o no
 *    (`anuncio.hasCtwaClid` es boolean).
 *  - Si la URL del creativo no es `https://`, el enlace "Ver anuncio" no se
 *    renderiza (un anchor `javascript:` o `http://` no se filtra en el DTO;
 *    lo filtramos aquí por defensa de UI).
 *  - Si no hay `imageAssetId` (descarga fallida, host no permitido, etc.),
 *    muestra un placeholder "Sin imagen" del mismo ancho que la miniatura.
 *  - `key={anuncio.imageAssetId ?? "none"}` permite forzar re-render del
 *    <img> cuando la reparación del creativo llega tarde.
 */
export function AnuncioOrigen({
  anuncio,
  conversationCreatedAt,
  className,
}: {
  anuncio: AnuncioDto;
  /** ISO de la creación de la conversación — se muestra como "Primer mensaje · hace X". */
  conversationCreatedAt?: string | null;
  className?: string;
}) {
  const safeSourceUrl =
    anuncio.sourceUrl?.startsWith("https://") ? anuncio.sourceUrl : null;
  const isVideo = (anuncio.mediaType ?? "").toLowerCase() === "video";
  const tipo = (anuncio.sourceType ?? "").toLowerCase() === "post"
    ? "Publicación"
    : "Anuncio";
  const Icon = tipo === "Publicación" ? FileText : Megaphone;

  return (
    <article
      className={cn(
        "rounded-md border bg-secondary/40 p-3",
        className
      )}
      aria-label={`${tipo} de origen`}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-[650] text-text-2">
          <Icon className="h-3.5 w-3.5 text-text-3" strokeWidth={1.7} />
          {tipo} de origen
        </span>
        {isVideo && (
          <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[10.5px] text-text-2">
            <Video className="h-3 w-3" strokeWidth={1.7} />
            con video
          </span>
        )}
      </header>

      <div className="flex gap-3">
        {anuncio.imageAssetId ? (
          <img
            key={anuncio.imageAssetId}
            src={`/api/media/${anuncio.imageAssetId}`}
            alt={`Creativo del ${tipo.toLowerCase()}`}
            className="h-[72px] w-[72px] shrink-0 rounded border border-border bg-background object-cover"
            loading="lazy"
          />
        ) : (
          <div
            aria-label="Sin imagen del creativo"
            className="flex h-[72px] w-[72px] shrink-0 flex-col items-center justify-center rounded border border-dashed border-border bg-background text-text-3"
          >
            <ImageOff className="h-5 w-5" strokeWidth={1.5} />
            <span className="mt-0.5 text-[10px]">Sin imagen</span>
          </div>
        )}

        <div className="min-w-0 flex-1">
          {anuncio.headline && (
            <p
              className="text-[13px] font-[600] leading-snug text-foreground"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {anuncio.headline}
            </p>
          )}
          {anuncio.body && (
            <p
              className="mt-0.5 text-[12px] leading-snug text-text-3"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {anuncio.body}
            </p>
          )}
          {conversationCreatedAt && (
            <p className="mt-1.5 text-[11px] text-text-3">
              Primer mensaje ·{" "}
              <span title={conversationCreatedAt}>
                {formatRelativeShort(conversationCreatedAt)}
              </span>
            </p>
          )}
          {anuncio.sourceId && (
            <p className="mt-1 text-[11px] text-text-3">
              ID{" "}
              <code className="rounded bg-background px-1 py-px font-mono text-[10.5px] text-text-2">
                {anuncio.sourceId}
              </code>
            </p>
          )}
          {safeSourceUrl && (
            <a
              href={safeSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-brand-text underline underline-offset-2 hover:text-brand"
            >
              Ver {tipo.toLowerCase()}
              <ExternalLink className="h-3 w-3" strokeWidth={1.7} />
            </a>
          )}
        </div>
      </div>

      {/* `hasCtwaClid` solo como presencia — nunca como valor. Sirve al
          futuro spec 007 (Conversions API / Ajustes → Anuncios) sin filtrar
          el identificador del clic en esta UI. */}
      {anuncio.hasCtwaClid && (
        <p className="mt-2 text-[10.5px] text-text-3">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand align-middle" />
          <span className="ml-1.5 align-middle">clic CTWA atribuido</span>
        </p>
      )}
    </article>
  );
}

/**
 * Diferencia humana corta, sin dependencias externas.
 * Equivale al "formatDistanceToNow" de date-fns pero con locales en español.
 */
function formatRelativeShort(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return "hace segundos";
  const min = Math.round(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const day = Math.round(hr / 24);
  if (day < 30) return `hace ${day} d`;
  const month = Math.round(day / 30);
  if (month < 12) return `hace ${month} mes${month === 1 ? "" : "es"}`;
  const year = Math.round(month / 12);
  return `hace ${year} año${year === 1 ? "" : "s"}`;
}
