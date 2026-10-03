import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { DEMO_RESOURCE_SLOTS } from "@/lib/commercial/resources";
import { ResourceUploadError, uploadVideo } from "@/server/commercial/resources";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ slot: string }> };
export const PUT = withAuth(async (session, request: Request, context: Params) => {
  const slot = z.enum(DEMO_RESOURCE_SLOTS).safeParse((await context.params).slot);
  if (!slot.success) return apiError(404, "not_found", "Slot de demo inexistente");
  let form: FormData;
  try { form = await request.formData(); }
  catch { return apiError(400, "invalid_body", "Se requiere multipart con un archivo MP4"); }
  const file = form.get("file");
  if (!(file instanceof File) || form.getAll("file").length !== 1 || [...form.keys()].some((key) => key !== "file")) {
    return apiError(400, "invalid_body", "Envía solo un archivo en el campo file");
  }
  try {
    return Response.json(await uploadVideo(session.organizationId, slot.data, file));
  } catch (error) {
    if (error instanceof ResourceUploadError) return apiError(error.status, error.code, error.message);
    return apiError(500, "persistence_failed", "No se pudo guardar el video");
  }
});
