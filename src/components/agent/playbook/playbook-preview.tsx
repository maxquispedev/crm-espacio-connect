/**
 * Sales Playbook — Prueba rápida embebida (Feature 010, Corte 2).
 *
 * Ejecuta **un** caso ad-hoc por el MISMO pipeline comercial sandbox que el
 * Laboratorio y muestra decisión + plan + respuesta del writer. No hay motor
 * aquí: el botón llama a `POST /api/lab/preview`, que a su vez invoca
 * `runSalesOrchestratorTurn`, la misma función del Laboratorio.
 *
 * Dos reglas que esta UI hace visibles (no las aplica el servidor):
 *   - **Guardar → Probar.** El endpoint no recibe el documento local: prueba la
 *     versión persistida. Con cambios sin guardar se dice, no se adivina.
 *   - **El fallo se muestra como fallo.** Nunca se pinta una respuesta que el
 *     pipeline no produjo.
 */

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/** Ejemplo por defecto: no arrancar en blanco (C2-3). */
export const DEFAULT_CONVERSATION = JSON.stringify(
  [
    {
      from: "lead",
      text: "Hola, vi que manejan academias. Tengo un negocio de capacitance y quiero ordenar mis alumnos y pagos.",
    },
  ],
  null,
  2
);

export type PreviewMode = "draft" | "published";

export type PreviewSignal = { type: string; value: unknown } | null;

export type PreviewResponse = {
  ok: true;
  playbook: {
    mode: PreviewMode;
    version_number: number | null;
    version_id: string | null;
    schema_version: string | null;
    is_draft: boolean;
  };
  jev: Record<string, PreviewSignal>;
  plan: {
    lane: string | null;
    next_action: string | null;
    should_handoff: boolean | null;
    stage_id: string | null;
    stage_name: string | null;
  };
  writer: { text: string | null };
  turns: number;
};

export type PreviewFailure = {
  ok: false;
  code: string;
  message: string;
  detail?: string;
};

/* ------------------------------------------------------------------ *
 * Parseo del guion pegado. Puro y testeable sin navegador.
 * ------------------------------------------------------------------ */

export type ParsedConversation =
  | { ok: true; lines: { from: "lead"; text: string }[] }
  | { ok: false; error: string };

export const MAX_LINES = 20;
export const MAX_TEXT = 2000;

/**
 * Parsea `[{"from":"lead","text":"…"}]`. Acepta también un array de strings
 * sueltos (se normalizan a `from: "lead"`), que es lo que se pega en la
 * práctica. Mismo límite que el Zod del endpoint: 1..20 líneas.
 */
export function parsePreviewConversation(text: string): ParsedConversation {
  const raw = text.trim();
  if (raw.length === 0) return { ok: false, error: "Pega una conversación." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `JSON inválido${err instanceof Error ? `: ${err.message}` : ""}`,
    };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "La conversación debe ser un array JSON." };
  }
  if (parsed.length === 0) {
    return { ok: false, error: "La conversación necesita al menos una línea." };
  }
  if (parsed.length > MAX_LINES) {
    return { ok: false, error: `Máximo ${MAX_LINES} líneas por prueba.` };
  }

  const lines: { from: "lead"; text: string }[] = [];
  for (const [i, item] of parsed.entries()) {
    // Atajo: `"hola"` → `{ from: "lead", text: "hola" }`.
    if (typeof item === "string") {
      if (item.trim().length === 0) {
        return { ok: false, error: `Línea ${i + 1}: el texto está vacío.` };
      }
      if (item.length > MAX_TEXT) {
        return { ok: false, error: `Línea ${i + 1}: demasiado larga.` };
      }
      lines.push({ from: "lead", text: item });
      continue;
    }
    if (!item || typeof item !== "object") {
      return { ok: false, error: `Línea ${i + 1}: se esperaba un objeto.` };
    }
    const obj = item as { from?: unknown; text?: unknown };
    if (obj.from !== "lead") {
      return { ok: false, error: `Línea ${i + 1}: "from" debe ser "lead".` };
    }
    if (typeof obj.text !== "string" || obj.text.trim().length === 0) {
      return { ok: false, error: `Línea ${i + 1}: "text" es obligatorio.` };
    }
    if (obj.text.length > MAX_TEXT) {
      return { ok: false, error: `Línea ${i + 1}: demasiado larga.` };
    }
    lines.push({ from: "lead", text: obj.text });
  }
  return { ok: true, lines };
}

/* ------------------------------------------------------------------ *
 * Componente.
 * ------------------------------------------------------------------ */

export function PlaybookQuickPreview({
  hasDraft,
  dirty,
}: {
  /** Sin draft no hay qué probar en modo Draft. */
  hasDraft: boolean;
  /** Hay cambios sin guardar en el editor. */
  dirty: boolean;
}) {
  const [mode, setMode] = React.useState<PreviewMode>(
    hasDraft ? "draft" : "published"
  );
  const [script, setScript] = React.useState(DEFAULT_CONVERSATION);
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<PreviewResponse | null>(null);
  const [failure, setFailure] = React.useState<PreviewFailure | null>(null);
  const [showJson, setShowJson] = React.useState(false);

  // Sin draft, Draft no es una opción: Published por defecto. Si el draft
  // desaparece mientras la vista está abierta, el selector se ajusta.
  const effectiveMode: PreviewMode = hasDraft ? mode : "published";
  const draftDisabled = !hasDraft;

  const run = React.useCallback(async () => {
    if (running) return; // una sola ejecución por clic
    const parsed = parsePreviewConversation(script);
    if (!parsed.ok) {
      setResult(null);
      setFailure({ ok: false, code: "invalid_script", message: parsed.error });
      return;
    }
    setRunning(true);
    setFailure(null);
    setResult(null);
    setShowJson(false);
    try {
      const res = await fetch("/api/lab/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Solo el guion. El playbook viaja SIEMPRE desde BD: el endpoint no
        // admite el documento local (semántica Guardar → Probar).
        body: JSON.stringify({ mode: effectiveMode, conversation: parsed.lines }),
      });
      const body = (await res.json().catch(() => null)) as
        | PreviewResponse
        | PreviewFailure
        | null;
      if (!res.ok || !body || body.ok === false) {
        const err = (body ?? null) as PreviewFailure | null;
        setFailure({
          ok: false,
          code: err?.code ?? "internal",
          message: err?.message ?? "No se pudo ejecutar la prueba",
          detail: err?.detail,
        });
        return;
      }
      setResult(body);
    } catch (err) {
      setFailure({
        ok: false,
        code: "network",
        message: err instanceof Error ? err.message : "No se pudo ejecutar la prueba",
      });
    } finally {
      setRunning(false);
    }
  }, [effectiveMode, running, script]);

  return (
    <section className="flex flex-col gap-3" aria-label="Prueba rápida">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold tracking-tight">Prueba rápida</h4>
        <p className="text-xs text-muted-foreground">
          Probar:{" "}
          <select
            aria-label="Versión a probar"
            value={effectiveMode}
            disabled={running}
            onChange={(e) => setMode(e.target.value as PreviewMode)}
            className="rounded-md border border-input bg-transparent px-2 py-1 text-xs"
          >
            <option value="draft" disabled={draftDisabled}>
              Draft
            </option>
            <option value="published">Published</option>
          </select>
        </p>
      </div>

      {dirty ? (
        <p className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
          Estás probando el último draft guardado. Guarda los cambios para
          probarlos.
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" htmlFor="pb-preview-script">
          Conversación del lead
        </label>
        <textarea
          id="pb-preview-script"
          rows={8}
          value={script}
          onChange={(e) => setScript(e.target.value)}
          disabled={running}
          spellCheck={false}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
        />
        <p className="text-xs text-muted-foreground">
          Array JSON:{" "}
          <code className="font-mono">
            [{`{`}&quot;from&quot;:&quot;lead&quot;,&quot;text&quot;:&quot;…&quot;{`}`}]
          </code>
          {" · "}máx. {MAX_LINES} líneas.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void run()} disabled={running}>
          {running ? "Ejecutando…" : "Ejecutar"}
        </Button>
        <Link
          href="/lab"
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Abrir Laboratorio completo
        </Link>
      </div>

      {failure ? (
        <div
          role="alert"
          className="rounded-md border border-danger-text/40 bg-danger-text/5 px-2 py-1.5 text-xs"
        >
          <p className="font-medium text-danger-text">{failure.message}</p>
          <p className="text-muted-foreground">
            <code className="font-mono">{failure.code}</code>
            {failure.detail ? ` · ${failure.detail}` : ""}
          </p>
        </div>
      ) : null}

      {result ? (
        <div className="flex flex-col gap-2">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">next_action</dt>
            <dd className="font-mono">{result.plan.next_action ?? "—"}</dd>
            <dt className="text-muted-foreground">lane</dt>
            <dd className="font-mono">{result.plan.lane ?? "—"}</dd>
            <dt className="text-muted-foreground">needs_human_call</dt>
            <dd className="font-mono">
              {formatSignal(result.jev["needs_human_call"])}
            </dd>
            <dt className="text-muted-foreground">handoff</dt>
            <dd className="font-mono">
              {result.plan.should_handoff === null
                ? "—"
                : result.plan.should_handoff
                  ? "sí"
                  : "no"}
            </dd>
            <dt className="text-muted-foreground">versión</dt>
            <dd className="font-mono">
              {result.playbook.mode === "draft" ? "V" : "V"}
              {result.playbook.version_number ?? "?"}{" "}
              {result.playbook.is_draft ? "draft" : "published"}
              {result.playbook.schema_version ? ` · ${result.playbook.schema_version}` : ""}
            </dd>
            <dt className="text-muted-foreground">turnos</dt>
            <dd className="font-mono">{result.turns}</dd>
          </dl>

          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">Respuesta</p>
            <p className="whitespace-pre-wrap rounded-md bg-muted px-2 py-1.5 text-xs">
              {result.writer.text ?? "Handoff interno aplicado; sin mensaje automático."}
            </p>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowJson((v) => !v)}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {showJson ? "Ocultar JSON completo" : "Ver JSON completo"}
            </button>
            {showJson ? (
              <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[11px]">
                {JSON.stringify(result, null, 2)}
              </pre>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** `noul 0.12` · `score 0.7` · `operational_control` · `—` */
function formatSignal(signal: PreviewSignal | undefined): string {
  if (!signal) return "—";
  if (signal.type === "choice") return String(signal.value ?? "—");
  if (signal.value === null || signal.value === undefined) return signal.type;
  return `${signal.type} ${String(signal.value)}`;
}
