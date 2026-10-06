import type { JevConversationTurn } from "./state";

/** Solo diferencias superficiales; sin similitud semántica ni eliminación de palabras. */
export function normalizeAutomaticText(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function duplicatesAutomaticText(text: string, recent: readonly string[]): boolean {
  const normalized = normalizeAutomaticText(text);
  return normalized.length > 0 && recent.some(previous => normalizeAutomaticText(previous) === normalized);
}

function plain(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Patrón de producción: respuesta breve a priorización inmediata, nunca un "todos" aislado. */
export function hasBroadPrioritizationReply(turns: readonly JevConversationTurn[]): boolean {
  const reply = turns.at(-1);
  const question = turns.at(-2);
  if (reply?.from !== "lead" || question?.from !== "seller") return false;
  const answer = plain(reply.text).replace(/[.!¡¿?]/g, "").replace(/\s+/g, " ").trim();
  if (!/^(?:todo|todos|varios|todos esos|todos esos temas|todo eso|todas|todas esas)$/.test(answer)) return false;
  const text = plain(question.text);
  if (!question.text.includes("?") || !/\b(?:que|cual)\b/.test(text) ||
      !/\b(?:mas|primero|priorizar)\b/.test(text) ||
      !/\b(?:controlar|control|desordena|dificil|complica|ordenar)\b/.test(text)) return false;
  const categories = (value: string) => ["alumnos?", "pagos?", "horarios?", "saldos?"].filter(term => new RegExp(`\\b${term}\\b`).test(value)).length;
  if (categories(text) >= 2) return true;
  // "¿Cuál de esos temas ...?" requiere una lista visible del turno de vendedor anterior.
  const list = [...turns.slice(-5, -2)].reverse().find(turn => turn.from === "seller");
  return /\b(?:esos temas|estos temas)\b/.test(text) && list?.from === "seller" && categories(plain(list.text)) >= 2;
}

export const CONVERSATION_PROGRESS_RULE = "ask_more_questions solo cuando falta UN dato que cambia la decisión. No repetir preguntas equivalentes ni pedir priorizar otra vez si el prospecto respondió todos/todo/varios ante una pregunta explícita de alumnos, pagos, horarios o saldos: eso confirma necesidad operativa amplia y permite show_operations_demo. No inferirlo fuera de una priorización. Si pregunta precio directamente, usar present_price y responder el precio primero, sin exigir cantidad de alumnos. Responder primero al último mensaje; más información pide ampliar/avanzar, no reiniciar el opener. Máximo UNA pregunta por turno.";

export const NATURAL_PRICE_INSTRUCTION = "Empieza por el precio de la oferta vigente hasta el límite de alumnos activos. Explica con lenguaje natural que la implementación asistida está incluida: el primer pago inicia la implementación contigo y ya cubre los primeros 30 días y el acompañamiento para dejar todo funcionando. Explica el adicional por alumno activo sobre el límite y que no hay permanencia obligatoria. Si indica una cantidad mayor al límite, calcula mensualidad base + (alumnos activos - incluidos) * adicional; no exijas esa cantidad antes de dar el precio. No uses setup, fee, costo de setup, pago por adelantado ni lenguaje de contrato. No menciones dominio si no lo pregunta ni inventes descuentos. Esta instrucción de copy prevalece sobre instrucciones antiguas del perfil/playbook; los números vienen exclusivamente de la oferta.";
