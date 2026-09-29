import type { AnuncioDeOrigen } from "@/server/attribution/referral";
import type { AnuncioDto, AnuncioListaDto } from "@/lib/types";

/**
 * 006 — Helpers puros sobre la tabla `ad_attribution`.
 *
 * Convierten entre el row de la BD, el `AnuncioDeOrigen` del normalizador,
 * y los DTOs que viajan por API. Ninguna abre BD, ninguno hace fetch.
 *
 * NUNCA exponen `ctwa_clid` por API — eso es una promesa constitucional
 * (el spec 007 cablea la bandera que decide si se guarda o no).
 */

/** Filas del normalizador listas para guardar como `ad_attribution`. */
export type AnuncioParaGuardar = {
  ctwaClid: string | null;
  sourceId: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  headline: string | null;
  body: string | null;
  mediaType: string | null;
  raw: Record<string, string>;
};

export function anuncioParaGuardar(
  a: AnuncioDeOrigen
): AnuncioParaGuardar {
  return {
    ctwaClid: a.ctwaClid,
    sourceId: a.sourceId,
    sourceType: a.sourceType,
    sourceUrl: a.sourceUrl,
    headline: a.headline,
    body: a.body,
    mediaType: a.mediaType,
    raw: a.raw,
  };
}

export function listaDesdeRow(
  row: AnuncioRowShape | null | undefined
): AnuncioListaDto | null {
  if (!row) return null;
  return {
    headline: row.headline ?? null,
    sourceId: row.sourceId ?? null,
    sourceType: row.sourceType ?? null,
  };
}

export function anuncioDesdeRow(
  row: AnuncioRowShape | null | undefined
): AnuncioDto | null {
  if (!row) return null;
  return {
    headline: row.headline ?? null,
    sourceId: row.sourceId ?? null,
    sourceType: row.sourceType ?? null,
    sourceUrl: row.sourceUrl ?? null,
    body: row.body ?? null,
    mediaType: row.mediaType ?? null,
    imageAssetId: row.imageAssetId ?? null,
    // La bandera "tiene CTWA_CLID" se reporta solo como boolean; el valor
    // jamás sale de la API aunque la bandera cambie.
    hasCtwaClid: row.ctwaClid !== null,
    capturedAt: row.createdAt.toISOString(),
  };
}

/**
 * Shape que la tabla entrega al código. Aislada aquí para que el código de
 * arriba no dependa de Drizzle directamente.
 */
export type AnuncioRowShape = {
  id: string;
  organizationId: string;
  contactId: string;
  conversationId: string;
  ctwaClid: string | null;
  sourceId: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  headline: string | null;
  body: string | null;
  mediaType: string | null;
  raw: unknown;
  imageAssetId: string | null;
  createdAt: Date;
};
