import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  getContactById,
  getContactStage,
  serializeContact,
} from "@/server/contacts";
import { serializeLeadSalesState } from "@/server/sales/serialize-ui";
import { anuncioDelContacto } from "@/server/attribution/store";
import { anuncioDesdeRow } from "@/lib/anuncios";
import { effectiveSource } from "@/server/contact-source";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const contact = await getContactById(session.organizationId, id);
  if (!contact) return apiError(404, "not_found", "Contacto no encontrado");
  const stageRow = await getContactStage(session.organizationId, id);

  // 006 — Origen del anuncio de Meta (anuncioDelContacto = el más viejo).
  const anuncioContacto = await anuncioDelContacto(session.organizationId, id);
  const source = effectiveSource(
    null, // `contact.source` aún no existe como columna — se enchufa en spec 008+
    anuncioContacto
  );

  return Response.json({
    contact: serializeContact(contact, stageRow?.stage.name ?? null, source),
    stage: stageRow
      ? {
          id: stageRow.stage.id,
          name: stageRow.stage.name,
          position: stageRow.stage.position,
          kind: stageRow.stage.kind,
        }
      : null,
    lead: stageRow
      ? {
          id: stageRow.lead.id,
          sales: serializeLeadSalesState(stageRow.lead),
        }
      : null,
    /**
     * 006 — DTO completo del anuncio de origen (lo que consume el panel
     * del contacto cuando el spec 007 pinte la UI). Si el caller quiere
     * el anuncio de una conversación específica, debe llamar a
     * `GET /api/conversations/[id]` y leer `anuncio` en su `conversation`.
     */
    anuncio: anuncioDesdeRow(anuncioContacto),
  });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(4000).nullable().optional(),
  archived: z.boolean().optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.data.name !== undefined) set.name = body.data.name;
  if (body.data.notes !== undefined) set.notes = body.data.notes;
  if (body.data.archived !== undefined) {
    set.archivedAt = body.data.archived ? new Date() : null;
  }

  const db = getDb();
  const updated = await db
    .update(schema.contact)
    .set(set)
    .where(
      scoped(
        schema.contact.organizationId,
        session.organizationId,
        eq(schema.contact.id, id)
      )
    )
    .returning();
  if (!updated[0]) return apiError(404, "not_found", "Contacto no encontrado");
  return Response.json({ contact: serializeContact(updated[0]) });
});
