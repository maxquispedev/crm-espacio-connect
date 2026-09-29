"use client";

import { useEffect, useRef, useState } from "react";
import {
  Clock3,
  MapPin,
  Paperclip,
  Send,
  UserRound,
  X,
} from "lucide-react";
import type { ConversationDto, TemplateDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatBytes, formatRemaining } from "./helpers";
import {
  AttachmentQueueList,
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
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  // 004 — Cola de adjuntos. El hook libera Object URLs al desmontar.
  const queue = useAttachmentQueue();

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

  async function apiSend(path: string, init: RequestInit): Promise<string | null> {
    const res = await fetch(path, init);
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

  async function submit() {
    if (sending) return;
    setError(null);

    // 004 (corte 1): si hay cola, envía el PRIMER pendiente. El envío
    // múltiple (todos en cadena, anti-doble-envío, estados por adjunto,
    // reintento) entra en el commit 2 con T205/T206. Mientras tanto, el
    // comportamiento es retro-compatible: cada click envía uno, igual que
    // antes.
    const head = queue.firstToSend;
    if (head) {
      setSending(true);
      const form = new FormData();
      // Si el cliente decidió re-tag (video >16MB), envía con el MIME
      // efectivo; si no, envía el MIME original del File.
      const fileToSend =
        head.effectiveMime && head.effectiveMime !== head.file.type
          ? new File([head.file], head.file.name, { type: head.effectiveMime })
          : head.file;
      form.set("file", fileToSend);
      const caption = text.trim();
      if (caption) form.set("caption", caption.slice(0, 1024));
      const err = await apiSend(
        `/api/conversations/${conversation.id}/messages/media`,
        { method: "POST", body: form }
      );
      setSending(false);
      if (err) {
        setError(err);
        return;
      }
      // Lo enviamos: lo sacamos de la cola. (El commit 2 añade estado
      // visible + retry; aquí el comportamiento es éxito ⇒ quitar.)
      queue.remove(head.id);
      // El caption solo aplica al primero; limpiar el textarea tras éxito.
      setText("");
      if (taRef.current) taRef.current.style.height = "auto";
      onSent();
      return;
    }

    const value = text.trim();
    if (!value) return;
    setSending(true);
    const err = await onSend(value);
    setSending(false);
    if (err) {
      setError(err);
      return;
    }
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
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
  const canSubmit =
    hasQueue ||
    text.trim().length > 0 ||
    panel !== null;

  /* ----------------------------------------------- */
  /* Handlers de drag & drop sobre el composer       */
  /* ----------------------------------------------- */

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragCounter.current += 1;
    setDragOver(true);
  }
  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    // Necesario para permitir el drop; sin preventDefault, el navegador
    // cancela el drop y abre el archivo en una pestaña.
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  }
  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragOver(false);
  }
  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
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
      {/* Overlay de drop — solo visible mientras hay un drag activo. */}
      {dragOver && (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-brand bg-brand/10"
          role="status"
          aria-live="polite"
        >
          <p className="rounded-md bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm">
            Suelta para adjuntar archivos
          </p>
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
      />

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

      <div className="flex items-end gap-2 rounded-md border bg-background px-3 py-2 transition-shadow focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft">
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
            className="rounded p-1.5 text-text-3 transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
          <button
            onClick={() => setPanel(panel === "location" ? null : "location")}
            aria-label="Enviar ubicación"
            title="Enviar ubicación"
            className={cn(
              "rounded p-1.5 text-text-3 transition-colors hover:bg-secondary hover:text-foreground",
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
              "rounded p-1.5 text-text-3 transition-colors hover:bg-secondary hover:text-foreground",
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
            }
          }}
          className="max-h-[120px] w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-text-3"
        />
        <button
          onClick={() => void submit()}
          disabled={sending || !canSubmit}
          aria-label="Enviar"
          className={cn(
            "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-brand text-white transition-opacity hover:bg-brand-hover",
            (sending || !canSubmit) && "opacity-40"
          )}
        >
          <Send className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        {error || rejected ? (
          <p className="text-xs text-destructive">
            {error ?? rejected}
          </p>
        ) : (
          <span />
        )}
        <p className="text-[11px] text-text-3">
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