/**
 * 013 C2 — "Por atender" como COLA DE TRABAJO, no como una vista de lectura.
 *
 * Por qué es un módulo puro y no lógica dentro del componente: el conteo del
 * chip y el listado tienen que ser **la misma cosa por construcción** (FR-2.7).
 * Aquí se calcula cada subconjunto UNA vez y el chip usa su `.length`; es
 * imposible que se separen porque salen de la misma operación.
 *
 * La definición de "requiere acción humana ahora" NO se reimplementa aquí: llega
 * ya derivada del servidor en `conversation.attention.needsAttentionNow`
 * (`deriveAttention`, `src/server/inbox/attention.ts`). Este módulo solo la lee.
 * Si alguien decidiera que "pendiente" es otra cosa, se decide en el servidor,
 * una sola vez, no en dos capas.
 *
 * NO usa `unreadCount` ni la etapa del pipeline (spec §2.1, FR-2.3): "No leídas"
 * responde "¿qué no vi?" y esta cola responde "¿qué hago?".
 */
import type { ConversationDto } from "@/lib/types";
import { cuentaComoAnuncio } from "@/lib/anuncios";
import { matchesQuery } from "@/lib/search";

/**
 * Filtros de la fila de la Bandeja. `por_atender` es el primero de la fila
 * porque es la pregunta con la que arranca el día el operador (FR-4.3). Los
 * otros tres conservan su significado previo intacto (FR-2.6).
 */
export type FiltroBandeja = "por_atender" | "all" | "unread" | "ads";

export type ResumenBandeja = {
  /** Lo que se pinta, ya filtrado por búsqueda + etapa + filtro. */
  visibles: ConversationDto[];
  /** Tamaño de la cola "Por atender" sobre la vista actual. */
  porAtender: number;
  noLeidas: number;
  anuncios: number;
  /** Total tras búsqueda y etapa (lo que muestra "Todas"). */
  total: number;
};

/**
 * ÚNICA definición de la cola. Deliberadamente trivial: no mira `unreadCount`,
 * ni `stageName`, ni `handoffAt`. Si una conversación está `waiting_client` o
 * tiene un recordatorio aún futuro, el servidor ya marcó
 * `needsAttentionNow: false` y aquí no se debate.
 */
export function necesitaAtencionAhora(c: ConversationDto): boolean {
  return c.attention?.needsAttentionNow === true;
}

/**
 * Resumen de la Bandeja para un filtro. Puro y sin estado: la lista es cliente
 * igual que hoy (`all`/`unread`/`ads`), sin endpoint propio para "Por atender" —
 * un endpoint nuevo además de sobrearquitectura, rompería la reactividad SSE
 * (plan §4.1).
 *
 * El orden de composición es el de siempre: búsqueda (nombre/teléfono) y después
 * etapa; los contadores de los tres chips se miden sobre ese mismo resultado
 * para que sean coherentes con lo que el usuario está mirando.
 */
export function resumirBandeja(
  conversations: readonly ConversationDto[],
  opciones: { query?: string; stage?: string; filter?: FiltroBandeja } = {}
): ResumenBandeja {
  const query = opciones.query ?? "";
  const stage = opciones.stage ?? "all";
  const filter = opciones.filter ?? "all";

  const searched = conversations.filter(
    (c) =>
      // Solo NOMBRE y TELÉFONO, como cualquier filtro de contactos. Antes también
      // miraba el preview, y como el agente nombra al dueño en sus propios
      // mensajes, buscar ese nombre devolvía media bandeja. Encima era una
      // búsqueda de mensajes a medias: solo el último de cada hilo, no el
      // historial. Este módulo conserva ese alcance tal cual (FR-2.6).
      matchesQuery(query, {
        text: [c.contact.name],
        phone: c.contact.phone,
      }) && (stage === "all" || c.stageName === stage)
  );

  // Cada subconjunto se calcula UNA vez; los contadores salen de aquí.
  const cola = searched.filter(necesitaAtencionAhora);
  const sinLeer = searched.filter((c) => c.unreadCount > 0);
  const deAnuncio = searched.filter((c) => cuentaComoAnuncio(c.anuncio));

  const visibles =
    filter === "por_atender"
      ? cola
      : filter === "unread"
        ? sinLeer
        : filter === "ads"
          ? deAnuncio
          : searched;

  return {
    visibles,
    porAtender: cola.length,
    noLeidas: sinLeer.length,
    anuncios: deAnuncio.length,
    total: searched.length,
  };
}
