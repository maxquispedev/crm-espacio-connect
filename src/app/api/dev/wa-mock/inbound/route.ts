import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { apiError, parseBody } from "@/lib/api";
import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";
import {
  buildInboundPayload,
  deliverToWebhook,
} from "@/server/dev/wa-mock-inbound";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    phoneNumberId: z.string().min(1),
    /** Teléfono; omítelo (con fromUserId) para simular un inbound BSUID (003). */
    from: z.string().min(5).optional(),
    fromUserId: z.string().min(3).optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    text: z.string().optional(),
    waMessageId: z.string().optional(),
    timestamp: z.number().optional(),
    // 008 — adjuntos simulados
    mediaId: z.string().optional(),
    mimeType: z.string().optional(),
    caption: z.string().optional(),
    filename: z.string().optional(),
    location: z.record(z.unknown()).optional(),
    // 006 — referral CTWA simulado. Si se omite, no se adjunta referral.
    referral: z
      .object({
        source_url: z.string().url().optional(),
        source_id: z.string().optional(),
        source_type: z.string().optional(),
        headline: z.string().optional(),
        body: z.string().optional(),
        media_type: z.string().optional(),
        image_url: z.string().url().optional(),
        thumbnail_url: z.string().url().optional(),
        ctwa_clid: z.string().optional(),
      })
      .optional(),
  })
  .refine((v) => v.from || v.fromUserId, {
    message: "Se requiere from o fromUserId",
  });

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  const creds = await getCredentialsByPhoneNumberId(body.data.phoneNumberId);
  const payload = buildInboundPayload({
    ...body.data,
    wabaId: creds?.wabaId ?? "WABA-MOCK",
  });
  const res = await deliverToWebhook(payload);
  if (!res.ok) {
    return apiError(
      502,
      "webhook_error",
      `El webhook respondió ${res.status}`
    );
  }
  return Response.json({ delivered: true });
}
