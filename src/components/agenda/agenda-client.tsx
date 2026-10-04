"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import type { AgendaBucketName, AgendaDto, ReminderDto } from "@/lib/types";
import { ETIQUETA_ESTADO, estadoDeAtencion } from "@/lib/operational-state";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { useEvents } from "@/components/use-events";

/**
 * 013 C3 — Agenda de recordatorios humanos.
 *
 * Los cinco grupos los decide el SERVIDOR (`GET /api/reminders`). Este
 * componente no calcula ningún bucket ni ningún vencimiento: solo pinta lo que
 * llega y manda las dos acciones (abrir conversación, cancelar). Si agrupara
 * aquí, el "Hoy" del navegador y el del servidor discreparían justo en el borde
 * de medianoche (spec §3.3, plan §4.2).
 *
 * Cancelar es una acción HUMANA: borra el compromiso y no envía nada. Al
 * vencer, el recordatorio vuelve a "Por atender" y quien decide qué hacer es la
 * persona (plan §5 D-5).
 */

const GROUPS: { key: AgendaBucketName; label: string; hint: string }[] = [
  { key: "overdue", label: "Vencidos", hint: "Ya tocaba: vuelve a “Por atender”" },
  { key: "today", label: "Hoy", hint: "Recordatorios de hoy" },
  { key: "tomorrow", label: "Mañana", hint: "Recordatorios de mañana" },
  { key: "week", label: "Esta semana", hint: "Del resto de la semana" },
  { key: "later", label: "Más adelante", hint: "Sin fecha cercana" },
];

export function AgendaClient() {
  const [agenda, setAgenda] = useState<AgendaDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/reminders").catch(() => null);
    if (!res) {
      // Camino infeliz: la Agenda avisa y sigue vacía en vez de colgarse.
      setError("No se pudo cargar la agenda. Revisa tu conexión.");
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError(`No se pudo cargar la agenda (${res.status})`);
      setLoading(false);
      return;
    }
    const data = (await res.json()) as AgendaDto;
    setAgenda(data);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Programar o cancelar fuera de esta pantalla (p. ej. desde el panel de la
  // conversación) debe reflejarse aquí sin recargar a mano.
  useEvents({ onConversationUpdated: () => void load() });

  const cancel = async (reminder: ReminderDto) => {
    setBusyId(reminder.conversationId);
    setError(null);
    try {
      const res = await fetch(`/api/reminders/${reminder.conversationId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(data?.error?.message ?? `No se pudo cancelar (${res.status})`);
        return;
      }
      await load();
    } catch {
      setError("No se pudo cancelar. Revisa tu conexión.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Agenda"
        icon={CalendarClock}
        hint="Recordatorios que tú te pusiste. Al vencer vuelven a “Por atender”; no se manda ningún WhatsApp."
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => void load()}
            data-testid="agenda-refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.7} />
            Actualizar
          </Button>
        }
      />

      <div
        className="flex-1 overflow-y-auto px-4 py-4 sm:px-6"
        // 014 C8 — `aria-busy` mientras llega: sin él, "Cargando agenda…" y una
        // agenda de verdad son indistinguibles para quien no ve la pantalla.
        aria-busy={loading}
      >
        {error && (
          <p
            // 014 C8 — `role="alert"`: la Agenda caída es un fallo de la pantalla
            // entera, y hasta ahora se pintaba en silencio. El mensaje avisa y el
            // botón "Actualizar" de la cabecera da la salida (FR-8.3).
            role="alert"
            className="mb-4 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-xs text-danger-text"
            data-testid="agenda-error"
          >
            {error}
          </p>
        )}

        {loading && (
          <p className="flex items-center gap-2 text-xs text-text-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando agenda…
          </p>
        )}

        {!loading && agenda && (
          <AgendaGroups
            agenda={agenda}
            busyId={busyId}
            onCancel={(reminder) => void cancel(reminder)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Los cinco grupos, sin estado propio. Se exporta separado para poder pintarlo
 * en un test de JSX real (`renderToStaticMarkup`): así se afirma sobre lo que el
 * operador LEE —grupos, contacto, fecha, nota, estado y las dos acciones— y no
 * sobre un HTML copiado a mano.
 */
export function AgendaGroups({
  agenda,
  busyId,
  onCancel,
}: {
  agenda: AgendaDto;
  busyId: string | null;
  onCancel: (reminder: ReminderDto) => void;
}) {
  return (
    <>
      {agenda.total === 0 && (
        <p
          className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-text-3"
          data-testid="agenda-empty"
        >
          No hay recordatorios. Desde una conversación en atención humana usa
          “Recordarme” para fijar una fecha.
        </p>
      )}

      {GROUPS.map((group) => {
        const items = agenda.buckets[group.key];
        return (
          <section key={group.key} className="mb-6" data-testid={`agenda-group-${group.key}`}>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-text-2">
                {group.label}
              </h2>
              <span className="text-[11px] text-text-3">
                {items.length} · {group.hint}
              </span>
            </div>
            {items.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-2 text-xs text-text-3">
                Sin recordatorios
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {items.map((reminder) => (
                  <li
                    key={reminder.conversationId}
                    // 014 C8 — `flex-wrap`: en un móvil los dos botones ("Abrir" y
                    // "Cancelar", con `shrink-0`) se comían el ancho del contacto y
                    // dejaban la línea de "vencido · en Por atender" ilegible. Al
                    // envolver, el texto conserva su sitio y las acciones bajan.
                    className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2.5"
                    data-testid={`agenda-item-${reminder.bucket}`}
                  >
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="truncate text-[13px] font-medium">
                        {reminder.contact.name}
                      </p>
                      <p
                        className="truncate text-[11px] text-text-3"
                        data-testid="agenda-item-when"
                      >
                        {formatWhen(reminder.dueAt)} · {stateLabel(reminder)}
                      </p>
                      {reminder.note && (
                        <p className="mt-0.5 truncate text-[11px] text-text-2">{reminder.note}</p>
                      )}
                    </div>
                    <Link
                      href={`/inbox?contact=${reminder.contact.id}`}
                      className="flex shrink-0 items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] text-text-2 hover:bg-accent"
                      data-testid="agenda-open"
                    >
                      <ExternalLink className="h-3 w-3" strokeWidth={1.7} />
                      Abrir
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onCancel(reminder)}
                      disabled={busyId === reminder.conversationId}
                      aria-label={`Cancelar recordatorio de ${reminder.contact.name}`}
                      data-testid="agenda-cancel"
                    >
                      {busyId === reminder.conversationId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                      )}
                      Cancelar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}

/**
 * El estado de cada item, con las MISMAS palabras que la fila de la lista y el
 * panel del hilo (FR-4.4). Sale de `estadoOperativo`, así que un recordatorio
 * vencido no puede decir aquí "programado" mientras la Bandeja dice "Por
 * atender": las dos superficies leen el mismo `needsAttentionNow` que ya derivó
 * el servidor y llegan al mismo estado.
 *
 * "Vencido" es la palabra de la Agenda —"ya tocaba"— y se le pega la etiqueta
 * compartida para que quede claro que ese trabajo ya está en la cola.
 */
function stateLabel(reminder: ReminderDto): string {
  const estado = estadoDeAtencion({
    state: reminder.state,
    dueAt: reminder.dueAt,
    note: reminder.note,
    needsAttentionNow: reminder.needsAttentionNow,
  });
  if (estado === "por_atender") {
    return `vencido · en ${ETIQUETA_ESTADO.por_atender}`;
  }
  // Un recordatorio que no está vencido es un compromiso a futuro. La palabra
  // "programado" describe la fecha, no el estado, y por eso no se mezcla con las
  // etiquetas de arriba.
  return "programado";
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
