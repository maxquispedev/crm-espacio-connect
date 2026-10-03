/**
 * Sales Playbook — Editor de CONFIGURACIÓN COMERCIAL en JSON
 * (Feature 009, Corte 1, T911).
 *
 * Sustituye a los ocho formularios por bloques del Corte 4 de la 008. El
 * documento que se edita es el `ConfigV1` **menos** `jev_questions`, que
 * vive en el editor 2. Al guardar, el padre reassembla
 * `{ ...configEdit, jev_questions: jevEdit }` y hace el
 * `PUT /api/playbook/draft` de siempre, igual que con los formularios.
 *
 * **Este componente no valida la config.** Solo formatea, detecta errores de
 * sintaxis con línea/columna, y expone los `details[]` que el servidor
 * devolvió. `ConfigV1Schema` es la autoridad (DV-4).
 */

import * as React from "react";

import { Button } from "@/components/ui/button";

import { FormatButton, JsonEditor, type JsonDocState, type JsonIssue } from "./json-editor";

/** Claves de `ConfigV1` que edita este documento (contrato §1). */
export const CONFIG_EDITABLE_KEYS = [
  "product",
  "offer",
  "commercial_policy",
  "priorities",
  "writer",
  "prohibitions",
  "handoff",
  "urgency_rules",
] as const;

export function PlaybookDraftEditor({
  state,
  jevState,
  jevEditor,
  issues,
  onSave,
  onValidate,
  onDiscard,
  onPublish,
  onDelete,
  saving,
  validating,
  publishing,
  deleting,
  canDelete,
  dirty,
  versionNumber,
  schemaVersion,
  notes,
}: {
  /** Estado del documento 1 (Config sin `jev_questions`). */
  state: JsonDocState;
  /** Estado del documento 2 (`jev_questions`). */
  jevState: JsonDocState;
  /** El editor 2 se renderiza dentro de esta tarjeta. */
  jevEditor: React.ReactNode;
  issues?: JsonIssue[];
  onSave: () => void;
  onValidate: () => void;
  onDiscard: () => void;
  onPublish: () => void;
  onDelete: () => void;
  saving: boolean;
  validating: boolean;
  publishing: boolean;
  deleting: boolean;
  canDelete: boolean;
  /** Hay cambios sin guardar respecto al draft cargado. */
  dirty: boolean;
  versionNumber?: number;
  schemaVersion?: string;
  notes?: string | null;
}) {
  const anySyntaxError = !state.valid || !jevState.valid;
  const busy = saving || validating || publishing || deleting;

  return (
    <section className="flex flex-col gap-4">
      <JsonEditor
        id="pb-config"
        label="1. Configuración comercial JSON"
        description={
          <>
            Bloques{" "}
            <code className="font-mono">{CONFIG_EDITABLE_KEYS.join(", ")}</code>
            . Las <code className="font-mono">jev_questions</code> van en el
            editor 2 y se reassembly al guardar.
          </>
        }
        state={state}
        issues={issues}
        rows={34}
        footer={<FormatButton state={state} />}
      />

      {jevEditor}

      {/* Barra de acciones del draft */}
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {versionNumber !== undefined ? <span>Draft V{versionNumber}</span> : null}
          {schemaVersion ? <span>schema {schemaVersion}</span> : null}
          {dirty ? (
            <span className="font-medium text-foreground">
              Cambios sin guardar
            </span>
          ) : (
            <span>Sin cambios sin guardar</span>
          )}
          {notes ? <span>Nota: {notes}</span> : null}
        </div>

        {anySyntaxError ? (
          <p className="text-xs text-danger-text" role="status">
            Hay JSON que no parsea: no se puede validar ni guardar. Corrige la
            sintaxis (línea y columna indicadas arriba) o pulsa{" "}
            <strong>Descartar cambios</strong> para volver al draft guardado.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={onValidate}
            disabled={busy || anySyntaxError}
            title={
              anySyntaxError
                ? "Corrige la sintaxis JSON antes de validar"
                : "POST /api/playbook/validate: el servidor decide la validez"
            }
          >
            {validating ? "Validando…" : "Validar"}
          </Button>
          <Button
            variant="secondary"
            onClick={onSave}
            disabled={busy || anySyntaxError || !dirty}
          >
            {saving ? "Guardando…" : "Guardar"}
          </Button>
          <Button
            variant="outline"
            onClick={onDiscard}
            disabled={busy || !dirty}
          >
            Descartar cambios
          </Button>
          <Button onClick={onPublish} disabled={busy || !dirty}>
            {publishing ? "Publicando…" : "Publicar"}
          </Button>
          <Button
            variant="ghost"
            onClick={onDelete}
            disabled={busy || !canDelete}
            title={
              canDelete
                ? "Elimina el draft abierto"
                : "Requiere una versión publicada activa"
            }
          >
            {deleting ? "Eliminando…" : "Eliminar draft"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          <strong>Validar</strong> siempre pregunta al servidor; el cliente no
          valida la config. <strong>Guardar</strong> persiste el draft.{" "}
          <strong>Publicar</strong> exige comentario y lo valida el backend
          otra vez.
        </p>
      </div>
    </section>
  );
}
