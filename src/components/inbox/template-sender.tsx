"use client";

import { useEffect, useState } from "react";
import type { TemplateDto } from "@/lib/types";
import { countVariables } from "@/lib/whatsapp/template-placeholders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Selector de plantilla aprobada para conversaciones con ventana cerrada
 * (FR-005/FR-051). Sin plantillas aprobadas muestra el estado vacío.
 */
export function TemplateSender({
  conversationId,
  onSent,
}: {
  conversationId: string;
  onSent: () => void;
}) {
  const [templates, setTemplates] = useState<TemplateDto[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [values, setValues] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: TemplateDto[] }) => {
        if (!cancelled) {
          setTemplates(
            (d.templates ?? []).filter((t) => t.status === "approved")
          );
        }
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (templates === null) {
    return <p className="text-xs text-muted-foreground">Cargando plantillas…</p>;
  }

  if (templates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aún no hay plantillas aprobadas. Créalas en{" "}
        <a href="/settings/templates" className="text-brand-text hover:underline">
          Configuración → Plantillas
        </a>{" "}
        y espera la aprobación de Meta.
      </p>
    );
  }

  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const varCount = selected ? countVariables(selected.body) : 0;
  const filled = Array.from({ length: varCount }, (_, i) => values[i] ?? "");
  const missingValues = filled.some((v) => !v.trim());

  function setValueAt(index: number, next: string) {
    setValues((prev) => {
      const copy = prev.slice();
      while (copy.length <= index) copy.push("");
      copy[index] = next;
      return copy;
    });
  }

  async function send() {
    if (!selected || sending) return;
    setSending(true);
    setError(null);
    const payload: {
      templateId: string;
      variable?: string;
      variables?: string[];
    } = { templateId: selected.id };
    if (varCount === 1) {
      payload.variable = filled[0] ?? "";
    } else if (varCount > 1) {
      payload.variables = filled;
    }
    const res = await fetch(
      `/api/conversations/${conversationId}/messages/template`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    setSending(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo enviar la plantilla");
      return;
    }
    setSelectedId("");
    setValues([]);
    onSent();
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="template-select">Plantilla aprobada</Label>
        <select
          id="template-select"
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setValues([]);
          }}
          className="flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Elige una plantilla…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.language})
            </option>
          ))}
        </select>
      </div>
      {selected && (
        <p className="rounded-md bg-secondary/60 p-2.5 text-xs text-muted-foreground">
          {selected.body}
        </p>
      )}
      {filled.map((value, i) => (
        <div key={i} className="space-y-1.5">
          <Label htmlFor={`template-variable-${i + 1}`}>
            Valor de la variable {`{{${i + 1}}}`}
          </Label>
          <Input
            id={`template-variable-${i + 1}`}
            value={value}
            onChange={(e) => setValueAt(i, e.target.value)}
            placeholder={i === 0 ? "p. ej. el nombre del cliente" : undefined}
          />
        </div>
      ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button
        onClick={() => void send()}
        disabled={!selected || sending || missingValues}
      >
        {sending ? "Enviando…" : "Enviar plantilla"}
      </Button>
    </div>
  );
}
