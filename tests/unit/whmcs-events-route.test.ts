import { beforeEach, describe, expect, it, vi } from "vitest";
import { signWhmcsPayload } from "@/server/integrations/whmcs/hmac";
import { processInvoiceCreated } from "@/server/integrations/whmcs/invoice-created";
import { resetRateLimit } from "@/lib/rate-limit";

const SECRET = "whmcs-secret-de-prueba-32ch";

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ WHMCS_WEBHOOK_SECRET: SECRET }),
}));

vi.mock("@/server/integrations/whmcs/invoice-created", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/integrations/whmcs/invoice-created")>();
  return { ...original, processInvoiceCreated: vi.fn() };
});

const validBody = {
  event: "invoice.created",
  invoiceId: 1296,
  client: { id: 123, name: "Mateo", phone: "51999999999" },
  invoice: {
    number: "1296",
    currency: "USD",
    total: "49.99",
    dueDate: "2026-04-02",
  },
  items: [{ description: "Hosting" }],
};

function signedRequest(
  body: unknown,
  opts?: { ts?: number; secret?: string; signature?: string }
) {
  const raw = JSON.stringify(body);
  const now = opts?.ts ?? Math.floor(Date.now() / 1000);
  const signed = signWhmcsPayload(raw, opts?.secret ?? SECRET, now);
  return new Request("http://localhost/api/integrations/whmcs/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ev-timestamp": String(now),
      "x-ev-signature": opts?.signature ?? signed.signature,
    },
    body: raw,
  });
}

describe("POST /api/integrations/whmcs/events", () => {
  beforeEach(() => {
    resetRateLimit();
    vi.mocked(processInvoiceCreated).mockReset();
    vi.mocked(processInvoiceCreated).mockResolvedValue({
      ok: true,
      duplicate: false,
      status: "completed",
      messageId: "msg_1",
    });
  });

  it("HMAC inválido no procesa el dominio", async () => {
    const { POST } = await import(
      "@/app/api/integrations/whmcs/events/route"
    );
    const res = await POST(
      signedRequest(validBody, { signature: "sha256=00" })
    );
    expect(res.status).toBe(401);
    expect(vi.mocked(processInvoiceCreated)).not.toHaveBeenCalled();
  });

  it("timestamp expirado no procesa", async () => {
    const { POST } = await import(
      "@/app/api/integrations/whmcs/events/route"
    );
    const res = await POST(
      signedRequest(validBody, { ts: Math.floor(Date.now() / 1000) - 400 })
    );
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe("timestamp_expired");
    expect(vi.mocked(processInvoiceCreated)).not.toHaveBeenCalled();
  });

  it("payload inválido firmado → 400", async () => {
    const { POST } = await import(
      "@/app/api/integrations/whmcs/events/route"
    );
    const res = await POST(signedRequest({ event: "invoice.created" }));
    expect(res.status).toBe(400);
    expect(vi.mocked(processInvoiceCreated)).not.toHaveBeenCalled();
  });

  it("evento no soportado → 422", async () => {
    const { POST } = await import(
      "@/app/api/integrations/whmcs/events/route"
    );
    const res = await POST(
      signedRequest({ ...validBody, event: "invoice.paid" })
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe("unsupported_event");
    expect(vi.mocked(processInvoiceCreated)).not.toHaveBeenCalled();
  });

  it("HMAC válido dispara processInvoiceCreated", async () => {
    const { POST } = await import(
      "@/app/api/integrations/whmcs/events/route"
    );
    const res = await POST(signedRequest(validBody));
    expect(res.status).toBe(200);
    expect(processInvoiceCreated).toHaveBeenCalledTimes(1);
  });
});
