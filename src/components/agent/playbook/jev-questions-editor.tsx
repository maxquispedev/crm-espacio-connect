/**
 * Sales Playbook — Editor de PREGUNTAS JEV en JSON (Feature 009, Corte 1).
 *
 * Sustituye al editor visual por clases del Corte 5 de la 008. El documento
 * que se edita es el objeto `jev_questions` completo; el modelo durable no
 * cambia (una sola versión con el `ConfigV1` entero) y el servidor sigue
 * siendo la autoridad de los candados: `ConfigV1Schema` +
 * `assertJevProtectedKeys` bloquean keys, tipos y option keys protegidas.
 *
 * **Qué se conserva de la UI anterior** (DV-12 y contrato §4): la
 * legibilidad de las clases de guardarraíl. Ya no se editan visualmente,
 * pero se siguen leyendo de `constants.ts`, que es la fuente única de la
 * clasificación:
 *
 * | clase          | icono | qué está bloqueado                       |
 * |----------------|-------|------------------------------------------|
 * | engine-required| 🔒    | key, type, option keys, `enabled`         |
 * | known-signal   | 📊    | key, type y option keys                   |
 * | analytical     | ➕    | nada: texto libre del administrador       |
 *
 * No se reimplementa aquí ninguna regla de validación: la UI **no** decide
 * qué es válido, solo muestra la clasificación y deja que el servidor
 * rechace (DV-4).
 */

import * as React from "react";

import {
  JEV_QUESTION_CLASS_ICON,
  JEV_QUESTION_CLASS_LABEL,
  JEV_QUESTION_CLASS_TOOLTIP,
  type JevQuestionClass,
  classifyJevQuestion,
} from "@/lib/sales/playbook/constants";

import {
  FormatButton,
  JsonEditor,
  type JsonIssue,
  type JsonDocState,
} from "./json-editor";

export type JevQuestions = Record<string, unknown>;

const CLASS_ORDER: readonly JevQuestionClass[] = [
  "engine-required",
  "known-signal",
  "analytical",
];

/**
 * Clasifica las keys presentes en el texto Actual del editor. Si el JSON no
 * parsea, se cae a la clasificación de la última versión válida que pasó el
 * padre, para que la leyenda no desaparezca mientras se escribe.
 */
function classifyKeys(
  questions: JevQuestions | null
): { key: string; cls: JevQuestionClass }[] {
  if (!questions) return [];
  return Object.keys(questions).map((key) => ({
    key,
    cls: classifyJevQuestion(key),
  }));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function JevQuestionsEditor({
  state,
  lastValid,
  issues,
  busy,
}: {
  state: JsonDocState;
  /** Último objeto `jev_questions` que parseó, para la leyenda. */
  lastValid: JevQuestions | null;
  issues?: JsonIssue[];
  busy?: boolean;
}) {
  // Legendas a partir del texto en vivo si parsea; si no, del último válido.
  const live = state.valid ? state.text : null;
  let liveObj: JevQuestions | null = null;
  if (live !== null) {
    try {
      const parsed = JSON.parse(live) as unknown;
      if (isPlainObject(parsed)) liveObj = parsed;
    } catch {
      liveObj = null;
    }
  }
  const classified = classifyKeys(liveObj ?? lastValid);

  const counts = React.useMemo(() => {
    const acc: Record<JevQuestionClass, string[]> = {
      "engine-required": [],
      "known-signal": [],
      analytical: [],
    };
    for (const { key, cls } of classified) acc[cls].push(key);
    return acc;
  }, [classified]);

  return (
    <JsonEditor
      id="pb-jev-questions"
      label="2. Preguntas Jev JSON"
      description={
        <>
          Objeto <code className="font-mono">jev_questions</code> completo: una
          clave por pregunta, con su <code className="font-mono">type</code> y
          sus opciones. Se reassembly con el documento 1 al guardar. Los
          candados los aplica el servidor: si tocas una clave protegida te
          devolverá el error con su <code className="font-mono">path</code>.
        </>
      }
      state={state}
      issues={issues}
      rows={30}
      legend={<GuardrailLegend counts={counts} busy={busy} />}
      footer={
        <FormatButton state={state} />
      }
    />
  );
}

/**
 * Leyenda de guardarraíles. Se mantiene aunque ya no se editen visualmente:
 * es lo que explica por qué el servidor va a rechazar certain cambios, y
 * evita que el administrador descubra los candados por un 422.
 */
function GuardrailLegend({
  counts,
  busy,
}: {
  counts: Record<JevQuestionClass, string[]>;
  busy?: boolean;
}) {
  const total = Object.values(counts).reduce((n, keys) => n + keys.length, 0);

  return (
    <div className="mt-1 flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
      <p className="font-medium text-foreground">
        Guardarraíles del contrato Jev{" "}
        <span className="font-normal text-muted-foreground">
          ({total} pregunta{total === 1 ? "" : "s"})
        </span>
      </p>

      {total === 0 ? (
        <p className="text-muted-foreground">
          Sin preguntas legibles todavía: el JSON actual no parsea o no es un
          objeto.
        </p>
      ) : null}

      <ul className="flex flex-col gap-1.5">
        {CLASS_ORDER.map((cls) => {
          const keys = counts[cls];
          return (
            <li key={cls} className="flex flex-wrap items-baseline gap-x-2">
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-medium"
                title={JEV_QUESTION_CLASS_TOOLTIP[cls]}
              >
                <span aria-hidden="true">{JEV_QUESTION_CLASS_ICON[cls]}</span>
                {JEV_QUESTION_CLASS_LABEL[cls]}
                <span className="text-muted-foreground">({keys.length})</span>
              </span>
              {keys.length > 0 ? (
                <code className="font-mono text-muted-foreground">
                  {keys.join(", ")}
                </code>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="text-muted-foreground">
        {busy
          ? "Validando contra el servidor…"
          : "🔒 y 📊: key, type y option keys no se pueden cambiar. ➕: texto libre. El servidor es la autoridad."}
      </p>
    </div>
  );
}
