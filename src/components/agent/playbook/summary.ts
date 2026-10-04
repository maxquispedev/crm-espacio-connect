/**
 * Sales Playbook — Helpers de presentación (Corte 4, Feature 008).
 *
 * Resúmenes que usan tanto la tarjeta de la versión publicada como el
 * editor del draft (mini-resumen del contenido y badges por clase de
 * pregunta Jev). Solo formateo: no mutan ni validan nada.
 */

import type { Config } from "@/lib/sales/playbook/schema";
import {
  JEV_QUESTION_CLASS_ICON,
  JEV_QUESTION_CLASS_LABEL,
  type JevQuestionClass,
  classifyJevQuestion,
} from "@/lib/sales/playbook/constants";

/** Símbolo de moneda por código ISO del bloque `offer`. */
const CURRENCY_SYMBOL: Record<string, string> = {
  PEN: "S/",
  USD: "$",
  MXN: "MX$",
  EUR: "€",
};

export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOL[currency] ?? currency;
}

function isFiniteNumber(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Resumen de precio en una línea:
 * `S/1,500 (una vez) + S/350/mes hasta 300 activos`.
 * Los campos con número inválido (usuario a medio escribir) se
 * omiten en vez de imprimir `NaN`.
 */
export function formatPricing(offer: Config["offer"]): string {
  const sym = currencySymbol(offer.currency);

  // Partes que se unen con " + " (los importes).
  const amounts: string[] = [];
  if (isFiniteNumber(offer.setup) && offer.setup > 0) {
    amounts.push(
      `${sym}${offer.setup.toLocaleString("es-PE")}${offer.setupIsOneTime ? " (una vez)" : " (al mes)"}`
    );
  }
  if (isFiniteNumber(offer.monthlyBase)) {
    amounts.push(`${sym}${offer.monthlyBase.toLocaleString("es-PE")}/mes`);
  }
  // El included NO es un importe: va pegado al bloque anterior ("hasta
  // N activos"), no con un "+" que lo haga parecer otro precio.
  let line = amounts.join(" + ");
  if (isFiniteNumber(offer.includedActiveStudents)) {
    const upto = `hasta ${offer.includedActiveStudents.toLocaleString("es-PE")} activos`;
    line = line.length > 0 ? `${line} ${upto}` : upto;
  }
  if (
    isFiniteNumber(offer.extraPerActiveStudent) &&
    offer.extraPerActiveStudent > 0
  ) {
    const extra = `+ ${sym}${offer.extraPerActiveStudent.toLocaleString("es-PE")} por activo extra`;
    line = line.length > 0 ? `${line} ${extra}` : extra.trimStart();
  }

  return line.length > 0 ? line : "Sin precio configurado";
}

/** Conteo de preguntas Jev por clase (para los badges). */
export function countJevByClass(
  questions: Config["jev_questions"]
): Record<JevQuestionClass, number> {
  const counts: Record<JevQuestionClass, number> = {
    "engine-required": 0,
    "known-signal": 0,
    analytical: 0,
  };
  for (const key of Object.keys(questions)) {
    counts[classifyJevQuestion(key)] += 1;
  }
  return counts;
}

export function jevClassIcon(cls: JevQuestionClass): string {
  return JEV_QUESTION_CLASS_ICON[cls];
}

export function jevClassLabel(cls: JevQuestionClass): string {
  return JEV_QUESTION_CLASS_LABEL[cls];
}

/** Fecha legible; `null` → "—". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-PE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Bytes → "12.4 kB" (sirve para el tamaño del config en el historial). */
export function formatBytes(bytes: number | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
