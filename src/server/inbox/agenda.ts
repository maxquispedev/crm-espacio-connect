import { and, asc, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { AgendaBucketName, AgendaDto, ReminderDto } from "@/lib/types";
import {
  AGENDA_BUCKETS,
  bucketFor,
  isOverdue,
  resolveOperatorTimeZone,
  type AgendaBucket,
} from "@/server/inbox/agenda-buckets";

/**
 * 013 C3 — Lectura de la Agenda de recordatorios humanos.
 *
 * Qué es y qué NO es (spec §2.3): es la lista de compromisos que el operador se
 * girdó. Un recordatorio NO es un seguimiento automático, así que aquí no se
 * toca `sales_follow_up_job`, `lead.next_follow_up_at`, cadencias ni el worker:
 * este módulo solo LEE `conversation_attention`, que es estado humano.
 *
 * Módulo de solo lectura a propósito: no importa nada que pueda enviar un
 * mensaje. Ni Graph, ni sender, ni plantillas, ni `follow-ups/*`. Ese camino
 * queda verificado en `tests/unit/agenda-no-send.test.ts`.
 */

export type ListAgendaInput = {
  organizationId: string;
  /** Reloj inyectable: los tests fijan medianoche, 23:59 o el cambio de día. */
  now?: Date;
  /** Zona de agrupación; por defecto la de la instancia (`OPERATOR_TIMEZONE`). */
  timeZone?: string;
};

/** `state` viene de la columna con `enum` de BD; el CHECK lo hace coherente. */
const ATTENTION_STATES = ["pending", "waiting_client", "deferred"] as const;

function asState(value: string | null): ReminderDto["state"] {
  return ATTENTION_STATES.find((s) => s === value) ?? "deferred";
}

function emptyBuckets(): Record<AgendaBucket, ReminderDto[]> {
  return { overdue: [], today: [], tomorrow: [], week: [], later: [] };
}

export async function listAgenda(input: ListAgendaInput): Promise<AgendaDto> {
  const { organizationId } = input;
  const now = input.now ?? new Date();
  const timeZone = resolveOperatorTimeZone(input.timeZone);
  const db = getDb();

  const rows = await db
    // Proyección por TABLA, el mismo patrón que `listConversations`: un solo
    // SELECT y cero N+1. Los nombres de columna se repiten entre tablas, así que
    // anidar por tabla es lo que mantiene el DTO inequívoco.
    .select({
      attention: schema.conversationAttention,
      conversation: schema.conversation,
      contact: schema.contact,
    })
    .from(schema.conversationAttention)
    // El `organization_id` va DENTRO del ON, igual que en `listConversations`:
    // una fila de atención de otra organización no puede pegarse a una
    // conversación de esta (Constitución III). El CHECK de BD garantiza que
    // `due_at` existe si y solo si `state = 'deferred'`; el `isNotNull` evita
    // además leer un bucket imposible.
    .innerJoin(
      schema.conversation,
      and(
        eq(schema.conversationAttention.conversationId, schema.conversation.id),
        eq(schema.conversationAttention.organizationId, schema.conversation.organizationId),
        eq(schema.conversation.isTest, false)
      )
    )
    .innerJoin(
      schema.contact,
      and(
        eq(schema.contact.id, schema.conversation.contactId),
        eq(schema.contact.organizationId, schema.conversation.organizationId)
      )
    )
    .where(
      scoped(
        schema.conversationAttention.organizationId,
        organizationId,
        // Solo los compromisos con fecha. `pending` es trabajo AHORA ( Bandeja)
        // y `waiting_client` es la pelota en el cliente: ninguno es Agenda.
        eq(schema.conversationAttention.state, "deferred"),
        isNotNull(schema.conversationAttention.dueAt)
      )
    )
    // Lo más próximo primero; en `overdue`, lo más retrasado primero.
    .orderBy(asc(schema.conversationAttention.dueAt));

  const buckets = emptyBuckets();
  for (const row of rows) {
    const dueAt = row.attention.dueAt;
    if (!(dueAt instanceof Date)) continue;
    const bucket = bucketFor(dueAt, now, timeZone);
    // Una fecha que no cae en ninguna ventana no se pierde: se va a `later`,
    // que es el último grupo y no tiene techo.
    const group: AgendaBucketName = bucket ?? "later";
    buckets[group].push({
      conversationId: row.conversation.id,
      contact: { id: row.contact.id, name: row.contact.name, phone: row.contact.phone },
      dueAt: dueAt.toISOString(),
      note: row.attention.note,
      state: asState(row.attention.state),
      bucket: group,
      needsAttentionNow: isOverdue(dueAt, now),
    });
  }

  return {
    generatedAt: now.toISOString(),
    timeZone,
    buckets,
    total: AGENDA_BUCKETS.reduce((sum, bucket) => sum + buckets[bucket].length, 0),
  };
}
