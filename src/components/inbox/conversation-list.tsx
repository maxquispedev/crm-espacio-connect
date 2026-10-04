"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Bell,
  Megaphone,
  Search,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import type { ConversationDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import {
  etiquetaDeOrigen,
  titularDeOrigen,
} from "@/lib/anuncios";
import { ETIQUETA_ESTADO, estadoOperativo } from "@/lib/operational-state";
import {
  type FiltroBandeja,
  resumirBandeja,
} from "./bandeja-filtros";
import { formatTime, previewText } from "./helpers";

const STAGE_DOT: Record<string, string> = {
  Nuevo: "#9ca3af",
  "En conversación": "#7b93b3",
  Interesado: "#b08b5e",
  Cliente: "#5f8f74",
  Perdido: "#a2504c",
};

/**
 * 013 C4 — El estado de la fila dice lo MISMO que el panel del hilo y el item de
 * la Agenda, y sale de la misma función (`estadoOperativo`). Aquí no se decide
 * nada: si esta fila dijera "Esperando respuesta" y el hilo dijera "Por
 * atender", el operador no sabría cuál de las dos pantallas está mintiendo
 * (FR-4.4).
 *
 * Con la IA al mando no se pinta nada, como hasta ahora: una etiqueta "La IA
 * responde" en cada fila de la lista no informa de nada, solo ocupa.
 */
function EstadoOperacionalChip({ conversacion }: { conversacion: ConversationDto }) {
  const estado = estadoOperativo(conversacion);
  if (estado === "ia") return null;
  const urgente = estado === "por_atender";
  const Icon = urgente ? AlertCircle : estado === "comprometido" ? Bell : UserRound;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        urgente
          ? "border-danger-border bg-danger-soft text-danger-text"
          : "border-warning-border bg-warning-soft text-warning-text"
      )}
      data-testid="fila-estado"
      data-estado={estado}
    >
      <Icon className="h-3 w-3" strokeWidth={1.7} />
      {ETIQUETA_ESTADO[estado]}
    </span>
  );
}

function EmptyState({ onSeeded }: { onSeeded: () => void }) {
  const [seeding, setSeeding] = useState(false);
  const [failed, setFailed] = useState(false);

  async function seed() {
    setSeeding(true);
    const res = await fetch("/api/seed/demo", { method: "POST" }).catch(
      () => null
    );
    setSeeding(false);
    if (res?.ok) onSeeded();
    else setFailed(true);
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-medium">Sin conversaciones todavía</p>
      <p className="text-xs text-text-3">
        Cuando alguien escriba a tu número de WhatsApp, su conversación
        aparecerá aquí en tiempo real.
      </p>
      {!failed && (
        <Button
          size="sm"
          variant="outline"
          disabled={seeding}
          onClick={() => void seed()}
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.7} />
          {seeding ? "Cargando demo…" : "Cargar datos de demostración"}
        </Button>
      )}
    </div>
  );
}

export function ConversationList({
  conversations: conversationsProp,
  selectedId,
  onSelect,
  onSeeded,
}: {
  conversations: ConversationDto[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSeeded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FiltroBandeja>("all");
  const [stage, setStage] = useState<string>("all");
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Rescate de lo tecleado ANTES de que hidratara el JS. La caja se pinta en
   * el HTML del servidor, así que se puede escribir en ella mientras carga la
   * página; al montar, React la dejaba vacía y esas pulsaciones se perdían en
   * silencio (el usuario veía la lista entera "sin filtrar"). Por eso el input
   * es NO controlado: el DOM manda y aquí solo adoptamos su valor.
   */
  useEffect(() => {
    const typed = inputRef.current?.value ?? "";
    if (typed) setQuery(typed);
  }, []);

  const loading = conversationsProp === null;
  const conversations = conversationsProp ?? [];
  // 013 C2/C4 — Toda la lógica de la fila de filtros vive en un módulo puro: los
  // conteos y sus listados salen de la MISMA operación, así que no pueden
  // discrepar. "Por atender" va primero porque es la pregunta con la que arranca
  // el día y "Comprometidos" detrás porque es su contracara —"¿qué tengo
  // guardado para después?"—; "Todas", "No leídas", "Anuncios" y la etapa
  // conservan exactamente su definición de siempre (FR-2.6).
  const { visibles, porAtender, comprometidos, noLeidas, anuncios, total } =
    resumirBandeja(conversations, { query, stage, filter });

  // Etapas presentes en la bandeja, en el orden en que llegan del pipeline.
  const stages: string[] = [];
  for (const c of conversations) {
    if (c.stageName && !stages.includes(c.stageName)) stages.push(c.stageName);
  }

  function clearQuery() {
    if (inputRef.current) inputRef.current.value = "";
    setQuery("");
    inputRef.current?.focus();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 pb-3 pt-4">
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-[17px] font-[650] tracking-tight">Bandeja</h2>
          <span className="text-sm text-text-3">{conversations.length}</span>
        </div>
        <div className="flex items-center gap-2 rounded-md border bg-secondary px-3 py-[7px] transition-colors focus-within:border-brand focus-within:bg-background focus-within:ring-[3px] focus-within:ring-brand-soft">
          <Search className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.7} />
          <input
            ref={inputRef}
            placeholder="Buscar por nombre o teléfono…"
            aria-label="Buscar conversación"
            defaultValue=""
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-text-3"
          />
          {query && (
            <button
              onClick={clearQuery}
              aria-label="Limpiar búsqueda"
              className="shrink-0 rounded-full p-0.5 text-text-3 hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5">
        {(
          [
            { id: "por_atender", label: "Por atender", count: porAtender },
            { id: "comprometidos", label: "Comprometidos", count: comprometidos },
            { id: "all", label: "Todas", count: total },
            { id: "unread", label: "No leídas", count: noLeidas },
          ] as const
        ).map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            data-testid={`bandeja-filtro-${f.id}`}
            className={cn(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[5px] text-[12.5px] font-medium transition-colors",
              filter === f.id
                ? "border-brand bg-brand text-white"
                : "bg-background text-text-2 hover:bg-accent"
            )}
          >
            {f.id === "por_atender" && (
              <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
            )}
            {f.id === "comprometidos" && (
              <Bell className="h-3.5 w-3.5" strokeWidth={1.7} />
            )}
            {f.label}
            <span
              className={cn(
                "rounded-full px-1.5 text-[11px]",
                filter === f.id ? "bg-white/20" : "bg-secondary text-text-3"
              )}
            >
              {f.count}
            </span>
          </button>
        ))}

        {anuncios > 0 && (
          <button
            onClick={() => setFilter(filter === "ads" ? "all" : "ads")}
            aria-label="Filtrar por anuncios"
            aria-pressed={filter === "ads"}
            className={cn(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[5px] text-[12.5px] font-medium transition-colors",
              filter === "ads"
                ? "border-brand bg-brand text-white"
                : "bg-background text-text-2 hover:bg-accent"
            )}
          >
            <Megaphone className="h-3.5 w-3.5" strokeWidth={1.7} />
            Anuncios
            <span
              className={cn(
                "rounded-full px-1.5 text-[11px]",
                filter === "ads" ? "bg-white/20" : "bg-secondary text-text-3"
              )}
            >
              {anuncios}
            </span>
          </button>
        )}

        {stages.length > 0 && (
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            aria-label="Filtrar por etapa del embudo"
            className={cn(
              "ml-auto min-w-0 max-w-[42%] truncate rounded-full border px-2 py-[5px] text-[12.5px] font-medium transition-colors",
              stage === "all"
                ? "bg-background text-text-2 hover:bg-accent"
                : "border-brand bg-brand text-white"
            )}
          >
            <option value="all">Toda etapa</option>
            {stages.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-6 text-center text-xs text-text-3">Cargando…</p>
        ) : conversations.length === 0 ? (
          <EmptyState onSeeded={onSeeded} />
        ) : visibles.length === 0 ? (
          <p className="p-6 text-center text-xs text-text-3">
            {filter === "por_atender"
              ? "Nada pendiente de tu lado ahora mismo."
              : filter === "comprometidos"
                ? "No tienes nada comprometido para después."
                : "Sin resultados para este filtro."}
          </p>
        ) : (
          <ul>
            {visibles.map((c) => {
              const unread = c.unreadCount > 0;
              const active = selectedId === c.id;
              return (
                <li key={c.id} className="relative border-b border-border/70">
                  {active && (
                    <span className="absolute inset-y-0 left-0 w-[3px] bg-brand" />
                  )}
                  <button
                    onClick={() => onSelect(c.id)}
                    data-testid="conversation-item"
                    aria-label={`Abrir conversación con ${c.contact.name}`}
                    className={cn(
                      "flex w-full items-start gap-[11px] px-4 py-[var(--row-py)] text-left transition-colors",
                      active ? "bg-[var(--bg-active)]" : "hover:bg-subtle"
                    )}
                  >
                    <span className="relative shrink-0">
                      <ContactAvatar name={c.contact.name} seed={c.contact.id} size="lg" />
                      {c.windowOpen && (
                        <span className="absolute bottom-0 right-0 h-[11px] w-[11px] rounded-full border-[2.5px] border-background bg-success" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-sm",
                            unread ? "font-[680]" : "font-semibold"
                          )}
                        >
                          {c.contact.name}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 text-[11.5px]",
                            unread ? "font-semibold text-brand" : "text-text-3"
                          )}
                        >
                          {formatTime(c.lastMessageAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-[13px]",
                            unread ? "font-medium text-text-2" : "text-text-3"
                          )}
                        >
                          {previewText(c.preview)}
                        </span>
                        {unread && (
                          <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[10.5px] font-semibold text-white">
                            {c.unreadCount}
                          </span>
                        )}
                      </span>
                      <span className="mt-1.5 flex items-center gap-1.5">
                        {c.stageName && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border bg-secondary px-2 py-0.5 text-[11px] text-text-2">
                            <span
                              className="h-[7px] w-[7px] rounded-full"
                              style={{
                                background: STAGE_DOT[c.stageName] ?? "#9ca3af",
                              }}
                            />
                            {c.stageName}
                          </span>
                        )}
                        <EstadoOperacionalChip conversacion={c} />
                        {(() => {
                          const eti = etiquetaDeOrigen(c.anuncio?.sourceType);
                          const tit = titularDeOrigen(
                            c.anuncio?.headline,
                            c.anuncio?.sourceId
                          );
                          if (!eti || !tit) return null;
                          return (
                            <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full border bg-background px-2 py-0.5 text-[11px] text-text-2">
                              <Megaphone className="h-3 w-3 shrink-0 text-text-3" strokeWidth={1.7} />
                              <span className="truncate">
                                {eti} · {tit}
                              </span>
                            </span>
                          );
                        })()}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
