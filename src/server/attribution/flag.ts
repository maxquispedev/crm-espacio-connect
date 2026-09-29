/**
 * 006 / 007 — Bandera "ATRIBUCION" (opt-in del operador por organización).
 *
 * El spec 007 cablea esta función a una columna de la organización y/o
 * variable de entorno. Hoy es un placeholder documental: el spec 006
 * solo se preocupa de NO guardar `ctwa_clid`, cosa que el normalizador
 * (`referral.ts`) ya hace por defecto.
 *
 * Cuando esta función pase a `true`, hay que:
 *   1. Permitir `ctwa_clid` en el `AnuncioDeOrigen` (`referral.ts`).
 *   2. Persistirlo en la columna `ad_attribution.ctwa_clid`.
 *   3. Mantenerlo fuera del DTO `AnuncioDto.hasCtwaClid` (boolean, no valor).
 *   4. Cablear el envío a CAPI (otro spec).
 */

export function atribucionEnabled(): boolean {
  return false;
}
