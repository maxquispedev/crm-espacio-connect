"use client";

import { useState } from "react";
import { Check, Loader2, Sparkles, UserRound } from "lucide-react";
import type { ConversationDto } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  EXPLICACION_ESTADO,
  estadoOperativo,
  esConversacionHumana,
  type EstadoOperativo,
} from "@/lib/operational-state";
import { EstadoPill } from "./estado-chip";
import { ReminderSchedule } from "./reminder-schedule";

/**
 * Por qué la conversación pasó a ser del humano. Son los motivos que ya
 * distinguía el panel; viven aquí porque son la explicación de este estado, no
 * un dato suelto de la conversación. En castellano de operación, nunca el
 * `handoffReason` crudo (FR-4.2).
 */
const MOTIVOS_HUMANO: Record<string, string> = {
  cliente: "El cliente pidió que le atendiera una persona.",
  modelo: "El agente decidió no seguir solo.",
  error: "La IA falló al responder.",
  ventana: "La ventana de 24 h está cerrada.",
  manual_reply: "Respondiste desde el teléfono, así que la IA se pausó.",
  commercial: "El seguimiento comercial pidió que lo atendiera una persona.",
  unsupported_media: "La IA no puede interpretar este archivo. Revisa el mensaje y responde al cliente.",
  duplicate_demo: "Esta demo ya se intentó enviar. Revisa la conversación antes de continuar.",
  delivery_failed: "Hubo un problema al enviar el mensaje. Revisa el error antes de continuar.",
};

/**
 * 013 C4 — El bloque de ATENCIÓN HUMANA de una conversación: el estado que ve la
 * persona y las tres acciones que puede tomar sobre él.
 *
 * Antes de este corte el estado y las acciones vivían sueltos: un aviso
 * "Atención humana" que solo aparecía si hubo handoff, y debajo, separado, el
 * "Recordarme" del corte 3. Aquí se juntan porque son una sola decisión —"¿qué
 * hago con esta conversación?"— y porque la respuesta tiene que ser la MISMA en
 * la lista y en la Agenda (FR-4.4).
 *
 * Las acciones, y a qué estado dejan la conversación:
 *
 * | Acción | Estado | Efecto operativo |
 * |---|---|---|
 * | Marcar atendido | `waiting_client` | sale de "Por atender" |
 * | Recordarme | `deferred(due_at)` | sale de "Por atender", aparece en la Agenda |
 * | Reactivar IA | (limpia) | la IA vuelve a responder |
 *
 * "Marcar atendido" solo se ofrece cuando hay algo que atender. Cuando ya está
 * atendida o tiene un recordatorio puesto, el botón desaparecería sin
 * explicación, así que lo que se hace es la inversa: el aviso de estado lo dice
 * con palabras y el botón se ofrece solo en `por_atender`. Un botón que aparece
 * exactamente cuando hay una tarea es la misma promesa que hace el chip de la
 * lista.
 *
 * Este componente no es una puerta al estado: llama al endpoint, y quien decide
 * es el servidor. "No se puede marcar: la IA es la dueña" se muestra tal cual.
 */
export function AttentionBlock({
  conversation,
  onPatchConversation,
  onChanged,
}: {
  conversation: ConversationDto;
  /**
   * 014 C8 — `Promise<string | null> | void`: el PATCH puede FALLAR y el bloque
   * tiene que poder decirlo. Antes devolvía `void` y el resultado del `fetch` se
   * descartaba, así que "Reactivar IA" fallaba en silencio: el botón se quedaba
   * ahí, la conversación seguía con la IA apagada y no había ni un mensaje.
   */
  onPatchConversation: (
    patch: { reactivate?: boolean }
  ) => void | Promise<string | null>;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Los hooks van ANTES del return temprano: el orden de hooks tiene que ser el
  // mismo tanto si la conversación es del humano como si no lo es.
  if (!esConversacionHumana(conversation)) return null;
  const estado = estadoOperativo(conversation);

  /** 014 C8 — "Reactivar IA" con su propio ciclo de vida: avisa en los dos sentidos. */
  const reactivateAi = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const fallo = await onPatchConversation({ reactivate: true });
      if (fallo) {
        setError(fallo);
        return;
      }
      setDone("IA reactivada · vuelve a responder sola");
      onChanged?.();
    } catch {
      setError("No se pudo reactivar la IA. Revisa tu conexión.");
    } finally {
      setBusy(false);
    }
  };

  const markAttended = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/conversations/${conversation.id}/attention`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "waiting_client" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(data?.error?.message ?? `No se pudo marcar como atendida (${res.status})`);
        return;
      }
      setDone("Atendida · esperando respuesta del cliente");
      onChanged?.();
    } catch {
      setError("No se pudo marcar como atendida. Revisa tu conexión.");
    } finally {
      setBusy(false);
    }
  };

  // 014 C7 — El bloque entero se tiñe por el estado. Antes era SIEMPRE ámbar,
  // así que una conversación con un recordatorio vencido (hay trabajo HOY) se
  // veía igual que una que ya atendiste y solo espera al cliente (no hay nada que
  // hacer). El ojo aprendió a ignorar el color y se perdió la señal más importante
  // de la pantalla: si esto es rojo, hay algo que hacer conmigo (FR-7.2, FR-7.7).
  // Los tonos son los mismos tokens que ya usan la fila de la lista y el chip del
  // nav, para que "rojo = por atender" signifique lo mismo en todas partes.
  const urgente = estado === "por_atender";
  const comprometido = estado === "comprometido";
  const Tono = urgente
    ? "border-danger-border bg-danger-soft text-danger-text"
    : comprometido
      ? "border-warning-border bg-warning-soft text-warning-text"
      : "border-border-strong bg-secondary text-text-2";

  return (
    <section
      className={cn("mt-3 rounded-md border p-3", Tono)}
      data-testid="attention-block"
      data-estado={estado}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold">
          <UserRound className="h-4 w-4" strokeWidth={1.7} /> Atención humana
        </p>
        <EstadoChip estado={estado} />
      </div>

      <p
        className="mt-1 text-xs opacity-90"
        data-testid="attention-explanation"
      >
        {EXPLICACION_ESTADO[estado]}
      </p>

      {conversation.handoffReason && MOTIVOS_HUMANO[conversation.handoffReason] && (
        <p
          className="mt-1 text-[11px] opacity-75"
          data-testid="attention-reason"
        >
          {MOTIVOS_HUMANO[conversation.handoffReason]}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {estado === "por_atender" && (
          <Button
            size="sm"
            onClick={() => void markAttended()}
            disabled={busy}
            data-testid="attention-mark-attended"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
            )}
            Marcar atendido
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => void reactivateAi()}
          disabled={busy}
          data-testid="attention-reactivate"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
          Reactivar IA
        </Button>
      </div>

      {/*
        014 C8 — Los dos mensajes se ANUNCIAN. `role="status"` es una región viva
        (WCAG 4.1.3): sin ella, "Atendida · esperando respuesta del cliente" y el
        error aparecían en pantalla sin que un lector de pantalla dijera nada, y
        la acción —que es asíncrona y no cambia el foco— pasaba desapercibida.
        `role="status"` en el éxito y `role="alert"` en el error: el error
        interrumpe porque algo está roto, el éxito no.
      */}
      {error && (
        <p
          role="alert"
          className="mt-2 text-[11px] text-danger-text"
          data-testid="attention-error"
        >
          {error}
        </p>
      )}
      {done && (
        <p
          role="status"
          className="mt-2 text-[11px] opacity-80"
          data-testid="attention-done"
        >
          {done}
        </p>
      )}

      {/* 013 C3 — "Recordarme" solo cuando la conversación es del humano.
          Programar sobre una conversación en manos de la IA es un 409 en el
          servidor (`ai_owns_conversation`): aquí ni se ofrece. */}
      <ReminderSchedule
        conversationId={conversation.id}
        attention={conversation.attention ?? null}
        onChanged={onChanged}
      />
    </section>
  );
}

/**
 * La etiqueta del estado, con el mismo texto y el mismo significado que la fila
 * de la lista y el item de la Agenda — ahora también la MISMA pitted pieza, con
 * el mismo `EstadoPill`. Para `atencion_humana` no se pinta nada: el título del
 * bloque ya dice "Atención humana" y repetirlo sería ruido, no información.
 */
function EstadoChip({ estado }: { estado: EstadoOperativo }) {
  if (estado === "atencion_humana") return null;
  return (
    <EstadoPill
      estado={estado}
      testId="attention-state"
      className="bg-background"
    />
  );
}
