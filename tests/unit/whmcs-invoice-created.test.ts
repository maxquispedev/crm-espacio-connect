import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceCreatedDeps } from "@/server/integrations/whmcs/invoice-created";
import {
  processInvoiceCreated,
  WhmcsIntegrationError,
} from "@/server/integrations/whmcs/invoice-created";
import type { InvoiceCreatedPayload } from "@/server/integrations/whmcs/payload";

const payload: InvoiceCreatedPayload = {
  event: "invoice.created",
  invoiceId: 1296,
  client: { id: 123, name: "Mateo", phone: "+51 999 999 999" },
  invoice: {
    number: "1296",
    currency: "USD",
    total: "49.99",
    dueDate: "2026-04-02",
  },
  items: [
    {
      description:
        "Espacio Impulsa - mijunapaqollantaytambo.com (02/04/2026 - 01/04/2027)",
    },
  ],
};

const EV_ORG = "org_espacio_veloz";

type EventRow = {
  id: string;
  status: "reserved" | "completed" | "failed";
  messageId: string | null;
};

function makeDeps(opts?: {
  orgId?: string | null;
  templateId?: string | null;
  contactIsNew?: boolean;
  sendImpl?: InvoiceCreatedDeps["sendTemplate"];
}): {
  deps: InvoiceCreatedDeps;
  events: Map<string, EventRow>;
  sendTemplate: ReturnType<typeof vi.fn>;
  getOrCreateContact: ReturnType<typeof vi.fn>;
} {
  const events = new Map<string, EventRow>();
  const sendTemplate = vi.fn(
    opts?.sendImpl ?? (async () => ({ messageId: "msg_1" }))
  );
  const getOrCreateContact = vi.fn(async () => ({
    contact: { id: "ct_1", name: "Mateo", phone: "51999999999" },
    isNew: opts?.contactIsNew ?? true,
  }));

  const deps: InvoiceCreatedDeps = {
    findOrgBySlug: async (slug) => {
      if (slug !== "espacio-veloz") return null;
      if (opts?.orgId === null) return null;
      return { id: opts?.orgId ?? EV_ORG };
    },
    reserveEvent: async ({ externalId }) => {
      const existing = events.get(externalId);
      if (existing) {
        return {
          kind: "existing",
          id: existing.id,
          status: existing.status,
          messageId: existing.messageId,
        };
      }
      const row: EventRow = {
        id: `iev_${externalId}`,
        status: "reserved",
        messageId: null,
      };
      events.set(externalId, row);
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
    findApprovedInvoiceTemplate: async (organizationId) => {
      if (organizationId !== EV_ORG) return null;
      if (opts?.templateId === null) return null;
      return { id: opts?.templateId ?? "tpl_invoice" };
    },
    getOrCreateContact: getOrCreateContact as unknown as InvoiceCreatedDeps["getOrCreateContact"],
    getOrCreateConversation: vi.fn(async () => ({
      id: "cv_1",
      isTest: false,
    })) as unknown as InvoiceCreatedDeps["getOrCreateConversation"],
    sendTemplate: sendTemplate as InvoiceCreatedDeps["sendTemplate"],
  };

  return { deps, events, sendTemplate, getOrCreateContact };
}

describe("processInvoiceCreated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("org espacio-veloz inexistente → no reserva ni envía", async () => {
    const { deps, sendTemplate, events } = makeDeps({ orgId: null });
    await expect(processInvoiceCreated(payload, deps)).rejects.toMatchObject({
      code: "org_not_found",
    });
    expect(events.size).toBe(0);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("primera ejecución llama sendTemplate con 5 vars y botón invoiceId", async () => {
    const { deps, sendTemplate, events } = makeDeps();
    const result = await processInvoiceCreated(payload, deps);
    expect(result).toEqual({
      ok: true,
      duplicate: false,
      status: "completed",
      messageId: "msg_1",
    });
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect(sendTemplate).toHaveBeenCalledWith({
      organizationId: EV_ORG,
      conversationId: "cv_1",
      templateId: "tpl_invoice",
      variables: [
        "Mateo",
        "1296",
        "49.99 USD",
        "02/04/2026",
        "Espacio Impulsa - mijunapaqollantaytambo.com (02/04/2026 - 01/04/2027)",
      ],
      urlButtonSuffix: "1296",
    });
    expect(events.get("1296")?.status).toBe("completed");
  });

  it("duplicado secuencial no vuelve a llamar al sender", async () => {
    const { deps, sendTemplate } = makeDeps();
    await processInvoiceCreated(payload, deps);
    const second = await processInvoiceCreated(payload, deps);
    expect(second.duplicate).toBe(true);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it("duplicado concurrente: el segundo no envía", async () => {
    const { deps, sendTemplate } = makeDeps();
    const started = processInvoiceCreated(payload, deps);
    const raced = processInvoiceCreated(payload, deps);
    const results = await Promise.all([started, raced]);
    const sends = results.filter((r) => !r.duplicate);
    const dupes = results.filter((r) => r.duplicate);
    expect(sends).toHaveLength(1);
    expect(dupes).toHaveLength(1);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it("template inexistente/no approved no llama a Meta y deja reserva failed", async () => {
    const { deps, sendTemplate, events } = makeDeps({ templateId: null });
    await expect(processInvoiceCreated(payload, deps)).rejects.toMatchObject({
      code: "template_unavailable",
    });
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(events.get("1296")?.status).toBe("failed");
  });

  it("retry posterior a fallo no vuelve a llamar al sender", async () => {
    const { deps, sendTemplate } = makeDeps({ templateId: null });
    await expect(processInvoiceCreated(payload, deps)).rejects.toBeInstanceOf(
      WhmcsIntegrationError
    );
    await expect(processInvoiceCreated(payload, deps)).resolves.toMatchObject({
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
    await expect(processInvoiceCreated(payload, deps)).rejects.toThrow(
      "meta down"
    );
    expect(events.get("1296")?.status).toBe("failed");
  });

  it("contacto nuevo y existente reutilizan getOrCreateContact", async () => {
    const created = makeDeps({ contactIsNew: true });
    await processInvoiceCreated(payload, created.deps);
    expect(created.getOrCreateContact).toHaveBeenCalledWith(
      EV_ORG,
      "51999999999",
      "Mateo"
    );

    const existing = makeDeps({ contactIsNew: false });
    await processInvoiceCreated(payload, existing.deps);
    expect(existing.getOrCreateContact).toHaveBeenCalledWith(
      EV_ORG,
      "51999999999",
      "Mateo"
    );
  });

  it("aislamiento: sendTemplate recibe solo el orgId de espacio-veloz", async () => {
    const { deps, sendTemplate } = makeDeps();
    await processInvoiceCreated(payload, deps);
    const arg = sendTemplate.mock.calls[0]?.[0] as { organizationId: string };
    expect(arg.organizationId).toBe(EV_ORG);
    expect(arg.organizationId).not.toContain("vende");
    expect(arg.organizationId).not.toContain("quispe");
  });

  it("teléfono inválido no reserva", async () => {
    const { deps, events, sendTemplate } = makeDeps();
    await expect(
      processInvoiceCreated(
        { ...payload, client: { ...payload.client, phone: "12" } },
        deps
      )
    ).rejects.toMatchObject({ code: "invalid_phone" });
    expect(events.size).toBe(0);
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});
