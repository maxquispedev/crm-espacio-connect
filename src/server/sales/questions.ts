/**
 * Jev V2 congelado. Freeze local: docs/SALES_ORCHESTRATOR.md §7.
 * Origen validado: jevveloz/config/questions-v2.json.
 * No reescribir. No añadir preguntas. No añadir pause_and_wait.
 */

export const JEV_QUESTION_KEYS = [
  "real_operational_need",
  "product_fit",
  "motivation_to_change",
  "purchase_intent",
  "buying_timing",
  "main_value_proposition",
  "next_action",
  "needs_human_call",
] as const;

export type JevQuestionKey = (typeof JEV_QUESTION_KEYS)[number];

export const JEV_SALES_QUESTIONS_V2 = {
  real_operational_need: {
    type: "noul",
    instructions:
      "¿Existe evidencia de que esta academia tiene actualmente una necesidad operativa real que Vende Veloz 365 puede ayudar a resolver?",
    criteria: {
      true: "Existen procesos manuales, información dispersa, falta de control, dependencia excesiva de WhatsApp, Excel o papel, dificultad para consultar la operación o una necesidad concreta relacionada con alumnos, pagos, ventas, horarios, asistencia, matrículas u otras capacidades existentes del producto.",
      false:
        "La operación relevante ya está adecuadamente resuelta o no existe evidencia de una necesidad operativa actual.",
    },
  },
  product_fit: {
    type: "score",
    instructions:
      "Evalúa qué tan bien las capacidades de Vende Veloz 365 corresponden objetivamente con el tipo de operación de esta academia. Evalúa únicamente compatibilidad funcional, independientemente de si actualmente quiere cambiar de sistema o comprar.",
    criteria: [
      "Sin encaje: las capacidades del producto prácticamente no corresponden con la operación de la academia.",
      "Encaje débil: algunas capacidades podrían servir, pero existe poca correspondencia.",
      "Encaje moderado: varias capacidades son aplicables a la operación.",
      "Encaje fuerte: el producto corresponde claramente con gran parte de la operación de la academia.",
      "Encaje muy fuerte: las capacidades del producto corresponden ampliamente con la forma en que opera la academia.",
    ],
  },
  motivation_to_change: {
    type: "score",
    instructions:
      "Evalúa si existe una razón concreta para que la academia cambie, mejore o reorganice su forma actual de trabajar.",
    criteria: [
      "Ninguna: está satisfecha con su situación actual y no expresa ningún motivo para cambiar.",
      "Débil: existe curiosidad o alguna molestia menor, pero no una razón clara para cambiar.",
      "Moderada: reconoce una limitación concreta y está explorando alternativas.",
      "Alta: existe un problema importante que quiere resolver y está buscando activamente una alternativa.",
      "Muy alta: necesita cambiar pronto y está evaluando activamente cómo implementar una nueva solución.",
    ],
  },
  purchase_intent: {
    type: "score",
    instructions:
      "Evalúa el nivel actual de intención comercial del lead basándote únicamente en lo que ha expresado o hecho dentro de la conversación. Diferencia curiosidad, evaluación e intención concreta de avanzar.",
    criteria: [
      "Muy baja: curiosidad general sin señales de evaluación real.",
      "Baja: solicita información, pero no muestra señales claras de considerar una implementación.",
      "Media: está evaluando activamente cómo funcionaría para su academia.",
      "Alta: muestra señales concretas como preguntar precio, pedir una demostración, proponer horarios, involucrar a un decisor o expresar que quiere implementar.",
      "Muy alta: expresa claramente intención de contratar, pagar, comenzar o coordinar la implementación.",
    ],
  },
  buying_timing: {
    type: "choice",
    instructions:
      "Determina exclusivamente el horizonte temporal de compra o implementación. No uses como evidencia las fechas u horarios para llamadas, demos, reuniones o seguimientos comerciales. Que un prospecto quiera reunirse hoy, mañana o la próxima semana no significa que quiera implementar en ese plazo. Si solo se conoce cuándo quiere conversar pero no cuándo quiere implementar, elige unknown.",
    criteria: {
      now: "El prospecto expresa explícitamente que quiere contratar, comenzar, implementar o resolverlo ahora o en los próximos días.",
      soon: "El prospecto expresa explícitamente que quiere implementar dentro de las próximas semanas o pocos meses, pero no inmediatamente.",
      future_season:
        "El prospecto indica explícitamente una temporada, apertura, campaña, mes o fecha futura para la que necesita tener implementada la solución.",
      unknown:
        "Existe interés o necesidad, pero todavía no ha indicado cuándo quiere implementar. También aplica cuando únicamente ha indicado cuándo desea tener una llamada, reunión o demostración.",
      no_current_plan:
        "El prospecto deja claro que solo está curioseando, informándose o evaluando y que actualmente no tiene ningún plan concreto de implementación.",
    },
  },
  main_value_proposition: {
    type: "choice",
    instructions:
      "Determina cuál es el ángulo de valor más relevante para continuar comercialmente con este prospecto en este momento. Elige según la necesidad expresada o inferida del contexto. No prometas generación de demanda, ventas ni nuevos alumnos.",
    criteria: {
      operational_control:
        "El principal valor es centralizar alumnos, pagos, ventas, saldos, horarios, asistencia y la operación diaria.",
      reduce_whatsapp_dependency:
        "El principal problema es depender demasiado de WhatsApp para consultas, matrículas, seguimiento, pagos o coordinación.",
      online_enrollment:
        "El prospecto ha expresado específicamente una necesidad relacionada con matrícula online, recepción de inscripciones o automatización de ese proceso.",
      reduce_manual_work:
        "El principal valor es reducir tareas repetitivas, duplicidad de registro o trabajo administrativo manual.",
      no_relevant_value_now:
        "El producto puede corresponder al tipo de academia, pero actualmente no existe una necesidad, motivación de cambio o problema concreto que justifique continuar comercialmente.",
    },
  },
  next_action: {
    type: "choice",
    instructions:
      "Decide la siguiente acción comercial. El objetivo es avanzar leads con una necesidad real sin convertir la conversación en una encuesta, sin forzar llamadas innecesarias y sin perseguir prospectos sin intención. No hagas preguntas adicionales solamente porque podría existir un problema no mencionado.",
    criteria: {
      ask_more_questions:
        "Existe una señal concreta de necesidad o interés, pero falta una información esencial para saber qué mostrar o cómo encaja Vende Veloz.",
      show_operations_demo:
        "Existe una necesidad operativa identificada y conviene mostrar brevemente cómo Vende Veloz centraliza alumnos, pagos, ventas y operación diaria.",
      show_online_enrollment_demo:
        "El prospecto ha expresado específicamente una necesidad relacionada con matrícula online, inscripciones o automatización de ese proceso.",
      present_price:
        "El prospecto ya entiende el valor relevante, existe suficiente contexto y muestra interés concreto para presentar la propuesta económica.",
      schedule_call:
        "Existe interés real, pero la complejidad de la operación, múltiples sedes, múltiples decisores, integraciones, API, necesidades especiales o una solicitud explícita hacen recomendable una conversación humana.",
      schedule_follow_up:
        "Existe buen encaje e interés, pero el prospecto ha indicado que la necesidad corresponde a una temporada, apertura o fecha futura. Registrar el interés y retomar cerca del momento adecuado.",
      disqualify:
        "El prospecto no presenta una necesidad relevante, está satisfecho con su solución actual, no muestra motivación de cambio o no existe un motivo comercial concreto para continuar.",
    },
  },
  needs_human_call: {
    type: "noul",
    instructions:
      "¿Existe una razón clara por la que este prospecto necesite una llamada humana antes de poder continuar o cerrar razonablemente por WhatsApp?",
    criteria: {
      true: "La operación es compleja, existen múltiples sedes o decisores, requiere API, integraciones o desarrollos especiales, hay necesidades difíciles de resolver por chat o el prospecto solicita explícitamente una reunión.",
      false:
        "La conversación puede continuar, mostrar el producto, presentar precio y potencialmente cerrar razonablemente por WhatsApp.",
    },
  },
} as const;

export type JevSalesQuestionsV2 = typeof JEV_SALES_QUESTIONS_V2;
