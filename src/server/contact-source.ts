import type { AnuncioRowShape } from "@/lib/anuncios";

/**
 * 006 (US2, TA20) — Fuente efectiva del contacto, pura y determinista.
 *
 * Reglas:
 *  - `stored` (lo que el operador escribió a mano o importó en otro momento)
 *    siempre manda si existe y no es vacío.
 *  - Sin `stored`, un anuncio deduce "anuncio".
 *  - Sin `stored`, una publicación orgánica deduce "desconocida" (el badge
 *    del contacto en la UI no cambia: seguimos diciendo "Desconocida").
 *  - Sin nada: "desconocida".
 *
 * La función NO toca la BD, no hace log, no traduce. Es una sola decisión
 * basada en lo que el panel del contacto tiene a mano.
 *
 * Constantes exportadas para que el panel renderice sin reescribir el glosario.
 */
export const FUENTE_DESCONOCIDA = "desconocida";
export const FUENTE_ANUNCIO = "anuncio";
export const FUENTE_PUBLICACION = "publicacion";

export type EffectiveSource =
  | typeof FUENTE_DESCONOCIDA
  | typeof FUENTE_ANUNCIO
  | typeof FUENTE_PUBLICACION
  | string;

export function effectiveSource(
  stored: string | null | undefined,
  llegoPorAnuncio: AnuncioRowShape | null | undefined
): EffectiveSource {
  const s = (stored ?? "").trim();
  if (s) return s;
  if (!llegoPorAnuncio) return FUENTE_DESCONOCIDA;
  // Spec TA20: una publicación deduce "desconocida" (no cambia el badge del
  // contacto — "Desconocida" sigue siendo "Desconocida"). Solo un anuncio de
  // pago deduce "anuncio".
  return (llegoPorAnuncio.sourceType ?? "").toLowerCase() === "post"
    ? FUENTE_DESCONOCIDA
    : FUENTE_ANUNCIO;
}
