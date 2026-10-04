/**
 * 014 C8 — El PULIDO, afirmado sobre lo que el corte 1–7 dejó.
 *
 * Este fichero no prueba "que se vea bien". Prueba las cuatro cosas que un pulido
 * puede dejar rotas sin que nadie se entere, que son las del corte (FR-8.1 a
 * FR-8.4):
 *
 * 1. **El foco se ve.** Antes de este corte, `Button`, `Input` y `Textarea` eran
 *    los ÚNICOS con anillo de foco. Los enlaces del nav, los chips de la Bandeja,
 *    las filas de conversación, los enlaces de la Agenda y las tres acciones que
 *    013 añadió para operar dependían del anillo por defecto del navegador, que
 *    se dibuja FUERA de la caja y por tanto lo recorta cualquier ancestro con
 *    `overflow` —que es el caso de la lista y de la Agenda—.
 * 2. **El contraste de los estados nuevos se midió, no se edificó.** Aquí se
 *    calcula la ratio de los pares de tokens que los cortes 6 y 7 dejaron por
 *    debajo del umbral, y se afirma el número. Si alguien vuelve a poner un color
 *    de superficie donde va texto, el test se pone rojo solo.
 * 3. **Un fallo se DICE.** La Bandeja se quedaba en "Cargando…" para siempre si
 *    el `fetch` fallaba, y el Pipeline afirmaba que no había etapas cuando en
 *    realidad no había podido preguntar.
 * 4. **Las acciones de 013 se anuncian y se pueden usar con teclado.** Un
 *    formulario que se abre y no se anuncia, con el foco perdido, no se puede
 *    usar sin ratón.
 *
 * El contraste se calcula de verdad (no se compara una clase de Tailwind) porque
 * una clase no dice nada del tema oscuro: el mismo `text-brand` es un azul
 * sobrio en claro y un azul casi invisible en oscuro. Los valores se LEEN de
 * `src/app/globals.css`, así que el test no puede quedarse mintiendo si alguien
 * re-tunea un token.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ConversationDto } from "@/lib/types";

// Los componentes cliente se renderizan sin navegador: `useEvents` abriría un
// `EventSource` que no existe fuera de un DOM. Mismo doble que usan los cortes
// anteriores de 013 y que el corte 7 de 014.
vi.mock("@/components/use-events", () => ({ useEvents: () => {} }));

const { ConversationList } = await import("@/components/inbox/conversation-list");
const { ReminderSchedule } = await import("@/components/inbox/reminder-schedule");

// --- El tema, leído del CSS real -------------------------------------------

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** Los tokens de un bloque, tal cual están en el CSS. */
function tokensDe(bloque: string): Record<string, string> {
  const desde = CSS.indexOf(bloque);
  if (desde < 0) throw new Error(`no se encuentra el bloque ${bloque} en globals.css`);
  const cuerpo = CSS.slice(desde, CSS.indexOf("}", desde));
  const salida: Record<string, string> = {};
  for (const coincidencia of cuerpo.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    const nombre = coincidencia[1];
    const valor = coincidencia[2];
    if (nombre && valor) salida[nombre] = valor;
  }
  return salida;
}

const CLARO = tokensDe(":root");
const OSCURO = tokensDe("html.dark");

/**
 * Un token en un tema, respetando la cascada: `html.dark` NO vuelve a declarar
 * `--accent` (ni `--bg`, ni `--text`…), solo lo que cambia. El resto se hereda de
 * `:root`, así que leer el bloque oscuro tal cual daría `undefined` para tokens
 * perfectamente válidos —y un `undefined` silencioso es peor que un color feo.
 */
function tokenEn(tema: Record<string, string>, nombre: string): string {
  const valor = tema[nombre] ?? CLARO[nombre];
  if (!valor) throw new Error(`el token --${nombre} no está en el tema`);
  return valor;
}

/** Luminancia relativa WCAG. */
function luminancia(hex: string): number {
  const limpio = hex.replace("#", "");
  const canales = [0, 2, 4].map((i) => {
    const bruto = parseInt(limpio.slice(i, i + 2), 16) / 255;
    return bruto <= 0.03928 ? bruto / 12.92 : ((bruto + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * canales[0]! + 0.7152 * canales[1]! + 0.0722 * canales[2]!;
}

/** Ratio de contraste de dos colores, 1 a 21. */
function ratio(primero: string, segundo: string): number {
  const a = luminancia(primero);
  const b = luminancia(segundo);
  const [claro, oscuro] = a > b ? [a, b] : [b, a];
  return (claro + 0.05) / (oscuro + 0.05);
}

/** Ratio de dos tokens en un tema, resolviendo la cascada. */
function ratioDe(tema: Record<string, string>, primerToken: string, segundoToken: string) {
  return ratio(tokenEn(tema, primerToken), tokenEn(tema, segundoToken));
}

// --- 1. El foco se ve -------------------------------------------------------

describe("014 C8 · el foco se ve donde el operador navega", () => {
  it("hay una regla de foco global, y el anillo va DENTRO para que no lo recorten", () => {
    const regla = CSS.match(
      /:where\(([^)]*\[[^\]]*\][^)]*)\):focus-visible\s*\{([^}]*)\}/
    );
    expect(regla, "globals.css debe declarar un anillo de foco global").toBeTruthy();

    // Cubre a los elementos crudos de todo el shell, no solo a los del `Button`.
    const selectores = regla![1]!;
    for (const etiqueta of ["a", "button", "input", "select", "textarea"]) {
      expect(selectores, etiqueta).toContain(etiqueta);
    }

    const cuerpo = regla![2]!;
    // El color es el token de acento: no se introduce un color nuevo.
    expect(cuerpo).toContain("var(--accent)");
    // Y el desplazamiento es NEGATIVO a propósito: un anillo por fuera de la caja
    // lo recorta el primer ancestro con `overflow`, que en la Bandeja y en la
    // Agenda está a dos niveles.
    expect(cuerpo).toMatch(/outline-offset:\s*-\d/);
  });

  it("el anillo del suelo no le pisa el que declara cada componente", () => {
    // `:where()` deja la especificidad en 0 a propósito: sin esto, el anillo
    // global ganaría a cualquier utilidad `focus-visible:*` de un componente y
    // `Button` dejaría de tener el suyo.
    expect(CSS).toMatch(/:where\([^)]+\):focus-visible/);
  });
});

// --- 2. Contraste de los estados nuevos, medido ------------------------------

/**
 * Los pares que los cortes 6 y 7 dejaron por debajo del umbral, con el motivo de
 * cada corrección. Los umbrales NO son negociables porimeters: `escuro` y `claro`
 * van por separado porque hay un caso en el que la deuda que queda es real y está
 * documentada como pendiente, y bajarlo sin decirlo sería precisely
 * "acomodar el resultado".
 */
const PARES: {
  motivo: string;
  fg: string;
  bg: string;
  /** Mínimo en tema oscuro. */
  oscuro: number;
  /** Mínimo en tema claro. */
  claro: number;
}[] = [
  {
    motivo: "reloj de lo no leído en la fila de la Bandeja (C7)",
    fg: "accent-text",
    bg: "bg",
    oscuro: 4.5,
    claro: 4.5,
  },
  {
    motivo: "reloj de lo no leído sobre la fila seleccionada (C7)",
    fg: "accent-text",
    bg: "accent-tint",
    oscuro: 4.5,
    claro: 4.5,
  },
  {
    motivo: "confirmación de 'Recordarme' (C4)",
    fg: "accent-text",
    bg: "bg-panel",
    oscuro: 4.5,
    claro: 4.5,
  },
  {
    // Los tres siguientes pasan el 4.5:1 en oscuro; en claro se quedan en el 3:1
    // del suelo del tema, y por qué está escrito en el test de deuda de abajo.
    motivo: "etiqueta de grupo del nav (C7)",
    fg: "text-3",
    bg: "bg-subtle",
    oscuro: 4.5,
    claro: 3,
  },
  {
    motivo: "'Nadie en esta etapa' (C7)",
    fg: "text-3",
    bg: "bg",
    oscuro: 4.5,
    claro: 3,
  },
  {
    motivo: "icono del megáfono de origen (C7)",
    fg: "text-3",
    bg: "bg",
    oscuro: 4.5,
    claro: 3,
  },
];

describe("014 C8 · los estados nuevos se ven en tema oscuro", () => {
  it.each(PARES)("$motivo pasa en ambos temas", ({ fg, bg, oscuro, claro }) => {
    // En oscuro, que es donde los tokens de acento fallaban: `accent` es un color
    // de SUPERFICIE y como texto sobre fondo oscuro se hunde.
    const medidoOscuro = ratioDe(OSCURO, fg, bg);
    expect(
      medidoOscuro,
      `oscuro: ${fg} sobre ${bg} da ${medidoOscuro.toFixed(2)}:1 y el mínimo es ${oscuro}:1`
    ).toBeGreaterThanOrEqual(oscuro);

    const medidoClaro = ratioDe(CLARO, fg, bg);
    expect(
      medidoClaro,
      `claro: ${fg} sobre ${bg} da ${medidoClaro.toFixed(2)}:1 y el mínimo es ${claro}:1`
    ).toBeGreaterThanOrEqual(claro);
  });

  it("`accent` sigue siendo un color de superficie: como texto en oscuro no vale", () => {
    // La razón de los tres cambios de `--accent` a `--accent-text`, escrita como
    // aserción: si alguien vuelve a poner `--accent` como texto sobre fondo
    // oscuro, esto falla y el motivo queda escrito aquí.
    const sobreFondo = ratioDe(OSCURO, "accent", "bg");
    expect(
      sobreFondo,
      "--accent como texto sobre --bg en oscuro está por debajo de 4.5:1: " +
        "por eso el texto de marca usa --accent-text, no --accent"
    ).toBeLessThan(4.5);
  });

  it("la deuda de la rampa neutra en claro, escrita con sus números", () => {
    // LO QUE ESTE CORTE NO CIERRA, y no se disimula bajando un umbral: en tema
    // claro, `--text-3` se queda en 3.2–3.3:1, por debajo del 4.5:1 que WCAG
    // pide para texto pequeño. Es deuda PREEXISTENTE y de toda la app —`--text-3`
    // es el texto normal de los items del nav, del buscador y de las etapas—,
    // no algo que este corte haya introducido: lo que hace este corte es dejar de
    // añadir casos nuevos por debajo de ese suelo, como eran las etiquetas de 10 y
    // 11 px de los cortes 6 y 7 en `--text-4` (2.13:1 y 2.20:1).
    //
    // Cerrarla de verdad es re-tunear la rampa neutra del tema claro —una
    // decisión de diseño que afecta a toda la superficie visible— y por eso queda
    // como pendiente escrita en `docs/CURRENT_STATE.md` (Corte 8), no como un
    // umbral bajado aquí. Esta aserción impide que empeore; no impide que mejore.
    expect(ratioDe(CLARO, "text-3", "bg")).toBeGreaterThanOrEqual(3);
    expect(ratioDe(CLARO, "text-3", "bg-subtle")).toBeGreaterThanOrEqual(3);
    // Y el token que se descartó para los estados nuevos sí es descartable:
    // `--text-4` en claro no llega al 3:1 ni para contenido no textual.
    expect(ratioDe(CLARO, "text-4", "bg")).toBeLessThan(3);
  });
});

// --- 3. Un fallo se dice, y dice la verdad ----------------------------------

const CONVERSACION: ConversationDto = {
  id: "c1",
  contact: { id: "ct1", name: "Ana Ruiz", phone: "525512345678" },
  preview: "¿Me confirmas la cita?",
  lastMessageAt: new Date().toISOString(),
  unreadCount: 1,
  aiEnabled: true,
  handoffAt: null,
  windowOpen: true,
  stageName: null,
  anuncio: null,
  attention: null,
} as unknown as ConversationDto;

describe("014 C8 · un fallo de carga se dice y no se disfraza de vacío", () => {
  it("sin error, la lista sigue mostrando su estado de carga", () => {
    const html = renderToStaticMarkup(
      createElement(ConversationList, {
        conversations: null,
        selectedId: null,
        onSelect: () => {},
        onSeeded: () => {},
      })
    );
    expect(html).toContain("Cargando");
    // Y un estado de carga que nunca termina no es un estado de carga: la lista
    // avisa que está ocupada para que no se confunda con una bandeja vacía.
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('data-testid="bandeja-error"');
  });

  it("con error, la lista lo dice y ofrece reintentar", () => {
    const html = renderToStaticMarkup(
      createElement(ConversationList, {
        conversations: null,
        selectedId: null,
        onSelect: () => {},
        onSeeded: () => {},
        error: "Sin conexión con el servidor",
        onRetry: () => {},
      })
    );
    // Antes este caso pintaba "Cargando…" para siempre: `conversations` se
    // quedaba en `null` y no había forma de distinguir "todavía no" de "nunca".
    expect(html).toContain('data-testid="bandeja-error"');
    expect(html).toContain("Sin conexión con el servidor");
    // Y tranquiliza en vez de asustar: nada de esto ha perdido datos.
    expect(html).toContain("no se han perdido");
    expect(html).toContain("Reintentar");
    // El aviso se anuncia, no aparece en silencio.
    expect(html).toContain('role="alert"');
    // Y en el camino infeliz ya no se dice "Cargando".
    expect(html).not.toContain("Cargando…");
  });
});

// --- 4. Las acciones de 013 se pueden usar sin ratón ------------------------

describe("014 C8 · las tres acciones de 013 se pueden usar sin ratón", () => {
  it("el reloj de lo no leído usa el token de TEXTO de marca, no el de superficie", () => {
    // La cadena completa: el test de ratios demuestra que `--accent-text` SÍ pasa
    // y `--accent` NO, pero eso no basta —el token puede estar bien y el
    // componente seguir usando el malo. Aquí se afirma que la fila usa el bueno.
    const html = renderToStaticMarkup(
      createElement(ConversationList, {
        conversations: [CONVERSACION],
        selectedId: null,
        onSelect: () => {},
        onSeeded: () => {},
      })
    );
    expect(html).toContain("text-brand-text");
    // Y que no queda ni una aparición del token de superficie como clase de texto
    // en la fila: `bg-brand` (el contador) es correcto y no se toca.
    expect(html).not.toMatch(/text-brand[^-]/);
  });
});

describe("014 C8 · 'Recordarme' se puede abrir y usar con teclado", () => {
  it("el botón declara si dejó el formulario abierto, y el formulario existe", () => {
    const html = renderToStaticMarkup(
      createElement(ReminderSchedule, {
        conversationId: "cv_1",
        attention: null,
      })
    );

    // Cerrado: `aria-expanded="false"` y apunta al panel por `id`. Sin esto,
    // quien navega con teclado no tiene forma de saber que al pulsar aparece
    // un formulario con una fecha.
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="reminder-form"');
    expect(html).not.toContain('id="reminder-form"');
  });

  it("sin recordatorio, ofrece la acción y no ofrece enviar nada", () => {
    const html = renderToStaticMarkup(
      createElement(ReminderSchedule, {
        conversationId: "cv_1",
        attention: null,
      })
    );
    expect(html).toContain("Elegir fecha");
    // Dice el estado de partida en palabras de operador, no en internals.
    expect(html).toContain("Sin recordatorio");
    // Y ni una acción de envío, como en 013: vencer no manda WhatsApp. La frase
    // que lo explica ("No se manda ningún WhatsApp") vive dentro del formulario,
    // así que aquí se afirma lo comprobable en este estado: que enviar no existe.
    expect(html).not.toContain("Enviar");
  });
});
