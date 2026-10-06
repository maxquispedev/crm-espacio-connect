"use client";

import { CommercialExport } from "./commercial-export";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, PanelRight } from "lucide-react";
import { cn, formatPhone } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import type { ConversationDto, MessageDto } from "@/lib/types";
import { useEvents } from "@/components/use-events";
import { ConversationList } from "./conversation-list";
import { MessageThread } from "./message-thread";
import { Composer } from "./composer";
import { ContactPanel } from "./contact-panel";
import { EstadoOperacionalChip } from "./estado-chip";
import { applyContactNamePatch } from "./conversation-patch";

export function InboxClient() {
  const [conversations, setConversations] = useState<ConversationDto[] | null>(
    null
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);
  // Se incrementa con cada evento SSE que puede cambiar la etapa/lead o el
  // estado del agente: el panel de detalles lo observa y refetch en vivo.
  const [detailRev, setDetailRev] = useState(0);
  // 014 C8 — Fallo de la carga de la lista, con su mensaje. Antes solo existía
  // `conversations === null` (cargando), que un error dejaba Definitivamente.
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    setPanelOpen(localStorage.getItem("vocero.panelOpen") !== "false");
  }, []);
  const togglePanel = useCallback((open: boolean) => {
    setPanelOpen(open);
    localStorage.setItem("vocero.panelOpen", String(open));
  }, []);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const lastFetchRef = useRef<string | null>(null);

  const refetchConversations = useCallback(async () => {
    const res = await fetch("/api/conversations").catch(() => null);
    // 014 C8 — Un fallo de red aquí ya no es invisible. Antes `return` a secas y
    // `conversations` se quedaba en `null`, así que la lista pintaba "Cargando…"
    // PARA SIEMPRE: la pantalla se quedaba en un estado de carga eterno que no
    // acababa nunca, sin un solo palabra de por qué. Un estado de carga que no
    // termina no es "cargando", es un fallo (FR-8.3).
    if (!res) {
      setListError("Sin conexión con el servidor");
      return;
    }
    if (!res.ok) {
      setListError("No se pudo cargar la bandeja");
      return;
    }
    const data = (await res.json()) as { conversations: ConversationDto[] };
    setConversations(data.conversations);
    setListError(null);
    lastFetchRef.current = new Date().toISOString();
  }, []);

  const refetchMessages = useCallback(async (conversationId: string) => {
    const res = await fetch(
      `/api/conversations/${conversationId}/messages`
    ).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { messages: MessageDto[] };
    if (selectedIdRef.current === conversationId) setMessages(data.messages);
  }, []);

  useEffect(() => {
    void refetchConversations();
  }, [refetchConversations]);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      setMessages([]);
      setVista("hilo");
      void refetchMessages(id);
      void fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markRead: true }),
      });
    },
    [refetchMessages]
  );

  // Enlace directo desde Contactos/Pipeline: /inbox?contact=<id>
  const searchParams = useSearchParams();
  const contactParam = searchParams.get("contact");
  // 014 C8 — La apertura automática ocurre UNA vez por enlace. Sin este registro,
  // en móvil el botón "volver" (que solo despeja la vista, sin deseleccionar de
  // verdad) se deshacía solo: el siguiente refetch por SSE volvía a abrir el hilo
  // y el usuario quedaba atrapado en la conversación que acababa de cerrar.
  const autoAbiertoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!contactParam || selectedIdRef.current) return;
    if (autoAbiertoRef.current === contactParam) return;
    const match = conversations?.find((c) => c.contact.id === contactParam);
    if (!match) return;
    autoAbiertoRef.current = contactParam;
    select(match.id);
  }, [contactParam, conversations, select]);

  /**
   * 014 C8 — Qué se ve en MÓVIL, que son tres pantallas y no caben de lado. En
   * escritorio las tres conviven y este estado no se mira: es lo que permite que
   * un móvil de 375 px tenga la Bandeja completa en vez de 360 px de lista y 15 px
   * de hilo. Es SOLO vista: no marca leído, no deselecciona y no toca nada, que
   * es lo que espera quien pulsa "atrás".
   */
  const [vista, setVista] = useState<"lista" | "hilo" | "detalle">("lista");
  const volverALista = useCallback(() => setVista("lista"), []);
  const abrirDetalles = useCallback(() => {
    togglePanel(true);
    setVista("detalle");
  }, [togglePanel]);
  const cerrarDetalles = useCallback(() => {
    togglePanel(false);
    setVista("hilo");
  }, [togglePanel]);

  useEvents({
    onMessageNew: ({ conversationId, message }) => {
      if (selectedIdRef.current === conversationId) {
        setMessages((prev) =>
          prev.some((x) => x.id === message.id) ? prev : [...prev, message]
        );
        void fetch(`/api/conversations/${conversationId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ markRead: true }),
        });
      }
      void refetchConversations();
      // Un entrante nuevo puede crear/mover el lead: refresca el panel.
      setDetailRev((v) => v + 1);
    },
    onMessageStatus: ({ conversationId, messageId, status, error }) => {
      if (selectedIdRef.current !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                status: status as MessageDto["status"],
                error: error ?? null,
              }
            : m
        )
      );
    },
    onConversationUpdated: () => {
      void refetchConversations();
      // El agente movió de etapa o cambió el handoff: refresca el panel en vivo.
      setDetailRev((v) => v + 1);
    },
    onReconnect: () => {
      // Catch-up tras reconexión (contrato sse.md): refetch completo.
      void refetchConversations();
      if (selectedIdRef.current) void refetchMessages(selectedIdRef.current);
      setDetailRev((v) => v + 1);
    },
  });

  const selected = conversations?.find((c) => c.id === selectedId) ?? null;

  const sendText = useCallback(
    async (text: string): Promise<string | null> => {
      if (!selectedIdRef.current) return "Sin conversación seleccionada";
      const res = await fetch(
        `/api/conversations/${selectedIdRef.current}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        }
      ).catch(() => null);
      if (!res) return "Sin conexión con el servidor";
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        return data?.error?.message ?? "No se pudo enviar el mensaje";
      }
      if (selectedIdRef.current) void refetchMessages(selectedIdRef.current);
      void refetchConversations();
      return null;
    },
    [refetchMessages, refetchConversations]
  );

  /**
   * 014 C8 — Devuelve el mensaje de error o `null` si salió bien. Antes devolvía
   * `void` y se tragaba el resultado del PATCH: si "Reactivar IA" fallaba, el
   * botón se quedaba pulsado, no cambiaba nada y la persona no se enteraba. Una
   * acción que falla en silencio es peor que una que avisa, porque parece que
   * funcionó. `null` = correcto, texto = qué pasó (el que lo llama decide dónde
   * mostrarlo: el bloque de atención ya tiene su línea de error).
   */
  const patchConversation = useCallback(
    async (patch: { aiEnabled?: boolean; reactivate?: boolean }): Promise<string | null> => {
      if (!selectedIdRef.current) return "Sin conversación seleccionada";
      const res = await fetch(`/api/conversations/${selectedIdRef.current}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => null);
      if (!res) return "Sin conexión con el servidor";
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        return data?.error?.message ?? "No se pudo actualizar la conversación";
      }
      void refetchConversations();
      return null;
    },
    [refetchConversations]
  );

  // 005 — Tras un rename exitoso desde el panel, sincroniza el `contact.name`
  // en el array de conversaciones (panel, header del hilo, lista izquierda) con
  // un patch in-place. Evita el refetch (latencia + race con SSE — ver
  // specs/005-quick-lead-name/plan.md §D-1).
  const onContactUpdated = useCallback(
    ({ id, name }: { id: string; name: string }) => {
      setConversations((prev) => applyContactNamePatch(prev ?? [], { id, name }));
    },
    []
  );

  return (
    <div className="flex h-full">
      {/* 014 C8 — En móvil, la lista ocupa la pantalla entera (`w-full`); desde
          `md` recupera su columna de 360 px y el hilo vuelve a estar al lado. */}
      <section
        data-testid="bandeja-lista"
        className={cn(
          "shrink-0 overflow-hidden border-r md:w-[360px]",
          vista === "lista" ? "flex w-full flex-col" : "hidden md:flex md:flex-col"
        )}
      >
        <CommercialExport />
        <div className="min-h-0 flex-1">
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            onSelect={select}
            onSeeded={() => void refetchConversations()}
            error={listError}
            onRetry={() => void refetchConversations()}
          />
        </div>
      </section>

      <section
        data-testid="bandeja-hilo"
        className={cn(
          "min-w-0 flex-1 flex-col",
          vista === "lista" ? "hidden md:flex" : "flex"
        )}
      >
        {selected ? (
          <>
            <header className="flex items-center justify-between gap-3 border-b bg-background px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-3">
                {/* 014 C8 — "Atrás" solo en móvil: en escritorio el hilo está al
                    lado de la lista y volver sería un botón sin destino. */}
                <button
                  type="button"
                  onClick={volverALista}
                  data-testid="hilo-volver"
                  aria-label="Volver a la lista de conversaciones"
                  className="-ml-1 shrink-0 rounded-sm p-1.5 text-text-3 transition-colors hover:bg-accent hover:text-foreground md:hidden"
                >
                  <ChevronLeft className="h-4 w-4" strokeWidth={1.7} />
                </button>
                <ContactAvatar
                  name={selected.contact.name}
                  seed={selected.contact.id}
                  size="md"
                />
                <div className="min-w-0">
                  {/* 014 C7 — El nombre manda y el estado lo acompaña. Con el panel
                      de detalles plegado, el estado de la conversación abierta era
                      invisible: había que abrirlo para saber si había trabajo
                      pendiente. Ahora se lee en la cabecera, con la misma etiqueta y
                      el mismo `data-estado` que la fila de la lista (FR-7.7). */}
                  <p className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-[650] leading-tight">
                      {selected.contact.name}
                    </span>
                    <EstadoOperacionalChip
                      conversacion={selected}
                      testId="hilo-estado"
                    />
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-xs",
                      selected.windowOpen ? "font-medium text-success" : "text-text-3"
                    )}
                  >
                    {selected.windowOpen
                      ? "ventana abierta"
                      : formatPhone(selected.contact.phone)}
                  </p>
                </div>
              </div>
              {/* 014 C8 — El botón de detalles aparece en los dos casos en los que
                  los detalles NO se ven: cuando el panel está plegado (escritorio y
                  móvil) y cuando se está viendo el hilo en móvil con el panel
                  "abierto" pero fuera de pantalla.

                  Ese segundo caso es un callejón sin salida que este corte
                  encontró ejecutando el E2E: `panelOpen` nace en `true`, así que el
                  botón solo se pintaba con `!panelOpen` y, en un móvil, la
                  conversación se abría sin ninguna manera de llegar a los
                  detalles. Con `md:hidden` cuando el panel ya está abierto, el
                  mismo botón cubre los dos casos y desaparece solo donde no
                  hace falta. Es CSS, no un `matchMedia`: el estado de la vista no
                  puede depender de medir la pantalla durante el render. */}
              {(!panelOpen || vista === "hilo") && (
                <button
                  onClick={abrirDetalles}
                  aria-label="Mostrar detalles"
                  // Si el botón se está viendo es porque los detalles están
                  // plegados: nunca puede ser `true` mientras exista.
                  aria-expanded={false}
                  className={cn(
                    "rounded-sm border p-1.5 text-text-3 hover:bg-accent hover:text-foreground",
                    panelOpen && "md:hidden"
                  )}
                >
                  <PanelRight className="h-4 w-4" strokeWidth={1.7} />
                </button>
              )}
            </header>
            <MessageThread messages={messages} />
            <Composer
              conversation={selected}
              onSend={sendText}
              onSent={() => {
                if (selectedIdRef.current)
                  void refetchMessages(selectedIdRef.current);
                void refetchConversations();
              }}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center bg-chat text-sm text-text-3">
            Elige una conversación para ver el hilo
          </div>
        )}
      </section>

      <section
        data-testid="bandeja-detalles"
        className={cn(
          "shrink-0 overflow-hidden border-l transition-[width] duration-[220ms]",
          vista === "detalle"
            ? "w-full md:w-[320px]"
            : panelOpen && selected
              ? "w-[320px]"
              : "w-0 border-l-0",
          // En móvil el panel tapaba el hilo: 320 px de detalles sobre 375 px de
          // pantalla dejaban la conversación fuera de pantalla.
          vista === "detalle" ? "flex" : "hidden md:block",
          !panelOpen && vista !== "detalle" && "border-l-0"
        )}
      >
        {selected && (
          <div className="h-full w-full md:w-[320px]" key={selected.contact.id}>
            <ContactPanel
              conversation={selected}
              refreshKey={detailRev}
              onPatchConversation={patchConversation}
              onContactUpdated={onContactUpdated}
              onAttentionChanged={() => void refetchConversations()}
              onClose={cerrarDetalles}
            />
          </div>
        )}
      </section>
    </div>
  );
}
