"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, CalendarClock, Loader2, X } from "lucide-react";
import type { AttentionDto } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * Límite de la nota. Solo una AYUDA de UX en el `maxLength`; la autoridad es
 * `ATTENTION_NOTE_MAX_LENGTH` en `@/server/inbox/attention`, que la duplica
 * deliberadamente porque un componente cliente no puede importar un módulo de
 * servidor (arrastraría la BD al bundle). Si divergen, manda el servidor (422).
 */
const NOTE_MAX = 280;

/**
 * 013 C3 — "Recordarme": aplazar la atención a una fecha concreta.
 *
 * Qué es y qué NO es (spec §2.3, plan §5): es un compromiso de una persona
 * ("vuelvo a este cliente el jueves"). NO es un seguimiento automático, NO tiene
 * plantilla y NO envía nada — ni al guardar, ni al vencer, ni al cancelar. Al
 * vencer, la conversación vuelve a "Por atender" y la decisión sigue siendo de
 * la persona.
 *
 * La fecha la elige la persona con un `datetime-local`: NO hay parsing de texto
 * libre ("el jueves que viene" no se interpreta). El navegador convierte a ISO
 * con su propio desfase y el servidor vuelve a validar que sea futura; los
 * grupos de la Agenda los calcula el servidor, no este componente.
 */
export function ReminderSchedule({
  conversationId,
  attention,
  onChanged,
}: {
  conversationId: string;
  attention: AttentionDto | null;
  /** Avisa al padre para que recargue la conversación (el SSE también lo hace). */
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [localDate, setLocalDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // 014 C8 — Al abrir el formulario, el foco va al campo que hay que rellenar.
  // Antes, "Elegir fecha" solo desplegaba el formulario: el foco se quedaba en el
  // botón, y quien navega con Tab tenía que recorrer el resto del panel para
  // llegar a la fecha sin saber que ya estaba abierta.
  const dueRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) dueRef.current?.focus();
  }, [open]);

  const scheduled = attention?.state === "deferred" ? attention : null;
  // El vencimiento NO se recalcula aquí: `needsAttentionNow` ya viene derivado
  // por el servidor con su reloj. Si el cliente lo calculara, la etiqueta
  // "Vencido" podría contradecir al grupo de la Agenda en el segundo exacto.
  const overdue = scheduled?.needsAttentionNow === true;

  const reset = () => {
    setOpen(false);
    setLocalDate("");
    setNote("");
    setError(null);
  };

  const submit = async () => {
    setError(null);
    if (!localDate) {
      setError("Elige la fecha y hora del recordatorio");
      return;
    }
    const due = new Date(localDate);
    if (Number.isNaN(due.getTime())) {
      setError("La fecha no es válida");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          dueAt: due.toISOString(),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        // Camino infeliz: se muestra el 422 del servidor (fecha pasada, nota
        // larga) sin tirar el formulario ni romper el panel.
        setError(data?.error?.message ?? `No se pudo guardar (${res.status})`);
        return;
      }
      setDone("Recordatorio guardado");
      setNote("");
      setOpen(false);
      onChanged?.();
    } catch {
      setError("No se pudo guardar el recordatorio. Revisa tu conexión.");
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/reminders/${conversationId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(data?.error?.message ?? `No se pudo cancelar (${res.status})`);
        return;
      }
      setDone("Recordatorio cancelado");
      onChanged?.();
    } catch {
      setError("No se pudo cancelar. Revisa tu conexión.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-md border bg-secondary/50 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-medium">
            <Bell className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
            Recordarme
          </p>
          <p className="text-[11px] text-text-3" data-testid="reminder-state">
            {scheduled?.dueAt
              ? overdue
                ? `Vencido · vuelve a "Por atender"`
                : `Para el ${formatDue(scheduled.dueAt)}`
              : "Sin recordatorio"}
          </p>
        </div>
        {scheduled ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void cancel()}
            disabled={saving}
            data-testid="reminder-cancel"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            Cancelar
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDone(null);
              setError(null);
              setOpen((v) => !v);
            }}
            // 014 C8 — El botón declara si DEJO algo abierto: sin `aria-expanded`
            // no hay forma de saber si el formulario de la fecha está desplegado
            // o no, y con teclado hay que adivinarlo por si aparece la fecha.
            aria-expanded={open}
            aria-controls="reminder-form"
            data-testid="reminder-open"
          >
            <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.7} />
            Elegir fecha
          </Button>
        )}
      </div>

      {scheduled?.note && (
        <p className="mt-2 text-[11px] text-text-2" data-testid="reminder-note">
          {scheduled.note}
        </p>
      )}

      {open && (
        <div id="reminder-form" className="mt-2.5 flex flex-col gap-2 border-t pt-2.5">
          <label className="flex flex-col gap-1 text-[11px] text-text-2">
            Fecha y hora
            <Input
              ref={dueRef}
              type="datetime-local"
              value={localDate}
              onChange={(e) => setLocalDate(e.target.value)}
              data-testid="reminder-due"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-text-2">
            Nota (opcional)
            <Textarea
              value={note}
              maxLength={NOTE_MAX}
              placeholder="Por qué retomo el contacto"
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              data-testid="reminder-note-input"
            />
          </label>
          <p className="text-[10px] leading-relaxed text-text-3">
            Al vencer vuelve a “Por atender”. No se manda ningún WhatsApp.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={saving}
              data-testid="reminder-save"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Guardar
            </Button>
            <Button size="sm" variant="ghost" onClick={reset} disabled={saving}>
              Cerrar
            </Button>
          </div>
        </div>
      )}

      {/* 014 C8 — Igual que en el bloque de atención: el resultado se anuncia.
          "Recordatorio guardado" salía de una acción asíncrona que no mueve el
          foco, así que sin región viva nadie se enteraba. */}
      {error && (
        <p
          role="alert"
          className="mt-2 text-[11px] text-danger-text"
          data-testid="reminder-error"
        >
          {error}
        </p>
      )}
      {done && (
        // 014 C8 — Y de `text-brand` a `text-brand-text`, medido: `text-brand` es
        // `--accent` (color de superficie) y como texto daba 2.33:1 sobre
        // `--bg-panel` en oscuro: la confirmación de que el recordatorio se guardó
        // era casi invisible en tema oscuro. `text-brand-text` sube a 11.24:1, y
        // es el token que el proyecto ya usa para texto de marca en el resto de
        // la app. En claro también mejora: 6.86:1 → 10.04:1.
        <p
          role="status"
          className="mt-2 text-[11px] text-brand-text"
          data-testid="reminder-done"
        >
          {done}
        </p>
      )}
    </div>
  );
}

function formatDue(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
