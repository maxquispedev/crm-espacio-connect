/**
 * 018 — Política de HORARIO COMERCIAL de los follow-ups automáticos.
 *
 * Un seguimiento automático es un mensaje comercial que la máquina decide
 * mandar. Mandarlo a las 02:00 no es "perseguir": es quemar la reputación del
 * negocio a una hora en la que nadie compra. Este módulo es la ÚNICA fuente de
 * la ventana; ningún horario mágico vive fuera de aquí.
 *
 * Contrato:
 * - La ventana es `[09:00, 20:00)` LOCALES: las 20:00 ya están fuera.
 * - La zona es `America/Lima`, EXPLÍCITA y fija. No se usa la zona del proceso
 *   ni `UTC`: el servidor puede estar en cualquier parte y una decisión
 *   comercial que se degrada en silencio a `UTC` es una decisión que no existe.
 *   (La agenda SÍ usa `OPERATOR_TIMEZONE` porque ahí la zona es "qué día ve el
 *   operador"; aquí es "puede la máquina escribir". Son contratos distintos.)
 * - Módulo PURO: sin BD, sin red, sin reloj implícito. El `Date` entra por
 *   parámetro, igual que en `agenda-buckets`, para que los tests fijen las
 *   02:00 sin dormir.
 *
 * La aritmética de zona (instante → hora local, y muro local → instante) es la
 * ya probada de `agenda-buckets`: no se reimplementa aquí.
 */

import { fromLocalWall, zonedParts } from "@/server/inbox/agenda-buckets";
import type { SalesFollowUpReason } from "@/lib/types";

/** Zona de decisión comercial. Explícita y fija: ver la cabecera del módulo. */
export const FOLLOW_UP_TIME_ZONE = "America/Lima";

/** Minuto local de inicio permitido (09:00), inclusivo. */
export const BUSINESS_HOURS_START_MINUTE = 9 * 60;

/**
 * Minuto local del límite (20:00), EXCLUSIVO: `[start, end)`. A las 20:00:00
 * el seguimiento ya no se envía y se difiere al día siguiente a las 09:00.
 */
export const BUSINESS_HOURS_END_MINUTE = 20 * 60;

/** Razón por la que el job vuelve a `pending` sin haber intentado enviar. */
export const OUTSIDE_BUSINESS_HOURS = "outside_business_hours";

/**
 * ¿Este `reason` lo decide la máquina (y por tanto lo manda la política de
 * horario) o lo eligió una persona?
 *
 * `scheduled_wait` es una fecha que un operador elige explícitamente desde el
 * CRM (`docs/SALES_FOLLOW_UPS.md` §4 y §13: "seguimiento manual futuro",
 * "WAIT con fecha manual"). Su contrato se preserva: el normalizador no lo
 * toca. Cambiarlo sería sustituir la decisión de una persona por la del sistema.
 * Es la única línea que habría que editar si el dueño decide lo contrario.
 */
export function isAutomaticFollowUpReason(
  reason: SalesFollowUpReason
): boolean {
  return reason !== "scheduled_wait";
}

/** Minutos transcurridos desde la medianoche local. */
function localMinuteOfDay(instant: Date): number {
  const { hour, minute } = zonedParts(instant.getTime(), FOLLOW_UP_TIME_ZONE);
  return hour * 60 + minute;
}

/**
 * ¿Este instante cae dentro del horario comercial para envío automático?
 * Ventana semiabierta `[09:00, 20:00)`.
 */
export function isWithinBusinessHours(instant: Date): boolean {
  const minute = localMinuteOfDay(instant);
  return (
    minute >= BUSINESS_HOURS_START_MINUTE && minute < BUSINESS_HOURS_END_MINUTE
  );
}

/**
 * Primer instante permitido a partir de `instant`.
 *
 * - dentro de la ventana → el mismo instante (no se toca un schedule válido);
 * - antes de las 09:00 → las 09:00 de ESE mismo día local;
 * - desde las 20:00 → las 09:00 del día local SIGUIENTE.
 *
 * Los milisegundos del instante de entrada se conservan: el normalizado es
 * idempotente y job/lead siguen empatados a menos de un segundo
 * (`dueMatchesLead`).
 */
export function nextAllowedInstant(instant: Date): Date {
  const minute = localMinuteOfDay(instant);
  if (isWithinBusinessHours(instant)) return instant;

  const { year, month, day } = zonedParts(instant.getTime(), FOLLOW_UP_TIME_ZONE);
  // `Date.UTC` NO acepta un epoch en su último argumento: el milisegundo se
  // suma al muro. Se recupera el resto de milisegundo del instante de entrada
  // y se aplica aparte, para que el normalizado sea idempotente.
  const msOfSecond = ((instant.getTime() % 1000) + 1000) % 1000;
  if (minute < BUSINESS_HOURS_START_MINUTE) {
    return new Date(
      fromLocalWall(
        Date.UTC(year, month - 1, day, 9, 0, 0) + msOfSecond,
        FOLLOW_UP_TIME_ZONE
      )
    );
  }
  // `Date.UTC` resuelve el cruce de día/mes/año del calendario local.
  return new Date(
    fromLocalWall(
      Date.UTC(year, month - 1, day + 1, 9, 0, 0) + msOfSecond,
      FOLLOW_UP_TIME_ZONE
    )
  );
}

/**
 * Normaliza un `due_at` de follow-up AUTOMÁTICO al horario comercial.
 *
 * `scheduled_wait` se devuelve tal cual: fecha manual del operador.
 */
export function applyBusinessHours(
  reason: SalesFollowUpReason,
  dueAt: Date
): Date {
  if (!isAutomaticFollowUpReason(reason)) return dueAt;
  return nextAllowedInstant(dueAt);
}