import type { WebhookReferral } from "@/server/inbox/webhook";

/**
 * 006 — Normalizador puro del `messages[].referral` de WhatsApp.
 *
 * - Acepta el subconjunto documentado por Meta.
 * - Acota tamaños por clave (id 128, titular 300, texto 2000, URL 2048, raw 8 KB).
 * - Descarta tipos que no son string.
 * - Devuelve `null` si no hay al menos un identificador utilizable
 *   (`source_id` o `source_url` o `headline` o `ctwa_clid`).
 * - `imageUrl` prefiere `thumbnail_url` sobre `image_url` (Meta documenta el
 *   thumbnail como la versión estable).
 *
 * Pura: sin BD, sin React, sin fetch. Probada en unit.
 */

/** Cotas duras por clave. Cambiar aquí impacta tests y serialización. */
export const COTAS = {
  id: 128,
  titular: 300,
  texto: 2000,
  url: 2048,
  raw: 8_000,
} as const;

/** Claves conservadas en `raw` (subset cerrado del `referral` de Meta). */
export const CLAVES_WHATSAPP = [
  "source_url",
  "source_id",
  "source_type",
  "headline",
  "body",
  "media_type",
  "image_url",
  "video_url",
  "thumbnail_url",
  "ctwa_clid",
] as const;

export type AnuncioDeOrigen = {
  sourceId: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  headline: string | null;
  body: string | null;
  mediaType: string | null;
  imageUrl: string | null;
  /** Identificador de clic CTWA; null mientras ATRIBUCION esté apagada. */
  ctwaClid: string | null;
  /** Subset crudo acotado para auditoría / debug. Nunca contiene `ctwa_clid` cuando ATRIBUCION está apagada. */
  raw: Record<string, string>;
};

function esString(x: unknown): x is string {
  return typeof x === "string";
}

function acotar(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

/**
 * Normaliza un `referral` arbitrario (probablemente de JSON.parse) al shape
 * `AnuncioDeOrigen`. Devuelve `null` cuando no hay un solo identificador
 * utilizable: el mensaje es contexto, no origen.
 */
export function anuncioDeWhatsapp(referral: unknown): AnuncioDeOrigen | null {
  if (!referral || typeof referral !== "object") return null;
  const r = referral as Partial<WebhookReferral> & Record<string, unknown>;

  const sourceUrl = esString(r.source_url) ? acotar(r.source_url, COTAS.url) : null;
  const sourceId = esString(r.source_id) ? acotar(r.source_id, COTAS.id) : null;
  const sourceType = esString(r.source_type) ? acotar(r.source_type, COTAS.id) : null;
  const headline = esString(r.headline) ? acotar(r.headline, COTAS.titular) : null;
  const body = esString(r.body) ? acotar(r.body, COTAS.texto) : null;
  const mediaType = esString(r.media_type) ? acotar(r.media_type, COTAS.id) : null;
  const thumbnailUrl = esString(r.thumbnail_url)
    ? acotar(r.thumbnail_url, COTAS.url)
    : null;
  const imageUrl = esString(r.image_url) ? acotar(r.image_url, COTAS.url) : null;
  const videoUrl = esString(r.video_url) ? acotar(r.video_url, COTAS.url) : null;
  const ctwaClidCrudo = esString(r.ctwa_clid)
    ? acotar(r.ctwa_clid, COTAS.id)
    : null;

  // Defensa: rechaza javascript:, data:, file: y otros esquemas peligrosos.
  function urlSegura(s: string | null): string | null {
    if (s === null) return null;
    const lower = s.trim().toLowerCase();
    if (
      lower.startsWith("javascript:") ||
      lower.startsWith("data:") ||
      lower.startsWith("file:") ||
      lower.startsWith("vbscript:")
    ) {
      return null;
    }
    return s;
  }

  const sourceUrlSafe = urlSegura(sourceUrl);
  const thumbnailSafe = urlSegura(thumbnailUrl);
  const imageSafe = urlSegura(imageUrl);
  const videoSafe = urlSegura(videoUrl);

  // El `imageUrl` final prefiere `thumbnail_url` (versión estable de Meta).
  const imageUrlFinal = thumbnailSafe ?? imageSafe ?? null;

  // Sin identificadores utilizables → no es un anuncio de origen.
  const hayIdentificador =
    sourceId !== null ||
    sourceUrlSafe !== null ||
    headline !== null ||
    ctwaClidCrudo !== null;
  if (!hayIdentificador) return null;

  // ATRIBUCION apagada (estado actual): el ctwaClid se guarda null.
  // La columna `ctwa_clid` y la clave `raw.ctwa_clid` se omiten.
  // El spec 007 cablea la bandera y este default se conecta a
  // `atribucionEnabled()` sin tocar el resto del flujo.
  const ctwaClid: string | null = null;

  // raw acotado: solo claves conocidas, todo string, total <= 8 KB.
  const rawCrudo: Record<string, string> = {};
  for (const key of CLAVES_WHATSAPP) {
    if (key === "ctwa_clid") continue; // omitido por la bandera
    const v = r[key];
    if (typeof v === "string" && v.length > 0) {
      rawCrudo[key] = acotar(v, COTAS.url);
    }
  }
  const raw = acotarRaw(rawCrudo);

  // Silenciar variables no usadas (el linter se quejaría).
  void videoSafe;

  return {
    sourceId,
    sourceType,
    sourceUrl: sourceUrlSafe,
    headline,
    body,
    mediaType,
    imageUrl: imageUrlFinal,
    ctwaClid,
    raw,
  };
}

function acotarRaw(raw: Record<string, string>): Record<string, string> {
  // Recorta claves hasta que el JSON serializado quepa en COTAS.raw.
  const claves = Object.keys(raw);
  const ordenadas = claves.sort(); // determinista
  const salida: Record<string, string> = {};
  let usado = 2; // {}
  for (const k of ordenadas) {
    const v = raw[k];
    if (typeof v !== "string") continue;
    // costo aproximado: `"k":"v",`
    const costo = k.length + v.length + 6;
    if (usado + costo > COTAS.raw) {
      const restante = Math.max(0, COTAS.raw - usado - k.length - 6);
      if (restante > 1) {
        salida[k] = v.slice(0, restante - 1);
        usado = COTAS.raw;
      }
      break;
    }
    salida[k] = v;
    usado += costo;
  }
  return salida;
}

/**
 * Devuelve una COPIA sin `ctwaClid` y sin `raw.ctwa_clid`. No muta el
 * original. Hoy no hace nada porque `ctwaClid` ya viene null cuando la
 * bandera está apagada, pero deja el cableado listo para el spec 007.
 */
export function sinIdentificadorDeClic(
  anuncio: AnuncioDeOrigen
): AnuncioDeOrigen {
  const { ctwaClid: _omit, raw, ...rest } = anuncio;
  void _omit;
  const rawSinClave: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "ctwa_clid") continue;
    rawSinClave[k] = v;
  }
  return { ...rest, ctwaClid: null, raw: rawSinClave };
}
