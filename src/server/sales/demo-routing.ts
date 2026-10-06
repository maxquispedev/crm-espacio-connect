import { hasBroadPrioritizationReply } from "./conversation-guards";
import type { DemoResourceSlot } from "@/lib/commercial/resources";
import type { NextActionChoice } from "./answers";
import type { JevAdContext, JevConversationTurn } from "./state";

/** Último tema explícito del prospecto; un asentimiento conserva el contexto.
 * La selección no interpreta intención comercial: la acción ya la decidió Jev.
 */
export function selectDemoSlot(
  action: NextActionChoice,
  conversation: readonly JevConversationTurn[],
  adContext?: JevAdContext
): DemoResourceSlot | null {
  if (action === "show_online_enrollment_demo") return "demo_online_enrollment";
  if (action !== "show_operations_demo") return null;
  if (hasBroadPrioritizationReply(conversation)) return "demo_enrollment_panel";
  for (const turn of [...conversation].reverse()) {
    if (turn.from !== "lead") continue;
    const text = turn.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const clauses = text.split(/[,;.!?]|\b(?:pero|sino|ahora|mejor)\b/);
    let paymentMention = false;
    for (const clause of clauses) {
      if (!/\b(?:pagos?|saldos?|vouchers?|deudas?|yapes?)\b/.test(clause)) continue;
      paymentMention = true;
      // Negación de interés/tema, no una dificultad operativa ("no sé cómo").
      if (!/\b(?:no (?:los |las |me |nos )?(?:interesa|interesan|quiero|queremos|necesito|necesitamos)|no (?:pagos?|saldos?|vouchers?|deudas?)|no tengo(?: problemas con)?|ya (?:estan|esta|lo tengo|los tengo|los tenemos) (?:resueltos?|controlados?)|ya no|sin|olvida|olvidemos|descarta)\b/.test(clause)) {
        return "demo_payments_balances";
      }
    }
    if (paymentMention || /\b(?:matricula\w*|inscripci\w*|alumnos?|panel|operacion|general)\b/.test(text)) {
      return "demo_enrollment_panel";
    }
  }
  if (adContext) {
    return selectDemoSlot(action, [{ from: "lead", text: `${adContext.headline ?? ""} ${adContext.body ?? ""}` }]);
  }
  return "demo_enrollment_panel";
}

/** Tema del anuncio, sin atribuirle al prospecto un problema ni usar source_id. */
export function adOpeningTopic(adContext?: JevAdContext): "payments" | "summer" | "centralization" | "control" {
  const topic = (value: string | null | undefined) => {
    const text = (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (/\b(?:verano|temporada alta)\b/.test(text)) return "summer" as const;
    if (/\b(?:un solo lugar|centraliz\w*)\b/.test(text)) return "centralization" as const;
    if (/\b(?:bajo control|control operativo)\b/.test(text)) return "control" as const;
    if (/\b(?:pagos?|saldos?)\b/.test(text)) return "payments" as const;
    return null;
  };
  return topic(adContext?.headline) ?? topic(adContext?.body) ?? "control";
}
