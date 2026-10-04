import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { AnuncioListaDto, AttentionDto, ConversationDto } from "@/lib/types";
import { isWindowOpen, windowRemainingMs } from "@/server/inbox/window";
import { listaDesdeRow } from "@/lib/anuncios";
import {
  bestEffortAttention,
  clearAttention,
  deriveAttention,
  markAttentionPending,
  resumenAtencion,
} from "@/server/inbox/attention";

export type { ConversationDto };

export async function listConversations(
  organizationId: string,
  since?: Date
): Promise<ConversationDto[]> {
  const db = getDb();
  const previewSql = sql<string | null>`(
    select coalesce(m.text, m.type)
    from message m
    where m.conversation_id = ${schema.conversation.id}
    order by m.created_at desc
    limit 1
  )`;
  const stageSql = sql<string | null>`(
    select s.name from lead l
    join pipeline_stage s on s.id = l.stage_id
    where l.contact_id = ${schema.contact.id}
    limit 1
  )`;
  // Un SOLO reloj para toda la lista: el vencimiento se compara una vez y todas
  // las conversaciones se derivan contra el mismo instante. Con un `now()` por
  // fila, dos conversaciones que vencen en el mismo segundo caerían en listas
  // distintas y el conteo del chip podría no cuadrar con el listado.
  const now = new Date();

  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
      preview: previewSql,
      stageName: stageSql,
      ad: schema.adAttribution,
      // 013 C2 — Atención humana en el MISMO SELECT que la lista (plan §4.1).
      attention: schema.conversationAttention,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    // 006 — LEFT JOIN para añadir el origen del anuncio a la lista.
    // La restricción UNIQUE (org, conversation) garantiza una fila como
    // mucho, así que el N+1 queda cerrado de raíz.
    .leftJoin(
      schema.adAttribution,
      and(
        eq(schema.adAttribution.conversationId, schema.conversation.id),
        eq(schema.adAttribution.organizationId, organizationId)
      )
    )
    // 013 C2 — Mismo patrón que `adAttribution` y por la misma razón: el
    // `organization_id` va DENTRO del ON, no solo en el WHERE. Así una fila de
    // atención de otra organización no puede quedarse pegada a una conversación
    // de esta (Constitución III), y sigue siendo UN SELECT: cero N+1. El UNIQUE
    // (org, conversation) garantiza como mucho una fila por conversación.
    .leftJoin(
      schema.conversationAttention,
      and(
        eq(
          schema.conversationAttention.conversationId,
          schema.conversation.id
        ),
        eq(schema.conversationAttention.organizationId, organizationId)
      )
    )
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        since ? gt(schema.conversation.updatedAt, since) : undefined
      )
    )
    .orderBy(desc(sql`coalesce(${schema.conversation.lastMessageAt}, ${schema.conversation.createdAt})`));

  return rows.map((r) =>
    serializeConversation(
      r.conversation,
      r.contact,
      r.preview,
      r.stageName,
      listaDesdeRow(r.ad ?? null),
      resumenAtencion(
        r.attention ? deriveAttention(r.attention, now) : null
      )
    )
  );
}

export async function getConversation(
  organizationId: string,
  conversationId: string
) {
  const db = getDb();
  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
      ad: schema.adAttribution,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .leftJoin(
      schema.adAttribution,
      and(
        eq(schema.adAttribution.conversationId, schema.conversation.id),
        eq(schema.adAttribution.organizationId, organizationId)
      )
    )
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    conversation: r.conversation,
    contact: r.contact,
    anuncio: listaDesdeRow(r.ad ?? null),
  };
}

export async function listMessages(
  organizationId: string,
  conversationId: string,
  since?: Date
) {
  const db = getDb();
  return db
    .select({ message: schema.message, media: schema.mediaAsset })
    .from(schema.message)
    .leftJoin(
      schema.mediaAsset,
      eq(schema.message.mediaAssetId, schema.mediaAsset.id)
    )
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversationId),
        since ? gt(schema.message.createdAt, since) : undefined
      )
    )
    .orderBy(schema.message.createdAt);
}

export function serializeConversation(
  c: typeof schema.conversation.$inferSelect,
  contact: typeof schema.contact.$inferSelect,
  preview: string | null = null,
  stageName: string | null = null,
  anuncio: AnuncioListaDto | null = null,
  // 013 C2 — Parámetro ADITIVO con valor por defecto: la firma anterior sigue
  // siendo válida, así que un llamador que no sepa de atención no cambia. Llega
  // YA derivado (`resumenAtencion`); aquí no se recalcula nada.
  attention: AttentionDto | null = null
): ConversationDto {
  return {
    id: c.id,
    contact: { id: contact.id, name: contact.name, phone: contact.phone },
    stageName,
    aiEnabled: c.aiEnabled,
    handoffAt: c.handoffAt?.toISOString() ?? null,
    handoffReason: c.handoffReason,
    lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    unreadCount: c.unreadCount,
    windowOpen: isWindowOpen(c.lastInboundAt),
    windowRemainingMs: windowRemainingMs(c.lastInboundAt),
    preview,
    anuncio,
    attention,
  };
}

export async function updateConversation(
  organizationId: string,
  conversationId: string,
  patch: { aiEnabled?: boolean; reactivate?: boolean; markRead?: boolean }
) {
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.aiEnabled !== undefined) set.aiEnabled = patch.aiEnabled;
  if (patch.reactivate) {
    set.handoffAt = null;
    set.handoffReason = null;
    set.aiEnabled = patch.aiEnabled ?? true;
  }
  if (patch.markRead) set.unreadCount = 0;

  const updated = await db
    .update(schema.conversation)
    .set(set)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, conversationId)
      )
    )
    .returning();
  const row = updated[0] ?? null;

  // 013 C1 - Estados de la atención humana en el mismo punto de estrangulamiento
  // que los estados de la conversación (plan §3.5):
  //   - `reactivate` devuelve la conversación a la IA: limpia la atención.
  //   - `aiEnabled: false` deja la conversación en manos del humano: pendiente.
  // `markRead` NO aparece aquí a propósito: abrir no resuelve (spec §3.4).
  // `reactivate` gana si vienen ambos: es la señal más fuerte.
  if (row) {
    if (patch.reactivate) {
      await bestEffortAttention(`reactivate ${conversationId}`, () =>
        clearAttention({ organizationId, conversationId })
      );
    } else if (patch.aiEnabled === false) {
      await bestEffortAttention(`ia desactivada ${conversationId}`, () =>
        markAttentionPending({ organizationId, conversationId })
      );
    }
  }
  return row;
}
