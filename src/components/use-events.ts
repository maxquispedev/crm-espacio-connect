"use client";

import { useEffect, useRef } from "react";
import type { MessageNewPayload } from "@/lib/types";

export type EventHandlers = {
  onMessageNew?: (data: MessageNewPayload) => void;
  onMessageStatus?: (data: {
    conversationId: string;
    messageId: string;
    status: string;
    /** Motivo, presente solo cuando status = "failed". */
    error?: string | null;
  }) => void;
  onConversationUpdated?: (data: { conversation: unknown }) => void;
  onLabRun?: (data: {
    runId: string;
    status: string;
    progress: { done: number; total: number };
    score?: number | null;
  }) => void;
  /** Se llama tras RECONECTAR (no en la conexión inicial): catch-up con refetch. */
  onReconnect?: () => void;
};

/**
 * Suscripción SSE de la bandeja (contrato sse.md). EventSource reconecta
 * solo; el servidor no garantiza replay, así que al reconectar el consumidor
 * debe refetch con `since=` (onReconnect).
 */
export function useEvents(handlers: EventHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const source = new EventSource("/api/events");
    let hadError = false;

    const listen = <T,>(type: string, handler: (data: T) => void) => {
      source.addEventListener(type, (ev) => {
        try {
          handler(JSON.parse((ev as MessageEvent).data) as T);
        } catch {
          // evento malformado: ignorar
        }
      });
    };

    listen<MessageNewPayload>("message.new", (d) =>
      handlersRef.current.onMessageNew?.(d)
    );
    listen<Parameters<NonNullable<EventHandlers["onMessageStatus"]>>[0]>(
      "message.status",
      (d) => handlersRef.current.onMessageStatus?.(d)
    );
    listen<{ conversation: unknown }>("conversation.updated", (d) =>
      handlersRef.current.onConversationUpdated?.(d)
    );
    listen<Parameters<NonNullable<EventHandlers["onLabRun"]>>[0]>(
      "lab.run",
      (d) => handlersRef.current.onLabRun?.(d)
    );

    source.onerror = () => {
      hadError = true;
    };
    source.onopen = () => {
      if (hadError) {
        hadError = false;
        handlersRef.current.onReconnect?.();
      }
    };

    return () => source.close();
  }, []);
}
