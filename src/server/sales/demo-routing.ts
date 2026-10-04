import type { DemoResourceSlot } from "@/lib/commercial/resources";
import type { NextActionChoice } from "./answers";
import type { JevConversationTurn } from "./state";

/** Último tema explícito del prospecto; un asentimiento conserva el contexto.
 * La selección no interpreta intención comercial: la acción ya la decidió Jev.
 */
export function selectDemoSlot(
  action: NextActionChoice,
  conversation: readonly JevConversationTurn[]
): DemoResourceSlot | null {
  if (action === "show_online_enrollment_demo") return "demo_online_enrollment";
  if (action !== "show_operations_demo") return null;
  for (const turn of [...conversation].reverse()) {
    if (turn.from !== "lead") continue;
    const text = turn.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const clauses = text.split(/[,;.!?]|\b(?:pero|sino|ahora|mejor)\b/);
    let paymentMention = false;
    for (const clause of clauses) {
      if (!/\b(?:pagos?|saldos?|vouchers?|deudas?)\b/.test(clause)) continue;
      paymentMention = true;
      // Negación de interés/tema, no una dificultad operativa ("no sé cómo").
      if (!/\b(?:no (?:los |las |me |nos )?(?:interesa|interesan|quiero|queremos|necesito|necesitamos)|no (?:pagos?|saldos?|vouchers?|deudas?)|no tengo(?: problemas con)?|ya (?:estan|esta|lo tengo|los tengo|los tenemos) (?:resueltos?|controlados?)|ya no|sin|olvida|olvidemos|descarta)\b/.test(clause)) {
        return "demo_payments_balances";
      }
    }
    if (paymentMention || /\b(?:matricula\w*|inscripci\w*|alumnos?|panel|operacion|general|funciona\w*|demo)\b/.test(text)) {
      return "demo_enrollment_panel";
    }
  }
  return "demo_enrollment_panel";
}
