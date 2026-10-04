import { desc, eq, inArray, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { AttentionDto } from "@/lib/types";

/**
 * 013 Corte 1 - Estado operativo de la atención humana.
 *
 * Es un concepto de OPERACIÓN, no de canal: por eso es una tabla dedicada y no
 * columnas en `conversation` (plan §3.1). Lo que este módulo NO es:
 *
 * - **No** es el motor automático de follow-ups. `sales_follow_up_job` sigue
 *   siendo el motor; `conversation_attention` es una fila por conversación con
 *   tres estados operativos (plan §5, D-2, D-3). Aquí no hay cadencia, ni lane,
 *   ni `automationLane`, ni worker, ni `followUpCount/Reason`, ni los errores
 *   `human_lane`/`handoff_active` (FR-1.9 intacto).
 * - **No** envía nada. Un recordatorio es un estado que Max ve en la Agenda
 *   (corte 3); jamás produce un mensaje a Graph. Nada en este archivo llama al
 *   sender, a plantillas ni al store de follow-ups, y nada aquí se agenda en el
 *   worker. `scheduleHumanReminder` es un UPDATE.
 * - **No** vence por proceso. `deferred` con `due_at <= now()` es un recordatorio
 *   VENCIDO, derivado en cada lectura (plan §3.3, D-5). Sin cron, sin lease, sin
 *   proceso que corra para "activar" nada.
 *
 * Reglas de estado (spec §3.4):
 * | Disparador | Efecto |
 * |---|---|
 * | handoff a humano (IA) | `pending` |
 * | inbound del cliente con la conversación en humano | `pending` |
 * | respuesta del dueño (echo o desde el CRM) | `waiting_client` |
 * | "recordar el jueves" | `deferred(due_at, note)` |
 * | reactivar la IA | limpia |
 * | lead a `cliente`/`perdido` | limpia |
 * | `markRead` / abrir la conversación | **no toca nada** |
 */

type AttentionRow = typeof schema.conversationAttention.$inferSelect;
type ConversationRow = typeof schema.conversation.$inferSelect;

/** Estados de la fila de atención. `deferred` es el único que lleva `dueAt`. */
export type AttentionState = AttentionRow["state"];

/**
 * Largo máximo de la nota del recordatorio. El endpoint lo valida con Zod; el
 * módulo también recorta, para que ninguna otra vía (script, seed futuro) pueda
 * escribir una nota infinita. La nota nunca se interpola en SQL ni se loguea.
 */
export const ATTENTION_NOTE_MAX_LENGTH = 280;

export type AttentionView = {
  id: string;
  conversationId: string;
  state: AttentionState;
  /** ISO-8601; solo presente en `deferred` (CHECK de coherencia en BD). */
  dueAt: string | null;
  note: string | null;
  /** `pending`, o `deferred` ya vencido: el cliente espera y no hay promesa viva. */
  needsAttentionNow: boolean;
  /** El dueño respondió y la pelota está en el cliente. */
  waitingClient: boolean;
  /** `deferred` con `due_at` en el futuro. */
  scheduled: boolean;
  /** `deferred` con `due_at <= now()`. Derivado, nunca persistido. */
  overdue: boolean;
};

/** Fallos de una acción explícita del operador (los eventos son no-op silencioso). */
export type AttentionErrorCode =
  | "conversation_not_found"
  | "ai_owns_conversation"
  | "due_in_past"
  | "no_reminder"
  | "not_scheduled";

/**
 * 013 C3 — Resultado de cancelar un recordatorio humano. Explícito en vez de
 * excepción: `DELETE` necesita distinguir 404 (no hay nada que cancelar) de 409
 * (hay trabajo humano VIVO que no es un recordatorio y no se puede borrar).
 */
export type CancelReminderResult =
  | { ok: true; conversationId: string; cancelled: boolean }
  | { ok: false; error: AttentionErrorCode };

export class AttentionError extends Error {
  readonly code: AttentionErrorCode;
  constructor(code: AttentionErrorCode, message: string) {
    super(message);
    this.name = "AttentionError";
    this.code = code;
  }
}

/**
 * FR-1.10 - la atención humana solo existe mientras la IA NO es la dueña de la
 * conversación. La conversación está en humano si hubo handoff (`handoffAt`) o
 * si el dueño desactivó la IA (spec §3.4: "desactivar la IA -> pending: la
 * conversación pasa a ser del humano, así que requiere acción"). Un handoff sin
 * IA desactivada sigue siendo humano: la IA no vuelve sola (011/FR-015), solo
 * por `reactivate`, que limpia.
 */
function humanOwnsConversation(conversation: {
  handoffAt: Date | null;
  aiEnabled: boolean;
}): boolean {
  return conversation.handoffAt !== null || conversation.aiEnabled === false;
}

/**
 * Deriva los flags de lectura en UN solo lugar (plan §3.3): el vencimiento es
 * una comparación con `now`, no un estado. Los cortes 2/3 reutilizan esta
 * función también para el LEFT JOIN del DTO.
 */
export function deriveAttention(
  row: AttentionRow,
  now: Date = new Date()
): AttentionView {
  const due = row.dueAt ? new Date(row.dueAt) : null;
  const overdue =
    row.state === "deferred" && due !== null && due.getTime() <= now.getTime();
  return {
    id: row.id,
    conversationId: row.conversationId,
    state: row.state,
    dueAt: due ? due.toISOString() : null,
    note: row.note,
    needsAttentionNow: row.state === "pending" || overdue,
    waitingClient: row.state === "waiting_client",
    scheduled: row.state === "deferred" && !overdue,
    overdue,
  };
}

/**
 * Proyección al DTO de la lista (plan §4.1): solo los cuatro campos que la
 * Bandeja necesita, y con `needsAttentionNow` YA derivado por `deriveAttention`.
 *
 * Existe para que el vencimiento se calcule en UN solo sitio (este módulo) y el
 * cliente solo lo lea. Si el cliente reinterpretara `state`/`dueAt` por su cuenta,
 * el conteo del chip y el listado dejarían de garantizar la misma definición
 * (FR-2.7).
 */
export function resumenAtencion(view: AttentionView | null): AttentionDto | null {
  if (!view) return null;
  return {
    state: view.state,
    dueAt: view.dueAt,
    note: view.note,
    needsAttentionNow: view.needsAttentionNow,
  };
}

/**
 * Carga la conversación en el scope de la organización. `null` si no existe o
 * si es de otra organización: una conversación ajena es INVISIBLE, no un error.
 */
async function loadConversation(
  organizationId: string,
  conversationId: string
): Promise<ConversationRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Confirma que la conversación admite atención humana antes de escribir.
 * No-op silencioso (nunca lanza) en los enganches: un evento legítimo, como un
 * inbound con la IA activa, no es un error (plan §3.5).
 */
async function loadHumanConversation(
  organizationId: string,
  conversationId: string
): Promise<ConversationRow | null> {
  const conversation = await loadConversation(organizationId, conversationId);
  // El Laboratorio (is_test) no entra en el modelo de operación (plan §3.4).
  if (!conversation || conversation.isTest) return null;
  return humanOwnsConversation(conversation) ? conversation : null;
}

/** Igual que arriba, pero distinguiendo "no existe/de otro tenant" de "IA es la dueña". */
async function humanConversationOrThrow(
  organizationId: string,
  conversationId: string
): Promise<ConversationRow> {
  const conversation = await loadConversation(organizationId, conversationId);
  if (!conversation) {
    throw new AttentionError(
      "conversation_not_found",
      `conversación no encontrada en la organización: ${conversationId}`
    );
  }
  if (conversation.isTest) {
    throw new AttentionError(
      "ai_owns_conversation",
      "las conversaciones del Laboratorio no tienen atención humana"
    );
  }
  if (!humanOwnsConversation(conversation)) {
    throw new AttentionError(
      "ai_owns_conversation",
      "la IA es la dueña de la conversación: no hay atención humana que registrar"
    );
  }
  return conversation;
}

function normalizeNote(note: string | null | undefined): string | null {
  if (note === null || note === undefined) return null;
  const flat = note.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return null;
  return flat.slice(0, ATTENTION_NOTE_MAX_LENGTH).trim();
}

/**
 * Upsert idempotente por (organization_id, conversation_id): programar otro
 * recordatorio reemplaza al anterior y repetir la misma operación NO duplica
 * fila ni crea un compromiso nuevo (D-6). `createdAt`/`id` se conservan;
 * `dueAt` y `note` viajan siempre con el estado para no violar el CHECK de
 * coherencia.
 */
async function upsertAttention(input: {
  organizationId: string;
  conversationId: string;
  state: AttentionState;
  dueAt: Date | null;
  note: string | null;
}): Promise<AttentionView> {
  const db = getDb();
  const now = new Date();
  const inserted = await db
    .insert(schema.conversationAttention)
    .values({
      id: newId("conversationAttention"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      state: input.state,
      dueAt: input.dueAt,
      note: input.note,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.conversationAttention.organizationId,
        schema.conversationAttention.conversationId,
      ],
      set: {
        state: input.state,
        dueAt: input.dueAt,
        note: input.note,
        updatedAt: now,
      },
    })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new Error("no se pudo registrar la atención de la conversación");
  }
  return deriveAttention(row, now);
}

/** Lectura de una fila de atención, tenant-scoped. `null` si no existe. */
export async function getAttention(
  organizationId: string,
  conversationId: string,
  now: Date = new Date()
): Promise<AttentionView | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.conversationAttention)
    .where(
      scoped(
        schema.conversationAttention.organizationId,
        organizationId,
        eq(schema.conversationAttention.conversationId, conversationId)
      )
    )
    .limit(1);
  const row = rows[0];
  return row ? deriveAttention(row, now) : null;
}

/**
 * Listado tenant-scoped para "Por atender" y la Agenda (cortes 2/3). Opcionalmente
 * filtrado por estado; el orden es "tocado más recientemente" y no implica ninguna
 * cola de trabajo ni proceso detrás.
 */
export async function listAttention(
  organizationId: string,
  filter: { states?: readonly AttentionState[] } = {},
  now: Date = new Date()
): Promise<AttentionView[]> {
  const db = getDb();
  const conditions: (SQL | undefined)[] = [];
  if (filter.states && filter.states.length > 0) {
    conditions.push(
      inArray(schema.conversationAttention.state, [...filter.states])
    );
  }
  const rows = await db
    .select()
    .from(schema.conversationAttention)
    .where(
      scoped(
        schema.conversationAttention.organizationId,
        organizationId,
        ...conditions
      )
    )
    .orderBy(desc(schema.conversationAttention.updatedAt));
  return rows.map((row) => deriveAttention(row, now));
}

/**
 * El cliente escribió y la conversación es del humano: vuelve a `pending` y el
 * recordatorio previo deja de aplicar (spec §3.2 pasos 4-6). No-op si la IA es
 * la dueña, si es del Laboratorio o si la conversación no existe en esta
 * organización.
 */
export async function markAttentionPending(input: {
  organizationId: string;
  conversationId: string;
}): Promise<AttentionView | null> {
  const conversation = await loadHumanConversation(
    input.organizationId,
    input.conversationId
  );
  if (!conversation) return null;
  // La nota de un recordatorio que ya no aplica no viaja a `pending`.
  return upsertAttention({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    state: "pending",
    dueAt: null,
    note: null,
  });
}

/** El dueño respondió: la pelota está en el cliente, no requiere acción propia. */
export async function markAttentionWaitingClient(input: {
  organizationId: string;
  conversationId: string;
}): Promise<AttentionView | null> {
  const conversation = await loadHumanConversation(
    input.organizationId,
    input.conversationId
  );
  if (!conversation) return null;
  return upsertAttention({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    state: "waiting_client",
    dueAt: null,
    note: null,
  });
}

/**
 * "Recordarme el jueves": APLAZAR la atención, no enviar nada. Reemplaza el
 * recordatorio anterior (D-6). Falla ruidosamente -a diferencia de los eventos,
 * que son no-op- porque la única vía es una acción explícita del operador, que
 * debe poder distinguir "no se guardó" de "se guardó" (spec §3.4, §4.2).
 */
export async function scheduleHumanReminder(input: {
  organizationId: string;
  conversationId: string;
  dueAt: Date;
  note?: string | null;
  now?: Date;
}): Promise<AttentionView> {
  const now = input.now ?? new Date();
  await humanConversationOrThrow(input.organizationId, input.conversationId);
  if (input.dueAt.getTime() <= now.getTime()) {
    throw new AttentionError(
      "due_in_past",
      "un recordatorio se aplaza a futuro: no se puede programar en el pasado"
    );
  }
  return upsertAttention({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    state: "deferred",
    dueAt: input.dueAt,
    note: normalizeNote(input.note),
  });
}

/**
 * 013 C3 — Cancela un compromiso futuro (FR-3.9).
 *
 * Qué hace y —sobre todo— qué NO hace: borra el `deferred`, y con él sale de la
 * Agenda. NO manda WhatsApp, no crea seguimiento automático y no toca el motor
 * de `sales_follow_up_job` (plan §5 D-5). Un `pending` (acción humana AHORA) o
 * un `waiting_client` NO se borran: cancelar un recordatorio nunca puede borrar
 * trabajo vivo de la cola "Por atender" ni hacer desaparecer una conversación de
 * la que el operador tiene que responder. Por eso el `DELETE` filtra por
 * `state = 'deferred'` en la propia sentencia: un `pending` creado entre el read
 * y el delete no se cuela.
 *
 * La fila se elimina en vez de volverse `pending`: "cancelar" significa "ya no
 * hay nada que retomar a esa hora". La conversación sigue siendo humana
 * (`ai_enabled` / `handoff_at` no se tocan) y, si el cliente escribe, vuelve a
 * `pending` por la vía normal de la ingesta.
 */
export async function cancelHumanReminder(input: {
  organizationId: string;
  conversationId: string;
}): Promise<CancelReminderResult> {
  const conversation = await loadConversation(input.organizationId, input.conversationId);
  if (!conversation) return { ok: false, error: "conversation_not_found" };
  const view = await getAttention(input.organizationId, input.conversationId);
  if (!view) return { ok: false, error: "no_reminder" };
  if (view.state !== "deferred") return { ok: false, error: "not_scheduled" };

  const db = getDb();
  const deleted = await db
    .delete(schema.conversationAttention)
    .where(
      scoped(
        schema.conversationAttention.organizationId,
        input.organizationId,
        eq(schema.conversationAttention.conversationId, input.conversationId),
        eq(schema.conversationAttention.state, "deferred")
      )
    )
    .returning({ id: schema.conversationAttention.id });
  return { ok: true, conversationId: input.conversationId, cancelled: deleted.length > 0 };
}

/** Limpia el estado humano de una conversación. Devuelve filas eliminadas. */
export async function clearAttention(input: {
  organizationId: string;
  conversationId: string;
}): Promise<number> {
  const db = getDb();
  const deleted = await db
    .delete(schema.conversationAttention)
    .where(
      scoped(
        schema.conversationAttention.organizationId,
        input.organizationId,
        eq(schema.conversationAttention.conversationId, input.conversationId)
      )
    )
    .returning({ id: schema.conversationAttention.id });
  return deleted.length;
}

/**
 * Limpia la atención de las conversaciones reales de un contacto. Se usa al
 * llevar el lead a `cliente`/`perdido`: el compromiso humano dejó de existir y
 * conservarlo sería ruido en "Por atender" (FR-1.8). El Laboratorio se excluye
 * por `is_test` y el scope es por organización.
 */
export async function clearAttentionForContact(input: {
  organizationId: string;
  contactId: string;
}): Promise<number> {
  const db = getDb();
  const conversations = await db
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        input.organizationId,
        eq(schema.conversation.contactId, input.contactId),
        eq(schema.conversation.isTest, false)
      )
    );
  let cleared = 0;
  for (const conversation of conversations) {
    cleared += await clearAttention({
      organizationId: input.organizationId,
      conversationId: conversation.id,
    });
  }
  return cleared;
}

/**
 * Enganche best-effort (plan §3.5/§8): un fallo al escribir la atención NO puede
 * tumbar el envío, la ingesta ni el cambio de etapa. Concentra el try/catch y el
 * log (sin nota ni contenido de conversación) para no repetirlo en cada sitio.
 */
export async function bestEffortAttention(
  context: string,
  run: () => Promise<unknown>
): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.warn(`[attention] ${context}: sin registrar la atención`, err);
  }
}
