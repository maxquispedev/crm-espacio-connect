/**
 * Sales Playbook — Container de la UI (Feature 009, Corte 1, T913).
 *
 * Orquesta el estado de las tres piezas (publicada / draft / historial) y
 * todas las acciones: crear draft, validar, guardar, publicar, rollback y
 * eliminar draft. Se revalida con refetch tras cada mutación (la 008 retiró
 * la cache a propósito).
 *
 * **Corte 1**: la pestaña pasó de ocho formularios a dos editores JSON
 * técnicos. Este archivo hace la *proyección* del `ConfigV1` a dos
 * documentos y el *reassembly* antes de enviar. El modelo durable no cambia:
 * sigue siendo una sola versión con el `ConfigV1` completo, y el `PUT`
 * sigue recibiendo el documento entero igual que con los formularios
 * (contrato `contracts/playbook-ui.md` §1).
 *
 * **Este contenedor no implementa Zod.** `Validar` siempre llama a
 * `POST /api/playbook/validate`: la autoridad es el servidor (DV-4).
 */

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { formatDateTime } from "./summary";
import { Modal } from "./fields";
import { JevQuestionsEditor } from "./jev-questions-editor";
import {
  issuesForConfig,
  issuesForJev,
  parseJsonDocument,
  useJsonDocState,
  type JsonDocState,
} from "./json-editor";
import { PlaybookDraftEditor } from "./playbook-draft-editor";
import { PlaybookPublishedCard } from "./playbook-published-card";
import { PlaybookVersionsList } from "./playbook-versions-list";
import type {
  PlaybookStateDto,
  PlaybookVersionDto,
  PlaybookVersionSummaryDto,
  ValidationIssue,
} from "./types";
import { readApiError } from "./types";

type Notice = { kind: "ok" | "error"; text: string } | null;

/** Ventana mínima entre dos `Validar` seguidos, en ms. */
const VALIDATE_THROTTLE_MS = 800;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function PlaybookClient() {
  const [playbook, setPlaybook] = React.useState<PlaybookStateDto["playbook"]>(null);
  const [published, setPublished] = React.useState<PlaybookVersionDto | null>(null);
  const [draft, setDraft] = React.useState<PlaybookVersionDto | null>(null);
  const [versions, setVersions] = React.useState<PlaybookVersionSummaryDto[]>([]);

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<Notice>(null);

  const [saving, setSaving] = React.useState(false);
  const [validating, setValidating] = React.useState(false);
  const [creatingDraft, setCreatingDraft] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [rollingBackId, setRollingBackId] = React.useState<string | null>(null);
  const [issues, setIssues] = React.useState<ValidationIssue[]>([]);

  const [showHistory, setShowHistory] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [publishNotes, setPublishNotes] = React.useState("");
  const [rollbackTarget, setRollbackTarget] = React.useState<{
    id: string;
    versionNumber: number;
  } | null>(null);
  const [rollbackNotes, setRollbackNotes] = React.useState("");

  /* --------------------- Carga ---------------------------------- */

  const refetch = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/playbook", { cache: "no-store" });
      if (res.status === 404) {
        // Sin playbook todavía: estado vacío administrable, no error.
        setPlaybook(null);
        setPublished(null);
        setDraft(null);
        setError(null);
        return;
      }
      if (!res.ok) {
        throw new Error(await readApiError(res, "No se pudo cargar el playbook"));
      }
      const body = (await res.json()) as PlaybookStateDto;
      setPlaybook(body.playbook);
      setPublished(body.published);
      setDraft(body.draft);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo cargar el playbook"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const refetchVersions = React.useCallback(async () => {
    try {
      const res = await fetch("/api/playbook/versions", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { versions: PlaybookVersionSummaryDto[] };
      setVersions(body.versions);
    } catch {
      // El historial es informativo: si falla, la edición sigue usable.
    }
  }, []);

  const refetchAll = React.useCallback(async () => {
    await Promise.all([refetch(), refetchVersions()]);
  }, [refetch, refetchVersions]);

  React.useEffect(() => {
    void refetchAll();
  }, [refetchAll]);

  /* --------------------- Acciones -------------------------------- */

  const createDraft = async () => {
    setCreatingDraft(true);
    setNotice(null);
    try {
      const res = await fetch("/api/playbook/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, "No se pudo crear el draft"));
      }
      setIssues([]);
      setNotice({ kind: "ok", text: "Draft creado a partir de la publicada." });
      await refetchAll();
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "No se pudo crear el draft",
      });
    } finally {
      setCreatingDraft(false);
    }
  };

  const confirmPublish = async () => {
    if (publishNotes.trim().length < 3) return;
    setPublishing(true);
    setNotice(null);
    try {
      const res = await fetch("/api/playbook/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: publishNotes.trim() }),
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, "No se pudo publicar"));
      }
      setPublishOpen(false);
      setPublishNotes("");
      setIssues([]);
      setNotice({ kind: "ok", text: "Draft publicado. Ya está en vigor." });
      await refetchAll();
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "No se pudo publicar",
      });
    } finally {
      setPublishing(false);
    }
  };

  const openRollback = (versionId: string, versionNumber: number) => {
    setRollbackTarget({ id: versionId, versionNumber });
    setRollbackNotes("");
  };

  const confirmRollback = async () => {
    if (!rollbackTarget || rollbackNotes.trim().length < 3) return;
    setRollingBackId(rollbackTarget.id);
    setNotice(null);
    try {
      const res = await fetch("/api/playbook/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version_id: rollbackTarget.id,
          notes: rollbackNotes.trim(),
        }),
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, "No se pudo hacer rollback"));
      }
      setRollbackTarget(null);
      setRollbackNotes("");
      setNotice({
        kind: "ok",
        text: `Rollback a V${rollbackTarget.versionNumber} aplicado.`,
      });
      await refetchAll();
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "No se pudo hacer rollback",
      });
    } finally {
      setRollingBackId(null);
    }
  };

  const deleteDraft = async () => {
    setDeleting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/playbook/draft", { method: "DELETE" });
      if (!res.ok) {
        throw new Error(await readApiError(res, "No se pudo eliminar el draft"));
      }
      setIssues([]);
      setNotice({ kind: "ok", text: "Draft eliminado." });
      await refetchAll();
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "No se pudo eliminar el draft",
      });
    } finally {
      setDeleting(false);
    }
  };

  /* --------------------- Render ---------------------------------- */

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Cargando playbook…
        </CardContent>
      </Card>
    );
  }

  // Estado vacío: no hay playbook ni publicada. No sembramos desde la UI.
  if (!playbook && !published) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sales Playbook</CardTitle>
          <CardDescription>
            El bootstrap multi-org siembra la V1 al boot del sistema. Si no
            aparece, contacta al administrador.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {notice ? <NoticeBanner notice={notice} /> : null}
          {error ? (
            <p className="text-sm text-danger-text" role="alert">
              {error}
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Puedes crear un draft manualmente como operación administrativa,
            pero la versión publicada la sigue sembrando el sistema.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void createDraft()} disabled={creatingDraft}>
              {creatingDraft ? "Creando draft…" : "Crear draft"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void refetchAll()}
              disabled={loading}
            >
              Refetch
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Barra superior */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-base font-semibold tracking-tight">
            Sales Playbook
          </h3>
          {playbook ? (
            <p className="text-xs text-muted-foreground">
              {playbook.label} · schema{" "}
              {draft?.schema_version ?? published?.schema_version ?? "1.0"}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetchAll()}
            disabled={loading}
          >
            Refetch
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHistory((v) => !v)}
          >
            {showHistory ? "Ocultar historial" : "Ver historial"}
          </Button>
          {!draft ? (
            <Button size="sm" onClick={() => void createDraft()} disabled={creatingDraft}>
              {creatingDraft ? "Creando draft…" : "Crear draft"}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Estado / versionado: qué está en vigor y qué se está editando. */}
      <VersionState published={published} draft={draft} />

      {/* CTA al Laboratorio: reutiliza el existente, no lo duplica. */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="text-sm text-muted-foreground">
            ¿Quieres ver cómo responde el agente con la{" "}
            <strong>publicada</strong> frente al <strong>draft</strong>? El
            Laboratorio corre el pipeline comercial real en sandbox y no toca
            WhatsApp.
          </p>
          <Link
            href="/lab"
            className="inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Abrir el Laboratorio
          </Link>
        </CardContent>
      </Card>

      {notice ? <NoticeBanner notice={notice} /> : null}
      {error ? (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      ) : null}

      {published ? (
        <PlaybookPublishedCard
          published={published}
          hasDraft={draft !== null}
          creatingDraft={creatingDraft}
          onCreateDraft={() => void createDraft()}
          onShowHistory={() => setShowHistory(true)}
        />
      ) : (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No hay ninguna versión publicada todavía. Publica un draft para
            poner el playbook en vigor.
          </CardContent>
        </Card>
      )}

      {draft ? (
        // `key={draft.id}`: al crear/eliminar/publicar un draft distinto se
        // remonta el editor y los dos documentos se reproyectan desde cero.
        // Es lo que evita que un refetch pise lo que el admin está escribiendo.
        <DraftEditorPane
          key={draft.id}
          draft={draft}
          issues={issues}
          saving={saving}
          validating={validating}
          publishing={publishing}
          deleting={deleting}
          canDelete={published !== null}
          onSave={async (doc) => {
            setSaving(true);
            setNotice(null);
            setIssues([]);
            try {
              const res = await fetch("/api/playbook/draft", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                // Documento COMPLETO reassemblado, igual que con la UI de
                // formularios. El servidor revalida con Zod +
                // `assertJevProtectedKeys` antes de persistir.
                body: JSON.stringify(doc),
              });
              if (!res.ok) {
                const msg = await readApiError(res, "No se pudo guardar el draft");
                await captureDetails(res, setIssues);
                throw new Error(msg);
              }
              setNotice({ kind: "ok", text: "Cambios guardados en el draft." });
              await refetchAll();
            } catch (err) {
              setNotice({
                kind: "error",
                text: err instanceof Error ? err.message : "No se pudo guardar el draft",
              });
            } finally {
              setSaving(false);
            }
          }}
          onValidate={async (doc) => {
            setValidating(true);
            setNotice(null);
            setIssues([]);
            try {
              const res = await fetch("/api/playbook/validate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(doc),
              });
              if (!res.ok) {
                const msg = await readApiError(res, "El playbook no es válido");
                await captureDetails(res, setIssues);
                throw new Error(msg);
              }
              setNotice({
                kind: "ok",
                text: "Válido: el servidor aceptó el documento completo.",
              });
            } catch (err) {
              setNotice({
                kind: "error",
                text: err instanceof Error ? err.message : "El playbook no es válido",
              });
            } finally {
              setValidating(false);
            }
          }}
          onDiscard={async () => {
            setIssues([]);
            setNotice({ kind: "ok", text: "Cambios descartados." });
            await refetchAll();
          }}
          onPublish={() => setPublishOpen(true)}
          onDelete={() => void deleteDraft()}
        />
      ) : null}

      {showHistory ? (
        <PlaybookVersionsList
          versions={versions}
          publishedId={published?.id ?? null}
          onRollback={openRollback}
          rollingBackId={rollingBackId}
        />
      ) : null}

      {/* Modal de publicación (nota obligatoria) */}
      <Modal
        open={publishOpen}
        title="Publicar draft"
        onClose={() => setPublishOpen(false)}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            La versión publicada actual (V{published?.version_number ?? "?"}) se
            archivará. Este comentario queda en el historial.
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="pb-publish-notes">
              Comentario <span className="text-danger-text">*</span>
            </label>
            <textarea
              id="pb-publish-notes"
              rows={3}
              value={publishNotes}
              onChange={(e) => setPublishNotes(e.target.value)}
              placeholder="Ajuste de precios del ciclo 2026"
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {publishNotes.trim().length > 0 && publishNotes.trim().length < 3 ? (
              <p className="text-xs text-danger-text">
                Mínimo 3 caracteres.
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setPublishOpen(false)}
              disabled={publishing}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => void confirmPublish()}
              disabled={publishing || publishNotes.trim().length < 3}
            >
              {publishing ? "Publicando…" : "Publicar"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal de rollback (nota obligatoria) */}
      <Modal
        open={rollbackTarget !== null}
        title={rollbackTarget ? `Rollback a V${rollbackTarget.versionNumber}` : "Rollback"}
        onClose={() => setRollbackTarget(null)}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Se republicará el contenido de V{rollbackTarget?.versionNumber}. La
            versión en vigor se archivará.
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="pb-rollback-notes">
              Comentario <span className="text-danger-text">*</span>
            </label>
            <textarea
              id="pb-rollback-notes"
              rows={3}
              value={rollbackNotes}
              onChange={(e) => setRollbackNotes(e.target.value)}
              placeholder="Revertimos el cambio de precios"
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {rollbackNotes.trim().length > 0 && rollbackNotes.trim().length < 3 ? (
              <p className="text-xs text-danger-text">Mínimo 3 caracteres.</p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setRollbackTarget(null)}
              disabled={rollingBackId !== null}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => void confirmRollback()}
              disabled={rollingBackId !== null || rollbackNotes.trim().length < 3}
            >
              {rollingBackId !== null ? "Publicando…" : "Hacer rollback"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ============================================================
 * Estado / versionado
 * ============================================================ */

function VersionState({
  published,
  draft,
}: {
  published: PlaybookVersionDto | null;
  draft: PlaybookVersionDto | null;
}) {
  const rows: { label: string; value: string }[] = [
    {
      label: "Publicada",
      value: published
        ? `V${published.version_number} · schema ${published.schema_version} · ${formatDateTime(published.published_at ?? published.created_at)}`
        : "—",
    },
    {
      label: "Draft",
      value: draft
        ? `V${draft.version_number} · schema ${draft.schema_version} · creado ${formatDateTime(draft.created_at)}`
        : "ninguno abierto",
    },
  ];
  if (published?.notes) rows.push({ label: "Nota publicada", value: published.notes });
  if (draft?.notes) rows.push({ label: "Nota del draft", value: draft.notes });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Estado y versionado</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,10rem)_1fr]">
          {rows.map((row) => (
            <React.Fragment key={row.label}>
              <dt className="text-xs font-medium text-muted-foreground">
                {row.label}
              </dt>
              <dd className="text-xs">{row.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * Panel de edición: los dos documentos JSON
 * ============================================================ */

/** El `ConfigV1` menos `jev_questions` (documento 1). */
function projectConfig(doc: PlaybookVersionDto): Record<string, unknown> {
  return {
    product: doc.product,
    offer: doc.offer,
    commercial_policy: doc.commercial_policy,
    priorities: doc.priorities,
    writer: doc.writer,
    prohibitions: doc.prohibitions,
    handoff: doc.handoff,
    urgency_rules: doc.urgency_rules,
  };
}

function DraftEditorPane({
  draft,
  issues,
  saving,
  validating,
  publishing,
  deleting,
  canDelete,
  onSave,
  onValidate,
  onDiscard,
  onPublish,
  onDelete,
}: {
  draft: PlaybookVersionDto;
  issues: ValidationIssue[];
  saving: boolean;
  validating: boolean;
  publishing: boolean;
  deleting: boolean;
  canDelete: boolean;
  onSave: (doc: Record<string, unknown>) => Promise<void>;
  onValidate: (doc: Record<string, unknown>) => Promise<void>;
  onDiscard: () => Promise<void>;
  onPublish: () => void;
  onDelete: () => void;
}) {
  const configState = useJsonDocState(projectConfig(draft));
  const jevState = useJsonDocState(draft.jev_questions);

  // `dirty` = el contenido parseado difiere del draft persistido. Comparar
  // el objeto (no el texto) hace que reformatear a 2 espacios sin cambiar
  // nada no cuente como modificación.
  const dirty = React.useMemo(() => {
    const config = configDocOf(configState);
    const jev = jevDocOf(jevState);
    if (!config || !jev) return false;
    return (
      JSON.stringify(config) !== JSON.stringify(projectConfig(draft)) ||
      JSON.stringify(jev) !== JSON.stringify(draft.jev_questions)
    );
  }, [configState, jevState, draft]);

  const lastValidAt = React.useRef(0);
  const runValidate = React.useCallback(() => {
    const now = Date.now();
    // Throttle: pulsaciones repetidas no golpean el endpoint en bucle.
    if (now - lastValidAt.current < VALIDATE_THROTTLE_MS) return;
    lastValidAt.current = now;
    // `validate` sí exige `schema_version`; el `PUT` no (cuerpo strict).
    const doc = reassemble(configState, jevState, draft.schema_version);
    if (!doc) return;
    void onValidate(doc);
  }, [configState, jevState, draft.schema_version, onValidate]);

  const runSave = React.useCallback(() => {
    const doc = reassemble(configState, jevState, undefined);
    if (!doc) return;
    void onSave(doc);
  }, [configState, jevState, onSave]);

  const jevEditor = (
    <JevQuestionsEditor
      state={jevState}
      lastValid={jevDocOf(jevState)}
      issues={issuesForJev(issues)}
      busy={validating}
    />
  );

  return (
    <PlaybookDraftEditor
      state={configState}
      jevState={jevState}
      jevEditor={jevEditor}
      issues={issuesForConfig(issues)}
      onSave={runSave}
      onValidate={runValidate}
      onDiscard={() => void onDiscard()}
      onPublish={onPublish}
      onDelete={onDelete}
      saving={saving}
      validating={validating}
      publishing={publishing}
      deleting={deleting}
      canDelete={canDelete}
      dirty={dirty}
      versionNumber={draft.version_number}
      schemaVersion={draft.schema_version}
      notes={draft.notes}
    />
  );
}

/** Valor parseado de un documento, o `null` si no parsea. */
function docOf(state: JsonDocState): unknown {
  const parsed = parseJsonDocument(state.text);
  return parsed.ok ? parsed.value : null;
}

function configDocOf(state: JsonDocState): Record<string, unknown> | null {
  const v = docOf(state);
  return isPlainObject(v) ? v : null;
}

function jevDocOf(state: JsonDocState): Record<string, unknown> | null {
  const v = docOf(state);
  return isPlainObject(v) ? v : null;
}

/**
 * Reassembly del `ConfigV1` completo (contrato §1.2). Devuelve `null` si
 * alguno de los dos documentos no es un objeto parseable: en ese caso no
 * hay nada que mandar y la UI ya muestra el error de sintaxis.
 *
 * `includeSchemaVersion` NO es cosmético: `PUT /api/playbook/draft` usa un
 * cuerpo `.strict()` de los nueve bloques (el `schema_version` lo pone el
 * servidor al mergear con el draft), mientras que
 * `POST /api/playbook/validate` corre `ConfigV1Schema.safeParse` sobre el
 * body tal cual, y ahí `schema_version: z.literal("1.0")` es **obligatorio**.
 * Omitirlo haría que Validar fallara siempre.
 */
function reassemble(
  configState: JsonDocState,
  jevState: JsonDocState,
  schemaVersion: string | undefined
): Record<string, unknown> | null {
  const config = configDocOf(configState);
  const jev = jevDocOf(jevState);
  if (!config || !jev) return null;
  return {
    ...(schemaVersion ? { schema_version: schemaVersion } : {}),
    ...config,
    jev_questions: jev,
  };
}

/** Lee `details[]` de un 422 sin romper si el body no es JSON. */
async function captureDetails(
  res: Response,
  setIssues: (next: ValidationIssue[]) => void
): Promise<void> {
  try {
    const body = (await res.clone().json()) as { details?: ValidationIssue[] };
    if (body.details) setIssues(body.details);
  } catch {
    /* sin details: solo el mensaje */
  }
}

function NoticeBanner({ notice }: { notice: NonNullable<Notice> }) {
  const isOk = notice.kind === "ok";
  return (
    <div
      role="status"
      className={`rounded-md border px-3 py-2 text-sm ${
        isOk
          ? "border-success-border bg-success-soft text-success-text"
          : "border-danger-border bg-danger-soft text-danger-text"
      }`}
    >
      {notice.text}
    </div>
  );
}
