import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { AnuncioListaDto, ConversationDto } from "@/lib/types";
import { isWindowOpen, windowRemainingMs } from "@/server/inbox/window";
import { listaDesdeRow } from "@/lib/anuncios";
import {
  bestEffortAttention,
  clearAttention,
  markAttentionPending,
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

  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
      preview: previewSql,
      stageName: stageSql,
      ad: schema.adAttribution,
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
      listaDesdeRow(r.ad ?? null)
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
  anuncio: AnuncioListaDto | null = null
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
