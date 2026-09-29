/**
 * 005 — Helper pura para sincronizar el `contact.name` en el array de
 * conversaciones del inbox sin necesidad de un refetch completo.
 *
 * Por qué existe: cuando el operador renombra un lead desde el panel lateral
 * (`ContactPanel`), el endpoint PATCH ya actualizó la BD. La UI muestra el
 * nombre en TRES lugares (panel, header del hilo, lista izquierda). Para
 * evitar el refetch (latencia + posible race con SSE entrante, ver
 * `specs/005-quick-lead-name/plan.md` §D-1), parchamos el array en memoria
 * de forma inmutable. Esta helper es trivialmente testeable sin React.
 */
import type { ConversationDto } from "@/lib/types";

export type ContactNameUpdate = {
  id: string;
  name: string;
};

/**
 * Devuelve un array nuevo donde la conversación cuyo `contact.id` coincide con
 * `update.id` tiene su `contact.name` reemplazado por `update.name`.
 *
 * - Si no hay ningún match, devuelve el array **original sin cambios** (misma
 *   referencia), evitando renders innecesarios.
 * - Si hay varios matches con el mismo id (defensivo: no debería pasar), todos
 *   son reemplazados.
 * - Inmutable: ni el array ni los `ConversationDto` se mutan.
 * - Si el `name` ya coincide con el actual, devuelve un array nuevo igual pero
 *   **distinta referencia** (mantiene contrato "patch retorna array nuevo").
 */
export function applyContactNamePatch(
  conversations: readonly ConversationDto[],
  update: ContactNameUpdate
): ConversationDto[] {
  let mutated = false;
  const result: ConversationDto[] = [];
  for (const c of conversations) {
    if (c.contact.id === update.id && c.contact.name !== update.name) {
      result.push({ ...c, contact: { ...c.contact, name: update.name } });
      mutated = true;
    } else {
      result.push(c);
    }
  }
  // Defensivo: si todos los matches tenían ya el `name` actualizado, igual
  // devolvemos un array nuevo (contrato "devuelve nuevo array"), excepto el
  // caso "no había match" donde conservamos la referencia original.
  if (!mutated) {
    // Averiguar si había match con mismo name
    const hadMatch = conversations.some((c) => c.contact.id === update.id);
    return hadMatch ? [...conversations] : (conversations as ConversationDto[]);
  }
  return result;
}
