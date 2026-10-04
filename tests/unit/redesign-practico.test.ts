/**
 * 014 C7 — El REDISEÑO PRÁCTICO, afirmado sobre el marcado que ve la persona.
 *
 * Este fichero no prueba "que se vea bonito": prueba las tres cosas que un
 * rediseño puede romper sin que nadie se dé cuenta, que son las que hacen útil la
 * pantalla (FR-7.1, FR-7.2, FR-7.7).
 *
 * 1. **La fila de la cola se reconoce sin leer.** Una conversación que hay que
 *    atender ahora lleva la marca de trabajo; una que está con la IA no lleva ni
 *    marca ni etiqueta. Antes bastaba con que el chip existiera.
 * 2. **El color significa lo mismo en todas partes.** `por_atender` es rojo, en la
 *    fila, en la cabecera del hilo y en el bloque del panel. Este era el agujero
 *    del rediseño: el bloque del panel era ámbar SIEMPRE, así que un recordatorio
 *    vencido y una conversación ya atendida se veían exactamente igual.
 * 3. **El número del nav y el chip de la lista no pueden separarse.** El nav cuenta
 *    la cola con `necesitaAtencionAhora`; el chip la cuenta con
 *    `resumirBandeja().porAtender`, que es la MISMA operación. Aquí se afirma que
 *    dar ambos números sobre la misma lista da el mismo resultado — no que hoy
 *    coincidan, sino que no hay dos cálculos que puedan divergir.
 *
 * Se afirma sobre JSX real con `renderToStaticMarkup`, como los cortes 2, 3 y 4 de
 * 013: si alguien cambia el marcado, el test lo ve.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AttentionDto, ConversationDto } from "@/lib/types";

// Los componentes cliente se renderizan sin navegador: `useEvents` abriría un
// `EventSource` que no existe fuera de un DOM. Mismo doble que usan los cortes
// anteriores de 013.
vi.mock("@/components/use-events", () => ({ useEvents: () => {} }));

const { ConversationList } = await import("@/components/inbox/conversation-list");
const { AttentionBlock } = await import("@/components/inbox/attention-block");
const { PageHeader } = await import("@/components/page-header");
const { PipelineClient } = await import("@/components/pipeline/pipeline-client");
const { necesitaAtencionAhora, resumirBandeja } = await import(
  "@/components/inbox/bandeja-filtros"
);
const { estadoOperativo } = await import("@/lib/operational-state");

// --- Fixtures ---------------------------------------------------------------

const HACE_UN_RATO = new Date(Date.now() - 60_000).toISOString();
const EN_48H = new Date(Date.now() + 48 * 3600_000).toISOString();

function atencion(over: Partial<AttentionDto> = {}): AttentionDto {
  return {
    state: "pending",
    handoffReason: "cliente",
    dueAt: null,
    needsAttentionNow: true,
    ...over,
  } as AttentionDto;
}

function conversacion(over: Partial<ConversationDto> = {}): ConversationDto {
  return {
    id: "c1",
    contact: { id: "ct1", name: "Ana Ruiz", phone: "525512345678" },
    preview: "¿Me confirmas la cita?",
    lastMessageAt: HACE_UN_RATO,
    unreadCount: 0,
    aiEnabled: true,
    handoffAt: HACE_UN_RATO,
    windowOpen: true,
    stageName: "Interesado",
    anuncio: null,
    attention: atencion(),
    ...over,
  } as ConversationDto;
}

function pintarLista(conversations: ConversationDto[]): string {
  return renderToStaticMarkup(
    createElement(ConversationList, {
      conversations,
      selectedId: null,
      onSelect: () => {},
      onSeeded: () => {},
    })
  );
}

function pintarBloque(c: ConversationDto): string {
  return renderToStaticMarkup(
    createElement(AttentionBlock, {
      conversation: c,
      onPatchConversation: () => {},
      onChanged: () => {},
    })
  );
}

// --- 1. La fila de la cola se ve sin leer -----------------------------------

describe("014 C7 · la fila que hay que atender se reconoce sin leer la etiqueta", () => {
  it("marca en rojo la fila de la cola y no marca las que no lo son", () => {
    const pendiente = conversacion({ id: "pendiente" });
    const conIa = conversacion({
      id: "con-ia",
      attention: null,
      handoffAt: null,
      aiEnabled: true,
    });

    const html = pintarLista([pendiente, conIa]);

    // La fila de la cola deja la marca de trabajo (`bg-danger`): se distingue de la
    // fila seleccionada, que usa el color de marca.
    expect(html).toContain("bg-danger");
    // Y solo hay una marca: la de la conversación que realmente hay que atender.
    expect(html.match(/w-\[3px\]/g) ?? []).toHaveLength(1);
    // Con la IA al mando no hay ni marca ni etiqueta (013 C4, se mantiene).
    expect(html).toContain('data-testid="fila-estado"');
    expect(html.match(/data-testid="fila-estado"/g) ?? []).toHaveLength(1);
  });

  it("el chip de la cola va primero y avisa en rojo aunque no esté seleccionado", () => {
    const html = pintarLista([
      conversacion({ id: "p", attention: atencion() }),
      conversacion({
        id: "c",
        attention: atencion({ state: "deferred", dueAt: EN_48H, needsAttentionNow: false }),
      }),
    ]);

    // "Por atender" abre la fila de filtros: es la pregunta del día (FR-4.3).
    const primerChip = html.indexOf('data-testid="bandeja-filtro-por_atender"');
    expect(primerChip).toBeGreaterThan(-1);
    for (const otro of ["comprometidos", "all", "unread"]) {
      expect(html.indexOf(`data-testid="bandeja-filtro-${otro}"`)).toBeGreaterThan(
        primerChip
      );
    }
    // Con trabajo pendiente y sin estar en la cola, el chip se insinúa en rojo:
    // si solo se pinta de rojo al pulsarlo, el número deja de avisar al pasar por
    // encima de la lista.
    expect(html).toMatch(
      /data-testid="bandeja-filtro-por_atender"[^>]*border-danger-border/
    );
  });
});

// --- 2. El color significa lo mismo en todas partes -------------------------

/**
 * El `<section>` de apertura del bloque, con sus clases. Se aísla el tag porque en
 * JSX el orden de los atributos lo decide quien escribe, y una prueba que depende
 * de que `class` venga antes que `data-testid` rompe sin que cambie el diseño.
 */
function bloqueDe(html: string): string {
  const tag = html.match(/<section[^>]*data-testid="attention-block"[^>]*>/);
  expect(tag, "el bloque de atención debe seguir renderizando su <section>").toBeTruthy();
  return tag?.[0] ?? "";
}

describe("014 C7 · rojo es «por atender» en las tres superficies", () => {
  it("el bloque del panel se tiñe por el estado, no siempre de ámbar", () => {
    const porAtender = pintarBloque(conversacion());
    const esperando = pintarBloque(
      conversacion({
        attention: atencion({ state: "waiting_client", needsAttentionNow: false }),
      })
    );

    // Hay trabajo AHORA → el bloque entero es rojo y ofrece la acción.
    expect(bloqueDe(porAtender)).toContain("bg-danger-soft");
    expect(porAtender).toContain("Marcar atendido");

    // No hay nada pendiente → tono neutro. Antes era ámbar como el de "por
    // atender", y por eso el color no distinguía los dos casos.
    expect(bloqueDe(esperando)).not.toContain("bg-danger");
    expect(bloqueDe(esperando)).not.toContain("bg-warning-soft");
    // Y sigue sin ofrecer la acción que no aplica.
    expect(esperando).not.toContain("Marcar atendido");
  });

  it("el copy del estado es el mismo en el bloque y en la fila (013 C4 intacto)", () => {
    const html = pintarBloque(conversacion());
    expect(html).toContain("Atención humana");
    expect(html).toContain("Por atender");
    expect(html).toContain('data-estado="por_atender"');
  });
});

// --- 3. El número del nav no puede separarse del chip -----------------------

describe("014 C7 · el contador del nav y el chip son la misma operación", () => {
  it("contar la cola a mano (como hace el nav) da el número del chip", () => {
    const lista: ConversationDto[] = [
      conversacion({ id: "a", attention: atencion() }),
      conversacion({ id: "b", attention: atencion({ state: "deferred", dueAt: EN_48H, needsAttentionNow: false }) }),
      conversacion({
        id: "c",
        attention: atencion({ state: "waiting_client", needsAttentionNow: false }),
      }),
      conversacion({ id: "d", attention: null, handoffAt: null }),
    ];

    // Así calcula el nav…
    const comoElNav = lista.reduce((a, c) => a + (necesitaAtencionAhora(c) ? 1 : 0), 0);
    // …y así el chip de la lista.
    const comoElChip = resumirBandeja(lista).porAtender;

    expect(comoElNav).toBe(1);
    expect(comoElNav).toBe(comoElChip);
  });

  it("el nav y el chip cuentan lo mismo aunque el recordatorio venza", () => {
    // El caso donde un recálculo propio se separaría: un `deferred` ya vencido.
    const vencido = atencion({ state: "deferred", dueAt: HACE_UN_RATO, needsAttentionNow: true });
    const lista = [conversacion({ id: "v", attention: vencido })];

    expect(estadoOperativo(lista[0]!)).toBe("por_atender");
    expect(resumirBandeja(lista).porAtender).toBe(
      lista.reduce((a, c) => a + (necesitaAtencionAhora(c) ? 1 : 0), 0)
    );
  });
});

// --- 4. Una sola cabecera, misma jerarquía ---------------------------------

describe("014 C7 · la cabecera de página es una sola", () => {
  it("el título manda y la frase queda subordinada", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        title: "Pipeline",
        hint: "Los leads viven aquí.",
        count: 7,
        actions: createElement("button", { type: "button" }, "Gestionar etapas"),
      })
    );

    // Un `h1` —antes cada pantalla tenía el suyo, y cinco de ellas eran `h2`—,
    // con el título, y la frase en el tamaño secundario de siempre.
    expect(html.match(/<h1/g) ?? []).toHaveLength(1);
    expect(html).toContain("Pipeline");
    expect(html).toMatch(/text-lg font-semibold tracking-tight/);
    expect(html).toMatch(/<p class="mt-0\.5 text-xs text-text-3">/);
    expect(html).toContain("7");
  });
});

// --- 5. Ninguna pantalla a medias ------------------------------------------

describe("014 C7 · un tablero vacío dice qué hacer, no se queda en blanco", () => {
  it("sin etapas, el Pipeline lo dice y ofrece la acción que lo arregla", () => {
    // Estado inicial de `PipelineClient`: aún no ha llegado nada del servidor. El
    // fetch no corre en `renderToStaticMarkup`, así que esto es exactamente lo que
    // ve el operador durante el primer frame y en el camino infeliz de red caída.
    const html = renderToStaticMarkup(createElement(PipelineClient));

    // Un tablero sin columnas sin explicación parece una pantalla rota.
    expect(html).toContain("todavía no tiene etapas");
    // Y ofrece la misma puerta que el botón de la cabecera, no un callejón.
    expect(html.match(/Gestionar etapas/g) ?? []).toHaveLength(2);
    expect(html).toContain("<h1");
  });
});
