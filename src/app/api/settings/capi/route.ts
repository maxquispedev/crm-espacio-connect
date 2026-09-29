import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { isCapiEnabled } from "@/server/attribution/flag";
import {
  getCapiSettingsDto,
  isQualifiedStageForTenant,
  upsertCapiSettings,
} from "@/server/attribution/settings";

/**
 * 007 — `/api/settings/capi` (Corte B).
 *
 * GET → devuelve la config saneada (sin ciphertext) o 404 si la bandera
 * ATRIBUCION está apagada.
 *
 * PUT → guarda `datasetId`, token opcional, `qualifiedStageId`. Valida con
 * Zod; valida que la etapa sea del tenant y `kind = "open"`.
 *
 * El endpoint está protegido por auth + tenant (`scoped()`) Y por la
 * bandera `ATRIBUCION`. Si la bandera está apagada, 404 incondicional.
 */

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  if (!isCapiEnabled()) {
    return apiError(404, "not_found", "CAPI no disponible");
  }
  const dto = await getCapiSettingsDto(session.organizationId);
  return Response.json({ settings: dto });
});

const upsertSchema = z.object({
  datasetId: z.string().trim().min(1).max(64),
  /**
   * Token opcional:
   *  - undefined: conserva el existente
   *  - string vacío: borrar (volver a reusar el token de WhatsApp)
   *  - string con contenido: cifrar y guardar
   *  - null: borrar explícitamente
   */
  accessToken: z
    .union([z.string().min(1).max(2048), z.literal(""), z.null()])
    .optional(),
  qualifiedStageId: z.string().min(1).nullable(),
});

export const PUT = withAuth(async (session, req: Request) => {
  if (!isCapiEnabled()) {
    return apiError(404, "not_found", "CAPI no disponible");
  }
  const body = await parseBody(req, upsertSchema);
  if (!body.ok) return body.response;

  // Validar que la etapa calificada, si viene, sea `kind = "open"` del tenant.
  // null es válido (QualifiedLead queda skipped con motivo "sin_etapa_calificada").
  const ok = await isQualifiedStageForTenant({
    organizationId: session.organizationId,
    stageId: body.data.qualifiedStageId,
  });
  if (!ok) {
    return apiError(
      422,
      "invalid_stage",
      "La etapa calificada debe ser del tenant y tener kind = 'open'"
    );
  }

  // Normalización de accessToken:
  // - "" → null (borrar y volver a reusar token WA)
  // - string → guardar
  // - undefined → no tocar (mantener existente)
  const accessToken =
    body.data.accessToken === ""
      ? null
      : body.data.accessToken === undefined
        ? undefined
        : body.data.accessToken;

  const updated = await upsertCapiSettings({
    organizationId: session.organizationId,
    datasetId: body.data.datasetId,
    accessToken,
    qualifiedStageId: body.data.qualifiedStageId,
  });
  return Response.json({
    settings: {
      datasetId: updated.datasetId,
      accessTokenLast4: updated.accessTokenLast4,
      hasCustomToken: updated.hasCustomToken,
      qualifiedStageId: updated.qualifiedStageId,
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
});
