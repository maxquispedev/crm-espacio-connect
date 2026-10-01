"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Columns2,
  FlaskConical,
  Play,
  Sparkles,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useEvents } from "@/components/use-events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Modos de playbook que el Laboratorio sabe ejecutar (Corte 6). */
type ModeChoice = "published" | "draft" | "both" | "legacy" | "archived";
type RunDetail = { run: Run; cases: Case[] };

type Run = {
  id: string;
  status: "running" | "done" | "failed";
  score: number | null;
  error: string | null;
  playbookMode: string;
  startedAt: string;
  finishedAt: string | null;
  delta: number | null;
};

type Hallazgo = {
  tipo: "alucinacion" | "fuera_de_kb" | "debio_escalar" | "tono";
  evidencia: string;
  sugerencia?: { pregunta: string; respuesta: string };
};

type Case = {
  id: string;
  persona: string;
  personaLabel: string;
  status: string;
  veredicto: "verde" | "amarillo" | "rojo" | null;
  hallazgos: Hallazgo[];
  transcript: { role: "cliente" | "agente"; text: string }[];
  playbookVersionId: string | null;
  playbookSchemaVersion: string | null;
  expectedNextAction: string | null;
  expectedLane: string | null;
  expectedHandoff: boolean | null;
  actualNextAction: string | null;
  actualLane: string | null;
  actualHandoff: boolean | null;
};

const TIPO_LABELS: Record<Hallazgo["tipo"], string> = {
  alucinacion: "Alucinación",
  fuera_de_kb: "Fuera del conocimiento",
  debio_escalar: "Debió escalar",
  tono: "Tono",
};

const LANES = ["auto", "auto_close", "wait", "human", "stop"] as const;
const NEXT_ACTIONS = [
  "ask_more_questions",
  "show_operations_demo",
  "show_online_enrollment_demo",
  "present_price",
  "schedule_call",
  "schedule_follow_up",
  "disqualify",
] as const;

const MODE_LABELS: Record<string, string> = {
  published: "Publicada",
  draft: "Borrador",
  both: "Publicada + Borrador",
  legacy: "Agente clásico",
};

export function LabClient() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Corte 6 — selector de playbook + diff side-by-side.
  const [mode, setMode] = useState<ModeChoice>("published");
  const [archivedId, setArchivedId] = useState("");
  const [compare, setCompare] = useState<{ a: string; b: string } | null>(null);
  const [compareDetail, setCompareDetail] = useState<
    { left: RunDetail; right: RunDetail } | null
  >(null);

  const refetchRuns = useCallback(async () => {
    const res = await fetch("/api/lab/runs").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { runs: Run[]; aiConfigured: boolean };
    setRuns(data.runs);
    setAiConfigured(data.aiConfigured);
    if (!selectedRunId && data.runs[0]) setSelectedRunId(data.runs[0].id);
  }, [selectedRunId]);

  const fetchDetail = useCallback(async (runId: string) => {
    const res = await fetch(`/api/lab/runs/${runId}`).catch(() => null);
    if (!res?.ok) return null;
    return (await res.json()) as RunDetail;
  }, []);

  const refetchDetail = useCallback(
    async (runId: string) => {
      const d = await fetchDetail(runId);
      if (d) setDetail(d);
    },
    [fetchDetail]
  );

  useEffect(() => {
    void refetchRuns();
  }, [refetchRuns]);

  useEffect(() => {
    if (selectedRunId) void refetchDetail(selectedRunId);
  }, [selectedRunId, refetchDetail]);

  // El diff side-by-side recarga las dos corridas cuando cambia el par.
  useEffect(() => {
    if (!compare) {
      setCompareDetail(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [left, right] = await Promise.all([
        fetchDetail(compare.a),
        fetchDetail(compare.b),
      ]);
      if (cancelled) return;
      if (left && right) setCompareDetail({ left, right });
    })();
    return () => {
      cancelled = true;
    };
  }, [compare, fetchDetail]);

  useEvents({
    onLabRun: (data) => {
      setProgress(data.status === "running" ? data.progress : null);
      void refetchRuns();
      if (compare) {
        void (async () => {
          const [l, r] = await Promise.all([
            fetchDetail(compare.a),
            fetchDetail(compare.b),
          ]);
          if (l && r) setCompareDetail({ left: l, right: r });
        })();
      }
      if (selectedRunId === data.runId || !selectedRunId) {
        setSelectedRunId(data.runId);
        void refetchDetail(data.runId);
      }
    },
  });

  async function launch() {
    setLaunching(true);
    setError(null);
    const playbook_mode =
      mode === "archived" ? `archived:${archivedId.trim()}` : mode;
    const res = await fetch("/api/lab/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playbook_mode }),
    }).catch(() => null);
    setLaunching(false);
    if (!res) return;
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo lanzar la corrida");
      return;
    }
    const data = (await res.json()) as { runId: string; runIds?: string[] };
    setSelectedRunId(data.runId);
    setProgress({ done: 0, total: 6 });
    // `both` devuelve dos corridas (publicada + borrador): se abre el diff.
    if (data.runIds && data.runIds.length === 2) {
      setCompare({ a: data.runIds[0]!, b: data.runIds[1]! });
    }
    void refetchRuns();
  }

  if (!aiConfigured) {
    return (
      <div className="flex h-full flex-col">
        <Header
          running={false}
          launching={false}
          onLaunch={() => {}}
          disabled
          mode={mode}
          setMode={setMode}
          archivedId={archivedId}
          setArchivedId={setArchivedId}
        />
        <div className="m-6 rounded-lg border border-brand-soft bg-brand-tint p-8 text-center">
          <Sparkles className="mx-auto mb-2 h-8 w-8 text-brand-text" />
          <p className="font-medium">
            Configura tu proveedor de IA para usar el Laboratorio
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            El Laboratorio necesita el agente activo: agrega{" "}
            <code className="rounded bg-secondary px-1">OPENROUTER_API_TOKEN</code> a la
            instancia y vuelve aquí.
          </p>
        </div>
      </div>
    );
  }

  const running = runs.some((r) => r.status === "running");

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Header
        running={running}
        launching={launching}
        onLaunch={() => void launch()}
        disabled={false}
        mode={mode}
        setMode={setMode}
        archivedId={archivedId}
        setArchivedId={setArchivedId}
      />
      {error && <p className="px-6 pt-3 text-sm text-destructive">{error}</p>}

      {running && progress && (
        <div className="mx-6 mt-4 rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Evaluando personas…</span>
            <span className="text-muted-foreground">
              {progress.done} / {progress.total}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid gap-6 p-6 lg:grid-cols-[280px_1fr]">
        <HistoryList
          runs={runs}
          selectedRunId={selectedRunId}
          onSelect={(id) => {
            setCompare(null);
            setSelectedRunId(id);
          }}
        />
        {compareDetail ? (
          <CompareReport
            compare={compareDetail}
            onClose={() => setCompare(null)}
          />
        ) : detail ? (
          <Report detail={detail} onApplied={() => void refetchDetail(detail.run.id)} />
        ) : (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            {runs.length === 0
              ? "Corre tu primera evaluación: las personas simuladas conversarán con tu agente y un juez calificará cada conversación."
              : "Elige una corrida del historial."}
          </div>
        )}
      </div>
    </div>
  );
}

function Header({
  running,
  launching,
  onLaunch,
  disabled,
  mode,
  setMode,
  archivedId,
  setArchivedId,
}: {
  running: boolean;
  launching: boolean;
  onLaunch: () => void;
  disabled: boolean;
  mode: ModeChoice;
  setMode: (m: ModeChoice) => void;
  archivedId: string;
  setArchivedId: (v: string) => void;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <FlaskConical className="h-4 w-4 text-brand-text" /> Laboratorio
        </h2>
        <p className="text-xs text-muted-foreground">
          Sandbox interno — no envía mensajes reales
        </p>
      </div>
      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="lab-mode" className="text-xs">
            Playbook
          </Label>
          <select
            id="lab-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as ModeChoice)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="published">Publicada</option>
            <option value="draft">Borrador</option>
            <option value="both">Publicada + Borrador</option>
            <option value="archived">Versión archivada…</option>
            <option value="legacy">Agente clásico (legacy)</option>
          </select>
        </div>
        {mode === "archived" && (
          <div className="space-y-1">
            <Label htmlFor="lab-archived" className="text-xs">
              Version ID
            </Label>
            <Input
              id="lab-archived"
              value={archivedId}
              placeholder="spv_…"
              onChange={(e) => setArchivedId(e.target.value)}
              className="h-9 w-40"
            />
          </div>
        )}
        <Button
          onClick={onLaunch}
          disabled={disabled || running || launching || (mode === "archived" && !archivedId.trim())}
        >
          <Play className="h-4 w-4" />
          {running ? "Corrida en curso…" : "Correr evaluación"}
        </Button>
      </div>
    </header>
  );
}

function HistoryList({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: Run[];
  selectedRunId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Historial
      </p>
      {runs.length === 0 && (
        <p className="text-xs text-muted-foreground">Sin corridas todavía.</p>
      )}
      {runs.map((run) => (
        <button
          key={run.id}
          onClick={() => onSelect(run.id)}
          className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/50 ${
            selectedRunId === run.id ? "border-primary/50 bg-accent/60" : "bg-card"
          }`}
        >
          <div className="flex items-center justify-between">
            <ScoreBadge run={run} />
            {run.delta !== null && run.delta !== 0 && (
              <span
                className={`flex items-center gap-0.5 text-xs font-medium ${
                  run.delta > 0 ? "text-success" : "text-destructive"
                }`}
              >
                {run.delta > 0 ? (
                  <TrendingUp className="h-3.5 w-3.5" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5" />
                )}
                {run.delta > 0 ? "+" : ""}
                {run.delta}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {MODE_LABELS[run.playbookMode] ?? run.playbookMode}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {new Date(run.startedAt).toLocaleString("es-MX", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </button>
      ))}
    </div>
  );
}

function ScoreBadge({ run }: { run: Run }) {
  if (run.status === "running") return <Badge variant="secondary">En curso…</Badge>;
  if (run.status === "failed") return <Badge variant="destructive">Fallida</Badge>;
  const score = run.score ?? 0;
  const variant = score >= 80 ? "success" : score >= 50 ? "warning" : "destructive";
  return <Badge variant={variant}>Score {score}</Badge>;
}

function Report({
  detail,
  onApplied,
}: {
  detail: RunDetail;
  onApplied: () => void;
}) {
  const { run, cases } = detail;
  const expectations = cases.filter((c) => hasAnyExpected(c)).length;
  const matched = cases.filter((c) => c.expectedNextAction !== null).filter(
    (c) => c.expectedNextAction === c.actualNextAction
  ).length;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Reporte</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {MODE_LABELS[run.playbookMode] ?? run.playbookMode}
              </Badge>
              <ScoreBadge run={run} />
            </div>
          </div>
          {run.status === "failed" && (
            <p className="text-sm text-destructive">
              La corrida falló: {run.error ?? "error desconocido"}. Vuelve a
              intentarlo.
            </p>
          )}
        </CardHeader>
        {run.status === "done" && (
          <CardContent>
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              {(["verde", "amarillo", "rojo"] as const).map((v) => (
                <div key={v} className="rounded-md border p-3">
                  <p className="text-2xl font-bold">
                    {cases.filter((c) => c.veredicto === v).length}
                  </p>
                  <p className="capitalize text-muted-foreground">{v}s</p>
                </div>
              ))}
            </div>
            {expectations > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Outcomes esperados: {matched}/{cases.filter((c) => c.expectedNextAction !== null).length}{" "}
                coinciden en next_action · {expectations} caso(s) con expectativa
                declarada.
              </p>
            )}
            {cases.some((c) => c.status === "judge_failed") && (
              <p className="mt-3 text-xs text-warning-text">
                {cases.filter((c) => c.status === "judge_failed").length} caso(s) sin
                veredicto (el juez no respondió válido); excluidos del score.
              </p>
            )}
          </CardContent>
        )}
      </Card>

      {cases.map((c) => (
        <CaseCard key={c.id} testCase={c} onApplied={onApplied} />
      ))}
    </div>
  );
}

function hasAnyExpected(c: Case): boolean {
  return (
    c.expectedNextAction !== null ||
    c.expectedLane !== null ||
    c.expectedHandoff !== null
  );
}

/** ✅ si coincide, ❌ si difiere, "—" si no hay expected (o no hay actual). */
function MatchMark({
  expected,
  actual,
}: {
  expected: string | boolean | null;
  actual: string | boolean | null;
}) {
  if (expected === null) return <span className="text-muted-foreground">—</span>;
  const ok = actual !== null && expected === actual;
  return ok ? (
    <CheckCircle2 className="h-4 w-4 text-success" data-testid="match-ok" />
  ) : (
    <XCircle className="h-4 w-4 text-destructive" data-testid="match-mismatch" />
  );
}

function MatchRow({
  label,
  expected,
  actual,
  testId,
}: {
  label: string;
  expected: string | boolean | null;
  actual: string | boolean | null;
  testId: string;
}) {
  const fmt = (v: string | boolean | null) =>
    v === null ? "—" : typeof v === "boolean" ? (v ? "sí" : "no") : v;
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="font-mono">{fmt(expected)}</span>
        <span className="text-muted-foreground">→</span>
        <span className="font-mono" data-testid={`${testId}-actual`}>
          {fmt(actual)}
        </span>
        <MatchMark expected={expected} actual={actual} />
      </span>
    </div>
  );
}

function ExpectedEditor({
  testCase,
  onApplied,
}: {
  testCase: Case;
  onApplied: () => void;
}) {
  const [nextAction, setNextAction] = useState(testCase.expectedNextAction ?? "");
  const [lane, setLane] = useState(testCase.expectedLane ?? "");
  const [handoff, setHandoff] = useState(
    testCase.expectedHandoff === null ? "" : testCase.expectedHandoff ? "true" : "false"
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    const res = await fetch(`/api/lab/cases/${testCase.id}/expected`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expected_next_action: nextAction === "" ? null : nextAction,
        expected_lane: lane === "" ? null : lane,
        expected_handoff: handoff === "" ? null : handoff === "true",
      }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      setSaved(true);
      onApplied();
    }
  }

  return (
    <div className="rounded-md border bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Outcome esperado (manual)
        </p>
        {saved && <span className="text-xs text-success">Guardado ✓</span>}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`exp-na-${testCase.id}`} className="text-xs">
            next_action
          </Label>
          <select
            id={`exp-na-${testCase.id}`}
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">— sin definir —</option>
            {NEXT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`exp-lane-${testCase.id}`} className="text-xs">
            lane
          </Label>
          <select
            id={`exp-lane-${testCase.id}`}
            value={lane}
            onChange={(e) => setLane(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">— sin definir —</option>
            {LANES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`exp-ho-${testCase.id}`} className="text-xs">
            handoff
          </Label>
          <select
            id={`exp-ho-${testCase.id}`}
            value={handoff}
            onChange={(e) => setHandoff(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">— sin definir —</option>
            <option value="true">sí</option>
            <option value="false">no</option>
          </select>
        </div>
      </div>
      <Button size="sm" className="mt-2" onClick={() => void save()} disabled={saving}>
        {saving ? "Guardando…" : "Guardar esperado"}
      </Button>
    </div>
  );
}

function CaseCard({ testCase, onApplied }: { testCase: Case; onApplied: () => void }) {
  const [open, setOpen] = useState(false);
  const c = testCase;
  const icon =
    c.veredicto === "verde" ? (
      <CheckCircle2 className="h-4 w-4 text-success" />
    ) : c.veredicto === "amarillo" ? (
      <AlertTriangle className="h-4 w-4 text-warning-text" />
    ) : c.veredicto === "rojo" ? (
      <XCircle className="h-4 w-4 text-destructive" />
    ) : (
      <AlertTriangle className="h-4 w-4 text-muted-foreground" />
    );

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          className="flex w-full items-center justify-between"
          onClick={() => setOpen(!open)}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            {icon}
            {c.personaLabel}
            {c.status === "judge_failed" && (
              <Badge variant="secondary">sin veredicto</Badge>
            )}
            {c.playbookVersionId && (
              <Badge variant="outline" data-testid="case-playbook-version">
                {c.playbookVersionId}
              </Badge>
            )}
          </span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {c.hallazgos.length > 0 && `${c.hallazgos.length} hallazgo(s)`}
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
        </button>
        <div className="mt-2 space-y-1 rounded-md border bg-background/40 p-2">
          <MatchRow
            label="next_action"
            expected={c.expectedNextAction}
            actual={c.actualNextAction}
            testId={`na-${c.id}`}
          />
          <MatchRow label="lane" expected={c.expectedLane} actual={c.actualLane} testId={`lane-${c.id}`} />
          <MatchRow
            label="handoff"
            expected={c.expectedHandoff}
            actual={c.actualHandoff}
            testId={`ho-${c.id}`}
          />
          {c.playbookVersionId === null && (
            <p className="text-[11px] text-muted-foreground">
              Sin playbook (corrida legacy o sin versión publicada): se usó el
              fallback interno del motor.
            </p>
          )}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          <ExpectedEditor testCase={c} onApplied={onApplied} />
          {c.hallazgos.map((h, i) => (
            <HallazgoCard key={i} hallazgo={h} caseId={c.id} index={i} onApplied={onApplied} />
          ))}
          <div className="rounded-md border bg-background/40 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Transcript
            </p>
            <div className="space-y-1.5 text-sm">
              {c.transcript.map((t, i) => (
                <p key={i}>
                  <span
                    className={
                      t.role === "cliente" ? "text-[#5b7291]" : "text-brand-text"
                    }
                  >
                    {t.role === "cliente" ? "Cliente" : "Agente"}:
                  </span>{" "}
                  {t.text}
                </p>
              ))}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

/**
 * Diff side-by-side de `playbook_mode: "both"`: una columna por versión y,
 * por caso, ✅/❌ donde el outcome observado difiere entre ambas.
 */
function CompareReport({
  compare,
  onClose,
}: {
  compare: { left: RunDetail; right: RunDetail };
  onClose: () => void;
}) {
  const { left, right } = compare;
  const rightByPersona = useMemo(() => {
    const m = new Map<string, Case>();
    for (const c of right.cases) m.set(c.persona, c);
    return m;
  }, [right.cases]);

  const diffCount = left.cases.filter((c) => {
    const r = rightByPersona.get(c.persona);
    if (!r) return false;
    return (
      c.actualNextAction !== r.actualNextAction ||
      c.actualLane !== r.actualLane ||
      c.actualHandoff !== r.actualHandoff
    );
  }).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Columns2 className="h-4 w-4 text-brand-text" />
              Publicada vs Borrador
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={diffCount > 0 ? "warning" : "success"}>
                {diffCount} caso(s) difieren
              </Badge>
              <Button size="sm" variant="outline" onClick={onClose}>
                Ver singly
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md border p-2">
            <p className="font-medium">Publicada</p>
            <p className="font-mono text-muted-foreground">
              {left.cases[0]?.playbookVersionId ?? "sin playbook"} · score{" "}
              {left.run.score ?? "—"}
            </p>
          </div>
          <div className="rounded-md border p-2">
            <p className="font-medium">Borrador</p>
            <p className="font-mono text-muted-foreground">
              {right.cases[0]?.playbookVersionId ?? "sin playbook"} · score{" "}
              {right.run.score ?? "—"}
            </p>
          </div>
        </CardContent>
      </Card>

      {left.cases.map((lc) => {
        const rc = rightByPersona.get(lc.persona);
        if (!rc) return null;
        return (
          <Card key={`cmp-${lc.id}`}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
                {lc.personaLabel}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-2">
              <VersionColumn testCase={lc} title="Publicada" />
              <VersionColumn testCase={rc} title="Borrador" other={lc} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function VersionColumn({
  testCase,
  title,
  other,
}: {
  testCase: Case;
  title: string;
  other?: Case;
}) {
  const differs = (key: "nextAction" | "lane" | "handoff") =>
    other ? testCase[`actual${key === "nextAction" ? "NextAction" : key === "lane" ? "Lane" : "Handoff"}`] !==
      other[`actual${key === "nextAction" ? "NextAction" : key === "lane" ? "Lane" : "Handoff"}`] : false;

  const fmt = (v: string | boolean | null) =>
    v === null ? "—" : typeof v === "boolean" ? (v ? "sí" : "no") : v;

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <span className="font-mono text-[10px] text-muted-foreground">
          {testCase.playbookVersionId ?? "sin playbook"}
        </span>
      </div>
      <div className="space-y-1 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">next_action</span>
          <span className="flex items-center gap-1">
            <span className="font-mono">{fmt(testCase.actualNextAction)}</span>
            {other && differs("nextAction") && (
              <Badge variant="warning">difiere</Badge>
            )}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">lane</span>
          <span className="flex items-center gap-1">
            <span className="font-mono">{fmt(testCase.actualLane)}</span>
            {other && differs("lane") && <Badge variant="warning">difiere</Badge>}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">handoff</span>
          <span className="flex items-center gap-1">
            <span className="font-mono">{fmt(testCase.actualHandoff)}</span>
            {other && differs("handoff") && <Badge variant="warning">difiere</Badge>}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">esperado</span>
          <span className="flex items-center gap-1">
            <span className="font-mono">
              {testCase.expectedNextAction ?? "—"}
            </span>
            <MatchMark expected={testCase.expectedNextAction} actual={testCase.actualNextAction} />
          </span>
        </div>
      </div>
    </div>
  );
}

function HallazgoCard({
  hallazgo,
  caseId,
  index,
  onApplied,
}: {
  hallazgo: Hallazgo;
  caseId: string;
  index: number;
  onApplied: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pregunta, setPregunta] = useState(hallazgo.sugerencia?.pregunta ?? "");
  const [respuesta, setRespuesta] = useState(hallazgo.sugerencia?.respuesta ?? "");
  const [applied, setApplied] = useState(false);
  const [saving, setSaving] = useState(false);

  async function apply() {
    setSaving(true);
    const res = await fetch("/api/lab/suggestions/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId, hallazgoIndex: index, pregunta, respuesta }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      setApplied(true);
      setEditing(false);
      onApplied();
    }
  }

  return (
    <div className="rounded-md border border-warning-border bg-warning-soft p-3">
      <div className="flex items-center justify-between">
        <Badge variant="warning">{TIPO_LABELS[hallazgo.tipo]}</Badge>
        {hallazgo.sugerencia && !applied && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Agregar al conocimiento
          </Button>
        )}
        {applied && (
          <span className="text-xs text-success">Agregado al conocimiento ✓</span>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Evidencia:</span>{" "}
        {hallazgo.evidencia}
      </p>
      {editing && hallazgo.sugerencia && (
        <div className="mt-3 space-y-2 rounded-md border bg-card p-3">
          <div className="space-y-1">
            <Label htmlFor={`sug-q-${caseId}-${index}`}>Pregunta</Label>
            <Input
              id={`sug-q-${caseId}-${index}`}
              value={pregunta}
              onChange={(e) => setPregunta(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`sug-a-${caseId}-${index}`}>Respuesta</Label>
            <Textarea
              id={`sug-a-${caseId}-${index}`}
              rows={3}
              value={respuesta}
              onChange={(e) => setRespuesta(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void apply()}
              disabled={saving || !pregunta.trim() || !respuesta.trim()}
            >
              {saving ? "Guardando…" : "Guardar en el KB"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
