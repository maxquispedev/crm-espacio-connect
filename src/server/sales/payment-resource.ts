import { getCommercialResource } from "@/lib/commercial/store";
import { PaymentInstructionsSchema, hasPaymentInstructions, type PaymentInstructions } from "@/lib/commercial/resources";

export const PAYMENT_UNAVAILABLE_TEXT = "No tengo métodos de pago configurados disponibles ahora. Te paso con el equipo para coordinar el pago y la implementación; aún no se ha confirmado ningún pago ni activación.";
export async function loadPaymentInstructions(organizationId: string): Promise<PaymentInstructions | null> {
  try {
    const resource = await getCommercialResource(organizationId, "payment_instructions");
    return resource?.slot === "payment_instructions" && hasPaymentInstructions(resource.payload) ? resource.payload : null;
  } catch {
    console.warn("[sales] instrucciones de pago no disponibles");
    return null;
  }
}

/** Destinos únicamente del recurso validado. Nunca usa texto del LLM ni KB. */
export function renderPaymentInstructions(value: PaymentInstructions): string[] {
  const payment = PaymentInstructionsSchema.parse(value);
  if (!hasPaymentInstructions(payment)) return [];
  const blocks = ["Estos son los métodos de pago configurados:"];
  for (const transfer of payment.transfers) blocks.push([
    `Transferencia · ${transfer.bank}`, `Titular: ${transfer.holder}`, `Moneda: ${transfer.currency}`,
    ...(transfer.accountNumber !== undefined ? [`Cuenta: ${transfer.accountNumber}`] : []),
    ...(transfer.cci !== undefined ? [`CCI: ${transfer.cci}`] : []),
  ].join("\n"));
  if (payment.yape) blocks.push(`Yape\nTeléfono: ${payment.yape.phone}\nTitular: ${payment.yape.holder}`);
  if (payment.paymentLink) blocks.push(`Link de pago: ${payment.paymentLink}`);
  blocks.push("Te paso con el equipo para confirmar el pago y coordinar la implementación. Este mensaje no confirma recepción de dinero ni activación del servicio.");
  // El payload máximo puede superar 4096. Partir entre métodos, jamás un destino.
  const messages: string[] = [];
  for (const block of blocks) {
    const previous = messages[messages.length - 1];
    if (previous && previous.length + block.length + 2 <= 4096) messages[messages.length - 1] = `${previous}\n\n${block}`;
    else messages.push(block);
  }
  return messages;
}
