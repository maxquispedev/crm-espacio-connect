"use client";

import { useEffect, useRef, useState } from "react";
import {
  Clock3,
  MapPin,
  Paperclip,
  Send,
  UploadCloud,
  UserRound,
  X,
} from "lucide-react";
import type { ConversationDto, TemplateDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatBytes, formatRemaining, type PendingAttachment } from "./helpers";
import {
  AttachmentQueueList,
  runQueueSend,
  useAttachmentQueue,
} from "./attachment-queue";
import { TemplateSender } from "./template-sender";

/** 008 — Panel secundario del clip: formulario de ubicación o contacto. */
type AttachPanel = "location" | "contact" | null;

/** Extrae lat,long de "21.019, -101.257" o de un enlace de Google Maps. */
function parseCoords(raw: string): { latitude: number; longitude: number } | null {
  const m =
    raw.match(/(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/) ??
    raw.match(/@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export function Composer({
  conversation,
  onSend,
  onSent,
}: {
  conversation: ConversationDto;
  onSend: (text: string) => Promise<string | null>;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [panel, setPanel] = useState<AttachPanel>(null);
  const [coordsRaw, setCoordsRaw] = useState("");
  const [placeName, setPlaceName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const [dragFilesHint, setDragFilesHint] = useState<number | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  // 004 — Anti doble-envío. Doble capa: disabled en el botón (visual) + este
  // ref (lógica). Cubre clicks programáticos y re-renders concurrentes.
  const submitInFlight = useRef(false);

  // 004 — Cola de adjuntos. El hook libera Object URLs al desmontar.
  const queue = useAttachmentQueue();
  // Refs para que `submitQueue` vea SIEMPRE el estado actual sin re-crear el
  // closure en cada render. Evita que un send en vuelo use una cola vieja.
  const queueRef = useRef(queue);
  queueRef.current = queue;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: TemplateDto[] }) => {
        if (!cancelled)
          setTemplates((d.templates ?? []).filter((t) => t.status === "approved"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function autogrow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  /** Acepta archivos desde cualquier origen (picker / drop / paste) y los añade. */
  function ingestFiles(files: File[]) {
    if (files.length === 0) return;
    const { accepted, rejected: rej } = queue.addFiles(files);
    if (accepted.length > 0) {
      setPanel(null);
      setError(null);
      // Auto-seleccionar el primero para feedback visual inmediato.
      if (!queue.selectedId) queue.select(accepted[0]!.id);
      // Lleva el foco al textarea para que el operador escriba el caption.
      requestAnimationFrame(() => taRef.current?.focus());
    }
    if (rej.length > 0) {
      setRejected(
        `${rej.length} archivo${
          rej.length === 1 ? "" : "s"
        } rechazado${rej.length === 1 ? "" : "s"}: ${rej[0]!.reason}`
      );
      // Limpia el aviso después de un rato para no contaminar el composer.
      window.setTimeout(() => setRejected(null), 4000);
    } else if (queue.attachments.length > 0) {
      // Limpia rechazos anteriores si esta tanda fue limpia.
      setRejected(null);
    }
    // Limpia el input file para permitir volver a seleccionar el mismo archivo.
    if (fileRef.current) fileRef.current.value = "";
  }

  /**
   * Envía un adjunto individual al endpoint existente. Devuelve `null` en éxito
   * o un mensaje de error legible en fallo. NO aborta el bucle del caller —
   * el caller decide si continuar con el siguiente adjunto.
   */
  async function sendOne(
    att: PendingAttachment,
    caption: string | null
  ): Promise<string | null> {
    const form = new FormData();
    // Reconstruimos el File con el MIME efectivo cuando difiere del original
    // (caso video re-taggeado a document). El servidor también acepta el File
    // tal cual cuando el override tipado `kind=document` se envía aparte.
    const fileToSend =
      att.effectiveMime && att.effectiveMime !== att.file.type
        ? new File([att.file], att.file.name, { type: att.effectiveMime })
        : att.file;
    form.set("file", fileToSend);
    // 004 — Typed contract: si el cliente decidió forzar `document`
    // (típicamente video >16MB), lo declara con el campo `kind`. El
    // servidor valida contra ALLOWED_KIND_OVERRIDES; cualquier otro valor
    // se ignora silenciosamente.
    if (att.willSendAsDocument) {
      form.set("kind", "document");
    }
    if (caption) {
      form.set("caption", caption.slice(0, 1024));
    }
    return apiSend(
      `/api/conversations/${conversation.id}/messages/media`,
      { method: "POST", body: form }
    );
  }

  async function apiSend(path: string, init: RequestInit): Promise<string | null> {
    // 004 — `fetch` puede lanzar por red caída o CORS; lo tratamos como un
    // error de envío más (no abortamos el bucle de la cola). El compositor
    // y el sender de location/contact también pasan por aquí, así que el
    // try/catch los protege igual.
    let res: Response;
    try {
      res = await fetch(path, init);
    } catch (cause) {
      return cause instanceof Error
        ? `Sin conexión con el servidor (${cause.message})`
        : "Sin conexión con el servidor";
    }
    if (res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      error?: { message?: string };
      message?: string;
    } | null;
    return (
      data?.error?.message ??
      data?.message ??
      `Error ${res.status}`
    );
  }

  /**
   * 004 — Bucle de envío de la cola. Itera secuencialmente (no en paralelo)
   * para que los mensajes lleguen en orden al hilo y para que un fallo
   * individual no rompa el resto. Cada adjunto transita por estados
   * independientes (`pending → sending → sent|failed`) y conserva su error.
   * El caption se aplica SOLO al primero que se intenta enviar.
   *
   * La lógica iterativa vive en `runQueueSend` (función pura testeable); aquí
   * se conecta con React state (refs, refs de queue, fetch real, onSent).
   *
   * Si el bucle termina con TODO enviado (sin errores y sin bloqueos),
   * limpiamos el textarea y devolvemos el foco al textarea. Si algo falló,
   * conservamos el textarea para que el operador pueda reintentar los
   * fallidos con el mismo caption.
   */
  async function submitQueue() {
    if (submitInFlight.current) return; // anti-doble-envío (capa lógica)
    const q = queueRef.current;
    if (q.readyToSend.length === 0) return;
    submitInFlight.current = true;
    setSending(true);
    setError(null);
    try {
      const caption = text.trim();
      const result = await runQueueSend({
        attachments: q.readyToSend,
        sendOne,
        onStatus: q.updateStatus,
        caption: caption || null,
      });
      // Si TODO salió bien (sin errores y sin bloqueos), limpiamos el caption.
      // Si algo falló, conservamos el textarea para que el operador pueda
      // reintentar manualmente los fallidos con el mismo texto.
      const stillBlocked = q.needsVideoAsDocumentConfirmCount > 0;
      const allDone = result.failed === 0 && !stillBlocked && result.sent > 0;
      if (allDone) {
        setText("");
        if (taRef.current) {
          taRef.current.style.height = "auto";
          // Devolvemos el foco al textarea para que el operador siga escribiendo.
          taRef.current.focus();
        }
      }
      if (result.sent > 0) onSent();
    } finally {
      submitInFlight.current = false;
      setSending(false);
    }
  }

  async function submit() {
    if (submitInFlight.current) return;
    setError(null);

    // Si hay adjuntos listos (no bloqueados), bucle de envío.
    const hasReady = queue.attachments.some(
      (a) => !a.needsVideoAsDocumentConfirm
    );
    if (hasReady) {
      await submitQueue();
      return;
    }

    const value = text.trim();
    if (!value) return;
    submitInFlight.current = true;
    setSending(true);
    try {
      const err = await onSend(value);
      if (err) {
        setError(err);
        return;
      }
      setText("");
      if (taRef.current) {
        taRef.current.style.height = "auto";
        taRef.current.focus();
      }
    } finally {
      submitInFlight.current = false;
      setSending(false);
    }
  }

  async function submitLocation() {
    const coords = parseCoords(coordsRaw);
    if (!coords) {
      setError("Coordenadas inválidas — pega «lat, long» o un enlace de Google Maps");
      return;
    }
    setSending(true);
    setError(null);
    const err = await apiSend(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "location",
        location: { ...coords, ...(placeName.trim() ? { name: placeName.trim() } : {}) },
      }),
    });
    setSending(false);
    if (err) {
      setError(err);
      return;
    }
    setPanel(null);
    setCoordsRaw("");
    setPlaceName("");
    onSent();
  }

  async function submitContact() {
    if (!contactName.trim() || contactPhone.trim().length < 5) {
      setError("El contacto necesita nombre y teléfono");
      return;
    }
    setSending(true);
    setError(null);
    const err = await apiSend(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "contacts",
        contacts: [{ name: contactName.trim(), phone: contactPhone.trim() }],
      }),
    });
    setSending(false);
    if (err) {
      setError(err);
      return;
    }
    setPanel(null);
    setContactName("");
    setContactPhone("");
    onSent();
  }

  if (!conversation.windowOpen) {
    return (
      <div className="border-t bg-background px-[18px] py-3.5">
        <div className="mb-3 flex items-start gap-2 rounded-md border border-warning-border bg-warning-soft p-3 text-sm text-warning-text">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
          <div>
            <p className="font-medium">La ventana de 24 horas está cerrada.</p>
            <p className="opacity-80">
              WhatsApp solo permite texto libre dentro de las 24 horas
              siguientes al último mensaje del cliente. Para retomar la
              conversación, envía una plantilla aprobada.
            </p>
          </div>
        </div>
        <TemplateSender conversationId={conversation.id} onSent={onSent} />
      </div>
    );
  }

  const hasQueue = queue.attachments.length > 0;
  // 004 — El botón Enviar está deshabilitado si:
  //   - hay algo en vuelo (anti-doble-envío visual)
  //   - la cola está vacía Y no hay texto Y no hay panel secundario abierto
  //   - hay adjuntos bloqueados esperando confirmación y nada más que enviar
  const onlyBlocked = queue.attachments.length > 0 && queue.readyToSend.length === 0;
  const canSubmit =
    queue.readyToSend.length > 0 ||
    (text.trim().length > 0 && !onlyBlocked) ||
    (panel !== null && !hasQueue);

  /* ----------------------------------------------- */
  /* Handlers de drag & drop sobre el composer       */
  /* ----------------------------------------------- */

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragCounter.current += 1;
    setDragOver(true);
    const count = e.dataTransfer.items?.length ?? 0;
    setDragFilesHint(count > 0 ? count : null);
  }
  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    // Necesario para permitir el drop; sin preventDefault, el navegador
    // cancela el drop y abre el archivo en una pestaña.
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  }
  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) {
      setDragOver(false);
      setDragFilesHint(null);
    }
  }
  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    setDragFilesHint(null);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) ingestFiles(files);
  }

  return (
    <div
      className="relative border-t bg-background px-[18px] pb-3.5 pt-3"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="region"
      aria-label="Área del composer; arrastra archivos para adjuntar"
    >
      {/* Overlay de drop — animado, con conteo de archivos. */}
      {dragOver && (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-brand bg-brand/15 backdrop-blur-[2px] transition-opacity"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-1.5 rounded-lg border border-brand bg-background px-4 py-3 text-sm font-medium text-foreground shadow-pop animate-in fade-in zoom-in-95 duration-150">
            <UploadCloud className="h-5 w-5 text-brand" strokeWidth={1.7} />
            <p>Suelta para adjuntar</p>
            {dragFilesHint !== null && (
              <p className="text-[11px] text-text-3">
                {dragFilesHint} archivo{dragFilesHint === 1 ? "" : "s"} detectado
                {dragFilesHint === 1 ? "" : "s"}
              </p>
            )}
          </div>
        </div>
      )}

      {templates.length > 0 && !hasQueue && panel === null && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {templates.slice(0, 4).map((t) => (
            <button
              key={t.id}
              className="rounded-full border bg-secondary px-3 py-1 text-xs font-medium text-text-2 transition-colors hover:border-brand-soft hover:bg-brand-tint hover:text-brand-text"
              onClick={() => {
                const firstName = conversation.contact.name.split(" ")[0] ?? "";
                setText(t.body.replace(/\{\{\s*1\s*\}\}/g, firstName));
                taRef.current?.focus();
                setTimeout(autogrow, 0);
              }}
              title={t.body}
            >
              {t.name.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      )}

      {/* 004 — Cola visual de adjuntos. */}
      <AttachmentQueueList
        attachments={queue.attachments}
        selectedId={queue.selectedId}
        onSelect={queue.select}
        onRemove={queue.remove}
        onClearAll={queue.clear}
        onClearSent={queue.clearSent}
        onConfirmVideoAsDocument={queue.confirmVideoAsDocument}
        onRetry={queue.retry}
        onSelectNext={queue.selectNext}
        onSelectPrev={queue.selectPrev}
      />

      {queue.needsVideoAsDocumentConfirmCount > 0 && (
        <p className="mb-2 text-[11px] text-warning-text">
          Hay {queue.needsVideoAsDocumentConfirmCount} adjunto
          {queue.needsVideoAsDocumentConfirmCount === 1 ? "" : "s"} que excede
          {queue.needsVideoAsDocumentConfirmCount === 1 ? "" : "n"} el límite de
          video. Confírmalo
          {queue.needsVideoAsDocumentConfirmCount === 1 ? "" : "s"} para enviar
          como documento.
        </p>
      )}

      {panel === "location" && (
        <div className="mb-2.5 flex flex-wrap items-end gap-2 rounded-md border bg-secondary/50 p-2.5">
          <label className="min-w-0 flex-1 text-xs text-text-2">
            Coordenadas o enlace de Google Maps
            <input
              value={coordsRaw}
              onChange={(e) => setCoordsRaw(e.target.value)}
              placeholder="21.019, -101.257"
              className="mt-1 w-full rounded border bg-background px-2 py-1.5 text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="min-w-0 flex-1 text-xs text-text-2">
            Nombre del lugar (opcional)
            <input
              value={placeName}
              onChange={(e) => setPlaceName(e.target.value)}
              placeholder="Oficina Central"
              className="mt-1 w-full rounded border bg-background px-2 py-1.5 text-sm outline-none focus:border-brand"
            />
          </label>
          <button
            onClick={() => void submitLocation()}
            disabled={sending}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-40"
          >
            Enviar ubicación
          </button>
          <button
            onClick={() => setPanel(null)}
            aria-label="Cancelar"
            className="rounded p-1 text-text-3 hover:bg-secondary"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      )}

      {panel === "contact" && (
        <div className="mb-2.5 flex flex-wrap items-end gap-2 rounded-md border bg-secondary/50 p-2.5">
          <label className="min-w-0 flex-1 text-xs text-text-2">
            Nombre
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Xavier Pérez"
              className="mt-1 w-full rounded border bg-background px-2 py-1.5 text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="min-w-0 flex-1 text-xs text-text-2">
            Teléfono
            <input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+52 462 123 4567"
              className="mt-1 w-full rounded border bg-background px-2 py-1.5 text-sm outline-none focus:border-brand"
            />
          </label>
          <button
            onClick={() => void submitContact()}
            disabled={sending}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-40"
          >
            Enviar contacto
          </button>
          <button
            onClick={() => setPanel(null)}
            aria-label="Cancelar"
            className="rounded p-1 text-text-3 hover:bg-secondary"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      )}

      <div className="flex items-end gap-1.5 rounded-md border bg-background px-2 py-1.5 transition-shadow focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            ingestFiles(files);
          }}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => fileRef.current?.click()}
            aria-label="Adjuntar archivo"
            title="Adjuntar imagen, video, audio o documento"
            className="flex h-11 w-11 items-center justify-center rounded text-text-3 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
          <button
            onClick={() => setPanel(panel === "location" ? null : "location")}
            aria-label="Enviar ubicación"
            title="Enviar ubicación"
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded text-text-3 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
              panel === "location" && "bg-secondary text-brand"
            )}
          >
            <MapPin className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
          <button
            onClick={() => setPanel(panel === "contact" ? null : "contact")}
            aria-label="Compartir contacto"
            title="Compartir contacto"
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded text-text-3 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
              panel === "contact" && "bg-secondary text-brand"
            )}
          >
            <UserRound className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
        </div>
        <textarea
          ref={taRef}
          placeholder={
            hasQueue ? "Pie del adjunto (opcional)…" : "Escribe una respuesta…"
          }
          value={text}
          rows={1}
          onChange={(e) => {
            setText(e.target.value);
            autogrow();
          }}
          onPaste={(e) => {
            // 004 — Pegar archivos del portapapeles (imagen, etc.). Si el
            // clipboard trae SOLO texto, dejamos pasar el pegado normal. Si
            // trae archivos, los añadimos a la cola y evitamos que el binario
            // se inserte como caracteres en el textarea.
            const items = Array.from(e.clipboardData?.items ?? []);
            const fileItems = items.filter((it) => it.kind === "file");
            if (fileItems.length === 0) return; // texto puro: flujo normal.
            const files = fileItems
              .map((it) => it.getAsFile())
              .filter((f): f is File => Boolean(f));
            if (files.length === 0) return;
            e.preventDefault();
            ingestFiles(files);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
              return;
            }
            // Esc con textarea vacío y cola con adjuntos no enviados: limpia
            // la cola completa (UX similar a "cancelar"). Si hay texto, sale
            // del textarea sin tocar la cola.
            if (
              e.key === "Escape" &&
              !text &&
              queue.attachments.length > 0 &&
              !sending
            ) {
              e.preventDefault();
              queue.clear();
            }
          }}
          className="max-h-[120px] w-full resize-none bg-transparent px-1 text-sm leading-relaxed outline-none placeholder:text-text-3"
        />
        <button
          onClick={() => void submit()}
          disabled={sending || !canSubmit}
          aria-label="Enviar"
          title="Enviar (Enter)"
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-brand text-white transition-opacity hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed",
            (sending || !canSubmit) && "opacity-40"
          )}
        >
          <Send className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        {error || rejected ? (
          <p
            className="truncate text-xs text-destructive"
            title={error ?? rejected ?? undefined}
          >
            {error ?? rejected}
          </p>
        ) : (
          <span />
        )}
        <p className="shrink-0 text-[11px] text-text-3">
          {hasQueue ? (
            <>
              {queue.attachments.length} adjunto
              {queue.attachments.length === 1 ? "" : "s"} ·{" "}
              {formatBytes(
                queue.attachments.reduce((acc, a) => acc + a.file.size, 0)
              )}{" "}
              · ventana abierta · quedan{" "}
              {formatRemaining(conversation.windowRemainingMs)}
            </>
          ) : (
            <>
              Ventana abierta · quedan {formatRemaining(conversation.windowRemainingMs)}
            </>
          )}
        </p>
      </div>
    </div>
  );
}