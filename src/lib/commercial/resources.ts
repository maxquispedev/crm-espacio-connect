import { BlockList, isIP } from "node:net";
import { z } from "zod";

export const DEMO_RESOURCE_SLOTS = [
  "demo_enrollment_panel",
  "demo_payments_balances",
  "demo_online_enrollment",
] as const;
export const COMMERCIAL_RESOURCE_SLOTS = [
  ...DEMO_RESOURCE_SLOTS,
  "payment_instructions",
] as const;
export type DemoResourceSlot = (typeof DEMO_RESOURCE_SLOTS)[number];
export type CommercialResourceSlot = (typeof COMMERCIAL_RESOURCE_SLOTS)[number];

const privateAddresses = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.168.0.0", 16], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) privateAddresses.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) privateAddresses.addSubnet(address, prefix, "ipv6");

/** Validación sintáctica solamente: nunca resuelve DNS ni visita el destino. */
function isPaymentLink(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (!host || host === "localhost" || host.endsWith(".localhost") ||
        host === "local" || host.endsWith(".local")) return false;
    const family = isIP(host);
    return !family || !privateAddresses.check(host, family === 4 ? "ipv4" : "ipv6");
  } catch {
    return false;
  }
}

const label = z.string().trim().min(1).max(120);
const account = z.string().trim().min(1).max(40)
  .regex(/^[\d -]+$/).refine((v) => /\d/.test(v), "Debe contener dígitos");
export const TransferSchema = z.object({
  bank: label,
  holder: label,
  currency: z.enum(["PEN", "USD"]),
  accountNumber: account.optional(),
  cci: account.optional(),
}).strict().refine((v) => v.accountNumber !== undefined || v.cci !== undefined, {
  message: "Se requiere cuenta o CCI", path: ["accountNumber"],
});

export const PaymentInstructionsSchema = z.object({
  transfers: z.array(TransferSchema).max(5),
  yape: z.object({
    phone: z.string().trim().transform((v) => v.replace(/^\+51\s*/, ""))
      .pipe(z.string().regex(/^\d{9}$/, "Teléfono peruano de 9 dígitos")),
    holder: label,
  }).strict().nullable(),
  paymentLink: z.string().trim().max(2048)
    .refine(isPaymentLink, "URL HTTPS absoluta sin credenciales ni host local/privado")
    .nullable(),
}).strict();
export type PaymentInstructions = z.infer<typeof PaymentInstructionsSchema>;

/** Vacío es válido; no implica que exista un método de cobro configurado. */
export function hasPaymentInstructions(value: PaymentInstructions): boolean {
  return value.transfers.length > 0 || value.yape !== null || value.paymentLink !== null;
}

export const CommercialResourceValueSchema = z.discriminatedUnion("slot", [
  z.object({
    slot: z.enum(DEMO_RESOURCE_SLOTS),
    mediaAssetId: z.string().regex(/^[\w.-]{1,64}$/),
    payload: z.null(),
  }).strict(),
  z.object({
    slot: z.literal("payment_instructions"),
    mediaAssetId: z.null(),
    payload: PaymentInstructionsSchema,
  }).strict(),
]);
export type CommercialResourceValue = z.infer<typeof CommercialResourceValueSchema>;
