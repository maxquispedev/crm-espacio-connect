/**
 * Sales Playbook — Modal accesible (Feature 009, Corte 1, T914).
 *
 * Este archivo solía contener las piezas de formulario del editor por
 * bloques del Corte 4 de la 008 (`FieldRow`, `TextField`, `TextAreaField`,
 * `NumberField`, `SelectField`, `SwitchField`, `StringListEditor`,
 * `BlockSection`). Con el editor técnico JSON ya no tienen **ninguna**
 * referencia en el repo — verificado con grep, porque `tsc` no avisa de
 * exports sin usar — y se borraron.
 *
 * De toda la lista solo `Modal` sobrevive: lo usan los diálogos de
 * publicación y rollback de `playbook-client.tsx`. `BlockSection` también
 * quedó sin uso (el corte 1 lo reemplaza por las secciones de
 * `json-editor.tsx`), corrigiendo la suposición de `plan.md` §3.4.
 */

import * as React from "react";

export function Modal({
  open,
  title,
  onClose,
  className,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  /**
   * Ancho extra para el panel. El `max-w-lg` por defecto NO cambia (el
   * Laboratorio y el resto de la app dependen de él): quien necesite más
   * espacio —el historial de versiones, que es una tabla— lo pide aquí.
   */
  className?: string;
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
        className={`w-full max-w-lg rounded-lg border bg-card p-5 shadow-lg ${className ?? ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-base font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}
