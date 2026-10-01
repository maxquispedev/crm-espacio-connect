/**
 * Sales Playbook — Piezas de formulario compartidas (Corte 4, Feature 008).
 *
 * Componentes locales del editor por bloques. Todos son *presentacionales*:
 * reciben `value` + `onChange` y no conocen la API. El orquestado de red
 * vive en `playbook-client.tsx`.
 *
 * Racional de "flechas en vez de drag-and-drop": el spec 004 pide
 * "drag-and-drop simple o flechas". Las flechas son accesibles por
 * teclado y funcionan en móvil sin librería extra, así que van primero;
 * el orden importa de verdad (prioridades primary/secondary/tertiary).
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/* ============================================================
 * FieldRow — etiqueta + control + error de validación
 * ============================================================ */

export function FieldRow({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
      {error ? (
        <p className="text-xs font-medium text-danger-text" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ============================================================
 * TextField / TextAreaField / NumberField / SwitchField
 * ============================================================ */

/**
 * Generador de `id` estable para asociar `<label htmlFor>` con el
 * control. Necesario porque los bloques se renderizan en listas
 * dinámicas y no tenemos ids fijos del servidor.
 */
let fieldIdSeq = 0;
function useFieldId(base: string): string {
  return React.useMemo(() => {
    fieldIdSeq += 1;
    return `${base}-${fieldIdSeq}`;
  }, [base]);
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  error,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  error?: string;
  placeholder?: string;
}) {
  const id = useFieldId("pb-text");
  return (
    <FieldRow label={label} htmlFor={id} hint={hint} error={error}>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
      />
    </FieldRow>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  hint,
  error,
  placeholder,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  error?: string;
  placeholder?: string;
  rows?: number;
}) {
  const id = useFieldId("pb-area");
  return (
    <FieldRow label={label} htmlFor={id} hint={hint} error={error}>
      <Textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
      />
    </FieldRow>
  );
}

/**
 * Campo numérico. Guardamos el texto crudo en el estado local del
 * editor para que el usuario pueda escribir "1" antes de "150" sin
 * que el cursor salte; el padre recibe el número parseado
 * (`Number.NaN` si está vacío o no es número, que el Zod del servidor
 * reportará como error).
 */
export function NumberField({
  label,
  value,
  onChange,
  hint,
  error,
  min = 0,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  hint?: string;
  error?: string;
  min?: number;
  step?: number;
}) {
  const id = useFieldId("pb-num");
  const [raw, setRaw] = React.useState(() => String(value));
  // Si el padre resetea el valor (refetch / descartar cambios), el input
  // tiene que reflejarlo; si no, mostraría el texto viejo.
  React.useEffect(() => {
    setRaw((prev) => (Number(prev) === value ? prev : String(value)));
  }, [value]);
  return (
    <FieldRow label={label} htmlFor={id} hint={hint} error={error}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        step={step}
        value={raw}
        onChange={(e) => {
          const text = e.target.value;
          setRaw(text);
          onChange(text === "" ? Number.NaN : Number(text));
        }}
        aria-invalid={error ? true : undefined}
      />
    </FieldRow>
  );
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  hint,
  error,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  hint?: string;
  error?: string;
}) {
  const id = useFieldId("pb-select");
  return (
    <FieldRow label={label} htmlFor={id} hint={hint} error={error}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-invalid={error ? true : undefined}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </FieldRow>
  );
}

export function SwitchField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
}) {
  const id = useFieldId("pb-switch");
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            checked ? "bg-brand" : "bg-muted"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
              checked ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
        <Label htmlFor={id} className="cursor-pointer">
          {label}
        </Label>
      </div>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/* ============================================================
 * StringListEditor — listas editables (producto, offer, prioridades…)
 * ============================================================ */

export function StringListEditor({
  label,
  items,
  onChange,
  error,
  hint,
  max,
  required = false,
  placeholder,
  /** Flechas ↑/↓ para reordenar (el orden es semántico). */
  orderable = false,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  error?: string;
  hint?: string;
  max?: number;
  required?: boolean;
  placeholder?: string;
  orderable?: boolean;
}) {
  const atMax = max !== undefined && items.length >= max;

  const setAt = (index: number, next: string) => {
    const copy = [...items];
    copy[index] = next;
    onChange(copy);
  };
  const removeAt = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const copy = [...items];
    const a = copy[index];
    const b = copy[target];
    if (a === undefined || b === undefined) return;
    copy[index] = b;
    copy[target] = a;
    onChange(copy);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label>
          {label}
          {required ? <span className="text-danger-text"> *</span> : null}
        </Label>
        <span className="text-xs text-muted-foreground">
          {hint ?? ""}
          {max !== undefined ? ` · ${items.length}/${max}` : ` · ${items.length}`}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1">
              <Input
                value={item}
                placeholder={placeholder}
                aria-label={`${label} — elemento ${i + 1}`}
                onChange={(e) => setAt(i, e.target.value)}
              />
            </div>
            {orderable ? (
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={i === 0}
                  aria-label={`Subir "${item || `elemento ${i + 1}`}"`}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={i === items.length - 1}
                  aria-label={`Bajar "${item || `elemento ${i + 1}`}"`}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </Button>
              </div>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={`Quitar "${item || `elemento ${i + 1}`}"`}
              onClick={() => removeAt(i)}
            >
              ✕
            </Button>
          </div>
        ))}
      </div>

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={atMax}
          onClick={() => onChange([...items, ""])}
        >
          + Añadir
        </Button>
        {atMax ? (
          <span className="ml-2 text-xs text-muted-foreground">
            Límite de {max} alcanzado
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="text-xs font-medium text-danger-text" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ============================================================
 * BlockSection — contenedor visual de un bloque funcional
 * ============================================================ */

export function BlockSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 sm:p-5">
      <header className="mb-4 flex flex-col gap-1">
        <h4 className="text-sm font-semibold tracking-tight">{title}</h4>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </header>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

/* ============================================================
 * Modal — overlay accesible (patrón ya usado en el repo)
 * ============================================================ */

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg rounded-lg border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-base font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}
