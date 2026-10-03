/**
 * Sales Playbook — Primitivas del editor técnico JSON (Feature 009, Corte 1).
 *
 * Sustituyen a los formularios por bloques del Corte 4 de la 008. La regla
 * histórica "NO JSON crudo" queda SUPERSEDED para esta pestaña: el usuario
 * objetivo es un administrador técnico que pega, valida y publica un
 * documento. Ver `specs/009-playbook-runtime-admin/contracts/playbook-ui.md`.
 *
 * **Este módulo NO valida semántica.** Aquí solo vive `JSON.parse`, que es
 * la única capa de validación que el cliente puede costear: `ConfigV1Schema`
 * y los guardarraíles Jev son código de servidor y se aplican en
 * `POST /api/playbook/validate`. Nada de Zod en el bundle del navegador.
 *
 * Sin dependencias nuevas: un `textarea` monoespaciado resuelve el caso
 * (DV-5). Monaco/CodeMirror quedan vetados por la Constitución II.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";

/* ============================================================
 * Parseo con línea y columna
 * ============================================================ */

/** Error de sintaxis, con posición traducida a línea/columna si se puede. */
export type JsonParseError = {
  message: string;
  /** 1-based. `null` si el motor no.Msg` posición: no se inventa. */
  line: number | null;
  /** 1-based. `null` si el motor no dio posición. */
  column: number | null;
};

export type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: JsonParseError };

/**
 * Traduce el `position` que `JSON.parse` de V8 incluye en el mensaje a
 * línea/columna, contando los `\n` anteriores sobre el propio texto.
 *
 * V8 cambió el formato del mensaje: versiones nuevas añaden ya
 * `(line 5 column 3)`. Se leen las dos formas; si no hay ninguna, se
 * devuelve el error crudo **sin inventar** posición.
 */
function locateJsonError(
  message: string,
  text: string
): { line: number; column: number } | null {
  const native = /line (\d+) column (\d+)/.exec(message);
  if (native?.[1] && native[2]) {
    return { line: Number(native[1]), column: Number(native[2]) };
  }

  const pos = /position (\d+)/.exec(message);
  if (!pos?.[1]) return null;
  const position = Number(pos[1]);
  if (!Number.isInteger(position) || position < 0) return null;
  // `position` puede caer justo al final del texto (error de clave ausente).
  const offset = Math.min(position, text.length);
  const before = text.slice(0, offset);
  const lastBreak = before.lastIndexOf("\n");
  return {
    line: before.split("\n").length,
    column: offset - lastBreak,
  };
}

/** `JSON.parse` que nunca lanza: devuelve el error con su ubicación. */
export function parseJsonDocument(text: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const at = locateJsonError(message, text);
    return {
      ok: false,
      error: { message, line: at?.line ?? null, column: at?.column ?? null },
    };
  }
}

/** Serializa a 2 espacios. Solo se llama con valores ya parseados. */
export function formatJsonDocument(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/* ============================================================
 * Estado de un documento JSON editado
 * ============================================================ */

/**
 * Estado de edición de un documento: el texto es la única fuente de
 * verdad (el admin puede estar a mitad de escribir una clave inválida y
 * eso no puede romper el render).
 */
export type JsonDocState = {
  text: string;
  setText: (next: string) => void;
  /** `null` mientras parsea; `JsonParseError` si hay error de sintaxis. */
  parseError: JsonParseError | null;
  /** `true` si el texto actual es un JSON parseable. */
  valid: boolean;
  /** Reformatea a 2 espacios. No hace nada si no parsea. */
  format: () => void;
};

/** Crea el estado de un documento a partir de un objeto inicial. */
export function useJsonDocState(initial: unknown): JsonDocState {
  const [text, setText] = React.useState(() => {
    // `JSON.stringify(undefined)` devuelve `undefined`, no un string, y eso
    // dejaría el `<textarea>` sin controlar. Un documento vacío es "{}".
    const serialized = formatJsonDocument(initial);
    return typeof serialized === "string" ? serialized : "{}";
  });

  const parsed = React.useMemo(() => parseJsonDocument(text), [text]);

  const format = React.useCallback(() => {
    // Nunca escribe un documento que no haya parseado: si `parsed` falló,
    // el texto del admin se conserva intacto.
    if (!parsed.ok) return;
    setText(formatJsonDocument(parsed.value));
  }, [parsed]);

  return {
    text,
    setText,
    parseError: parsed.ok ? null : parsed.error,
    valid: parsed.ok,
    format,
  };
}

/* ============================================================
 * Textarea monoespaciado + botón Formatear
 * ============================================================ */

/** Un `details[]` de la API, con el `path` literal del servidor. */
export type JsonIssue = { path: string; message: string; code?: string };

export function JsonEditor({
  id,
  label,
  description,
  state,
  issues,
  legend,
  footer,
  rows = 26,
}: {
  id: string;
  label: string;
  description?: React.ReactNode;
  state: JsonDocState;
  /** `details[]` de `/api/playbook/validate`, filtrados por el padre. */
  issues?: JsonIssue[];
  /** Leyenda de guardarraíles u otro contexto legible bajo el editor. */
  legend?: React.ReactNode;
  /** Acciones a la derecha de la cabecera (Validar, Guardar…). */
  footer?: React.ReactNode;
  rows?: number;
}) {
  const { parseError, valid } = state;
  const issueList = issues ?? [];

  return (
    <section className="rounded-lg border bg-card p-4 sm:p-5">
      <header className="mb-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold tracking-tight">{label}</h4>
          {footer ? <div className="flex flex-wrap gap-2">{footer}</div> : null}
        </div>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </header>

      <textarea
        id={id}
        rows={rows}
        value={state.text}
        onChange={(e) => state.setText(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-invalid={parseError || issueList.length > 0 ? true : undefined}
        aria-describedby={`${id}-help`}
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs leading-relaxed shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />

      <div
        id={`${id}-help`}
        className="mt-2 flex flex-col gap-2 text-xs"
        role={parseError || issueList.length > 0 ? "alert" : undefined}
      >
        {parseError ? (
          <p className="font-medium text-danger-text">
            {parseError.line !== null && parseError.column !== null
              ? `JSON inválido · línea ${parseError.line}, columna ${parseError.column} · `
              : "JSON inválido · "}
            {parseError.message}
          </p>
        ) : null}

        {!parseError && issueList.length === 0 && valid ? (
          <p className="text-muted-foreground">
            JSON bien formado. La validez del playbook la decide el servidor
            al validar.
          </p>
        ) : null}

        {issueList.length > 0 ? (
          <ul className="flex list-disc flex-col gap-1 pl-4 text-danger-text sm:list-square">
            {issueList.map((issue, i) => (
              <li key={`${issue.path}:${i}`}>
                <code className="font-mono">{issue.path || "(documento)"}</code>{" "}
                · {issue.message}
              </li>
            ))}
          </ul>
        ) : null}

        {legend}
      </div>
    </section>
  );
}

/** Botón "Formatear JSON": deshabilitado mientras el texto no parsee. */
export function FormatButton({ state }: { state: JsonDocState }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={state.format}
      disabled={!state.valid}
      title={
        state.valid
          ? "Reformatea el documento a 2 espacios"
          : "Corrige el JSON: no se puede formatear algo que no parsea"
      }
    >
      Formatear JSON
    </Button>
  );
}

/**
 * Filtra `details[]` del servidor para un editor concreto.
 *
 * Los paths de Zod vienen como `a.b.0.c` (unidos por `.` en la API). El
 * editor de Config muestra todo lo que no empieza por `jev_questions`, y
 * el de Preguntas solo lo que empieza por ahí.
 */
export function issuesForConfig(issues: JsonIssue[]): JsonIssue[] {
  return issues.filter((i) => !i.path.startsWith("jev_questions"));
}

export function issuesForJev(issues: JsonIssue[]): JsonIssue[] {
  return issues.filter(
    (i) => i.path.startsWith("jev_questions") || i.path === "jev_questions"
  );
}
