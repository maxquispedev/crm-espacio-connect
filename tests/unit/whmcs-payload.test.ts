import { describe, expect, it } from "vitest";
import {
  buildInvoicePaidTemplateVariables,
  buildInvoiceTemplateVariables,
  eventEnvelopeSchema,
  formatDueDate,
  formatInvoiceAmount,
  formatPaidAt,
  invoiceCreatedSchema,
  invoiceExternalId,
  invoicePaidSchema,
  joinItemDescriptions,
} from "@/server/integrations/whmcs/payload";

const valid = {
  event: "invoice.created" as const,
  invoiceId: 1296,
  client: { id: 123, name: "Mateo", phone: "51999999999" },
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

describe("invoiceCreatedSchema", () => {
  it("acepta el contrato documentado", () => {
    const parsed = invoiceCreatedSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("payload inválido (sin cliente) → fail", () => {
    const { client: _c, ...rest } = valid;
    expect(invoiceCreatedSchema.safeParse(rest).success).toBe(false);
  });

  it("rechaza organizationId y demás campos de selección de tenant", () => {
    const keys = [
      "organizationId",
      "organization",
      "organizationSlug",
      "phoneNumberId",
      "wabaId",
      "templateId",
      "conversationId",
      "contactId",
    ] as const;
    for (const key of keys) {
      const parsed = invoiceCreatedSchema.safeParse({
        ...valid,
        [key]: "intruso",
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("otros campos extra se descartan y el contrato sigue válido", () => {
    const parsed = invoiceCreatedSchema.safeParse({
      ...valid,
      source: "whmcs",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("source");
    }
  });
});

const validPaid = {
  event: "invoice.paid" as const,
  invoiceId: 1346,
  client: { id: 123, name: "Max", phone: "51948134994" },
  invoice: {
    number: "1346",
    currency: "USD",
    total: "54.99",
    paidAt: "2026-08-19 13:51:00",
  },
};

describe("invoicePaidSchema", () => {
  it("acepta el contrato documentado", () => {
    const parsed = invoicePaidSchema.safeParse(validPaid);
    expect(parsed.success).toBe(true);
  });

  it("payload inválido (sin cliente) → fail", () => {
    const { client: _c, ...rest } = validPaid;
    expect(invoicePaidSchema.safeParse(rest).success).toBe(false);
  });

  it("sin paidAt → fail", () => {
    const { paidAt: _p, ...invoice } = validPaid.invoice;
    expect(
      invoicePaidSchema.safeParse({ ...validPaid, invoice }).success
    ).toBe(false);
  });

  it.each([
    "2026-08-19",
    "2026-08-19T13:51:00",
    "2026-08-19 13:51:00Z",
    "2026-08-19 13:51:00-05:00",
    "19/08/2026 13:51:00",
    "2026-08-19 13:51",
  ])("paidAt inválido %s → fail", (paidAt) => {
    expect(
      invoicePaidSchema.safeParse({
        ...validPaid,
        invoice: { ...validPaid.invoice, paidAt },
      }).success
    ).toBe(false);
  });

  it("rechaza organizationId y demás campos de selección de tenant", () => {
    const keys = [
      "organizationId",
      "organization",
      "organizationSlug",
      "phoneNumberId",
      "wabaId",
      "templateId",
      "conversationId",
      "contactId",
    ] as const;
    for (const key of keys) {
      const parsed = invoicePaidSchema.safeParse({
        ...validPaid,
        [key]: "intruso",
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("dueDate e items extra se descartan y el contrato sigue válido", () => {
    const parsed = invoicePaidSchema.safeParse({
      ...validPaid,
      items: [{ description: "Hosting" }],
      invoice: { ...validPaid.invoice, dueDate: "2026-04-02" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.invoice).not.toHaveProperty("dueDate");
      expect(parsed.data).not.toHaveProperty("items");
    }
  });
});

describe("eventEnvelopeSchema", () => {
  it("invoice.paid se distingue por el campo event", () => {
    const parsed = eventEnvelopeSchema.parse({ event: "invoice.paid" });
    expect(parsed.event).toBe("invoice.paid");
  });

  it("evento desconocido se distingue por el campo event", () => {
    const parsed = eventEnvelopeSchema.parse({ event: "invoice.overdue" });
    expect(parsed.event).toBe("invoice.overdue");
  });
});

describe("variables de plantilla", () => {
  it("formatea fecha calendar-only sin timezone", () => {
    expect(formatDueDate("2026-04-02")).toBe("02/04/2026");
  });

  it("importe estable total + currency", () => {
    expect(formatInvoiceAmount("49.99", "USD")).toBe("49.99 USD");
  });

  it("une varios items de forma determinista", () => {
    expect(
      joinItemDescriptions([
        { description: "A" },
        { description: "B" },
      ])
    ).toBe("A · B");
  });

  it("construye {{1}}…{{5}} y el invoiceId como string", () => {
    expect(buildInvoiceTemplateVariables(valid)).toEqual([
      "Mateo",
      "1296",
      "49.99 USD",
      "02/04/2026",
      "Espacio Impulsa - mijunapaqollantaytambo.com (02/04/2026 - 01/04/2027)",
    ]);
    expect(invoiceExternalId(valid.invoiceId)).toBe("1296");
  });

  it("paidAt YYYY-MM-DD HH:MM:SS → DD/MM/YYYY HH:MM sin timezone", () => {
    expect(formatPaidAt("2026-08-19 13:51:00")).toBe("19/08/2026 13:51");
  });

  it("construye {{1}}…{{4}} para invoice.paid", () => {
    expect(buildInvoicePaidTemplateVariables(validPaid)).toEqual([
      "Max",
      "1346",
      "54.99 USD",
      "19/08/2026 13:51",
    ]);
    expect(invoiceExternalId(validPaid.invoiceId)).toBe("1346");
  });
});
