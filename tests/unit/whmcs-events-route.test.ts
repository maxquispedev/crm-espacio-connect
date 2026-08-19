import { beforeEach, describe, expect, it, vi } from "vitest";
import { signWhmcsPayload } from "@/server/integrations/whmcs/hmac";
import { processInvoiceCreated } from "@/server/integrations/whmcs/invoice-created";
import { processInvoicePaid } from "@/server/integrations/whmcs/invoice-paid";
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

vi.mock("@/server/integrations/whmcs/invoice-paid", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/integrations/whmcs/invoice-paid")>();
  return { ...original, processInvoicePaid: vi.fn() };
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

const validPaidBody = {
  event: "invoice.paid",
  invoiceId: 1346,
  client: { id: 123, name: "Max", phone: "51948134994" },
  invoice: {
    number: "1346",
    currency: "USD",
    total: "54.99",
    paidAt: "2026-08-19 13:51:00",
  },
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
    vi.mocked(processInvoicePaid).mockReset();
    vi.mocked(processInvoicePaid).mockResolvedValue({
      ok: true,
      duplicate: false,
      status: "completed",
      messageId: "msg_paid",
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
    expect(vi.mocked(processInvoicePaid)).not.toHaveBeenCalled();
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
    expect(vi.mocked(processInvoicePaid)).not.toHaveBeenCalled();
  });

  it("payload inválido firmado → 400", async () => {
    const { POST } = await import(
      "@/app/api/integrations/whmcs/events/route"
    );
    const res = await POST(signedRequest({ event: "invoice.created" }));
    expect(res.status).toBe(400);
    expect(vi.mocked(processInvoiceCreated)).not.toHaveBeenCalled();
  });

  it("invoice.paid inválido (sin paidAt) → 400 y no llama processors", async () => {
    const { POST } = await import(
      "@/app/api/integrations/whmcs/events/route"
    );
    const res = await POST(
      signedRequest({ event: "invoice.paid", invoiceId: 1346 })
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(processInvoiceCreated)).not.toHaveBeenCalled();
    expect(vi.mocked(processInvoicePaid)).not.toHaveBeenCalled();
  });

  it("invoice.overdue → 422", async () => {
    const { POST } = await import(
      "@/app/api/integrations/whmcs/events/route"
    );
    const res = await POST(
      signedRequest({ ...validBody, event: "invoice.overdue" })
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe("unsupported_event");
    expect(vi.mocked(processInvoiceCreated)).not.toHaveBeenCalled();
    expect(vi.mocked(processInvoicePaid)).not.toHaveBeenCalled();
  });

  it("HMAC válido dispara processInvoiceCreated", async () => {
    const { POST } = await import(
      "@/app/api/integrations/whmcs/events/route"
    );
    const res = await POST(signedRequest(validBody));
    expect(res.status).toBe(200);
    expect(processInvoiceCreated).toHaveBeenCalledTimes(1);
    expect(vi.mocked(processInvoicePaid)).not.toHaveBeenCalled();
  });

  it("HMAC válido + invoice.paid dispara processInvoicePaid y no created", async () => {
    const { POST } = await import(
      "@/app/api/integrations/whmcs/events/route"
    );
    const res = await POST(signedRequest(validPaidBody));
    expect(res.status).toBe(200);
    expect(processInvoicePaid).toHaveBeenCalledTimes(1);
    expect(vi.mocked(processInvoiceCreated)).not.toHaveBeenCalled();
  });

  it("organizationId en el payload no procesa ni llama al sender", async () => {
    const { POST } = await import(
      "@/app/api/integrations/whmcs/events/route"
    );
    const res = await POST(
      signedRequest({ ...validBody, organizationId: "otra-organizacion" })
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(processInvoiceCreated)).not.toHaveBeenCalled();
  });

  it("organizationId en invoice.paid no procesa", async () => {
    const { POST } = await import(
      "@/app/api/integrations/whmcs/events/route"
    );
    const res = await POST(
      signedRequest({ ...validPaidBody, organizationId: "otra-organizacion" })
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(processInvoicePaid)).not.toHaveBeenCalled();
    expect(vi.mocked(processInvoiceCreated)).not.toHaveBeenCalled();
  });
});
