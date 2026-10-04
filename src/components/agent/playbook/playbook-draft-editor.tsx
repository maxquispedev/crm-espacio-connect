/**
 * Sales Playbook — Editor del draft en JSON: tabs Config / Preguntas Jev y la
 * action bar (Feature 010, Corte 1, C1-3 y C1-6).
 *
 * Un **solo** editor visible a la vez. El estado de los dos documentos vive en
 * el padre (`playbook-client.tsx`), así que cambiar de tab no pierde lo
 * escrito: aquí solo se monta el editor del tab activo, y su texto sigue
 * viniendo del padre. El guardado reensambla el documento completo
 * (`reassembleDocuments`, igual que en 009).
 *
 * **Este componente no valida la config.** Solo formatea, detecta errores de
 * sintaxis con línea/columna y expone los `details[]` del servidor.
 * `ConfigV1Schema` y los candados Jev son la autoridad (DV-4).
 *
 * La regla de qué botón está habilitado no se calcula aquí: viene de
 * `draftActions()` (`draft-actions.ts`), que es pura y testeable sin navegador.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";

import { CONFIG_EDITABLE_KEYS, TABS, draftActions, type DraftTab } from "./draft-actions";
import { FormatButton, JsonEditor, type JsonDocState, type JsonIssue } from "./json-editor";

export function PlaybookDraftEditor({
  state,
  jevState,
  jevEditor,
  issues,
  onSave,
  onUpgrade,
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
}: {
  /** Estado del documento 1 (Config sin `jev_questions`). */
  state: JsonDocState;
  /** Estado del documento 2 (`jev_questions`). */
  jevState: JsonDocState;
  /** El editor 2, que se monta solo cuando su tab está activo. */
  jevEditor: React.ReactNode;
  issues?: JsonIssue[];
  onSave: () => void;
  onUpgrade?: () => void;
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
}) {
  const [tab, setTab] = React.useState<DraftTab>(TABS[0]!.id);

  const anySyntaxError = !state.valid || !jevState.valid;
  const actions = draftActions({
    busy: saving || validating || publishing || deleting,
    dirty,
    anySyntaxError,
    canDelete,
  });

  return (
    <section className="flex flex-col gap-3">
      {onUpgrade ? <Button variant="outline" size="sm" onClick={onUpgrade}
        disabled={saving || validating || publishing || deleting || anySyntaxError}>
        Actualizar draft a 1.1 (pago)
      </Button> : null}
      {/* Tabs: un editor a la vez. Montar y desmontar no pierde estado porque
          el texto vive en el padre, no dentro del editor. */}
      <div
        role="tablist"
        aria-label="Documentos del playbook"
        className="flex flex-wrap gap-1 rounded-lg border bg-card p-1"
      >
        {TABS.map((t) => {
          const active = t.id === tab;
          // El punto de aviso: un tab con JSON roto se marca sin cambiar de
          // tab (puede estar escondido, que es justo el caso que el aviso de
          // la action bar cuenta).
          const broken = t.id === TABS[0]!.id ? !state.valid : !jevState.valid;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`pb-tab-${t.id}`}
              aria-selected={active}
              aria-controls="pb-doc-panel"
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {t.label}
              {broken ? (
                <span className="ml-1.5 text-danger-text" aria-label="JSON inválido">
                  ●
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Línea de guardarraíles: informativa. La autoridad es el servidor
          (`assertJevProtectedKeys` + `ConfigV1Schema`). */}
      <p className="text-xs text-muted-foreground">
        🔒 <code className="font-mono">next_action</code>,{" "}
        <code className="font-mono">needs_human_call</code> y las option keys
        contractuales están protegidas. El servidor lo valida.
      </p>

      {/* Un solo editor visible. */}
      <div id="pb-doc-panel" role="tabpanel" aria-labelledby={`pb-tab-${tab}`}>
        {tab === TABS[0]!.id ? (
          <JsonEditor
            id="pb-config"
            label="Configuración comercial"
            description={
              <>
                Bloques{" "}
                <code className="font-mono">{CONFIG_EDITABLE_KEYS.join(", ")}</code>
                . Las <code className="font-mono">jev_questions</code> van en el
                tab de Preguntas Jev y se reensamblan al guardar.
              </>
            }
            state={state}
            issues={issues}
            rows={34}
            footer={<FormatButton state={state} />}
          />
        ) : (
          jevEditor
        )}
      </div>

      {/* Action bar: tres primarias, dos secundarias, y el estado en una línea.
          Sticky al fondo del área de edición. */}
      <div className="sticky bottom-0 z-10 flex flex-col gap-2 rounded-lg border bg-card p-3">
        <p
          className={`text-xs ${anySyntaxError ? "text-danger-text" : "text-muted-foreground"}`}
          role={anySyntaxError ? "alert" : "status"}
        >
          {anySyntaxError
            ? "Hay JSON que no parsea: corrige la sintaxis o descarta los cambios."
            : dirty
              ? "Cambios sin guardar"
              : "Guardado"}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={onValidate}
            disabled={!actions.validate}
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
            disabled={!actions.save}
            title="PUT /api/playbook/draft: persiste el documento completo"
          >
            {saving ? "Guardando…" : "Guardar"}
          </Button>
          <Button
            onClick={onPublish}
            disabled={!actions.publish}
            title={actions.publishTitle}
          >
            {publishing ? "Publicando…" : "Publicar"}
          </Button>

          <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />

          <Button
            variant="outline"
            size="sm"
            onClick={onDiscard}
            disabled={!actions.discard}
            title="Vuelve al draft guardado, descartando lo escrito"
          >
            Descartar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={!actions.remove}
            title={
              canDelete
                ? "Elimina el draft abierto"
                : "Requiere una versión publicada activa"
            }
          >
            {deleting ? "Eliminando…" : "Eliminar draft"}
          </Button>
        </div>
      </div>
    </section>
  );
}
