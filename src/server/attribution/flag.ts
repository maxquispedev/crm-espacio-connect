/**
 * 007 — Bandera "ATRIBUCION" (opt-in del operador por instancia).
 *
 * Apagada por defecto. Cualquier valor distinto de `'on'` ⇒ apagada.
 * Mientras esté apagada:
 *  - Toda la superficie CAPI (APIs, schema visible, captura de ctwa_clid
 *    que 006 ya omite) está inactiva.
 *  - El reporte de conversiones es `skipped` con motivo.
 *  - La UI Ajustes → Anuncios no se renderiza.
 *
 * Encendida (`ATRIBUCION=on`):
 *  - El ctwa_clid que 006 ya captura se persiste (ver `referral.ts`).
 *  - Las APIs `/api/settings/capi/*` responden 200.
 *  - El gateway del Corte A engancha `reportStageChange` después del commit.
 *  - La pestaña Anuncios aparece en Ajustes (Corte C).
 *
 * Se evalúa en runtime, no en build: el valor se lee de `process.env`
 * cada vez (cheap, sin caché) para permitir flippear la bandera sin
 * reiniciar el contenedor. Los strings vacíos cuentan como ausentes
 * (compose/paneles suelen inyectar VAR="").
 */
export function isCapiEnabled(): boolean {
  return process.env.ATRIBUCION === "on";
}

/**
 * @deprecated compatibilidad hacia atrás con 006, que ya usaba este nombre
 * antes de cablear el spec 007. La nueva API canónica es `isCapiEnabled()`.
 */
export function atribucionEnabled(): boolean {
  return isCapiEnabled();
}
