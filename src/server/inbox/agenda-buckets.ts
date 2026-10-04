/**
 * 013 C3 — Buckets de la Agenda humana, en el servidor y SIN dependencias.
 *
 * Un recordatorio humano es un compromiso de una persona con una fecha. La
 * pregunta "¿es hoy, mañana o más adelante?" no la puede responder el cliente
 * sin discrepar del reloj del servidor (dos `Date.now()`, dos zona horaria, dos
 * resultado). Por eso los grupos se calculan AQUÍ, con un `now` inyectable, y
 * el cliente solo los pinta (spec §2.3, plan §4.2/§5 D-2).
 *
 * Reglas:
 * - En BD el `due_at` es UTC (`timestamp`). Agrupar por el día natural del
 *   operador exige convertir, igual que hace el hotfix de `claimDueJobs`
 *   documentado en `docs/SALES_FOLLOW_UPS.md`: el motor automático agrupa por
 *   fecha local y la BD guarda UTC.
 * - `now` entra como parámetro (nunca `Date.now()` dentro) para que los tests
 *   fijen medianoche, 23:59 o el cambio de día sin dormir.
 * - Este módulo es PURO: sin BD, sin red, sin WhatsApp. La Agenda solo ordena
 *   compromisos; no envía nada (plan §5 D-5).
 */

/** Los cinco grupos de la Agenda, en el orden en que se pintan. */
export const AGENDA_BUCKETS = ["overdue", "today", "tomorrow", "week", "later"] as const;

export type AgendaBucket = (typeof AGENDA_BUCKETS)[number];

export function isAgendaBucket(value: unknown): value is AgendaBucket {
  return typeof value === "string" && (AGENDA_BUCKETS as readonly string[]).includes(value);
}

type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = domingo … 6 = sábado, en la fecha LOCAL del operador. */
  weekday: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    // `h23` y no `hour12: false`: en algunas versiones de ICU `hour12: false`
    // devuelve "24" para medianoche y un día empezaría en las 24:00:00.
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(timeZone, created);
  return created;
}

/** Descompone un instante UTC en la fecha/hora que ve el operador. */
export function zonedParts(instantMs: number, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const read: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") read[part.type] = part.value;
  }
  const year = Number(read.year ?? "0");
  const month = Number(read.month ?? "0");
  const day = Number(read.day ?? "0");
  return {
    year,
    month,
    day,
    hour: Number(read.hour ?? "0"),
    minute: Number(read.minute ?? "0"),
    second: Number(read.second ?? "0"),
    // La fecha local, interpreterda como UTC, da el día de la semana sin que
    // el offset pueda desplazarlo.
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** ¿Es una zona horaria que `Intl` entiende? (IANA tipo `America/Lima`.) */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Zona de agrupación. Prioridad: la que pide el cliente (para que un operador
 * que trabaja desde otro horario vea sus días, no los del servidor) → la
 * configurada en la instancia (`OPERATOR_TIMEZONE`, una instancia = un
 * negocio) → la del proceso → `UTC`.
 *
 * Lo que NUNCA hace es decidir el grupo: eso siempre es aritmética de este
 * módulo en el servidor. El cliente solo declara desde qué reloj lee.
 */
export function resolveOperatorTimeZone(requested?: string | null): string {
  const candidate = requested?.trim();
  if (candidate && isValidTimeZone(candidate)) return candidate;
  const configured = process.env.OPERATOR_TIMEZONE?.trim();
  if (configured && isValidTimeZone(configured)) return configured;
  try {
    const serverZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (serverZone && isValidTimeZone(serverZone)) return serverZone;
  } catch {
    // Sin zona del proceso: `UTC` es un default honesto y no lanza.
  }
  return "UTC";
}

/** Desplazamiento de la zona respecto de UTC, en ms, en ese instante. */
function offsetMs(instantMs: number, timeZone: string): number {
  const p = zonedParts(instantMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Se descarta la fracción de segundo: el formato solo llega al segundo.
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Convierte un "muro" local (un `Date.UTC` que representa lo que el operador ve
 * en su reloj) al instante UTC real. Dos rondas corrigen el offset porque en un
 * cambio de horario el primer guess puede usar el offset equivocado: el muro se
 * calcula con un offset y el resultado se vuelve a interpretar con otro.
 */
function fromLocalWall(wallMs: number, timeZone: string): number {
  let instant = wallMs - offsetMs(wallMs, timeZone);
  instant = wallMs - offsetMs(instant, timeZone);
  return instant;
}

/** 00:00:00 local del día que contiene `instantMs`. */
export function startOfLocalDay(instantMs: number, timeZone: string): number {
  const p = zonedParts(instantMs, timeZone);
  return fromLocalWall(Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0), timeZone);
}

/** Suma días en el calendario LOCAL (no 86 400 000 ms, que con DST desplaza). */
export function addLocalDays(instantMs: number, days: number, timeZone: string): number {
  const p = zonedParts(instantMs, timeZone);
  return fromLocalWall(
    Date.UTC(p.year, p.month - 1, p.day + days, p.hour, p.minute, p.second),
    timeZone
  );
}

/** 00:00:00 local del lunes de la semana a la que pertenece `instantMs`. */
export function startOfLocalWeek(instantMs: number, timeZone: string): number {
  const p = zonedParts(instantMs, timeZone);
  // Lunes = 0 días hacia atrás … domingo = 6. Con `weekday` 0=domingo.
  const daysSinceMonday = (p.weekday + 6) % 7;
  return fromLocalWall(
    Date.UTC(p.year, p.month - 1, p.day - daysSinceMonday, 0, 0, 0),
    timeZone
  );
}

/**
 * Ventanas de los cinco grupos para un instante de referencia. `from`/`to` en
 * epoch ms; `null` = sin límite de ese lado.
 *
 * `overdue` es el único con el tope INCLUSIVE (`due_at <= now`), porque es la
 * misma regla que usa `isOverdue` y la que devuelve la conversación a "Por
 * atender": el segundo exacto en que vence ya está vencido. Los otros cuatro
 * son intervalos semiabiertos `[from, to)`, encadenados sin huecos desde la
 * medianoche local.
 *
 * Regla de "esta semana": el resto de la semana EN CURSO (lunes a domingo) que
 * queda después de mañana. En fin de semana la semana ya se agotó, así que el
 * grupo queda vacío por construcción (`from === to`) y el lunes siguiente entra
 * directamente en `later` — sin huecos y sin repetir un recordatorio en dos
 * grupos.
 */
export function agendaWindows(
  now: Date,
  timeZone: string
): Record<AgendaBucket, { from: number | null; to: number | null }> {
  const today = startOfLocalDay(now.getTime(), timeZone);
  const tomorrow = addLocalDays(today, 1, timeZone);
  const afterTomorrow = addLocalDays(tomorrow, 1, timeZone);
  // Lunes 00:00 de la semana siguiente: el final de la semana en curso.
  const endOfThisWeek = addLocalDays(startOfLocalWeek(now.getTime(), timeZone), 7, timeZone);
  // Si la semana ya no tiene días después de mañana, `later` empieza el mismo
  // día que `week` termina: `week` queda vacío sin necesitar un caso especial.
  const laterFrom = afterTomorrow >= endOfThisWeek ? afterTomorrow : endOfThisWeek;
  return {
    overdue: { from: null, to: now.getTime() },
    today: { from: today, to: tomorrow },
    tomorrow: { from: tomorrow, to: afterTomorrow },
    week: { from: afterTomorrow, to: laterFrom },
    later: { from: laterFrom, to: null },
  };
}

/**
 * Grupo de un `due_at` dado, o `null` si no cae en ninguna ventana.
 *
 * `overdue` se decide PRIMERO y con el tope cerrado, para que coincida con
 * `isOverdue`: las otras cuatro ventanas empiezan en la medianoche local, que
 * es anterior a `now`, así que sin esta comprobación un recordatorio vencido
 * hace horas dentro del día se clasificaría como "hoy" en vez de vencido — que
 * es justo el error que esconde un recordatorio del operador.
 */
export function bucketFor(
  dueAt: Date,
  now: Date,
  timeZone: string
): AgendaBucket | null {
  const at = dueAt.getTime();
  if (at <= now.getTime()) return "overdue";
  const windows = agendaWindows(now, timeZone);
  for (const bucket of AGENDA_BUCKETS) {
    if (bucket === "overdue") continue;
    const { from, to } = windows[bucket];
    if (from !== null && at < from) continue;
    if (to !== null && at >= to) continue;
    return bucket;
  }
  return null;
}

/** Un recordatorio ya vencido: es lo que vuelve a la cola humana. */
export function isOverdue(dueAt: Date, now: Date): boolean {
  return dueAt.getTime() <= now.getTime();
}
