import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { apiError, parseBody } from "@/lib/api";
import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";
import {
  buildHistoryPayload,
  deliverToWebhook,
} from "@/server/dev/wa-mock-inbound";

export const dynamic = "force-dynamic";

/**
 * Simula un webhook `history` de coexistence y lo entrega a la ruta real.
 * Solo en el entorno de pruebas (dev-guard).
 */
const schema = z.object({
  phoneNumberId: z.string().min(1),
  displayPhoneNumber: z.string().optional(),
  phase: z.number().optional(),
  chunkOrder: z.number().optional(),
  progress: z.number().optional(),
  threads: z.array(
    z.object({
      id: z.string().min(5),
      messages: z.array(
        z.object({
          from: z.string().min(5),
          to: z.string().optional(),
          id: z.string().optional(),
          timestamp: z.number(),
          type: z.string().optional(),
          text: z.string().optional(),
          historyStatus: z.string().optional(),
          mediaId: z.string().optional(),
          mimeType: z.string().optional(),
          caption: z.string().optional(),
        })
      ),
    })
  ),
});

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const creds = await getCredentialsByPhoneNumberId(body.data.phoneNumberId);
  const payload = buildHistoryPayload({
    ...body.data,
    wabaId: creds?.wabaId ?? "WABA-MOCK",
  });
  const res = await deliverToWebhook(payload);
  if (!res.ok) {
    return apiError(502, "webhook_error", `El webhook respondió ${res.status}`);
  }
  return Response.json({ delivered: true });
}
