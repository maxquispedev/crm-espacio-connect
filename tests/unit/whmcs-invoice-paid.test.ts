import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoicePaidDeps } from "@/server/integrations/whmcs/invoice-paid";
import {
  processInvoicePaid,
  WhmcsIntegrationError,
} from "@/server/integrations/whmcs/invoice-paid";
import type { InvoicePaidPayload } from "@/server/integrations/whmcs/payload";

const payload: InvoicePaidPayload = {
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

const EV_ORG = "org_espacio_veloz";

type EventRow = {
  id: string;
  eventType: string;
  externalId: string;
  status: "reserved" | "completed" | "failed";
  messageId: string | null;
};

function eventKey(eventType: string, externalId: string): string {
  return `${eventType}:${externalId}`;
}

function makeDeps(opts?: {
  orgId?: string | null;
  templateId?: string | null;
  contactIsNew?: boolean;
  sendImpl?: InvoicePaidDeps["sendTemplate"];
  seedEvents?: EventRow[];
}): {
  deps: InvoicePaidDeps;
  events: Map<string, EventRow>;
  sendTemplate: ReturnType<typeof vi.fn>;
  getOrCreateContact: ReturnType<typeof vi.fn>;
} {
  const events = new Map<string, EventRow>();
  for (const row of opts?.seedEvents ?? []) {
    events.set(eventKey(row.eventType, row.externalId), row);
  }
  const sendTemplate = vi.fn(
    opts?.sendImpl ?? (async () => ({ messageId: "msg_paid" }))
  );
  const getOrCreateContact = vi.fn(async () => ({
    contact: { id: "ct_1", name: "Max", phone: "51948134994" },
    isNew: opts?.contactIsNew ?? true,
  }));

  const deps: InvoicePaidDeps = {
    findOrgBySlug: async (slug) => {
      if (slug !== "espacio-veloz") return null;
      if (opts?.orgId === null) return null;
      return { id: opts?.orgId ?? EV_ORG };
    },
    reserveEvent: async ({ externalId }) => {
      const key = eventKey("invoice.paid", externalId);
      const existing = events.get(key);
      if (existing) {
        return {
          kind: "existing",
          id: existing.id,
          status: existing.status,
          messageId: existing.messageId,
        };
      }
      const row: EventRow = {
        id: `iev_paid_${externalId}`,
        eventType: "invoice.paid",
        externalId,
        status: "reserved",
        messageId: null,
      };
      events.set(key, row);
      return { kind: "created", id: row.id };
    },
    markEvent: async ({ id, status, messageId }) => {
      for (const row of events.values()) {
        if (row.id === id) {
          row.status = status;
          row.messageId = messageId ?? null;
        }
      }
    },
    findApprovedPaidTemplate: async (organizationId) => {
      if (organizationId !== EV_ORG) return null;
      if (opts?.templateId === null) return null;
      return { id: opts?.templateId ?? "tpl_invoice_paid" };
    },
    getOrCreateContact:
      getOrCreateContact as unknown as InvoicePaidDeps["getOrCreateContact"],
    getOrCreateConversation: vi.fn(async () => ({
      id: "cv_1",
      isTest: false,
    })) as unknown as InvoicePaidDeps["getOrCreateConversation"],
    sendTemplate: sendTemplate as InvoicePaidDeps["sendTemplate"],
  };

  return { deps, events, sendTemplate, getOrCreateContact };
}

describe("processInvoicePaid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("org espacio-veloz inexistente → no reserva ni envía", async () => {
    const { deps, sendTemplate, events } = makeDeps({ orgId: null });
    await expect(processInvoicePaid(payload, deps)).rejects.toMatchObject({
      code: "org_not_found",
    });
    expect(events.size).toBe(0);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("primera ejecución llama sendTemplate con 4 vars y sin botón URL", async () => {
    const { deps, sendTemplate, events } = makeDeps();
    const result = await processInvoicePaid(payload, deps);
    expect(result).toEqual({
      ok: true,
      duplicate: false,
      status: "completed",
      messageId: "msg_paid",
    });
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect(sendTemplate).toHaveBeenCalledWith({
      organizationId: EV_ORG,
      conversationId: "cv_1",
      templateId: "tpl_invoice_paid",
      variables: ["Max", "1346", "54.99 USD", "19/08/2026 13:51"],
    });
    const arg = sendTemplate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("urlButtonSuffix");
    expect(events.get("invoice.paid:1346")?.status).toBe("completed");
  });

  it("duplicado secuencial no vuelve a llamar al sender", async () => {
    const { deps, sendTemplate } = makeDeps();
    await processInvoicePaid(payload, deps);
    const second = await processInvoicePaid(payload, deps);
    expect(second.duplicate).toBe(true);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it("duplicado concurrente: el segundo no envía", async () => {
    const { deps, sendTemplate } = makeDeps();
    const started = processInvoicePaid(payload, deps);
    const raced = processInvoicePaid(payload, deps);
    const results = await Promise.all([started, raced]);
    const sends = results.filter((r) => !r.duplicate);
    const dupes = results.filter((r) => r.duplicate);
    expect(sends).toHaveLength(1);
    expect(dupes).toHaveLength(1);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it("invoice.created completed del mismo invoiceId no bloquea paid", async () => {
    const { deps, sendTemplate, events } = makeDeps({
      seedEvents: [
        {
          id: "iev_created_1346",
          eventType: "invoice.created",
          externalId: "1346",
          status: "completed",
          messageId: "msg_created",
        },
      ],
    });
    const result = await processInvoicePaid(payload, deps);
    expect(result.duplicate).toBe(false);
    expect(result.status).toBe("completed");
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect(events.get("invoice.created:1346")?.status).toBe("completed");
    expect(events.get("invoice.paid:1346")?.status).toBe("completed");
  });

  it("template inexistente/no approved no llama a Meta y deja reserva failed", async () => {
    const { deps, sendTemplate, events } = makeDeps({ templateId: null });
    await expect(processInvoicePaid(payload, deps)).rejects.toMatchObject({
      code: "template_unavailable",
    });
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(events.get("invoice.paid:1346")?.status).toBe("failed");
  });

  it("retry posterior a fallo no vuelve a llamar al sender", async () => {
    const { deps, sendTemplate } = makeDeps({ templateId: null });
    await expect(processInvoicePaid(payload, deps)).rejects.toBeInstanceOf(
      WhmcsIntegrationError
    );
    await expect(processInvoicePaid(payload, deps)).resolves.toMatchObject({
      duplicate: true,
      status: "failed",
    });
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("fallo de sendTemplate conserva reserva failed", async () => {
    const { deps, events } = makeDeps({
      sendImpl: async () => {
        throw new Error("meta down");
      },
    });
    await expect(processInvoicePaid(payload, deps)).rejects.toThrow(
      "meta down"
    );
    expect(events.get("invoice.paid:1346")?.status).toBe("failed");
  });

  it("teléfono 51948134994 llega a getOrCreateContact", async () => {
    const { deps, getOrCreateContact } = makeDeps();
    await processInvoicePaid(payload, deps);
    expect(getOrCreateContact).toHaveBeenCalledWith(
      EV_ORG,
      "51948134994",
      "Max"
    );
  });

  it("aislamiento: sendTemplate recibe solo el orgId de espacio-veloz", async () => {
    const { deps, sendTemplate } = makeDeps();
    await processInvoicePaid(payload, deps);
    const arg = sendTemplate.mock.calls[0]?.[0] as { organizationId: string };
    expect(arg.organizationId).toBe(EV_ORG);
    expect(arg.organizationId).not.toContain("vende");
    expect(arg.organizationId).not.toContain("quispe");
  });

  it("teléfono inválido no reserva", async () => {
    const { deps, events, sendTemplate } = makeDeps();
    await expect(
      processInvoicePaid(
        { ...payload, client: { ...payload.client, phone: "12" } },
        deps
      )
    ).rejects.toMatchObject({ code: "invalid_phone" });
    expect(events.size).toBe(0);
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});
