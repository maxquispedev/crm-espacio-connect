import { and, asc, eq, isNull } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { listaDesdeRow, type AnuncioRowShape } from "@/lib/anuncios";

export const dynamic = "force-dynamic";

/** Datos completos del kanban: etapas ordenadas + tarjetas con su contacto. */
export const GET = withAuth(async (session) => {
  const db = getDb();

  const stages = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, session.organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  // 006 — Traemos el anuncio (LEFT JOIN) por conversación para pintar la
  // línea secundaria "Anuncio · titular" en la tarjeta del lead del kanban.
  const leads = await db
    .select({
      lead: schema.lead,
      contact: schema.contact,
      conversationId: schema.conversation.id,
      ad: schema.adAttribution,
    })
    .from(schema.lead)
    .innerJoin(schema.contact, eq(schema.lead.contactId, schema.contact.id))
    .leftJoin(
      schema.conversation,
      and(
        eq(schema.conversation.contactId, schema.contact.id),
        eq(schema.conversation.isTest, false)
      )
    )
    .leftJoin(
      schema.adAttribution,
      and(
        eq(schema.adAttribution.conversationId, schema.conversation.id),
        eq(schema.adAttribution.organizationId, session.organizationId)
      )
    )
    .where(scoped(schema.lead.organizationId, session.organizationId,
      isNull(schema.contact.archivedAt)
    ))
    .orderBy(asc(schema.lead.position));

  return Response.json({
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      kind: s.kind,
    })),
    leads: leads.map((r) => ({
      id: r.lead.id,
      stageId: r.lead.stageId,
      position: r.lead.position,
      lastActivityAt: r.lead.lastActivityAt?.toISOString() ?? null,
      automationLane: r.lead.automationLane,
      followUpReason: r.lead.followUpReason,
      contact: {
        id: r.contact.id,
        name: r.contact.name,
        phone: r.contact.phone,
      },
      conversationId: r.conversationId,
      // 006 — Anuncio reducido para la línea secundaria. NUNCA expone
      // ctwa_clid. Si la fila de ad_attribution no existe (orgánico),
      // `listaDesdeRow(null)` devuelve null y la línea no se renderiza.
      anuncio: listaDesdeRow(r.ad as AnuncioRowShape | null),
    })),
  });
});
