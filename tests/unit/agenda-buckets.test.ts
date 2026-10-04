/**
 * 013 C3 — Los cinco grupos de la Agenda se calculan en el SERVIDOR, con reloj
 * y zona horaria explícitos.
 *
 * Por qué un fichero tan recurrente: el error clásico de este bloque es que la
 * fecha se decide en el cliente y el resultado "discrepa del reloj" (spec §3.3).
 * Aquí se afirma lo contrario con un `now` inyectado: no hay `Date.now()` en el
 * módulo, así que los mismos casos (medianoche, 23:59, cambio de día, fin de
 * semana, cambio de horario) se comprueban de forma determinista, sin esperar.
 *
 * Las fechas están elegidas a mano y verificadas contra `Intl`:
 *   Lima (UTC-5, sin DST): lunes 2026-10-05 12:00 local = 17:00Z.
 *   Nueva York (con DST): el domingo 2026-11-01 tiene 25 horas.
 */
import { describe, expect, it } from "vitest";
import {
  addLocalDays,
  agendaWindows,
  bucketFor,
  isOverdue,
  isValidTimeZone,
  resolveOperatorTimeZone,
  startOfLocalDay,
  startOfLocalWeek,
  zonedParts,
} from "@/server/inbox/agenda-buckets";

const LIMA = "America/Lima";
const NEW_YORK = "America/New_York";
const UTC = "UTC";

/** Lunes 2026-10-05, 12:00 en Lima. */
const LUNES_MEDIODIA = new Date("2026-10-05T17:00:00Z");

function grupo(iso: string, now: Date, tz = LIMA) {
  return bucketFor(new Date(iso), now, tz);
}

describe("agenda-buckets — los cinco grupos con reloj inyectable", () => {
  it("coloca un recordatorio en cada grupo según su fecha local", () => {
    const now = LUNES_MEDIODIA;
    // Vencido: una hora antes de "ahora" en Lima (11:00 del lunes).
    expect(grupo("2026-10-05T16:00:00Z", now)).toBe("overdue");
    // Hoy: 12:30 del lunes.
    expect(grupo("2026-10-05T17:30:00Z", now)).toBe("today");
    // Mañana: martes 10:00.
    expect(grupo("2026-10-06T15:00:00Z", now)).toBe("tomorrow");
    // Esta semana: viernes 10:00.
    expect(grupo("2026-10-09T15:00:00Z", now)).toBe("week");
    // Más adelante: tres semanas después.
    expect(grupo("2026-10-26T15:00:00Z", now)).toBe("later");
  });

  it("usa un instante fijo: el mismo caso da el mismo grupo siempre", () => {
    // Si el módulo usara `Date.now()` por dentro, esta llamada no podría
    // fijar el resultado. Es la prueba de que el reloj entra por parámetro.
    const futuro = new Date("2026-10-09T15:00:00Z");
    expect(bucketFor(futuro, LUNES_MEDIODIA, LIMA)).toBe("week");
    expect(bucketFor(futuro, LUNES_MEDIODIA, LIMA)).toBe("week");
    // Un recordatorio en el pasado sigue en su pasado: el grupo es una foto,
    // no una promesa que se reevalúa sola.
    expect(bucketFor(new Date("2026-10-01T15:00:00Z"), LUNES_MEDIODIA, LIMA)).toBe(
      "overdue"
    );
  });
});

describe("agenda-buckets — límites de día", () => {
  it("23:59:59 del día local sigue siendo 'hoy' y la medianoche pasa a 'mañana'", () => {
    const now = LUNES_MEDIODIA;
    // Último segundo del lunes en Lima.
    expect(grupo("2026-10-06T04:59:59Z", now)).toBe("today");
    // Medianoche exacta del martes en Lima: ya es mañana.
    expect(grupo("2026-10-06T05:00:00Z", now)).toBe("tomorrow");
    // El mismo instante, un segundo antes, sigue siendo lunes.
    expect(grupo("2026-10-06T04:59:00Z", now)).toBe("today");
  });

  it("el instante exacto de 'ahora' ya está vencido (límite cerrado)", () => {
    const now = LUNES_MEDIODIA;
    expect(grupo("2026-10-05T17:00:00Z", now)).toBe("overdue");
    expect(isOverdue(new Date("2026-10-05T17:00:00Z"), now)).toBe(true);
    // Un milisegundo después todavía NO está vencido: el tope es `<= now`, no
    // "todo el minuto" ni un margen de gracia.
    expect(isOverdue(new Date(now.getTime() + 1), now)).toBe(false);
    expect(bucketFor(new Date(now.getTime() + 1), now, LIMA)).toBe("today");
  });

  it("el cambio de día local se calcula con la zona, no con UTC", () => {
    // now = lunes 23:30 UTC = lunes 18:30 en Lima. El mismo instante de
    // recordatorio es "mañana" para quien lee el reloj en UTC y "hoy" para el
    // operador de Lima, porque su día ya no ha cambiado.
    const now = new Date("2026-10-05T23:30:00Z");
    const instante = "2026-10-06T02:00:00Z";
    expect(grupo(instante, now, UTC)).toBe("tomorrow");
    expect(grupo(instante, now, LIMA)).toBe("today");
  });

  it("startOfLocalDay devuelve la medianoche local, no la de UTC", () => {
    expect(new Date(startOfLocalDay(LUNES_MEDIODIA.getTime(), LIMA)).toISOString()).toBe(
      "2026-10-05T05:00:00.000Z"
    );
    expect(new Date(startOfLocalDay(LUNES_MEDIODIA.getTime(), UTC)).toISOString()).toBe(
      "2026-10-05T00:00:00.000Z"
    );
  });
});

describe("agenda-buckets — 'esta semana' y el fin de semana", () => {
  it("de lunes a jueves cubre el resto de la semana y el lunes siguiente ya es 'later'", () => {
    const now = LUNES_MEDIODIA;
    const windows = agendaWindows(now, LIMA);
    // Miércoles a domingo.
    expect(new Date(windows.week.from!).toISOString()).toBe("2026-10-07T05:00:00.000Z");
    expect(new Date(windows.week.to!).toISOString()).toBe("2026-10-12T05:00:00.000Z");
    // El domingo sigue en la semana; el lunes ya pasó a "más adelante".
    expect(grupo("2026-10-11T20:00:00Z", now)).toBe("week");
    expect(grupo("2026-10-12T05:00:00Z", now)).toBe("later");
  });

  it("en viernes solo queda el domingo en 'esta semana'", () => {
    // Viernes 2026-10-09, 12:00 Lima.
    const now = new Date("2026-10-09T17:00:00Z");
    expect(grupo("2026-10-11T20:00:00Z", now)).toBe("week");
    expect(grupo("2026-10-12T15:00:00Z", now)).toBe("later");
  });

  it("en sábado la semana ya se agotó: 'esta semana' queda vacía y nada se pierde", () => {
    // Sábado 2026-10-10, 12:00 Lima.
    const now = new Date("2026-10-10T17:00:00Z");
    const windows = agendaWindows(now, LIMA);
    // `from === to`: el grupo es vacío por construcción, no por un caso especial.
    expect(windows.week.from).toBe(windows.week.to);
    // El domingo sigue siendo "mañana" y el lunes ya es "más adelante":
    // los grupos son contiguos y no se pierde ni se duplica ningún recordatorio.
    expect(grupo("2026-10-11T15:00:00Z", now)).toBe("tomorrow");
    expect(grupo("2026-10-12T15:00:00Z", now)).toBe("later");
  });

  it("en domingo pasa igual: lunes entra directo en 'más adelante'", () => {
    const now = new Date("2026-10-11T17:00:00Z");
    const windows = agendaWindows(now, LIMA);
    expect(windows.week.from).toBe(windows.week.to);
    expect(grupo("2026-10-12T15:00:00Z", now)).toBe("tomorrow");
    expect(grupo("2026-10-13T15:00:00Z", now)).toBe("later");
  });

  it("startOfLocalWeek ancla en el lunes de la semana en curso", () => {
    // Domingo: su lunes es seis días antes, no el lunes siguiente.
    const domingo = new Date("2026-10-11T17:00:00Z");
    expect(new Date(startOfLocalWeek(domingo.getTime(), LIMA)).toISOString()).toBe(
      "2026-10-05T05:00:00.000Z"
    );
    expect(new Date(startOfLocalWeek(LUNES_MEDIODIA.getTime(), LIMA)).toISOString()).toBe(
      "2026-10-05T05:00:00.000Z"
    );
  });
});

describe("agenda-buckets — zona horaria (BD en UTC, agrupación local)", () => {
  it("el MISMO timestamp cambia de grupo según la zona del operador", () => {
    // now = lunes 2026-10-05 12:00 en Lima = 17:00Z. Lima va 5 horas por
    // detrás de UTC, así que un instante de madrugada UTC todavía es "hoy" en
    // Lima: la fila en BD es la misma, el grupo depende de la zona.
    const now = LUNES_MEDIODIA;
    // Martes 02:00 UTC = lunes 21:00 en Lima.
    const madrugada = new Date("2026-10-06T02:00:00Z");
    expect(bucketFor(madrugada, now, UTC)).toBe("tomorrow");
    expect(bucketFor(madrugada, now, LIMA)).toBe("today");
    // Lunes 21:00 Lima = martes 02:00 UTC: al revés, el mismo instante cae en
    // "más adelante" para el operador en UTC y en "esta semana" para el de Lima.
    const findeNoche = new Date("2026-10-12T02:00:00Z");
    expect(bucketFor(findeNoche, now, UTC)).toBe("later");
    expect(bucketFor(findeNoche, now, LIMA)).toBe("week");
    // Y un instante ya pasado está vencido en las dos zonas: el reloj manda.
    const pasado = new Date("2026-10-05T16:00:00Z");
    expect(bucketFor(pasado, now, UTC)).toBe("overdue");
    expect(bucketFor(pasado, now, LIMA)).toBe("overdue");
  });

  it("un día con cambio de horario mide 25 horas y los límites no se desplazan", () => {
    // El domingo 2026-11-01 en Nueva York tiene 25 horas: el salto ocurre a las
    // 2:00. Un límite calculado con un simple +24h dejaría el día corrido.
    const now = new Date("2026-10-30T16:00:00Z"); // viernes 12:00 EDT
    const windows = agendaWindows(now, NEW_YORK);
    // Sábado 00:00 EDT.
    expect(new Date(windows.tomorrow.from!).toISOString()).toBe("2026-10-31T04:00:00.000Z");
    // Domingo 00:00 EDT: el día de 25 horas empieza a las 04:00Z.
    expect(new Date(windows.week.from!).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    // Lunes 00:00 EST: 25 horas después, no 24 (a las 05:00Z, no 04:00Z).
    expect(new Date(windows.week.to!).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    // El lunes siguiente pertenece a "más adelante", no a "esta semana".
    expect(bucketFor(new Date("2026-11-02T05:30:00Z"), now, NEW_YORK)).toBe("later");
    // Y el domingo sí está dentro de la semana.
    expect(bucketFor(new Date("2026-11-01T20:00:00Z"), now, NEW_YORK)).toBe("week");
  });

  it("addLocalDays suma días de calendario, no 24 horas", () => {
    // Del sábado 00:00 EDT al domingo 00:00 EDT hay 24h; al lunes, 25.
    const sabado = new Date("2026-10-31T04:00:00Z");
    expect(new Date(addLocalDays(sabado.getTime(), 1, NEW_YORK)).toISOString()).toBe(
      "2026-11-01T04:00:00.000Z"
    );
    expect(new Date(addLocalDays(sabado.getTime(), 2, NEW_YORK)).toISOString()).toBe(
      "2026-11-02T05:00:00.000Z"
    );
  });

  it("zonedParts devuelve la fecha que ve el operador", () => {
    expect(zonedParts(LUNES_MEDIODIA.getTime(), LIMA)).toMatchObject({
      year: 2026,
      month: 10,
      day: 5,
      hour: 12,
      weekday: 1,
    });
    // Medianoche en Lima: `hour` es 0 y no 24 (de ahí el `h23`).
    expect(zonedParts(new Date("2026-10-05T05:00:00Z").getTime(), LIMA).hour).toBe(0);
  });
});

describe("agenda-buckets — resolución de zona", () => {
  it("acepta la zona que pide el cliente y descarta la que no existe", () => {
    expect(resolveOperatorTimeZone("America/Mexico_City")).toBe("America/Mexico_City");
    expect(resolveOperatorTimeZone("No/Existe")).toBeTypeOf("string");
    // Un valor basura NO puede romper la vista: se cae a la zona de la instancia.
    expect(isValidTimeZone("No/Existe")).toBe(false);
    expect(isValidTimeZone(LIMA)).toBe(true);
  });

  it("sin zona declarada usa OPERATOR_TIMEZONE y, si no, la del proceso", () => {
    const previo = process.env.OPERATOR_TIMEZONE;
    process.env.OPERATOR_TIMEZONE = "America/Mexico_City";
    try {
      expect(resolveOperatorTimeZone()).toBe("America/Mexico_City");
      // Una zona explícita del cliente manda sobre la de la instancia.
      expect(resolveOperatorTimeZone("America/Lima")).toBe("America/Lima");
    } finally {
      if (previo === undefined) delete process.env.OPERATOR_TIMEZONE;
      else process.env.OPERATOR_TIMEZONE = previo;
    }
    delete process.env.OPERATOR_TIMEZONE;
    expect(resolveOperatorTimeZone()).toBeTypeOf("string");
  });
});

describe("agenda-buckets — las ventanas derived no pierden ni duplican nada", () => {
  it("los cuatro grupos futuros se encadenan sin huecos desde la medianoche local", () => {
    const now = LUNES_MEDIODIA;
    const w = agendaWindows(now, LIMA);
    // Con la semana en curso: hoy→mañana→(mañana+1)→fin de semana→lunes+.
    expect(w.today.from).toBe(startOfLocalDay(now.getTime(), LIMA));
    expect(w.today.to).toBe(w.tomorrow.from);
    expect(w.tomorrow.to).toBe(w.week.from);
    expect(w.week.to).toBe(w.later.from);
    // `later` no tiene techo: nada se cae fuera de la Agenda.
    expect(w.later.to).toBeNull();
    // `overdue` no tiene suelo y su tope es `now`…
    expect(w.overdue.from).toBeNull();
    expect(w.overdue.to).toBe(now.getTime());
    // …y NO coincide con la medianoche: la ventana de "hoy" empieza antes que
    // `now`. Por eso `bucketFor` decide `overdue` primero, con el tope cerrado.
    expect(w.today.from).toBeLessThan(w.overdue.to!);
  });

  it("con la semana agotada los grupos siguen siendo contiguos", () => {
    const sabado = new Date("2026-10-10T17:00:00Z");
    const w = agendaWindows(sabado, LIMA);
    expect(w.today.to).toBe(w.tomorrow.from);
    expect(w.tomorrow.to).toBe(w.week.from);
    expect(w.week.to).toBe(w.later.from);
  });

  it("todo recordatorio cae en exactamente un grupo, a cualquier distancia", () => {
    const now = LUNES_MEDIODIA;
    const base = now.getTime();
    for (const deltaMin of [-100_000, -1, 0, 1, 59, 60, 1_440, 2_880, 5_000, 40_000]) {
      const at = new Date(base + deltaMin * 60_000);
      const grupo = bucketFor(at, now, LIMA);
      expect(grupo, `instante ${deltaMin} min`).not.toBeNull();
      // Y el grupo que devuelve coincide con su propia ventana: la clasificación
      // no puede contradecir a la aritmética que la produce.
      const win = agendaWindows(now, LIMA)[grupo!];
      if (grupo !== "overdue") {
        expect(at.getTime(), `instante ${deltaMin} min`).toBeGreaterThanOrEqual(win.from!);
        // `later` no tiene techo.
        if (win.to !== null) expect(at.getTime(), `instante ${deltaMin} min`).toBeLessThan(win.to);
      } else {
        expect(at.getTime(), `instante ${deltaMin} min`).toBeLessThanOrEqual(win.to!);
      }
    }
  });
});
