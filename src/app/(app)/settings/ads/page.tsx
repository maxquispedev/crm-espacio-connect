import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { AdsClient, type CapiSettingsClientDto, type ActivityRowDto } from "@/components/settings/ads-client";
import { isCapiEnabled } from "@/server/attribution/flag";
import { getCapiSettingsDto } from "@/server/attribution/settings";
import { listConversionEvents } from "@/server/attribution/conversions";
import { requireSession } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { asc } from "drizzle-orm";
import { scoped } from "@/lib/db/tenant";

/**
 * 007 — Ajustes → Anuncios (Corte C).
 *
 * Server Component que:
 *  - Lee `isCapiEnabled()`. Si la bandera está apagada → 404 (defensa en
 *    profundidad: aunque el link no esté oculto, alguien podría tipear la URL).
 *  - Carga la config CAPI saneada del tenant (sin ciphertext).
 *  - Carga las etapas `kind = "open"` del tenant para el selector de "etapa
 *    calificada" (NO hardcodeada).
 *  - Carga las primeras 50 filas de `conversion_event` para la tabla de
 *    actividad.
 */

export const dynamic = "force-dynamic";

type StageOption = { id: string; name: string; position: number };

async function loadOpenStages(
  organizationId: string
): Promise<StageOption[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.pipelineStage.id,
      name: schema.pipelineStage.name,
      position: schema.pipelineStage.position,
    })
    .from(schema.pipelineStage)
    .where(
      scoped(
        schema.pipelineStage.organizationId,
        organizationId,
        eq(schema.pipelineStage.kind, "open")
      )
    )
    .orderBy(asc(schema.pipelineStage.position));
  return rows.map((r) => ({ id: r.id, name: r.name, position: r.position }));
}

export default async function AdsSettingsPage() {
  if (!isCapiEnabled()) {
    notFound();
  }
  const session = await requireSession();
  const [settings, openStages, events] = await Promise.all([
    getCapiSettingsDto(session.organizationId),
    loadOpenStages(session.organizationId),
    listConversionEvents({ organizationId: session.organizationId, limit: 50 }),
  ]);

  // DTOs ya saneados por `getCapiSettingsDto` y `listConversionEvents`. No
  // sale ni ciphertext ni token descifrado al cliente.
  const clientSettings: CapiSettingsClientDto | null = settings
    ? {
        datasetId: settings.datasetId,
        accessTokenLast4: settings.accessTokenLast4,
        hasCustomToken: settings.hasCustomToken,
        qualifiedStageId: settings.qualifiedStageId,
        updatedAt: settings.updatedAt,
      }
    : null;
  const activity: ActivityRowDto[] = events.map((e) => ({
    id: e.id,
    conversationId: e.conversationId,
    eventName: e.eventName,
    status: e.status,
    fbtraceId: e.fbtraceId,
    errorMessage: e.errorMessage,
    skipReason: e.skipReason,
    customData: e.customData,
    createdAt: e.createdAt,
  }));

  return (
    <AdsClient
      initialSettings={clientSettings}
      openStages={openStages}
      initialActivity={activity}
    />
  );
}
