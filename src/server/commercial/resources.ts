import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { DEMO_RESOURCE_SLOTS, type DemoResourceSlot } from "@/lib/commercial/resources";
import { getCommercialResource, upsertCommercialResource } from "@/lib/commercial/store";
import type { CommercialResourcesDto, VideoResourceDto } from "@/lib/commercial/dto";
import { deleteMediaFile, MEDIA_LIMITS, saveMediaFile } from "@/server/whatsapp/media";

export class ResourceUploadError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

type Mp4Box = { kind: string; start: number; end: number };
const invalidMp4 = () => new ResourceUploadError(415, "invalid_mp4", "El archivo no tiene estructura MP4 de video válida");
function mp4Boxes(data: Buffer, start = 0, end = data.length): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  for (let offset = start; offset < end;) {
    if (end - offset < 8) throw invalidMp4();
    let size = data.readUInt32BE(offset);
    const kind = data.toString("ascii", offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (end - offset < 16) throw invalidMp4();
      const large = data.readBigUInt64BE(offset + 8);
      if (large > BigInt(end - offset)) throw invalidMp4();
      size = Number(large); header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || size > end - offset) throw invalidMp4();
    boxes.push({ kind, start: offset + header, end: offset + size });
    offset += size;
  }
  return boxes;
}

/** Firma, límites de boxes y track de video ISO BMFF; no valida codec ni Meta. */
export function validateMp4(data: Buffer, mime: string): void {
  if (data.length > MEDIA_LIMITS.video.maxBytes) {
    throw new ResourceUploadError(413, "too_large", "El MP4 supera el límite de 16 MiB");
  }
  if (!data.length) throw new ResourceUploadError(422, "empty_file", "El archivo está vacío");
  if (mime !== "video/mp4") throw new ResourceUploadError(415, "unsupported_type", "Selecciona un archivo video/mp4");
  const boxes = mp4Boxes(data);
  const ftyp = boxes[0];
  if (!ftyp || ftyp.kind !== "ftyp" || boxes.filter((box) => box.kind === "ftyp").length !== 1 ||
      ftyp.end - ftyp.start < 8 || (ftyp.end - ftyp.start) % 4) throw invalidMp4();
  const brands = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "dash"]);
  const compatible = [data.toString("ascii", ftyp.start, ftyp.start + 4)];
  for (let pos = ftyp.start + 8; pos < ftyp.end; pos += 4) compatible.push(data.toString("ascii", pos, pos + 4));
  if (!compatible.some((brand) => brands.has(brand))) throw invalidMp4();
  const moov = boxes.find((box) => box.kind === "moov");
  if (!moov || !boxes.some((box) => box.kind === "mdat" && box.end > box.start)) throw invalidMp4();
  const children = (box: Mp4Box) => mp4Boxes(data, box.start, box.end);
  const movie = children(moov);
  if (!movie.some((box) => box.kind === "mvhd" && box.end > box.start)) throw invalidMp4();
  const videoTrack = movie.filter((box) => box.kind === "trak").some((track) => {
    const mdia = children(track).find((box) => box.kind === "mdia");
    if (!mdia) return false;
    const handler = children(mdia).find((box) => box.kind === "hdlr");
    return handler !== undefined && handler.end - handler.start >= 24 &&
      data.toString("ascii", handler.start + 8, handler.start + 12) === "vide";
  });
  if (!videoTrack) throw invalidMp4();
}

function videoDto(slot: DemoResourceSlot, asset: typeof schema.mediaAsset.$inferSelect | null): VideoResourceDto {
  return { slot, configured: asset !== null, media: asset ? {
    assetId: asset.id, fileName: asset.fileName ?? "demo.mp4",
    fileSize: asset.fileSize!, mimeType: asset.mimeType!, previewUrl: `/api/media/${asset.id}`,
  } : null };
}

export async function readResources(organizationId: string): Promise<CommercialResourcesDto> {
  const videos = await Promise.all(DEMO_RESOURCE_SLOTS.map(async (slot) => {
    const resource = await getCommercialResource(organizationId, slot);
    if (!resource || resource.slot === "payment_instructions") return videoDto(slot, null);
    const assets = await getDb().select().from(schema.mediaAsset).where(
      scoped(schema.mediaAsset.organizationId, organizationId, eq(schema.mediaAsset.id, resource.mediaAssetId))
    ).limit(1);
    return videoDto(slot, assets[0] ?? null);
  }));
  const payment = await getCommercialResource(organizationId, "payment_instructions");
  return { videos, paymentInstructions: payment?.slot === "payment_instructions"
    ? payment.payload : { transfers: [], yape: null, paymentLink: null } };
}

export async function uploadVideo(organizationId: string, slot: DemoResourceSlot, file: File): Promise<VideoResourceDto> {
  // Tamaño antes de materializar bytes; MIME/firma siempre en servidor.
  if (file.size > MEDIA_LIMITS.video.maxBytes) {
    throw new ResourceUploadError(413, "too_large", "El MP4 supera el límite de 16 MiB");
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  validateMp4(bytes, file.type);
  const id = newId("mediaAsset");
  const fileName = file.name.split(/[\\/]/).pop()?.replace(/[^\w. -]/g, "_").slice(0, 160) || "demo.mp4";
  let transactionStarted = false;
  let asset: typeof schema.mediaAsset.$inferSelect;
  try {
    const storagePath = await saveMediaFile(organizationId, id, bytes);
    transactionStarted = true;
    asset = await getDb().transaction(async (tx) => {
      const rows = await tx.insert(schema.mediaAsset).values({
        id, organizationId, kind: "video", mimeType: "video/mp4", fileSize: bytes.length,
        fileName, storagePath, fetchStatus: "available",
      }).returning();
      if (!rows[0]) throw new Error("asset_write_failed");
      await upsertCommercialResource(organizationId, { slot, mediaAssetId: id, payload: null }, tx);
      return rows[0];
    });
  } catch {
    // Nunca borrar históricos. Si el resultado del commit es incierto, comprobar
    // la ausencia del NUEVO asset; con BD inaccesible conservar disco por seguridad.
    let orphan = !transactionStarted;
    if (transactionStarted) {
      try {
        const rows = await getDb().select({ id: schema.mediaAsset.id }).from(schema.mediaAsset).where(
          scoped(schema.mediaAsset.organizationId, organizationId, eq(schema.mediaAsset.id, id))
        ).limit(1);
        orphan = rows.length === 0;
      } catch { /* no hay evidencia suficiente para borrar */ }
    }
    if (orphan) await deleteMediaFile(organizationId, id);
    throw new ResourceUploadError(500, "persistence_failed", "No se pudo guardar el video. Recarga para comprobar el recurso actual");
  }
  // Fuera del catch: una respuesta fallida no elimina un archivo ya publicado.
  return videoDto(slot, asset);
}
