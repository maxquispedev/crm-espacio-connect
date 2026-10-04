"use client";

import { AlertCircle, Bell, UserRound } from "lucide-react";
import type { ConversationDto } from "@/lib/types";
import { ETIQUETA_ESTADO, estadoOperativo } from "@/lib/operational-state";
import { cn } from "@/lib/utils";

/**
 * 014 C7 — La ETIQUETA del estado operativo, en un solo sitio.
 *
 * Antes había tres copias del mismo texto, icono y color: la fila de la lista
 * (`conversation-list.tsx`), el chip del bloque del panel (`attention-state`) y la
 * cabecera del hilo. Cuando hay copias, un rediseño las separa —la fila decía una
 * cosa y el panel otra— y el operador tenía que decidir cuál mentía. Aquí se
 * decide UNA vez, en `EstadoPill`, y las tres superficies la importan. Las tres
 * siguen hablando de `estadoOperativo`, que es la única fuente de verdad (FR-4.4).
 *
 * 013 C4 — El texto sale de `ETIQUETA_ESTADO`, el mismo vocabulario que usa la
 * Agenda. Con la IA al mando no se pinta nada: una etiqueta "La IA responde" en
 * cada fila no informa de nada, solo ocupa.
 *
 * 014 C7 — El tono distingue tres cosas que antes se confundían: `por_atender` es
 * rojo (hay trabajo AHORA), `comprometido` es ámbar (hay trabajo más adelante) y
 * `esperando_cliente` es neutro (nada pendiente, que es lo que el propio copy de
 * "Atención humana" define). El `data-estado` no se negocia: es el vocabulario
 * operativo que comprueban los tests y el que leen las otras superficies.
 */
export function EstadoPill({
  estado,
  testId,
  className,
}: {
  estado: NonNullable<ReturnType<typeof estadoOperativo>>;
  testId?: string;
  className?: string;
}) {
  const urgente = estado === "por_atender";
  const comprometido = estado === "comprometido";
  const Icon = urgente ? AlertCircle : comprometido ? Bell : UserRound;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        urgente
          ? "border-danger-border bg-danger-soft text-danger-text"
          : comprometido
            ? "border-warning-border bg-warning-soft text-warning-text"
            : "border-border-strong bg-secondary text-text-2",
        className
      )}
      data-testid={testId}
      data-estado={estado}
    >
      <Icon className="h-3 w-3" strokeWidth={1.7} />
      {ETIQUETA_ESTADO[estado]}
    </span>
  );
}

/**
 * Envoltura para las superficies que tienen la conversación a mano. Con la IA al
 * mando no se pinta nada (mismo criterio que siempre: ver el comentario de arriba).
 * El `testId` se pasa porque cada superficie necesita el suyo sin que el texto
 * cambie de una a otra.
 */
export function EstadoOperacionalChip({
  conversacion,
  testId = "fila-estado",
  className,
}: {
  conversacion: ConversationDto;
  testId?: string;
  className?: string;
}) {
  const estado = estadoOperativo(conversacion);
  if (estado === "ia") return null;
  return <EstadoPill estado={estado} testId={testId} className={className} />;
}
