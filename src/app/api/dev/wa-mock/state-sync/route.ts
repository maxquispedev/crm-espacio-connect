import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { apiError, parseBody } from "@/lib/api";
import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";
import {
  buildStateSyncPayload,
  deliverToWebhook,
} from "@/server/dev/wa-mock-inbound";

export const dynamic = "force-dynamic";

/**
 * Simula un webhook `smb_app_state_sync` y lo entrega a la ruta real.
 * Solo en el entorno de pruebas (dev-guard).
 */
const schema = z.object({
  phoneNumberId: z.string().min(1),
  contacts: z.array(
    z.object({
      action: z.enum(["add", "remove"]),
      phone_number: z.string().min(5),
      full_name: z.string().optional(),
      first_name: z.string().optional(),
    })
  ),
});

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const creds = await getCredentialsByPhoneNumberId(body.data.phoneNumberId);
  const payload = buildStateSyncPayload({
    ...body.data,
    wabaId: creds?.wabaId ?? "WABA-MOCK",
  });
  const res = await deliverToWebhook(payload);
  if (!res.ok) {
    return apiError(502, "webhook_error", `El webhook respondió ${res.status}`);
  }
  return Response.json({ delivered: true });
}
