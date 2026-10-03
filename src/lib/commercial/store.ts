import { stat } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  COMMERCIAL_RESOURCE_SLOTS,
  CommercialResourceValueSchema,
  type CommercialResourceSlot,
  type CommercialResourceValue,
} from "./resources";
import { MEDIA_LIMITS, mediaFilePath } from "@/server/whatsapp/media";

export type CommercialResource = CommercialResourceValue & {
  id: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
};

export class CommercialResourceMediaError extends Error {
  readonly code = "commercial_resource_media_invalid";
  constructor() {
    // Misma respuesta para ajena, ausente o inválida; sin rutas/metadata ajenas.
    super("El recurso requiere un MP4 local disponible de esta organización");
    this.name = "CommercialResourceMediaError";
  }
}

async function requireLocalVideo(organizationId: string, assetId: string): Promise<void> {
  const rows = await getDb().select().from(schema.mediaAsset).where(
    scoped(schema.mediaAsset.organizationId, organizationId, eq(schema.mediaAsset.id, assetId))
  ).limit(1);
  const asset = rows[0];
  if (!asset || asset.kind !== "video" || asset.mimeType !== "video/mp4" ||
      asset.fetchStatus !== "available" || asset.storagePath !== `${organizationId}/${assetId}` ||
      !asset.fileSize || asset.fileSize > MEDIA_LIMITS.video.maxBytes) {
    throw new CommercialResourceMediaError();
  }
  try {
    const file = await stat(mediaFilePath(organizationId, assetId));
    if (!file.isFile() || file.size !== asset.fileSize) throw new CommercialResourceMediaError();
  } catch {
    throw new CommercialResourceMediaError();
  }
}

/** null = sin fila o demo no disponible; errores de BD no se ocultan. Sin cache. */
export async function getCommercialResource(
  organizationId: string,
  slot: CommercialResourceSlot
): Promise<CommercialResource | null> {
  const condition = scoped(schema.commercialResource.organizationId, organizationId,
    eq(schema.commercialResource.slot, z.enum(COMMERCIAL_RESOURCE_SLOTS).parse(slot)));
  const rows = await getDb().select().from(schema.commercialResource).where(condition).limit(1);
  const row = rows[0];
  if (!row) return null;
  const value = CommercialResourceValueSchema.parse({
    slot: row.slot, mediaAssetId: row.mediaAssetId, payload: row.payload,
  });
  if (value.slot !== "payment_instructions") {
    try {
      await requireLocalVideo(organizationId, value.mediaAssetId);
    } catch (error) {
      if (error instanceof CommercialResourceMediaError) return null;
      throw error;
    }
  }
  return { ...row, ...value };
}

/** Valida todo antes de escribir. Upsert atómico; conserva id/createdAt del slot. */
export async function upsertCommercialResource(
  organizationId: string,
  input: CommercialResourceValue
): Promise<CommercialResource> {
  const condition = scoped(schema.commercialResource.organizationId, organizationId);
  const value = CommercialResourceValueSchema.parse(input);
  if (value.slot !== "payment_instructions") {
    await requireLocalVideo(organizationId, value.mediaAssetId);
  }
  const rows = await getDb().insert(schema.commercialResource).values({
    id: newId("commercialResource"), organizationId, ...value,
  }).onConflictDoUpdate({
    target: [schema.commercialResource.organizationId, schema.commercialResource.slot],
    set: { mediaAssetId: value.mediaAssetId, payload: value.payload, updatedAt: new Date() },
    setWhere: condition,
  }).returning();
  const row = rows[0];
  if (!row) throw new Error("commercial_resource_write_failed");
  return { ...row, ...value };
}
