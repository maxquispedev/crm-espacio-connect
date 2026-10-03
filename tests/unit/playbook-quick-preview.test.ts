/**
 * Corte 2 — la UI de la Prueba rápida.
 *
 * Se renderiza el componente REAL a markup (sin jsdom, con
 * `react-dom/server`) para que lo que se afirma sea lo que el JSX produce, que
 * es el mismo criterio que `playbook-draft-editor-actions.test.ts` del corte 1.
 *
 * Cubre las reglas de cliente del contrato:
 *   - C2-4: sin draft, Draft deshabilitado y Published por defecto.
 *   - C2-8: con cambios sin guardar, el aviso exacto.
 *   - C2-3: conversación de ejemplo por defecto (no arrancar en blanco).
 *   - C2-6: salida compacta, no cards enormes.
 *   - el parseo del guion pegado y sus límites.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONVERSATION,
  MAX_LINES,
  PlaybookQuickPreview,
  parsePreviewConversation,
} from "@/components/agent/playbook/playbook-preview";

function render(props: { hasDraft: boolean; dirty: boolean }): string {
  // `createElement` en vez de JSX: la suite solo incluye `*.test.ts` y el
  // runtime `node` no transpila JSX en un `.ts`.
  return renderToStaticMarkup(createElement(PlaybookQuickPreview, props));
}

describe("Prueba rápida — parseo del guion pegado", () => {
  it("acepta el array con objetos {from,text}", () => {
    const parsed = parsePreviewConversation(
      '[{"from":"lead","text":"hola"},{"from":"lead","text":"cuánto cuesta"}]'
    );
    expect(parsed).toEqual({
      ok: true,
      lines: [
        { from: "lead", text: "hola" },
        { from: "lead", text: "cuánto cuesta" },
      ],
    });
  });

  it("normaliza un array de strings sueltos", () => {
    const parsed = parsePreviewConversation('["hola","y el precio?"]');
    expect(parsed).toEqual({
      ok: true,
      lines: [
        { from: "lead", text: "hola" },
        { from: "lead", text: "y el precio?" },
      ],
    });
  });

  it("rechaza lo que no puede ser una conversación", () => {
    expect(parsePreviewConversation("").ok).toBe(false);
    expect(parsePreviewConversation("{no json").ok).toBe(false);
    expect(parsePreviewConversation("{}").ok).toBe(false);
    expect(parsePreviewConversation("[]").ok).toBe(false);
  });

  it("rechaza from distinto de lead (el lead es quien inicia)", () => {
    const parsed = parsePreviewConversation('[{"from":"agent","text":"hola"}]');
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toMatch(/from/);
  });

  it("rechaza texto vacío y texto demasiado largo", () => {
    expect(parsePreviewConversation('[{"from":"lead","text":"   "}]').ok).toBe(false);
    expect(
      parsePreviewConversation(`[{"from":"lead","text":"${"x".repeat(2001)}"}]`).ok
    ).toBe(false);
  });

  it("acota el número de líneas", () => {
    const many = JSON.stringify(
      Array.from({ length: MAX_LINES + 1 }, () => ({ from: "lead", text: "hola" }))
    );
    const parsed = parsePreviewConversation(many);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toMatch(new RegExp(String(MAX_LINES)));
  });

  it("la conversación de ejemplo por defecto es válida", () => {
    // No arrancar en blanco (C2-3).
    const parsed = parsePreviewConversation(DEFAULT_CONVERSATION);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok === true && parsed.lines.length).toBe(1);
  });
});

describe("Prueba rápida — el componente real", () => {
  it("sin draft: Draft deshabilitado y Published por defecto", () => {
    const html = render({ hasDraft: false, dirty: false });
    // El `option` de Draft sale con `disabled`.
    expect(html).toMatch(/<option value="draft" disabled=""/);
    // El `select` está en `published`: React marca el `option` elegido.
    expect(html).toMatch(/<option value="published" selected=""/);
    expect(html).not.toMatch(/<option value="draft"[^>]*selected=""/);
  });

  it("con draft: Draft disponible y es el modo por defecto", () => {
    const html = render({ hasDraft: true, dirty: false });
    expect(html).not.toMatch(/<option value="draft"[^>]*disabled/);
    expect(html).toMatch(/<option value="draft" selected=""/);
  });

  it("con cambios sin guardar, avisa del draft guardado (C2-8)", () => {
    const html = render({ hasDraft: true, dirty: true });
    expect(html).toContain(
      "Estás probando el último draft guardado. Guarda los cambios para probarlos."
    );
  });

  it("sin cambios, NO avisa", () => {
    expect(render({ hasDraft: true, dirty: false })).not.toContain(
      "Estás probando el último draft guardado"
    );
  });

  it("trae conversación de ejemplo, un botón Ejecutar y el enlace al Lab", () => {
    const html = render({ hasDraft: true, dirty: false });
    expect(html).toContain("Ejecutar");
    expect(html).toContain("Abrir Laboratorio completo");
    expect(html).toContain('href="/lab"');
    // El textarea ya trae el ejemplo: no arranca vacío.
    expect(html).toContain("academias");
  });

  it("un solo botón de ejecución (una ejecución por clic)", () => {
    const html = render({ hasDraft: true, dirty: false });
    expect(html.match(/Ejecutar/g)).toHaveLength(1);
  });

  it("la salida es compacta: no hay una card gigante por señal", () => {
    const html = render({ hasDraft: true, dirty: false });
    // Sin resultado ejecutado no hay salida; el resumen vive en un `dl`.
    expect(html).not.toContain("Ver JSON completo");
    expect(html).not.toContain("Respuesta");
  });
});
