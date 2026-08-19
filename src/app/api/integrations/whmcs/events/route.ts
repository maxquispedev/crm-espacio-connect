import { apiError } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyWhmcsHmac } from "@/server/integrations/whmcs/hmac";
import {
  eventEnvelopeSchema,
  INVOICE_CREATED_EVENT,
  INVOICE_PAID_EVENT,
  invoiceCreatedSchema,
  invoicePaidSchema,
} from "@/server/integrations/whmcs/payload";
import {
  processInvoiceCreated,
  WhmcsIntegrationError,
} from "@/server/integrations/whmcs/invoice-created";
import { processInvoicePaid } from "@/server/integrations/whmcs/invoice-paid";

export const dynamic = "force-dynamic";

/**
 * Webhook WHMCS (sin sesión). Firma HMAC sobre el body crudo; la org
 * `espacio-veloz` se resuelve en servidor, nunca desde el payload.
 */
export async function POST(req: Request) {
  const rl = checkRateLimit("whmcs-webhook", { windowMs: 60_000, max: 120 });
  if (!rl.allowed) {
    return apiError(429, "rate_limited", "Demasiadas solicitudes");
  }

  const rawBody = await req.text();
  const verified = verifyWhmcsHmac({
    rawBody,
    timestampHeader: req.headers.get("x-ev-timestamp"),
    signatureHeader: req.headers.get("x-ev-signature"),
    secret: getEnv().WHMCS_WEBHOOK_SECRET,
  });
  if (!verified.ok) {
    if (verified.reason === "expired") {
      return apiError(401, "timestamp_expired", "Timestamp inválido");
    }
    return apiError(401, "unauthorized", "No autorizado");
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody) as unknown;
  } catch {
    return apiError(400, "invalid_body", "El body debe ser JSON válido");
  }

  const envelope = eventEnvelopeSchema.safeParse(json);
  if (!envelope.success) {
    return apiError(400, "invalid_body", "Payload inválido");
  }

  if (envelope.data.event === INVOICE_CREATED_EVENT) {
    const parsed = invoiceCreatedSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(400, "invalid_body", "Payload inválido");
    }
    return runProcessor(() => processInvoiceCreated(parsed.data));
  }

  if (envelope.data.event === INVOICE_PAID_EVENT) {
    const parsed = invoicePaidSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(400, "invalid_body", "Payload inválido");
    }
    return runProcessor(() => processInvoicePaid(parsed.data));
  }

  return apiError(422, "unsupported_event", "Evento no soportado");
}

async function runProcessor(
  run: () => Promise<{ ok: true; duplicate: boolean; status: string; messageId?: string }>
): Promise<Response> {
  try {
    const result = await run();
    return Response.json(result);
  } catch (err) {
    if (err instanceof WhmcsIntegrationError) {
      return apiError(err.status, err.code, err.message);
    }
    console.error("[whmcs] error procesando evento");
    return apiError(500, "internal", "Error interno");
  }
}
