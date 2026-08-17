import { z } from "zod";

export const WHMCS_SOURCE = "whmcs";
export const INVOICE_CREATED_EVENT = "invoice.created";
export const INVOICE_CREATED_TEMPLATE = "invoice_created";
export const WHMCS_ORG_SLUG = "espacio-veloz";

const phoneSchema = z
  .string()
  .trim()
  .min(7)
  .max(32);

const itemSchema = z.object({
  description: z.string().trim().min(1).max(500),
});

/**
 * Contrato `invoice.created`. Campos de tenant / Meta / IDs internos no
 * están en el schema: Zod los descarta (strip) y jamás se usan.
 */
export const invoiceCreatedSchema = z.object({
  event: z.literal(INVOICE_CREATED_EVENT),
  invoiceId: z.union([
    z.number().int().positive().max(2_147_483_647),
    z
      .string()
      .trim()
      .regex(/^[0-9]{1,20}$/),
  ]),
  client: z.object({
    id: z.union([
      z.number().int().positive(),
      z.string().trim().min(1).max(40),
    ]),
    name: z.string().trim().min(1).max(120),
    phone: phoneSchema,
  }),
  invoice: z.object({
    number: z.string().trim().min(1).max(40),
    currency: z.string().trim().min(1).max(8),
    total: z.string().trim().min(1).max(32),
    dueDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate debe ser YYYY-MM-DD"),
  }),
  items: z.array(itemSchema).min(1).max(20),
});

export type InvoiceCreatedPayload = z.infer<typeof invoiceCreatedSchema>;

export const eventEnvelopeSchema = z
  .object({
    event: z.string().trim().min(1).max(80),
  })
  .passthrough();

export function invoiceExternalId(
  invoiceId: InvoiceCreatedPayload["invoiceId"]
): string {
  return String(invoiceId);
}

/** Fecha calendar-only YYYY-MM-DD → DD/MM/YYYY, sin timezone. */
export function formatDueDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/** Importe estable: `total` + espacio + `currency` (p. ej. `49.99 USD`). */
export function formatInvoiceAmount(total: string, currency: string): string {
  return `${total.trim()} ${currency.trim()}`;
}

/** Une descripciones en orden, determinista. */
export function joinItemDescriptions(
  items: InvoiceCreatedPayload["items"]
): string {
  return items.map((item) => item.description.trim()).join(" · ");
}

/**
 * Variables BODY {{1}}…{{5}} para `invoice_created`.
 */
export function buildInvoiceTemplateVariables(
  payload: InvoiceCreatedPayload
): string[] {
  return [
    payload.client.name.trim(),
    payload.invoice.number.trim(),
    formatInvoiceAmount(payload.invoice.total, payload.invoice.currency),
    formatDueDate(payload.invoice.dueDate),
    joinItemDescriptions(payload.items),
  ];
}
