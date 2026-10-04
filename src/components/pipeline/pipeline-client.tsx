"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Megaphone, MessageSquareText, Settings2, Trophy, XCircle, Kanban } from "lucide-react";
import type { AnuncioListaDto, AutomationLane, StageDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { operationalLaneShortLabel } from "@/lib/sales-ui";
import { etiquetaDeOrigen, titularDeOrigen } from "@/lib/anuncios";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { formatTime } from "@/components/inbox/helpers";
import { StageManager } from "./stage-manager";

export type BoardLead = {
  id: string;
  stageId: string;
  position: number;
  lastActivityAt: string | null;
  automationLane: AutomationLane;
  followUpReason: string | null;
  contact: { id: string; name: string; phone: string | null };
  conversationId: string | null;
  /**
   * 006 — Origen del anuncio cuando el lead viene de un CTWA. `null` para
   * orgánicos. Lo pinta la línea secundaria debajo del nombre del lead.
   */
  anuncio: AnuncioListaDto | null;
};

export function PipelineClient() {
  const [stages, setStages] = useState<StageDto[]>([]);
  const [leads, setLeads] = useState<BoardLead[]>([]);
  const [activeLead, setActiveLead] = useState<BoardLead | null>(null);
  const [managing, setManaging] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const refetch = useCallback(async () => {
    const res = await fetch("/api/pipeline/board").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { stages: StageDto[]; leads: BoardLead[] };
    setStages(data.stages);
    setLeads(data.leads);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  function onDragStart(event: DragStartEvent) {
    const lead = leads.find((l) => l.id === event.active.id);
    setActiveLead(lead ?? null);
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveLead(null);
    const leadId = String(event.active.id);
    const overStage = event.over ? String(event.over.id) : null;
    if (!overStage) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stageId === overStage) return;

    const position = leads.filter((l) => l.stageId === overStage).length;
    // Optimista + persistencia
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, stageId: overStage, position } : l))
    );
    await fetch(`/api/pipeline/leads/${leadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stageId: overStage, position }),
    }).catch(() => null);
    void refetch();
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Pipeline"
        icon={Kanban}
        count={leads.length}
        hint="Los leads viven aquí. Arrástralos entre etapas para moverlos."
        actions={
          <Button variant="outline" size="sm" onClick={() => setManaging(true)}>
            <Settings2 className="h-4 w-4" /> Gestionar etapas
          </Button>
        }
      />

      {stages.length === 0 ? (
        /* 014 C7 — Un tablero sin columnas no es un tablero vacío: es una pantalla
           rota que no dice qué hacer. Ahora dice qué falta y ofrece la misma acción
           que el botón de arriba, en el sitio donde se mira (FR-7.8: esto NO es un
           panel nuevo, es el estado vacío de la pantalla que ya existía). */
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm font-medium">Este pipeline todavía no tiene etapas</p>
          <p className="max-w-sm text-xs text-text-3">
            Crea la primera etapa —«Nuevo», «Interesado», «Cliente»— y los leads
            que lleguen por WhatsApp se irán colocando aquí solos.
          </p>
          <Button variant="outline" size="sm" onClick={() => setManaging(true)}>
            <Settings2 className="h-4 w-4" /> Gestionar etapas
          </Button>
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto p-4">
          <DndContext
            sensors={sensors}
            onDragStart={onDragStart}
            onDragEnd={(e) => void onDragEnd(e)}
          >
            <div className="flex h-full gap-3">
              {stages.map((stage) => (
                <StageColumn
                  key={stage.id}
                  stage={stage}
                  leads={leads
                    .filter((l) => l.stageId === stage.id)
                    .sort((a, b) => a.position - b.position)}
                />
              ))}
            </div>
            <DragOverlay>
              {activeLead ? <LeadCard lead={activeLead} overlay /> : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}

      {managing && (
        <StageManager
          stages={stages}
          onClose={() => setManaging(false)}
          onChanged={() => void refetch()}
        />
      )}
    </div>
  );
}

function StageColumn({ stage, leads }: { stage: StageDto; leads: BoardLead[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full w-64 shrink-0 flex-col rounded-lg border bg-card/50",
        isOver && "ring-2 ring-primary/60"
      )}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        {/* 014 C7 — La cabecera de columna dice qué contiene y cuántas cosas son,
            en el mismo peso: nombre a la izquierda, cuenta a la derecha. Antes la
            cuenta era gris claro sobre gris claro y desaparecía. */}
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          {stage.kind === "won" && <Trophy className="h-3.5 w-3.5 shrink-0 text-brand-text" />}
          {stage.kind === "lost" && (
            <XCircle className="h-3.5 w-3.5 shrink-0 text-text-3" />
          )}
          <span className="truncate">{stage.name}</span>
        </span>
        <span className="ml-2 shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-text-2">
          {leads.length}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {leads.length === 0 ? (
          /* Una columna sin leads es información ("nadie está aquí"), no un hueco
             vacío que hay que interpretar. No compite con nada: `text-text-4`. */
          <p className="px-1 py-2 text-center text-[11px] text-text-4">
            Nadie en esta etapa
          </p>
        ) : (
          leads.map((lead) => <DraggableLead key={lead.id} lead={lead} />)
        )}
      </div>
    </div>
  );
}

function DraggableLead({ lead }: { lead: BoardLead }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(isDragging && "opacity-40")}
    >
      <LeadCard lead={lead} />
    </div>
  );
}

function LeadCard({ lead, overlay = false }: { lead: BoardLead; overlay?: boolean }) {
  const laneHint = operationalLaneShortLabel({
    lane: lead.automationLane,
    followUpReason: lead.followUpReason,
  });
  const eti = etiquetaDeOrigen(lead.anuncio?.sourceType);
  const tit = titularDeOrigen(lead.anuncio?.headline, lead.anuncio?.sourceId);

  return (
    <div
      className={cn(
        "cursor-grab rounded-md border bg-card p-3 shadow-sm",
        overlay && "rotate-2 shadow-xl"
      )}
    >
      <div className="flex items-center gap-2.5">
        <ContactAvatar name={lead.contact.name} seed={lead.contact.id} size="sm" />
        <div className="min-w-0 flex-1">
          {/* 014 C7 — El nombre es el ancla de la tarjeta; todo lo demás es
              secundario y baja a `text-3`. */}
          <p className="truncate text-sm font-semibold">{lead.contact.name}</p>
          <p className="text-[11px] text-text-3">
            {lead.lastActivityAt
              ? `Actividad: ${formatTime(lead.lastActivityAt)}`
              : "Sin actividad"}
          </p>
        </div>
        {lead.conversationId && (
          <Link
            href={`/inbox?contact=${lead.contact.id}`}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Abrir conversación"
            className="rounded p-1 text-text-3 hover:bg-accent hover:text-foreground"
          >
            <MessageSquareText className="h-4 w-4" />
          </Link>
        )}
      </div>
      {eti && tit && (
        <p className="mt-1.5 flex items-center gap-1 truncate text-[11px] text-text-3">
          <Megaphone className="h-3 w-3 shrink-0" strokeWidth={1.7} />
          <span className="truncate">
            {eti} · {tit}
          </span>
        </p>
      )}
      {laneHint && (
        /* 014 C7 — El carril deja de ser un texto en versalitas de 10 px y pasa a
           ser una etiqueta con color. Solo el carril HUMANO se pinta en acento: es
           la única de estas etiquetas que significa "aquí manda una persona", y es
           la que el operador necesita ver sin leer. `auto` no llega aquí
           (`operationalLaneShortLabel` devuelve `null`), así que lo que queda es
           motor en curso ("Cierre", "Espera") o detenido ("Detenido",
           "Dormido"), que se quedan en neutro (FR-7.7). No cambia ninguna
           semántica: el texto sigue viniendo de `sales-ui`. */
        <p
          className={cn(
            "mt-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium",
            lead.automationLane === "human"
              ? "border-brand-soft bg-brand-soft text-brand-text"
              : "border-border-strong bg-secondary text-text-2"
          )}
        >
          <span
            className={cn(
              "h-[5px] w-[5px] rounded-full",
              lead.automationLane === "human" ? "bg-brand" : "bg-text-3"
            )}
          />
          {laneHint}
        </p>
      )}
    </div>
  );
}
