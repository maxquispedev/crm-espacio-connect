"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, Sparkles, UserRound } from "lucide-react";
import type { ContactSalesDto, ConversationDto, StageDto } from "@/lib/types";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatTime } from "@/components/inbox/helpers";

const HANDOFF_LABELS: Record<string, string> = {
  cliente: "El cliente pidió un humano",
  modelo: "El agente decidió escalar",
  error: "Error del proveedor de IA",
  ventana: "Ventana de 24h cerrada",
  manual_reply: "Respondiste desde el teléfono — IA en pausa",
  commercial: "El orquestador comercial pidió un humano",
};

export function ContactPanel({
  conversation,
  refreshKey = 0,
  onPatchConversation,
  onClose,
}: {
  conversation: ConversationDto;
  /** Aumenta con cada evento SSE relevante: dispara un refetch en vivo. */
  refreshKey?: number;
  onPatchConversation: (patch: {
    aiEnabled?: boolean;
    reactivate?: boolean;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [stages, setStages] = useState<StageDto[]>([]);
  const [currentStageId, setCurrentStageId] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [sales, setSales] = useState<ContactSalesDto | null>(null);
  // Estado global del agente: sin esto, el toggle "Respondiendo" mentiría
  // cuando el agente aún no se ha configurado/encendido.
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);

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
    }
    if (stagesRes) setStages(stagesRes.stages);
    setAgentEnabled(Boolean(agentRes?.profile?.enabled));
    setAiConfigured(Boolean(agentRes?.aiConfigured));
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
            <div className="min-w-0">
              <p className="truncate text-sm font-[650]">
                {conversation.contact.name}
              </p>
              <p className="text-xs text-text-3">
                {formatPhone(conversation.contact.phone)}
              </p>
            </div>
          </div>

          {conversation.handoffAt && (
            <div className="mt-3 rounded-md border border-warning-border bg-warning-soft p-3">
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-warning-text">
                <UserRound className="h-4 w-4" strokeWidth={1.7} /> Atención humana
              </p>
              <p className="mt-1 text-xs text-warning-text opacity-80">
                {HANDOFF_LABELS[conversation.handoffReason ?? ""] ??
                  "La IA está en pausa en esta conversación."}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2 w-full"
                onClick={() => void onPatchConversation({ reactivate: true })}
              >
                Reactivar IA
              </Button>
            </div>
          )}

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
                    ? "El agente de Vocero no responde por su cuenta. Configura lo básico y enciéndelo (o conecta tu propio bot por la API)."
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

        {/* Stepper de etapa */}
        {stages.length > 0 && leadId && (
          <section className="border-b p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-3">
              Etapa del pipeline
            </p>
            <ol>
              {stages.map((s, i) => {
                const done = currentIndex >= 0 && i < currentIndex;
                const current = s.id === currentStageId;
                return (
                  <li key={s.id} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < stages.length - 1 && (
                      <span
                        className={cn(
                          "absolute left-[7px] top-4 h-full w-px",
                          done ? "bg-brand" : "bg-border-strong"
                        )}
                      />
                    )}
                    <button
                      onClick={() => void moveToStage(s.id)}
                      aria-label={`Mover a ${s.name}`}
                      className={cn(
                        "relative z-10 mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full transition-colors",
                        done && "bg-brand text-white",
                        current && "bg-brand ring-4 ring-brand-soft",
                        !done && !current && "border border-border-strong bg-background hover:border-brand"
                      )}
                    >
                      {done && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                    </button>
                    <button
                      onClick={() => void moveToStage(s.id)}
                      className={cn(
                        "text-left text-[13px]",
                        current ? "font-[650] text-brand-text" : "text-text-2 hover:text-foreground"
                      )}
                    >
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
      </div>
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
              snap.realOperationalNeed !== null
                ? labelForNoul(snap.realOperationalNeed)
                : null
            }
            hint={percentHint(snap.realOperationalNeed)}
            showHint
          />
          <SalesRow
            label="Encaje"
            value={
              snap.productFit !== null
                ? labelForScore(snap.productFit, "product_fit")
                : null
            }
            hint={percentHint(snap.productFitConfidence)}
          />
          <SalesRow
            label="Intención de compra"
            value={
              snap.purchaseIntent !== null
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
        <li>Estado del seguimiento: {followUpStatusLabel(sales)}</li>
        <li>Intentos: {sales.followUpCount}</li>
        <li>Motivo: {followUpReasonLabel(sales.followUpReason) ?? "—"}</li>
        <li>
          Próximo:{" "}
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
          No se puede programar: atención humana activa.
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
