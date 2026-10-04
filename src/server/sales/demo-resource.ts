import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { DemoResourceSlot } from "@/lib/commercial/resources";
import { getCommercialResource } from "@/lib/commercial/store";
import { readMediaFile } from "@/server/whatsapp/media";
import { validateMp4 } from "@/server/commercial/resources";

export const DEMO_UNAVAILABLE_TEXT = "El video de esta demo no está disponible ahora. No puedo enviártelo en este momento.";

/** Recurso y bytes locales del tenant; sin descarga Graph ni sustitución de slot. */
export async function loadDemoVideo(organizationId: string, slot: DemoResourceSlot) {
  try {
    const resource = await getCommercialResource(organizationId, slot);
    if (!resource || resource.slot === "payment_instructions") return null;
    const [asset] = await getDb().select().from(schema.mediaAsset).where(
      scoped(schema.mediaAsset.organizationId, organizationId, eq(schema.mediaAsset.id, resource.mediaAssetId))
    ).limit(1);
    if (!asset || asset.kind !== "video" || asset.mimeType !== "video/mp4" || asset.fetchStatus !== "available") return null;
    const data = await readMediaFile(organizationId, asset.id);
    if (data.length !== asset.fileSize) return null;
    validateMp4(data, asset.mimeType);
    return { file: { data, mimeType: "video/mp4", fileName: asset.fileName ?? "demo.mp4" } };
  } catch {
    // Ausencia, corrupción o disco/BD inaccesibles: disponibilidad honesta, sin PII.
    console.warn("[sales] demo comercial no disponible");
    return null;
  }
}

/** Caption breve y sin destinos externos, incluso con instrucciones antiguas. */
export function demoCaption(slot: DemoResourceSlot, text: string): string {
  const caption = text.trim();
  if (caption && caption.length <= 300 && !/(?:https?:|www\.|\b[\w-]+\.[a-z]{2,}\b|envi[eé]|enviado|mand[eé])/i.test(caption)) return caption;
  return {
    demo_enrollment_panel: "Así se gestionan las matrículas y los alumnos desde el panel.",
    demo_payments_balances: "Así se consultan los pagos y saldos de los alumnos.",
    demo_online_enrollment: "Así funciona la matrícula online.",
  }[slot];
}
