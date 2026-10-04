"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  FlaskConical,
  Pencil,
  Sparkles,
  X,
} from "lucide-react";
import type {
  AnuncioDto,
  ContactSalesDto,
  ConversationDto,
  StageDto,
} from "@/lib/types";
import { cn, formatPhone } from "@/lib/utils";
import {
  BUYING_TIMING_LABELS,
  followUpReasonLabel,
  isDormantSales,
  NEXT_ACTION_LABELS,
  operationalLaneLabel,
  labelForNoul,
  labelForScore,
  percentHint,
} from "@/lib/sales-ui";
import { ContactAvatar } from "@/components/avatar";
import { AnuncioOrigen } from "@/components/anuncio-origen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatTime } from "@/components/inbox/helpers";
import { AttentionBlock } from "@/components/inbox/attention-block";

type ContactNameUpdate = { id: string; name: string };

export function ContactPanel({
  conversation,
  refreshKey = 0,
  onPatchConversation,
  onContactUpdated,
  onAttentionChanged,
  onClose,
}: {
  conversation: ConversationDto;
  /** Aumenta con cada evento SSE relevante: dispara un refetch en vivo. */
  refreshKey?: number;
  onPatchConversation: (patch: {
    aiEnabled?: boolean;
    reactivate?: boolean;
  }) => Promise<string | null>;
  /**
   * Notifica al padre que el `contact.name` cambió en el servidor tras un
   * guardado exitoso del editor inline. El padre sincroniza las tres
   * superficies (panel, header del hilo, lista izquierda) vía patch in-place.
   */
  onContactUpdated?: (update: ContactNameUpdate) => void;
  /**
   * 013 C3 — El recordatorio se guardó/canceló: el padre recarga la lista para
   * que "Por atender" y la cabecera de la conversación queden al día sin
   * esperar al SSE.
   */
  onAttentionChanged?: () => void;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [stages, setStages] = useState<StageDto[]>([]);
  const [currentStageId, setCurrentStageId] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [sales, setSales] = useState<ContactSalesDto | null>(null);
  // 006 — Anuncio de origen del contacto. Lo trae GET /api/contacts/:id;
  // se rehidrata en cada refreshLive para que un `conversation.updated`
  // posterior pinte la tarjeta sin necesidad de tocar la conversación.
  const [anuncio, setAnuncio] = useState<AnuncioDto | null>(null);
  // Estado global del agente: sin esto, el toggle "Respondiendo" mentiría
  // cuando el agente aún no se ha configurado/encendido.
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  // 008 Corte 7 (T701) — "Guardar conversación como caso".
  const [confirmCase, setConfirmCase] = useState(false);
  const [savingCase, setSavingCase] = useState(false);
  const [caseError, setCaseError] = useState<string | null>(null);
  const [salesOrchestratorEnabled, setSalesOrchestratorEnabled] = useState(false);

  const contactId = conversation.contact.id;

  const agentReady = aiConfigured && agentEnabled;
  // El control es la FUENTE DE VERDAD de la conversación: el agente in-process
  // y cualquier cerebro externo conectado por /api/bot/* respetan este flag,
  // así que el toggle opera siempre — `agentReady` solo matiza el texto.
  const aiActive = conversation.aiEnabled && !conversation.handoffAt;

  // Carga inicial (incluye notas): se re-ejecuta al cambiar de contacto.
  const refetch = useCallback(async () => {
    const [detail, stagesRes, agentRes] = await Promise.all([
      fetch(`/api/contacts/${contactId}`).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/pipeline/stages").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/agent/profile").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null, null]);
    if (detail) {
      setNotes(detail.contact?.notes ?? "");
      setCurrentStageId(detail.stage?.id ?? null);
      setLeadId(detail.lead?.id ?? null);
      setSales(detail.lead?.sales ?? null);
      setAnuncio(detail.anuncio ?? null);
    }
    if (stagesRes) setStages(stagesRes.stages);
    setAgentEnabled(Boolean(agentRes?.profile?.enabled));
    setAiConfigured(Boolean(agentRes?.aiConfigured));
    // 008 Corte 7 (T701): el botón de guardar caso solo habilita con el
    // Sales Orchestrator encendido; el server lo vuelve a exigir (409).
    setSalesOrchestratorEnabled(
      Boolean(agentRes?.profile?.salesOrchestratorEnabled)
    );
    setNotesLoaded(true);
  }, [contactId]);

  // Refetch en vivo (etapa/lead + estado del agente) SIN tocar las notas, para
  // no pisar lo que el operador esté escribiendo. Lo dispara el SSE.
  const refreshLive = useCallback(async () => {
    const [detail, agentRes] = await Promise.all([
      fetch(`/api/contacts/${contactId}`).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/agent/profile").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null]);
    if (detail) {
      setCurrentStageId(detail.stage?.id ?? null);
      setLeadId(detail.lead?.id ?? null);
      setSales(detail.lead?.sales ?? null);
      setAnuncio(detail.anuncio ?? null);
    }
    if (agentRes) {
      setAgentEnabled(Boolean(agentRes.profile?.enabled));
      setAiConfigured(Boolean(agentRes.aiConfigured));
    }
  }, [contactId]);

  useEffect(() => {
    setNotesLoaded(false);
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!notesLoaded) return; // la carga inicial ya trae el estado fresco
    void refreshLive();
  }, [refreshKey, notesLoaded, refreshLive]);

  async function moveToStage(stageId: string) {
    if (!leadId || stageId === currentStageId) return;
    setCurrentStageId(stageId); // optimista
    await fetch(`/api/pipeline/leads/${leadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stageId, position: 0 }),
    }).catch(() => null);
    void refreshLive();
  }

  async function saveNotes() {
    setSavingNotes(true);
    await fetch(`/api/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes }),
    }).catch(() => null);
    setSavingNotes(false);
  }

  /**
   * 008 Corte 7 (T701). El `conversation_id` viaja como input
   * autenticado para que el server lea la conversación del tenant; el
   * server NO lo persiste en el caso (garantía de PII minimizada).
   */
  async function saveConversationAsCase() {
    setSavingCase(true);
    setCaseError(null);
    try {
      const res = await fetch("/api/lab/cases/from-conversation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation_id: conversation.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setCaseError(
          body?.error?.message ?? `No se pudo guardar el caso (${res.status})`
        );
        return;
      }
      setConfirmCase(false);
    } catch {
      // Camino infeliz: degradar sin colgarse ni romper el panel.
      setCaseError("No se pudo guardar el caso. Revisa tu conexión.");
    } finally {
      setSavingCase(false);
    }
  }

  const currentIndex = stages.findIndex((s) => s.id === currentStageId);

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 flex items-center justify-between border-b bg-background px-4 py-3">
        <h3 className="text-[13px] font-[650] uppercase tracking-wide text-text-2">
          Detalles
        </h3>
        <button
          onClick={onClose}
          aria-label="Ocultar panel"
          className="rounded p-1 text-text-3 hover:bg-accent hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Contacto */}
        <section className="border-b p-4">
          <div className="flex items-center gap-3">
            <ContactAvatar
              name={conversation.contact.name}
              seed={conversation.contact.id}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <ContactNameEditor
                contactId={conversation.contact.id}
                name={conversation.contact.name}
                onSaved={(update) => onContactUpdated?.(update)}
              />
              <p className="text-xs text-text-3">
                {formatPhone(conversation.contact.phone)}
              </p>
            </div>
          </div>

          {/* 013 C4 — Estado y acciones de la atención humana en un solo bloque.
              Aparece para CUALQUIER conversación del humano (hubo handoff o se
              apagó la IA a mano), no solo con handoff: antes, una conversación
              con la IA desactivada tenía "Recordarme" pero ni estado ni
              "Reactivar IA", que es justo el hueco que dejaba el flujo
              incoherente. Si la IA es la dueña, el bloque no se pinta. */}
          <AttentionBlock
            conversation={conversation}
            onPatchConversation={onPatchConversation}
            onChanged={onAttentionChanged}
          />

          <div className="mt-3 rounded-md border bg-secondary/50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium">IA en esta conversación</p>
                <p className="text-[11px] text-text-3">
                  {conversation.handoffAt
                    ? "En pausa · atención humana"
                    : !conversation.aiEnabled
                      ? "En pausa"
                      : agentReady
                        ? "Respondiendo"
                        : "Activada"}
                </p>
              </div>
              <button
                role="switch"
                aria-checked={aiActive}
                aria-label="IA en esta conversación"
                onClick={() => {
                  void onPatchConversation({
                    aiEnabled: !conversation.aiEnabled,
                  });
                }}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors",
                  aiActive ? "bg-brand" : "bg-border-strong"
                )}
              >
                <span
                  className={cn(
                    "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                    aiActive ? "translate-x-4" : "translate-x-0"
                  )}
                />
              </button>
            </div>

            {!agentReady && (
              <div className="mt-2.5 flex items-start gap-2 rounded-md border border-warning-border bg-warning-soft p-2.5">
                <Sparkles
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-text"
                  strokeWidth={1.7}
                />
                <p className="text-[11px] leading-relaxed text-warning-text">
                  {aiConfigured
                    ? "El agente no responde por su cuenta. Configura lo básico y enciéndelo (o conecta tu propio bot por la API)."
                    : "Falta la clave de IA de la instancia (OPENROUTER_API_TOKEN) para que el agente responda, o conecta tu propio bot por la API."}
                  {aiConfigured && (
                    <Link
                      href="/agent"
                      className="ml-1 whitespace-nowrap font-medium text-brand-text underline underline-offset-2 hover:text-brand"
                    >
                      Configurar agente →
                    </Link>
                  )}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* 006 — Tarjeta del anuncio de origen (debajo del header, antes del
            stepper de etapa). Si el contacto es orgánico, no se inserta nada. */}
        {anuncio && (
          <section className="border-b p-4">
            <AnuncioOrigen
              key={`${anuncio.imageAssetId ?? "noimg"}-${anuncio.capturedAt}`}
              anuncio={anuncio}
              conversationCreatedAt={anuncio.capturedAt}
            />
          </section>
        )}

        {/* Stepper de etapa
            014 C7 — De columna a RIEL. El vertical ocupaba ~150 px para decir una
            cosa ("está en Interesado") y empujaba hacia abajo el bloque de estado y
            las notas, que es lo que se usa a diario. El riel dice lo mismo —dónde
            está, cuántas quedan por delante, cuál se puede tocar— en dos líneas, y
            conserva el MISMO manejador, el MISMO `aria-label` y el mismo orden de
            las etapas: aquí no cambia ninguna semántica comercial, solo cómo se
            lee (FR-7.3). El conector entre etapas se mantiene como pista de
            progreso, pero la línea es discontinua para no competir con el texto. */}
        {stages.length > 0 && leadId && (
          <section className="border-b p-4">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
              Etapa del pipeline
            </p>
            <ol className="flex flex-wrap items-center gap-1.5">
              {stages.map((s, i) => {
                const done = currentIndex >= 0 && i < currentIndex;
                const current = s.id === currentStageId;
                return (
                  <li key={s.id} className="flex items-center gap-1.5">
                    {i > 0 && (
                      <span
                        aria-hidden
                        className={cn(
                          "h-px w-3 shrink-0",
                          done || current ? "bg-brand" : "bg-border-strong"
                        )}
                      />
                    )}
                    <button
                      onClick={() => void moveToStage(s.id)}
                      aria-label={`Mover a ${s.name}`}
                      aria-current={current ? "step" : undefined}
                      title={s.name}
                      className={cn(
                        "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[5px] text-[12px] transition-colors",
                        current
                          ? "border-brand bg-brand font-semibold text-white"
                          : done
                            ? "border-brand-soft bg-brand-soft text-brand-text hover:brightness-105"
                            : "bg-background text-text-3 hover:bg-accent hover:text-foreground"
                      )}
                    >
                      {done && <Check className="h-3 w-3 shrink-0" strokeWidth={3} />}
                      {s.name}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {sales && leadId && (
          <SalesSection
            leadId={leadId}
            sales={sales}
            handoffAt={conversation.handoffAt}
            onChanged={() => void refreshLive()}
          />
        )}

        {/* Notas */}
        <section className="p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">
            Notas
          </p>
          <Textarea
            rows={5}
            placeholder="Notas internas sobre este contacto…"
            value={notes}
            disabled={!notesLoaded}
            onChange={(e) => setNotes(e.target.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            disabled={savingNotes || !notesLoaded}
            onClick={() => void saveNotes()}
          >
            {savingNotes ? "Guardando…" : "Guardar notas"}
          </Button>
        </section>

        {/* 008 Corte 7 (T701) — Guardar conversación como caso de evaluación */}
        <section className="border-t p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">
            Laboratorio comercial
          </p>
          <p className="mb-2 text-[12px] leading-relaxed text-text-2">
            Convierte esta conversación en un caso de evaluación del
            Laboratorio, con la política comercial activa.
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            disabled={savingCase || !salesOrchestratorEnabled}
            onClick={() => setConfirmCase(true)}
          >
            <FlaskConical className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.8} />
            {savingCase ? "Guardando caso…" : "Guardar conversación como caso"}
          </Button>
          {!salesOrchestratorEnabled && (
            <p className="mt-2 text-[11px] leading-relaxed text-text-3">
              Requiere el Sales Orchestrator encendido en Ajustes → Agente.
            </p>
          )}
        </section>
      </div>

      {/* Confirmación explícita de minimización de PII (T701).
          No es un confirm genérico: el texto dice exactamente qué NO
          se guarda, porque es la decisión que el dueño está tomando. */}
      {confirmCase && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-case-title"
        >
          <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-xl">
            <h4
              id="confirm-case-title"
              className="mb-2 text-[15px] font-semibold"
            >
              ¿Guardar esta conversación como caso de evaluación?
            </h4>
            <p className="mb-3 text-[13px] leading-relaxed text-text-2">
              No se incluirá número de teléfono, email ni identificador de
              contacto.
            </p>
            <ul className="mb-4 space-y-1.5 text-[12px] leading-relaxed text-text-2">
              <li>
                Se guarda el <strong>texto</strong> de la conversación (el
                agente y el cliente), con teléfonos, emails y enlaces
                reemplazados por <code className="text-[11px]">[telefono]</code>,{" "}
                <code className="text-[11px]">[email]</code> y{" "}
                <code className="text-[11px]">[enlace]</code>.
              </li>
              <li>
                Se guarda qué versión del playbook estaba publicada, para
                poder comparar después.
              </li>
              <li>
                <strong>No</strong> se guarda ninguna referencia a este
                contacto, lead o conversación: el caso no permite
                reconstruir quién era.
              </li>
              <li>
                Después declaras a mano el resultado esperado en el
                Laboratorio.
              </li>
            </ul>
            {caseError && (
              <p className="mb-3 text-[12px] text-destructive">{caseError}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={savingCase}
                onClick={() => {
                  setConfirmCase(false);
                  setCaseError(null);
                }}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                disabled={savingCase}
                onClick={() => void saveConversationAsCase()}
              >
                {savingCase ? "Guardando…" : "Guardar como caso"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 005 — Editor inline del `contact.name` en la cabecera del panel.
 *
 * Estados: `"view"` (default) muestra el nombre + icono lápiz; `"edit"`
 * muestra un input con autofocus+select y dos botones (check/X).
 *
 * Atajos:
 * - Click lápiz o doble-click sobre el nombre → `mode="edit"`.
 * - Enter sin Shift → submit (PATCH).
 * - Escape → cancela y restaura el nombre anterior.
 * - Blur → cancela (decisión conservadora, plan §D-3).
 * - Click en check → submit. Click en X → cancela.
 *
 * Trim antes de validar. Si queda vacío, no se llama a la API y se muestra
 * un error inline. Durante `saving=true` el input y los botones quedan
 * deshabilitados y un segundo Enter/click se ignora.
 *
 * Defensa SSE: el `draft` vive en `useState` local y NO se sincroniza con la
 * prop `name` mientras `mode === "edit"`. Un rename entrante por SSE solo
 * cambia la prop `name` cuando el modo edición termina (guardar o cancelar).
 *
 * Si el PATCH devuelve 200, se sale de modo edición con el `name` que
 * devolvió el servidor como nueva fuente de verdad (FR-9).
 */
function ContactNameEditor({
  contactId,
  name,
  onSaved,
}: {
  contactId: string;
  name: string;
  onSaved: (update: ContactNameUpdate) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ref defensivo contra doble submit aunque `saving` esté desactualizado.
  const savingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function enterEdit() {
    if (saving) return;
    setDraft(name);
    setError(null);
    setMode("edit");
  }

  function cancelEdit() {
    if (saving) return;
    setMode("view");
    setDraft(name);
    setError(null);
  }

  async function submit() {
    if (savingRef.current) return;
    const trimmed = draft.trim();
    if (trimmed === "") {
      setError("El nombre no puede estar vacío");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(
          payload?.error?.message ?? "No se pudo guardar el nombre"
        );
        return;
      }
      const data = (await res.json()) as {
        contact?: { id?: string; name?: string };
      };
      const savedName = data.contact?.name?.trim() || trimmed;
      onSaved({ id: contactId, name: savedName });
      setMode("view");
      setDraft(savedName);
    } catch {
      setError("Sin conexión con el servidor");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // Autofocus + select programático al entrar en modo edición.
  useEffect(() => {
    if (mode !== "edit") return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [mode]);

  if (mode === "view") {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          onDoubleClick={enterEdit}
          onClick={enterEdit}
          aria-label="Editar nombre"
          className="group flex min-w-0 items-center gap-1.5 rounded-sm text-left transition-colors"
        >
          <span className="truncate text-sm font-[650]">{name}</span>
          <Pencil
            className="h-3.5 w-3.5 shrink-0 text-text-3 opacity-0 transition-opacity group-hover:opacity-100"
            strokeWidth={1.7}
          />
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          maxLength={120}
          disabled={saving}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onBlur={() => {
            if (!saving) cancelEdit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelEdit();
            }
          }}
          aria-label="Nombre del contacto"
          aria-invalid={error !== null}
          className="min-w-0 flex-1 rounded-md border border-border-strong bg-background px-2 py-1 text-sm font-[650] outline-none focus:border-brand focus:ring-[3px] focus:ring-brand-soft disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || draft.trim() === ""}
          aria-label="Guardar nombre"
          className="shrink-0 rounded-md p-1 text-text-3 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={cancelEdit}
          disabled={saving}
          aria-label="Cancelar edición"
          className="shrink-0 rounded-md p-1 text-text-3 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[11px] text-text-3">
          {error}
        </p>
      )}
    </div>
  );
}

function SalesSection({
  leadId,
  sales,
  handoffAt,
  onChanged,
}: {
  leadId: string;
  sales: ContactSalesDto;
  handoffAt: string | null;
  onChanged: () => void;
}) {
  const snap = sales.snapshot;
  const dormant = isDormantSales(sales);
  const blockedHuman = sales.lane === "human" || Boolean(handoffAt);
  const templateBlocked = sales.followUpReason === "template_required";
  const laneLabel = operationalLaneLabel(sales);
  const laneVariant =
    dormant
      ? "secondary"
      : sales.lane === "stop"
        ? "secondary"
        : sales.lane === "wait" || sales.lane === "human"
          ? "warning"
          : sales.lane === "auto_close"
            ? "default"
            : "secondary";

  return (
    <section className="border-b p-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-3">
        Venta
      </p>
      <Badge variant={laneVariant}>{laneLabel}</Badge>

      {snap && (
        <dl className="mt-3 space-y-1.5 text-[13px]">
          <SalesRow
            label="Acción"
            value={
              snap.nextAction
                ? (NEXT_ACTION_LABELS[snap.nextAction] ?? snap.nextAction)
                : null
            }
            hint={percentHint(snap.nextActionConfidence)}
          />
          <SalesRow
            label="Momento de compra"
            value={
              snap.buyingTiming
                ? (BUYING_TIMING_LABELS[snap.buyingTiming] ?? snap.buyingTiming)
                : null
            }
            hint={percentHint(snap.buyingTimingConfidence)}
          />
          <SalesRow
            label="Necesidad operativa"
            value={
              snap.realOperationalNeed !== undefined
                ? labelForNoul(snap.realOperationalNeed)
                : null
            }
            hint={percentHint(snap.realOperationalNeed)}
            showHint
          />
          <SalesRow
            label="Encaje"
            value={
              snap.productFit !== undefined
                ? labelForScore(snap.productFit, "product_fit")
                : null
            }
            hint={percentHint(snap.productFitConfidence)}
          />
          <SalesRow
            label="Intención de compra"
            value={
              snap.purchaseIntent !== undefined
                ? labelForScore(snap.purchaseIntent, "purchase_intent")
                : null
            }
            hint={percentHint(snap.purchaseIntentConfidence)}
          />
        </dl>
      )}

      <ul className="mt-3 space-y-1 text-[12px] text-text-2">
        <li>Demo mostrada: {sales.demoShownAt ? "sí" : "aún no"}</li>
        <li>Precio presentado: {sales.pricePresentedAt ? "sí" : "aún no"}</li>
        {/* 013 C4 — Estas cuatro líneas son del lado AUTOMÁTICO y se nombran
            como tales. "Seguimiento automático" contra "Recordarme" es la
            distinción que el spec exige (FR-4.5, §2.3): sin ella, un
            `nextFollowUpAt` con el mismo formato que un `due_at` humano
            parecería el mismo tipo de compromiso. */}
        <li>Seguimiento automático: {followUpStatusLabel(sales)}</li>
        <li>Intentos automáticos: {sales.followUpCount}</li>
        <li>Motivo: {followUpReasonLabel(sales.followUpReason) ?? "—"}</li>
        <li>
          Próxima automatización:{" "}
          {sales.nextFollowUpAt ? formatFollowUp(sales.nextFollowUpAt) : "—"}
        </li>
      </ul>

      {templateBlocked && (
        <div className="mt-3 rounded-md border border-warning-border bg-warning-soft p-2.5">
          <p className="text-[12px] text-warning-text">
            Bloqueado: falta una plantilla aprobada sin variables para seguimientos
            fuera de la ventana de 24 h.
          </p>
          <Link
            href="/agent"
            className="mt-1 inline-block text-[12px] font-medium text-brand-text underline underline-offset-2 hover:text-brand"
          >
            Configurar en Agente →
          </Link>
        </div>
      )}

      {blockedHuman ? (
        <p className="mt-3 text-[12px] text-text-3">
          No se puede programar un seguimiento automático mientras la conversación
          esté en atención humana.
        </p>
      ) : (
        <FollowUpScheduler
          leadId={leadId}
          dormant={dormant}
          hasSchedule={Boolean(sales.nextFollowUpAt)}
          onChanged={onChanged}
        />
      )}

      {sales.lastEvaluatedAt && (
        <p className="mt-2 text-[11px] text-text-3">
          Última evaluación: {formatTime(sales.lastEvaluatedAt)}
        </p>
      )}
    </section>
  );
}

function FollowUpScheduler({
  leadId,
  dormant,
  hasSchedule,
  onChanged,
}: {
  leadId: string;
  dormant: boolean;
  hasSchedule: boolean;
  onChanged: () => void;
}) {
  const [dueLocal, setDueLocal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function schedule() {
    if (!dueLocal) return;
    const dueAt = new Date(dueLocal);
    if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() <= Date.now()) {
      setError("Elige una fecha y hora futuras.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/pipeline/leads/${leadId}/follow-up`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dueAt: dueAt.toISOString() }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const payload = (await res?.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(payload?.error?.message ?? "No se pudo programar el seguimiento.");
      return;
    }
    setDueLocal("");
    onChanged();
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/pipeline/leads/${leadId}/follow-up`, {
      method: "DELETE",
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError("No se pudo cancelar el seguimiento.");
      return;
    }
    onChanged();
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-3">
        {dormant ? "Reactivar seguimiento" : "Programar seguimiento"}
      </p>
      <Input
        type="datetime-local"
        value={dueLocal}
        onChange={(e) => setDueLocal(e.target.value)}
        aria-label="Fecha y hora del seguimiento"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={dormant ? "default" : "secondary"}
          disabled={busy || !dueLocal}
          onClick={() => void schedule()}
        >
          {dormant ? "Reactivar seguimiento" : "Programar seguimiento"}
        </Button>
        {hasSchedule && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void cancel()}
          >
            Cancelar seguimiento
          </Button>
        )}
      </div>
      {error && <p className="text-[11px] text-warning-text">{error}</p>}
    </div>
  );
}

function followUpStatusLabel(sales: ContactSalesDto): string {
  if (isDormantSales(sales)) return "Dormido";
  if (sales.followUpReason === "template_required") {
    return "Bloqueado: falta plantilla";
  }
  if (sales.followUpReason === "follow_up_failed") {
    return "Error de seguimiento";
  }
  if (sales.nextFollowUpAt) return "Programado";
  return followUpReasonLabel(sales.followUpReason) ?? "Sin seguimiento";
}

function SalesRow({
  label,
  value,
  hint,
  showHint = false,
}: {
  label: string;
  value: string | null;
  hint?: string;
  showHint?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[11px] text-text-3">{label}</dt>
      <dd className="text-right font-medium" title={hint}>
        {value}
        {showHint && hint && (
          <span className="ml-1 font-normal text-text-3">{hint}</span>
        )}
      </dd>
    </div>
  );
}

function formatFollowUp(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
