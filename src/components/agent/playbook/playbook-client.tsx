/**
 * Sales Playbook — Container de la UI (Corte 4, Feature 008, T402).
 *
 * Orquesta el estado de las tres piezas (publicada / draft / historial)
 * y todas las acciones: crear draft, guardar, validar (lo hace el
 * editor), publicar, rollback y eliminar draft. No hay estado global:
 * se revalida con refetch tras cada mutación, que es barato y evita
 * caches desincronizados (Corte 1 retiró la cache a propósito).
 *
 * **Empty state**: si no hay playbook ni publicada, esta UI NO siembra
 * nada por su cuenta. El bootstrap multi-org siembra la V1 al boot del
 * sistema; si falta, es un problema de despliegue y le toca al
 * administrador. Aun así se permite crear un draft manualmente como
 * operación administrativa.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { ConfigV1 } from "@/lib/sales/playbook/schema";

import { Modal } from "./fields";
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

export function PlaybookClient() {
  const [playbook, setPlaybook] = React.useState<PlaybookStateDto["playbook"]>(null);
  const [published, setPublished] = React.useState<PlaybookVersionDto | null>(null);
  const [draft, setDraft] = React.useState<PlaybookVersionDto | null>(null);
  const [versions, setVersions] = React.useState<PlaybookVersionSummaryDto[]>([]);

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<Notice>(null);

  const [saving, setSaving] = React.useState(false);
  const [creatingDraft, setCreatingDraft] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [rollingBackId, setRollingBackId] = React.useState<string | null>(null);
  const [saveIssues, setSaveIssues] = React.useState<ValidationIssue[]>([]);

  const [showHistory, setShowHistory] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [publishNotes, setPublishNotes] = React.useState("");
  const [rollbackTarget, setRollbackTarget] = React.useState<{
    id: string;
    versionNumber: number;
  } | null>(null);
  const [rollbackNotes, setRollbackNotes] = React.useState("");

  /* --------------------- Carga ---------------------------------- */

  const refetch = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
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
    // `refetchAll` (y no solo `refetch`): el historial se puede abrir sin
    // ninguna mutación de por medio, y con `refetch` solo la lista de
    // versiones quedaría vacía hasta la próxima acción.
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
      setSaveIssues([]);
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

  const saveDraft = async (config: ConfigV1) => {
    setSaving(true);
    setNotice(null);
    setSaveIssues([]);
    try {
      const res = await fetch("/api/playbook/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // El endpoint acepta patch por bloque; mandamos los bloques
        // tocables (las preguntas Jev no se editan en este corte).
        body: JSON.stringify({
          product: config.product,
          offer: config.offer,
          commercial_policy: config.commercial_policy,
          priorities: config.priorities,
          writer: config.writer,
          prohibitions: config.prohibitions,
          handoff: config.handoff,
          urgency_rules: config.urgency_rules ?? null,
        }),
      });
      if (!res.ok) {
        const msg = await readApiError(res, "No se pudo guardar el draft");
        // Si el 422 trae details, los mostramos bajo los campos.
        try {
          const body = (await res.clone().json()) as { details?: ValidationIssue[] };
          if (body.details) setSaveIssues(body.details);
        } catch {
          /* sin details: solo el mensaje */
        }
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
  };

  const discardChanges = async () => {
    setSaveIssues([]);
    setNotice({ kind: "ok", text: "Cambios descartados." });
    await refetchAll();
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
      setSaveIssues([]);
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
      setSaveIssues([]);
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
          {notice ? (
            <NoticeBanner notice={notice} />
          ) : null}
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
              {playbook.label} · schema {draft?.schema_version ?? published?.schema_version ?? "1.0"}
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
        <PlaybookDraftEditor
          draft={draft}
          issues={saveIssues}
          saving={saving}
          publishing={publishing}
          canDelete={published !== null}
          deleting={deleting}
          onSave={(config) => void saveDraft(config)}
          onDiscard={() => void discardChanges()}
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
