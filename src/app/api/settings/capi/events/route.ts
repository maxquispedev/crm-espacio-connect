import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { isCapiEnabled } from "@/server/attribution/flag";
import { listConversionEvents } from "@/server/attribution/conversions";

/**
 * 007 — `/api/settings/capi/events` (Corte B).
 *
 * GET → lista la actividad de conversion_event del tenant.
 *   Query params:
 *     - limit (opcional, default 50, max 200).
 *
 * Protegido por auth + tenant + bandera ATRIBUCION.
 */

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const GET = withAuth(async (session, req: Request) => {
  if (!isCapiEnabled()) {
    return apiError(404, "not_found", "CAPI no disponible");
  }
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return apiError(422, "invalid_query", "limit inválido");
  }
  const events = await listConversionEvents({
    organizationId: session.organizationId,
    limit: parsed.data.limit ?? 50,
  });
  return Response.json({ events });
});
