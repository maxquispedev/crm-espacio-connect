import type { AttentionDto } from "@/lib/types";

/**
 * 013 C4 — El vocabulario OPERATIVO de la atención humana, en un solo sitio.
 *
 * Por qué un módulo y no una constante por componente: la misma conversación se
 * muestra en TRES superficies a la vez (la fila de la Bandeja, el panel del hilo y
 * la Agenda) y el requisito es que digan lo MISMO (FR-4.4). Si cada una tradujera
 * `attention.state` por su cuenta, bastaría con que una añadiera una palabra para
 * que el operador leyera "Esperando respuesta" en el hilo y "En espera" en la
 * Agenda, y la contradicción parecería un fallo de datos cuando es de copy.
 *
 * Dos reglas que este módulo NO puede violar (son del corte 1 y no se tocan):
 *
 * 1. **El reloj no se recalcula aquí.** "Vencido" no es comparar `dueAt` con la
 *    hora del navegador: llega YA derivado por el servidor en
 *    `attention.needsAttentionNow` (`deriveAttention`). Si el cliente lo
 *    recalculara, en el segundo exacto en que vence un recordatorio el chip de la
 *    lista y el grupo de la Agenda discreparían (plan §4.1).
 * 2. **La pertenencia a "humano" la decide quién tiene el control**, no la fila
 *    de atención. Es la misma regla de `humanOwnsConversation` en
 *    `src/server/inbox/attention.ts`, escrita para el cliente sobre el DTO ya
 *    resuelto. Si la IA es la dueña, no hay estado humano que enseñar por mucho
 *    que quede una fila huérfana (FR-1.10).
 */

/**
 * Los cinco estados que una persona puede leer. Deliberadamente NO son los tres
 * `attention.state` de la base: son la lectura operativa de esos tres más los dos
 * casos que la fila de atención no representa ("nadie está al mando" y "la IA
 * manda"). "Por atender" y "Recordatorio" son COMPROMISOS, no estados internos.
 */
export type EstadoOperativo =
  /** La IA responde sola: nada que hacer. */
  | "ia"
  /** Hay que actuar AHORA: o `pending`, o un recordatorio ya vencido. */
  | "por_atender"
  /** Atendida y esperando al cliente: la pelota está en su campo. */
  | "esperando_cliente"
  /** Compromiso con fecha futura: lo tengo en la Agenda. */
  | "comprometido"
  /** Del humano, sin nada pendiente ahora mismo. */
  | "atencion_humana";

/** La palabra que ve la persona. Idéntica en las tres superficies (FR-4.4). */
export const ETIQUETA_ESTADO: Record<EstadoOperativo, string> = {
  ia: "La IA responde",
  por_atender: "Por atender",
  esperando_cliente: "Esperando respuesta",
  comprometido: "Recordatorio",
  atencion_humana: "Atención humana",
};

/**
 * Qué significa ese estado en una frase, para responder "¿qué tengo que hacer
 * ahora?" sin que nadie tenga que deducirlo de un nombre de estado (FR-4.1).
 */
export const EXPLICACION_ESTADO: Record<EstadoOperativo, string> = {
  ia: "La IA está respondiendo por su cuenta.",
  por_atender: "Esta conversación necesita tu respuesta.",
  esperando_cliente: "Ya la respondiste. Ahora la pelota está con el cliente.",
  comprometido: "No hay nada que hacer por ahora: te pusiste un recordatorio.",
  atencion_humana: "La IA está en pausa aquí. Escribe cuando quieras.",
};

/** Lo mínimo de una conversación que hace falta para derivar su estado. */
export type EstadoOperativoInput = {
  attention?: AttentionDto | null;
  aiEnabled: boolean;
  handoffAt: string | null;
};

/**
 * ¿Es del humano? Handoff (la IA se paró) o IA desactivada a mano. Es la misma
 * condición que usa el servidor para permitir `Recordarme` (si aquí fuera falsa,
 * el botón aparecería y el servidor lo rechazaría con 409).
 */
export function esConversacionHumana(conversation: {
  aiEnabled: boolean;
  handoffAt: string | null;
}): boolean {
  return conversation.handoffAt !== null || conversation.aiEnabled === false;
}

/**
 * El estado visible a partir de la fila de atención, SIN mirar quién manda.
 *
 * Existe separada de `estadoOperativo` porque la Agenda solo conoce un
 * recordatorio, no una conversación entera: el item ya llega con su `state` y su
 * `needsAttentionNow`, y todos los items de la Agenda son compromisos humanos
 * (`listAgenda` solo devuelve conversaciones del humano). Así la Agenda deriva el
 * estado con la MISMA función sin tener que inventar un `ConversationDto` —ni
 * mentir con un `handoffAt` de relleno— para poder llamarla.
 */
export function estadoDeAtencion(attention: AttentionDto | null): EstadoOperativo {
  if (attention?.needsAttentionNow === true) return "por_atender";
  if (attention?.state === "waiting_client") return "esperando_cliente";
  if (attention?.state === "deferred") return "comprometido";
  return "atencion_humana";
}

/**
 * ÚNICA derivación del estado visible para una conversación. El orden importa:
 *
 * 1. La IA manda sobre todo lo demás.
 * 2. `needsAttentionNow` (vencido por el servidor) gana sobre el `state` que lo
 *    acompaña: un `deferred` vencido es "Por atender", no "Recordatorio".
 * 3. `waiting_client` y `deferred` futuro se leen tal cual.
 * 4. Sin fila de atención y del humano: "Atención humana", que no es una tarea.
 */
export function estadoOperativo(c: EstadoOperativoInput): EstadoOperativo {
  if (!esConversacionHumana(c)) return "ia";
  return estadoDeAtencion(c.attention ?? null);
}

/** La palabra de la etiqueta, sin volver a derivar el estado. */
export function etiquetaDeEstado(estado: EstadoOperativo): string {
  return ETIQUETA_ESTADO[estado];
}

/**
 * "¿Tengo algo comprometido para después?" — la segunda mitad de FR-4.3. Es la
 * definición de un compromiso con fecha VIVO, así que un recordatorio ya vencido
 * NO cuenta: ese ya está en "Por atender", que es otra pregunta.
 */
export function tieneCompromiso(c: EstadoOperativoInput): boolean {
  return estadoOperativo(c) === "comprometido";
}

/**
 * Vencidos para el contador del nav (T403). Se lee el grupo `overdue` que el
 * SERVIDOR ya calculó en `GET /api/reminders`, sin reagrupar ni recontar en el
 * cliente: es exactamente el conjunto que volvió a "Por atender", así que el
 * número del nav y el chip de la Bandeja no pueden decir cosas distintas.
 *
 * Acepta un tipo estructural para que el test no tenga que construir un
 * `AgendaDto` entero, y tolera `null` (la Agenda aún no cargó) devolviendo 0.
 */
export function vencidosDeAgenda(
  agenda: { buckets: Record<string, readonly unknown[]> } | null | undefined
): number {
  return agenda?.buckets?.overdue?.length ?? 0;
}
