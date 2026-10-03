import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { PaymentInstructionsSchema } from "@/lib/commercial/resources";
import { upsertCommercialResource } from "@/lib/commercial/store";
import { readResources } from "@/server/commercial/resources";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  try { return Response.json(await readResources(session.organizationId)); }
  catch { return apiError(500, "persistence_failed", "No se pudieron cargar los recursos comerciales"); }
});

const Body = z.object({ paymentInstructions: PaymentInstructionsSchema }).strict();
export const PUT = withAuth(async (session, request: Request) => {
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return apiError(400, "invalid_body", "El body debe ser JSON válido"); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return apiError(422, "invalid_payment", parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  try {
    const resource = await upsertCommercialResource(session.organizationId, {
      slot: "payment_instructions", mediaAssetId: null, payload: parsed.data.paymentInstructions,
    });
    return Response.json({ paymentInstructions: resource.payload });
  } catch { return apiError(500, "persistence_failed", "No se pudo guardar la configuración de cobro"); }
});
