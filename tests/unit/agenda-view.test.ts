import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgendaBucketName, AgendaDto, ReminderDto } from "@/lib/types";

/**
 * 013 C3 — Lo que el operador LEE en la Agenda (spec §3.3).
 *
 * Se renderiza el JSX real con `renderToStaticMarkup` (sin jsdom, como el chip de
 * "Por atender" del corte 2) para afirmar sobre el marcado que ve la persona:
 * los cinco grupos SIEMPRE presentes, el contacto, la fecha/hora, la nota y el
 * estado, y las dos acciones (abrir la conversación, cancelar). El componente no
 * agrupa nada: recibe los grupos ya resueltos del servidor, y eso es justo lo que
 * este test deja a la vista.
 */

vi.mock("@/components/use-events", () => ({ useEvents: () => {} }));

const { AgendaGroups } = await import("@/components/agenda/agenda-client");

const AHORA = "2026-10-05T17:00:00.000Z";

function recordatorio(extra: Partial<ReminderDto> = {}): ReminderDto {
  return {
    conversationId: "cv_1",
    contact: { id: "ct_1", name: "Ana Ruiz", phone: "+51 999 000 111" },
    dueAt: AHORA,
    note: null,
    state: "deferred",
    bucket: "today",
    needsAttentionNow: false,
    ...extra,
  };
}

function agenda(entries: Partial<Record<AgendaBucketName, ReminderDto[]>>): AgendaDto {
  const buckets = { overdue: [], today: [], tomorrow: [], week: [], later: [] } as Record<
    AgendaBucketName,
    ReminderDto[]
  >;
  let total = 0;
  for (const [key, items] of Object.entries(entries) as [
    AgendaBucketName,
    ReminderDto[] | undefined,
  ][]) {
    if (!items) continue;
    buckets[key] = items;
    total += items.length;
  }
  return { generatedAt: AHORA, timeZone: "America/Lima", buckets, total };
}

function pintar(d: AgendaDto) {
  return renderToStaticMarkup(
    createElement(AgendaGroups, { agenda: d, busyId: null, onCancel: () => {} })
  );
}

describe("013 C3 — la vista Agenda", () => {
  it("pinta los cinco grupos aunque estén vacíos", () => {
    const html = pintar(agenda({}));
    for (const bucket of ["overdue", "today", "tomorrow", "week", "later"]) {
      expect(html, bucket).toContain(`data-testid="agenda-group-${bucket}"`);
    }
    // Las etiquetas en castellano del operador, en orden de urgencia.
    expect(html.indexOf("Vencidos")).toBeLessThan(html.indexOf("Hoy"));
    expect(html.indexOf("Mañana")).toBeLessThan(html.indexOf("Esta semana"));
    expect(html.indexOf("Esta semana")).toBeLessThan(html.indexOf("Más adelante"));
    // Y el estado vacío orienta en vez de mostrar una pantalla en blanco.
    expect(html).toContain('data-testid="agenda-empty"');
  });

  it("muestra contacto, fecha, estado y nota de cada recordatorio", () => {
    const html = pintar(
      agenda({
        today: [
          recordatorio({ note: "prometió llamar el jueves" }),
        ],
      })
    );
    expect(html).toContain("Ana Ruiz");
    expect(html).toContain("prometió llamar el jueves");
    // Fecha/hora legible junto al estado, en el mismo renglón.
    expect(html).toContain("agenda-item-when");
    expect(html).toMatch(/10:00|9:00|12:00/);
    expect(html).toContain("programado");
  });

  it("distingue lo vencido: vuelve a la cola, no a un grupo futuro", () => {
    const html = pintar(
      agenda({
        overdue: [
          recordatorio({
            conversationId: "cv_viejo",
            contact: { id: "ct_viejo", name: "Luis Paz", phone: null },
            bucket: "overdue",
            needsAttentionNow: true,
          }),
        ],
        later: [recordatorio({ conversationId: "cv_lejos", bucket: "later" })],
      })
    );
    expect(html).toContain("vencido · en Por atender");
    expect(html).toContain('data-testid="agenda-item-overdue"');
    expect(html).toContain('data-testid="agenda-item-later"');
  });

  it("ofrece abrir la conversación y cancelar, con destino comprobable", () => {
    const html = pintar(agenda({ tomorrow: [recordatorio()] }));
    // "Abrir" lleva a la Bandeja con el contacto, que es como la Bandeja
    // selecciona la conversación.
    expect(html).toContain('href="/inbox?contact=ct_1"');
    expect(html).toContain('data-testid="agenda-open"');
    expect(html).toContain('data-testid="agenda-cancel"');
    expect(html).toContain('aria-label="Cancelar recordatorio de Ana Ruiz"');
  });

  it("no ofrece ninguna acción de envío: vencer no manda WhatsApp", () => {
    // La diferencia de producto entre esta Agenda y un seguimiento automático
    // es visible en el marcado: aquí no existe ningún botón de envío. Si
    // alguien lo añadiera, este test se pondría rojo.
    const html = pintar(
      agenda({
        overdue: [recordatorio({ bucket: "overdue", needsAttentionNow: true })],
        today: [recordatorio({ conversationId: "cv_2" })],
      })
    );
    expect(html).not.toContain("Enviar");
    expect(html).not.toContain("enviar");
    // Lo único que se ofrece es abrir y cancelar.
    expect(html).toContain("Abrir");
    expect(html).toContain("Cancelar");
    // Y el grupo vencido dice que vuelve a la cola humana.
    expect(html).toContain("vuelve a");
  });
});
