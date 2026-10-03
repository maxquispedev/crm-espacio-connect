/**
 * 010 — Corte 1 (C1-1): la regla contractual Guardar/Publicar de la action bar.
 *
 * Estos tests atacan el componente REAL (`PlaybookDraftEditor`) renderizado a
 * markup estático, no una reimplementación de la regla: si el `disabled` se
 * calcula en el JSX, el assertion lee ese JSX. Una copia de la lógica en el
 * test podría quedar verde mientras el botón real sigue invertido.
 *
 * Por qué son dos capas y no una:
 *
 *  1. `draftActions()` es la regla pura, consumida por el componente. Fija la
 *     tabla de `contracts/playground-ui.md` §6 caso por caso, incluidas las
 *     combinaciones que la UI no puede dejar ocurrir a mano.
 *  2. El render del componente ata la regla al botón de verdad, incluido el
 *     `title` que explica por qué está apagado.
 *
 * El segundo test **fallaba contra el código de antes del corte**
 * (`disabled={busy || !dirty}`: Publicar se encendía justo con cambios sin
 * guardar, que es el bug documentado en `research.md` §1.1).
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlaybookDraftEditor } from "@/components/agent/playbook/playbook-draft-editor";
import { draftActions } from "@/components/agent/playbook/draft-actions";
import type { JsonDocState } from "@/components/agent/playbook/json-editor";

/* ============================================================
 * Capa 1 — la regla pura
 * ============================================================ */

const NOOP = () => {};

describe("draftActions — la tabla del contrato §6", () => {
  const base = { busy: false, dirty: false, anySyntaxError: false, canDelete: true };

  it("dirty + JSON válido: se GUARDA, no se PUBLICA", () => {
    const a = draftActions({ ...base, dirty: true });
    expect(a.save).toBe(true);
    expect(a.publish).toBe(false);
    expect(a.validate).toBe(true);
    expect(a.discard).toBe(true);
  });

  it("sin cambios: se PUBLICA, no se GUARDA", () => {
    const a = draftActions({ ...base, dirty: false });
    expect(a.publish).toBe(true);
    expect(a.save).toBe(false);
    expect(a.discard).toBe(false);
  });

  it("JSON inválido con cambios: ni validar, ni guardar, ni publicar", () => {
    const a = draftActions({ ...base, dirty: true, anySyntaxError: true });
    expect(a.validate).toBe(false);
    expect(a.save).toBe(false);
    expect(a.publish).toBe(false);
    // Descartar sigue siendo la salida: es lo que devuelve al draft guardado.
    expect(a.discard).toBe(true);
  });

  it("JSON inválido sin cambios: tampoco se publica", () => {
    // El caso que la fila 3 del spec abre: hoy Publicar no mira la sintaxis,
    // así que un texto roto pero persistido lo deja publicable.
    const a = draftActions({ ...base, dirty: false, anySyntaxError: true });
    expect(a.publish).toBe(false);
    expect(a.validate).toBe(false);
    expect(a.save).toBe(false);
    expect(a.discard).toBe(false);
  });

  it("acción en vuelo: las cinco apagadas", () => {
    const a = draftActions({ ...base, busy: true, dirty: true, anySyntaxError: true });
    expect(a.validate).toBe(false);
    expect(a.save).toBe(false);
    expect(a.publish).toBe(false);
    expect(a.discard).toBe(false);
    expect(a.remove).toBe(false);
  });

  it("eliminar draft solo con versión publicada", () => {
    expect(draftActions({ ...base, canDelete: true }).remove).toBe(true);
    expect(draftActions({ ...base, canDelete: false }).remove).toBe(false);
  });

  it("NUNCA habilita Publicar con cambios sin guardar", () => {
    // La invariante, recorrida entera en vez de caso por caso: si algún día
    // alguien reintroduce la inversión, falla aquí aunque la tabla de arriba
    // se haya quedado igual.
    for (const anySyntaxError of [false, true]) {
      for (const busy of [false, true]) {
        expect(draftActions({ ...base, dirty: true, anySyntaxError, busy }).publish).toBe(
          false
        );
      }
    }
  });

  it("el title de Publicar explica el bloqueo en cada caso", () => {
    expect(
      draftActions({ ...base, dirty: true }).publishTitle
    ).toBe("Guarda los cambios antes de publicar");
    expect(
      draftActions({ ...base, anySyntaxError: true }).publishTitle
    ).toBe("Corrige la sintaxis JSON antes de publicar");
    expect(
      draftActions({ ...base, busy: true, dirty: true }).publishTitle
    ).toBe("Guarda los cambios antes de publicar");
    // Sin bloqueos: la explicación dice qué hace de verdad (publica el draft
    // PERSISTIDO, que es el motivo de la regla).
    expect(draftActions(base).publishTitle).toContain("draft guardado");
  });

  it("no hay autosave: la regla no depende de nada que guarde solo", () => {
    // Guardar solo se habilita por `dirty` explícito; con `dirty=false` nadie
    // guarda. Esto ata la invariante 2 del contrato ("no hay autosave").
    expect(draftActions({ ...base, dirty: false }).save).toBe(false);
  });
});

/* ============================================================
 * Capa 2 — el componente real
 * ============================================================ */

/** Estado de documento mínimo: solo `valid` decide la regla de la action bar. */
function docState(valid: boolean): JsonDocState {
  return {
    text: valid ? "{}" : "{ nope",
    setText: NOOP,
    parseError: valid ? null : { message: "boom", line: 1, column: 1 },
    valid,
    format: NOOP,
  };
}

function renderBar(
  opts: {
    dirty: boolean;
    configValid?: boolean;
    jevValid?: boolean;
    busy?: boolean;
    canDelete?: boolean;
  }
): string {
  return renderToStaticMarkup(
    React.createElement(PlaybookDraftEditor, {
      state: docState(opts.configValid ?? true),
      jevState: docState(opts.jevValid ?? true),
      jevEditor: React.createElement("div", null, "editor jev"),
      issues: [],
      onSave: NOOP,
      onValidate: NOOP,
      onDiscard: NOOP,
      onPublish: NOOP,
      onDelete: NOOP,
      saving: opts.busy ?? false,
      validating: opts.busy ?? false,
      publishing: opts.busy ?? false,
      deleting: false,
      canDelete: opts.canDelete ?? true,
      dirty: opts.dirty,
    })
  );
}

/** El `<button>` cuyo texto es exactamente `label`. */
function button(markup: string, label: string): string {
  const buttons = markup.match(/<button\b[^>]*>(?:(?!<\/button>).)*<\/button>/g) ?? [];
  const found = buttons.find((b) => b.replace(/<[^>]*>/g, "").trim() === label);
  if (!found) throw new Error(`no hay botón "${label}" en: ${markup.slice(0, 400)}`);
  return found;
}

const isDisabled = (b: string) => /\sdisabled(=|\s|>)/.test(b);

describe("PlaybookDraftEditor — los botones reales", () => {
  it("con cambios sin guardar: Guardar ON y Publicar OFF", () => {
    const m = renderBar({ dirty: true });
    expect(isDisabled(button(m, "Guardar"))).toBe(false);
    expect(isDisabled(button(m, "Publicar"))).toBe(true);
  });

  it("sin cambios: Publicar ON y Guardar OFF", () => {
    const m = renderBar({ dirty: false });
    expect(isDisabled(button(m, "Publicar"))).toBe(false);
    expect(isDisabled(button(m, "Guardar"))).toBe(true);
  });

  it("JSON inválido en Config: Publicar y Guardar OFF, Descartar ON", () => {
    const m = renderBar({ dirty: true, configValid: false });
    expect(isDisabled(button(m, "Publicar"))).toBe(true);
    expect(isDisabled(button(m, "Guardar"))).toBe(true);
    expect(isDisabled(button(m, "Validar"))).toBe(true);
    expect(isDisabled(button(m, "Descartar"))).toBe(false);
  });

  it("JSON inválido en Preguntas Jev: el otro editor también lo bloquea", () => {
    const m = renderBar({ dirty: true, jevValid: false });
    expect(isDisabled(button(m, "Publicar"))).toBe(true);
    expect(isDisabled(button(m, "Guardar"))).toBe(true);
  });

  it("acción en vuelo: las cinco apagadas", () => {
    // Con `saving` en vuelo los labels pasan a su verbo en gerundio; lo que
    // se afirma es que ninguno queda pulsable, no el texto del botón.
    const m = renderBar({ dirty: true, busy: true });
    for (const label of ["Validando…", "Guardando…", "Publicando…", "Descartar", "Eliminar draft"]) {
      expect(isDisabled(button(m, label)), label).toBe(true);
    }
  });

  it("Publicar dice por qué está apagado con cambios sin guardar", () => {
    const b = button(renderBar({ dirty: true }), "Publicar");
    expect(b).toContain('title="Guarda los cambios antes de publicar"');
  });

  it("Publicar habilitado explica que publica el draft guardado", () => {
    const b = button(renderBar({ dirty: false }), "Publicar");
    expect(b).toContain('title="POST /api/playbook/publish: publica el draft guardado"');
  });

  it("el párrafo explicativo de tres frases ya no está", () => {
    const m = renderBar({ dirty: true });
    expect(m).not.toContain("siempre pregunta al servidor");
    expect(m).not.toContain("exige comentario y lo valida el backend");
  });

  it("el estado visible es una línea, no cinco", () => {
    const m = renderBar({ dirty: true });
    expect(m).toContain("Cambios sin guardar");
    expect(m).not.toContain("Nota: ");
  });
});
