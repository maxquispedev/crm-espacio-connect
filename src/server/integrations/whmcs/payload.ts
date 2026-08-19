import { z } from "zod";

export const WHMCS_SOURCE = "whmcs";
export const INVOICE_CREATED_EVENT = "invoice.created";
export const INVOICE_CREATED_TEMPLATE = "invoice_created";
export const INVOICE_PAID_EVENT = "invoice.paid";
export const INVOICE_PAID_TEMPLATE = "invoice_paid";
export const WHMCS_ORG_SLUG = "espacio-veloz";

/** Contrato de `invoice.paid`: datetime local de WHMCS, sin timezone. */
export const PAID_AT_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const phoneSchema = z.string().trim().min(7).max(32);

const invoiceIdSchema = z.union([
  z.number().int().positive().max(2_147_483_647),
  z
    .string()
    .trim()
    .regex(/^[0-9]{1,20}$/),
]);

const clientSchema = z.object({
  id: z.union([
    z.number().int().positive(),
    z.string().trim().min(1).max(40),
  ]),
  name: z.string().trim().min(1).max(120),
  phone: phoneSchema,
});

const itemSchema = z.object({
  description: z.string().trim().min(1).max(500),
});

/**
 * WHMCS no puede elegir tenant ni IDs internos. Presencia explícita → inválido.
 * El resto de campos extra se sigue descartando (no usamos `.strict()`).
 */
export const FORBIDDEN_WHMCS_SELECTION_KEYS = [
  "organizationId",
  "organization",
  "organizationSlug",
  "phoneNumberId",
  "wabaId",
  "templateId",
  "conversationId",
  "contactId",
] as const;

function rejectForbiddenSelectionKeys(
  raw: Record<string, unknown>,
  ctx: z.RefinementCtx
): void {
  for (const key of FORBIDDEN_WHMCS_SELECTION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: "Campo no permitido",
      });
    }
  }
}

function isolateWhmcsPayload<T extends z.ZodType>(fields: T) {
  return z
    .object({})
    .passthrough()
    .superRefine(rejectForbiddenSelectionKeys)
    .pipe(fields);
}

const invoiceCreatedFields = z.object({
  event: z.literal(INVOICE_CREATED_EVENT),
  invoiceId: invoiceIdSchema,
  client: clientSchema,
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

/**
 * Contrato `invoice.created`. Org y credenciales se resuelven en servidor.
 */
export const invoiceCreatedSchema = isolateWhmcsPayload(invoiceCreatedFields);

export type InvoiceCreatedPayload = z.infer<typeof invoiceCreatedSchema>;

const invoicePaidFields = z.object({
  event: z.literal(INVOICE_PAID_EVENT),
  invoiceId: invoiceIdSchema,
  client: clientSchema,
  invoice: z.object({
    number: z.string().trim().min(1).max(40),
    currency: z.string().trim().min(1).max(8),
    total: z.string().trim().min(1).max(32),
    paidAt: z
      .string()
      .trim()
      .regex(PAID_AT_PATTERN, "paidAt debe ser YYYY-MM-DD HH:MM:SS"),
  }),
});

/**
 * Contrato `invoice.paid`. Mismo aislamiento de tenant que created.
 * No exige `items` ni `dueDate`.
 */
export const invoicePaidSchema = isolateWhmcsPayload(invoicePaidFields);

export type InvoicePaidPayload = z.infer<typeof invoicePaidSchema>;

export const eventEnvelopeSchema = z
  .object({
    event: z.string().trim().min(1).max(80),
  })
  .passthrough();

export type WhmcsInvoiceId =
  | InvoiceCreatedPayload["invoiceId"]
  | InvoicePaidPayload["invoiceId"];

export function invoiceExternalId(invoiceId: WhmcsInvoiceId): string {
  return String(invoiceId);
}

/** Fecha calendar-only YYYY-MM-DD → DD/MM/YYYY, sin timezone. */
export function formatDueDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/**
 * Datetime WHMCS `YYYY-MM-DD HH:MM:SS` → `DD/MM/YYYY HH:MM`.
 * Recorte léxico: sin Date, sin timezone, sin segundos en el mensaje.
 */
export function formatPaidAt(paidAt: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(paidAt);
  if (!match) return paidAt;
  const [, year, month, day, hour, minute] = match;
  return `${day}/${month}/${year} ${hour}:${minute}`;
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

/**
 * Variables BODY {{1}}…{{4}} para `invoice_paid`. Sin botón URL.
 */
export function buildInvoicePaidTemplateVariables(
  payload: InvoicePaidPayload
): string[] {
  return [
    payload.client.name.trim(),
    payload.invoice.number.trim(),
    formatInvoiceAmount(payload.invoice.total, payload.invoice.currency),
    formatPaidAt(payload.invoice.paidAt),
  ];
}
