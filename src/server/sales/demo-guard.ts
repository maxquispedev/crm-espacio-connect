import type { JevConversationTurn } from "./state";

/** Reconoce solo curiosidad inequívoca, no intenta clasificar necesidades.
 * Cualquier texto desconocido (incluido un pedido de demo) queda a Jev.
 * Solo habla el lead: anuncios y preguntas del vendedor no son evidencia.
 */
export function hasOnlyGenericCuriosity(turns: readonly JevConversationTurn[]): boolean {
  const lead = turns.filter(turn => turn.from === "lead");
  return lead.length > 0 && lead.every(turn => {
    const text = turn.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    return /^(?:(?:hola|buenas|buenos dias|buenas tardes|buenas noches)\s*)?(?:(?:quiero|quisiera|deseo|me interesa|necesito)\s+(?:saber\s+)?(?:mas\s+)?(?:informacion|info|informes)|(?:mas\s+)?(?:informacion|info|informes))?(?:\s+por favor)?$/.test(text) && text.length > 0;
  });
}
