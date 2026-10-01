/**
 * Tipos congelados del contrato de preguntas que Jev (TypeSafe) puede
 * resolver para el orchestrator de Ventas.
 *
 * Cada `JevQuestionDefinition` describe una pregunta que el motor puede
 * enviar al proveedor LLM. Las preguntas marcadas como `enabled = false`
 * en un playbook publicado NO se incluyen en el payload que el
 * orchestrator manda a Jev — son contratos que la agencia desactivó para
 * este negocio concreto (ver T303).
 *
 * El set por defecto (`JEV_SALES_QUESTIONS_V2`) NO lleva `enabled`: por
 * definición, todas las preguntas del set canónico están activas. El
 * runtime las trata como `enabled = true` cuando el campo está ausente.
 * El campo pasa a ser requerido al PUBLICAR un playbook (ver
 * `lib/sales/playbook/schema.ts`), donde `enabled = false` sí significa
 * "no preguntar" para esta organización.
 */
export type JevQuestionDefinition =
  | {
      type: "choice";
      enabled?: boolean;
      instructions: string;
      criteria: Record<string, string>;
    }
  | {
      type: "noul";
      enabled?: boolean;
      instructions: string;
      criteria: { true: string; false: string };
    }
  | {
      type: "score";
      enabled?: boolean;
      instructions: string;
      criteria: Record<string, string>;
    };

/** Conjunto activo que el motor va a enviar a Jev. */
export type JevQuestions = Readonly<Record<string, JevQuestionDefinition>>;

/** Devuelve solo las preguntas marcadas como activas (o no-marcadas). */
export function pickActiveQuestions(
  questions: JevQuestions | Record<string, JevQuestionDefinition> | undefined
): Record<string, JevQuestionDefinition> {
  const out: Record<string, JevQuestionDefinition> = {};
  if (!questions) return out;
  for (const [key, q] of Object.entries(questions)) {
    if (q.enabled === false) continue;
    out[key] = q;
  }
  return out;
}

/**
 * Set congelado de preguntas por defecto para el orchestrator.
 *
 * Este objeto ES el contrato canónico §7 del documento
 * `docs/SALES_ORCHESTRATOR.md`. El freeze test
 * (`sales-questions-freeze.test.ts`) exige que el JSON literal de este
 * bloque coincida exactamente con el bloque de preguntas que aparece en
 * ese documento — no añadir ni quitar claves, no cambiar nombres, no
 * reordenar.
 */
export const JEV_SALES_QUESTIONS_V2 = {
  next_action: {
    type: "choice",
    instructions:
      "Elige la siguiente acción comercial que el agente debe tomar, considerando el momentum del lead y la información recopilada hasta ahora.",
    criteria: {
      ask_more_questions: "Necesitamos más información antes de avanzar.",
      show_operations_demo:
        "Vale la pena mostrar cómo Vende Veloz resuelve la operación diaria.",
      show_online_enrollment_demo:
        "Vale la pena mostrar cómo Vende Veloz resuelve la inscripción online.",
      present_price:
        "Tenemos suficiente evidencia para presentar el precio con confianza.",
      schedule_call:
        "Lo correcto es agendar una llamada con un humano del equipo.",
      schedule_follow_up:
        "Ahora no es buen momento, pero el lead sigue siendo relevante; deja un seguimiento programado.",
      disqualify:
        "El lead no encaja con Vende Veloz 365; cerramos sin quemar más turnos.",
    },
  },
  real_operational_need: {
    type: "noul",
    instructions:
      "¿Existe evidencia de que esta academia tiene actualmente una necesidad operativa real que Vende Veloz 365 puede ayudar a resolver?",
    criteria: {
      true: "Hay síntomas operativos claros y actuales.",
      false: "No hay señales de una necesidad operativa actual.",
    },
  },
  product_fit: {
    type: "score",
    instructions:
      "En escala 0..3, ¿qué tan bien Vende Veloz 365 encaja con el tipo de academia y el momento del lead?",
    criteria: {
      "0": "No encaja con su realidad.",
      "1": "Encaje débil; tendría que forzar el producto.",
      "2": "Encaje razonable con ajustes.",
      "3": "Encaje natural con su operación.",
    },
  },
  motivation_to_change: {
    type: "score",
    instructions:
      "En escala 0..3, ¿qué tanta urgencia / motivación al cambio demuestra el lead en este momento?",
    criteria: {
      "0": "No hay intención real de moverse del status quo.",
      "1": "Insatisfacción pasiva; nada concreto en el horizonte.",
      "2": "Incomodidad real; evalúa alternativas.",
      "3": "Dolor agudo; busca activamente resolver.",
    },
  },
  purchase_intent: {
    type: "score",
    instructions:
      "En escala 0..3, ¿qué tan probable es que concrete una compra de Vende Veloz 365 en este momento si le damos el siguiente paso correcto?",
    criteria: {
      "0": "Casi seguro no compra ahora.",
      "1": "Compraría solo si el precio cambia mucho.",
      "2": "Compraría si la oferta es razonable.",
      "3": "Listo para cerrar en este turno.",
    },
  },
  buying_timing: {
    type: "choice",
    instructions:
      "Define el momento de compra más probable del lead, según lo que haya dicho explícitamente o lo que se pueda inferir.",
    criteria: {
      now: "Quiere/necesita decidir pronto (semanas).",
      this_quarter: "Espera resolver este trimestre.",
      this_year: "Planea resolver este año.",
      exploring: "Está explorando, sin compromiso temporal.",
      unknown: "No hay señal suficiente para inferirlo.",
    },
  },
  main_value_proposition: {
    type: "choice",
    instructions:
      "Resume en una etiqueta cuál es el valor principal que más le importa al lead (lo que activaría la decisión).",
    criteria: {
      operations: "Centralizar la operación diaria del negocio.",
      enrollment: "Resolver la inscripción online.",
      retention: "Retener y recuperar alumnos.",
      admin_overhead: "Quitar carga administrativa al dueño.",
      visibility: "Visibilidad en tiempo real del negocio.",
      unspecified: "Aún no está claro o no aplica.",
    },
  },
  needs_human_call: {
    type: "noul",
    instructions:
      "¿Vale la pena pasar este lead a un humano del equipo comercial en este turno?",
    criteria: {
      true: "Sí, hay valor real en intervención humana ahora.",
      false: "No, el agente puede seguir avanzando.",
    },
  },
} as const satisfies Record<string, JevQuestionDefinition>;

/**
 * Tipos narrow de las respuestas válidas que `normalize.ts` puede
 * devolver. El motor solo exige `next_action` y `needs_human_call`; el
 * resto son señales conocidas que el consumidor (writer, UI) consume
 * cuando están presentes (T304, T305).
 */
export type NextActionChoice =
  | "ask_more_questions"
  | "show_operations_demo"
  | "show_online_enrollment_demo"
  | "present_price"
  | "schedule_call"
  | "schedule_follow_up"
  | "disqualify";

export type BuyingTimingChoice =
  | "now"
  | "this_quarter"
  | "this_year"
  | "exploring"
  | "unknown";

export type MainValuePropositionChoice =
  | "operations"
  | "enrollment"
  | "retention"
  | "admin_overhead"
  | "visibility"
  | "unspecified";

export type NoulAnswer = { type: "noul"; noul: number };
export type ScoreAnswer = { type: "score"; score: number };
export type ChoiceAnswer<T extends string> = { type: "choice"; choice: T };

export type NormalizedNoul = NoulAnswer;
export type NormalizedScore = ScoreAnswer;
export type NormalizedChoice<T extends string> = ChoiceAnswer<T>;
export type NormalizedAnswer =
  | NormalizedNoul
  | NormalizedScore
  | NormalizedChoice<string>;

export type NextActionAnswer = NormalizedChoice<NextActionChoice>;
export type BuyingTimingAnswer = NormalizedChoice<BuyingTimingChoice>;
export type MainValuePropositionAnswer =
  NormalizedChoice<MainValuePropositionChoice>;