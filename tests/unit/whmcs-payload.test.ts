import { describe, expect, it } from "vitest";
import {
  buildInvoiceTemplateVariables,
  eventEnvelopeSchema,
  formatDueDate,
  formatInvoiceAmount,
  invoiceCreatedSchema,
  invoiceExternalId,
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

describe("eventEnvelopeSchema", () => {
  it("evento no soportado se distingue por el campo event", () => {
    const parsed = eventEnvelopeSchema.parse({ event: "invoice.paid" });
    expect(parsed.event).toBe("invoice.paid");
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
});
