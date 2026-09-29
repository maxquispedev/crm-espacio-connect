import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import {
  anuncioParaGuardar,
  anuncioDesdeRow,
  listaDesdeRow,
  type AnuncioRowShape,
  type AnuncioParaGuardar,
} from "@/lib/anuncios";
import type { AnuncioDeOrigen } from "@/server/attribution/referral";
import { sinIdentificadorDeClic } from "@/server/attribution/referral";
import { atribucionEnabled } from "@/server/attribution/flag";

/**
 * 006 — Persistencia del origen del anuncio.
 *
 * Reglas (Constitución IV):
 *  - Idempotente por (org, conversation): el segundo INSERT gana DO NOTHING
 *    si ya hay fila. El "primer referral gana".
 *  - Tenant estricto: `scoped()` en todas las queries.
 *  - Best-effort: las excepciones se loguean pero NO rompen el mensaje
 *    (la función devuelve `false` y la ingestión sigue).
 *  - La columna `ctwa_clid` se trata como si la bandera estuviera apagada,
 *    mientras el spec 007 no la cablea.
 */

/**
 * Inserta un origen si no existe. Devuelve `true` si persistió, `false` si
 * ya había fila o si falló (y en ese caso el error ya se logueó).
 *
 * El segundo referral posterior del mismo `source_id` o uno nuevo NO pisa
 * al primero. Si quieren sobrescribirlo en frío, es otra herramienta.
 */
export async function registrarAnuncioDeOrigen(args: {
  organizationId: string;
  contactId: string;
  conversationId: string;
  normalizado: AnuncioDeOrigen;
  /** Puede venir null si la imagen ya se descargó antes para otro contacto. */
  imageAssetId: string | null;
}): Promise<boolean> {
  const { organizationId, contactId, conversationId, normalizado, imageAssetId } =
    args;

  const limpia = atribucionEnabled()
    ? normalizado
    : sinIdentificadorDeClic(normalizado);

  const preparado: AnuncioParaGuardar = anuncioParaGuardar(limpia);

  const db = getDb();
  try {
    const inserted = await db
      .insert(schema.adAttribution)
      .values({
        id: newId("adAttribution"),
        organizationId,
        contactId,
        conversationId,
        ctwaClid: preparado.ctwaClid,
        sourceId: preparado.sourceId,
        sourceType: preparado.sourceType,
        sourceUrl: preparado.sourceUrl,
        headline: preparado.headline,
        body: preparado.body,
        mediaType: preparado.mediaType,
        raw: preparado.raw,
        imageAssetId,
      })
      .onConflictDoNothing({
        target: [
          schema.adAttribution.organizationId,
          schema.adAttribution.conversationId,
        ],
      })
      .returning({ id: schema.adAttribution.id });
    return inserted.length > 0;
  } catch (err) {
    console.warn(
      "[attribution] no se pudo registrar el origen del anuncio:",
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}

/** Adjunta `image_asset_id` a una fila ya existente (idempotente). */
export async function vincularCreativo(args: {
  organizationId: string;
  conversationId: string;
  imageAssetId: string;
}): Promise<void> {
  const { organizationId, conversationId, imageAssetId } = args;
  const db = getDb();
  try {
    await db
      .update(schema.adAttribution)
      .set({ imageAssetId })
      .where(
        and(
          eq(schema.adAttribution.organizationId, organizationId),
          eq(schema.adAttribution.conversationId, conversationId)
        )
      );
  } catch (err) {
    console.warn(
      "[attribution] no se pudo vincular el creativo:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Freno: si ya hay una fila para (org, conversation), devuelve `true`.
 * La ingestión llama esto ANTES de la descarga de la imagen para no
 * duplicar el mismo `source_id` y desperdiciar bandwidth.
 */
export async function yaExisteAnuncio(
  organizationId: string,
  conversationId: string
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.adAttribution.id })
    .from(schema.adAttribution)
    .where(
      and(
        eq(schema.adAttribution.organizationId, organizationId),
        eq(schema.adAttribution.conversationId, conversationId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** Recupera la fila cruda por conversación, o `null`. Tenant estricto. */
export async function anuncioDeConversacion(
  organizationId: string,
  conversationId: string
): Promise<AnuncioRowShape | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.adAttribution)
    .where(
      scoped(
        schema.adAttribution.organizationId,
        organizationId,
        eq(schema.adAttribution.conversationId, conversationId)
      )
    )
    .limit(1);
  const r = rows[0];
  return r ? rowAForma(r) : null;
}

/** Recupera el primer anuncio del contacto (el más viejo, el "de origen"). */
export async function anuncioDelContacto(
  organizationId: string,
  contactId: string
): Promise<AnuncioRowShape | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.adAttribution)
    .where(
      and(
        eq(schema.adAttribution.organizationId, organizationId),
        eq(schema.adAttribution.contactId, contactId)
      )
    )
    .orderBy(sql`${schema.adAttribution.createdAt} asc`)
    .limit(1);
  const r = rows[0];
  return r ? rowAForma(r) : null;
}

/** Recupera cualquier anuncio del contacto por source_id (idempotencia imagen). */
export async function anuncioPorSourceId(
  organizationId: string,
  sourceId: string
): Promise<AnuncioRowShape | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.adAttribution)
    .where(
      and(
        eq(schema.adAttribution.organizationId, organizationId),
        eq(schema.adAttribution.sourceId, sourceId),
        // Solo los que ya tienen imagen; los NULL no nos sirven para reuso.
        sql`${schema.adAttribution.imageAssetId} IS NOT NULL`
      )
    )
    .orderBy(desc(schema.adAttribution.createdAt))
    .limit(1);
  const r = rows[0];
  return r ? rowAForma(r) : null;
}

/** DTO corto para bandeja y pipeline. */
export async function anuncioListaDeConversacion(
  organizationId: string,
  conversationId: string
): Promise<ReturnType<typeof listaDesdeRow>> {
  const row = await anuncioDeConversacion(organizationId, conversationId);
  return listaDesdeRow(row);
}

/** DTO completo para el panel del contacto. */
export async function anuncioCompletoDeConversacion(
  organizationId: string,
  conversationId: string
): Promise<ReturnType<typeof anuncioDesdeRow>> {
  const row = await anuncioDeConversacion(organizationId, conversationId);
  return anuncioDesdeRow(row);
}

/**
 * Reparación: si un mensaje llegó con `referral` y por una excepción la fila
 * de `ad_attribution` no se insertó, lo intenta de nuevo.
 * Idempotente: si ya hay fila, no hace nada.
 */
export async function repararSiFalta(args: {
  organizationId: string;
  contactId: string;
  conversationId: string;
  normalizado: AnuncioDeOrigen;
  imageAssetId: string | null;
}): Promise<boolean> {
  const existe = await yaExisteAnuncio(
    args.organizationId,
    args.conversationId
  );
  if (existe) return false;
  return registrarAnuncioDeOrigen(args);
}

function rowAForma(r: typeof schema.adAttribution.$inferSelect): AnuncioRowShape {
  return {
    id: r.id,
    organizationId: r.organizationId,
    contactId: r.contactId,
    conversationId: r.conversationId,
    ctwaClid: r.ctwaClid,
    sourceId: r.sourceId,
    sourceType: r.sourceType,
    sourceUrl: r.sourceUrl,
    headline: r.headline,
    body: r.body,
    mediaType: r.mediaType,
    raw: r.raw,
    imageAssetId: r.imageAssetId,
    createdAt: r.createdAt,
  };
}
