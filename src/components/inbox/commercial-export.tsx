"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function CommercialExport() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function download(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const form = new FormData(event.currentTarget);
    busy.current = true;
    setLoading(true); setError(null); setDone(false);
    try {
      const sourceId = String(form.get("source_id") ?? "").trim();
      const response = await fetch("/api/commercial-export", {
        method: "POST", signal: AbortSignal.timeout(60000), headers: { "content-type": "application/json" },
        body: JSON.stringify({ date_from: form.get("date_from"), date_to: form.get("date_to"),
          ad_attributed_only: form.get("ads") === "on", source_ids: sourceId ? [sourceId] : [] }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        throw new Error(failure?.error?.message ?? "No se pudo generar el export. Reintenta.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1]
        ?? "espacio-connect-commercial-export.json";
      document.body.appendChild(anchor);
      anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDone(true);
    } catch (failure) {
      setError(failure instanceof TypeError ? "Sin conexión con el servidor. Reintenta."
        : failure instanceof DOMException ? "La descarga tardó demasiado. Reintenta."
        : failure instanceof Error ? failure.message : "No se pudo descargar. Reintenta.");
    } finally { busy.current = false; setLoading(false); }
  }

  return (
    <div className="border-b px-4 py-2">
      <Button variant="ghost" size="sm" aria-expanded={open} aria-controls="commercial-export-form"
        onClick={() => setOpen(!open)}>Exportar dataset comercial</Button>
      {open && <form id="commercial-export-form" onSubmit={download} className="mt-2 space-y-3 text-xs">
        <p className="text-text-3">Conversaciones creadas entre estas fechas (America/Lima, ambos días incluidos).
          Incluye su historial completo. El texto del chat se conserva.</p>
        <fieldset disabled={loading} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label>Desde<input name="date_from" type="date" required className="mt-1 w-full rounded border bg-background p-2" /></label>
            <label>Hasta<input name="date_to" type="date" required className="mt-1 w-full rounded border bg-background p-2" /></label>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" name="ads" />Solo conversaciones provenientes de anuncios</label>
          <label className="block">ID de anuncio / origen (opcional)
            <input name="source_id" maxLength={128} className="mt-1 w-full rounded border bg-background p-2" />
          </label>
          <Button type="submit" size="sm">{loading ? "Generando…" : "Descargar JSON"}</Button>
        </fieldset>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
        {done && <p role="status">JSON descargado.</p>}
      </form>}
    </div>
  );
}
