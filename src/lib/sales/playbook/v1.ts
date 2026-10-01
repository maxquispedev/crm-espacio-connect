/**
 * Sales Playbook V1 — "Vende Veloz 365 — Academia Bajo Control".
 *
 * Contenido LITERAL exportado para sembrar cada organización con
 * `salesOrchestratorEnabled=true` (ver `bootstrap.ts`). Validado en
 * build time con `ConfigV1Schema.parse(...)`: cualquier drift rompe
 * el build antes de llegar a runtime.
 *
 * Las descripciones de los criterios de `main_value_proposition`
 * son editables y reflejan la V1 "Academia Bajo Control"; las KEYS
 * son contrato del resolver (no se renombran en Feature 008).
 *
 * Fuente: `specs/008-sales-playbook/data-model.md` § "Anexo V1".
 */

import { ConfigV1Schema, type ConfigV1 } from "./schema";

const VENDE_VELOZ_PLAYBOOK_V1_RAW: ConfigV1 = {
  schema_version: "1.0",
  product: {
    name: "Vende Veloz 365",
    one_liner:
      "Ten tu academia bajo control, sin depender de Excel, papel y WhatsApp para saber qué está pasando.",
    who_it_is_for: [
      "Academias y escuelas deportivas en Perú (natación, karate, fútbol, running, baile, artes marciales y similares)",
      "Negocios con alumnos, apoderados, planes, ciclos, horarios, cupos y cobros recurrentes",
      "Academias que hoy controlan su operación en Excel, papel o grupos de WhatsApp y quieren ordenar sin perder lo que ya funciona",
    ],
    core_jobs: [
      "Alumnos y apoderados con historia centralizada",
      "Planes, ciclos y horarios",
      "Pagos completos y parciales con saldos pendientes",
      "Control de ingresos y caja",
      "Siguiente ciclo y renovación",
      "Adopción real durante el primer mes",
      "Matrícula online opcional",
    ],
    not_the_product: [
      "No genera alumnos por sí solo",
      "No gestiona pauta publicitaria ni campañas",
      "No es un CRM genérico de pipeline de ventas",
      "No es un ERP contable ni una app de socios de gimnasio",
      "No retiene fondos ni cobra comisión por venta",
    ],
    how_it_starts:
      "Empezamos por entender cómo trabaja hoy la academia y configuramos contigo. La carga inicial se acuerda a partir de información utilizable (Excel, fotos, listas). El acompañamiento de adopción real corre durante el primer mes, no como un manual que se entrega y se olvida.",
  },
  offer: {
    currency: "PEN",
    setup: 497,
    monthlyBase: 197,
    includedActiveStudents: 50,
    extraPerActiveStudent: 1,
    setupIsOneTime: true,
    implementation: {
      purpose: "adopción real durante el primer mes",
      includes: [
        "Entender cómo trabaja la academia",
        "Configuración acordada con funciones existentes",
        "Planes, cursos, horarios, niveles, cupos y ciclos cuando aplique",
        "Carga inicial acordada desde información utilizable",
        "Usuarios y capacitación",
        "Primeras operaciones reales asistidas",
        "Acompañamiento de adopción durante 30 días",
        "Dominio propio durante el primer año cuando aplique",
      ],
    },
    neverPromise: [
      "Generación de alumnos",
      "Demanda asegurada",
      "Ventas garantizadas",
      "ROI prometido",
      "Recuperación de inversión en X meses",
      "Pérdidas de ventas por WhatsApp sin evidencia",
      "Falsas señales de escasez o urgencia",
    ],
  },
  commercial_policy: {
    defaultChannel: "WhatsApp",
    goal:
      "Avanzar comercialmente de forma automática todo lo posible y reservar la intervención humana para los casos donde aporte valor real.",
    automationFirst:
      "El agente puede obtener contexto, explicar el producto, mostrar demos o videos, presentar precio, resolver preguntas estándar, hacer seguimiento e intentar cerrar sin intervención humana.",
    autoClose:
      "Si el prospecto quiere avanzar y el caso es estándar, sin complejidad especial, el agente puede continuar hasta instrucciones de pago e implementación.",
    humanHandoff:
      "Escalar a humano cuando exista complejidad, integraciones o API, múltiples sedes o decisores, negociación u objeciones importantes, necesidades especiales o una solicitud explícita de conversación humana.",
    futureInterest:
      "Si existe interés real pero la implementación corresponde a una temporada o fecha futura, programar seguimiento automático cerca de ese momento, sin inventar la fecha.",
    noResponse:
      "Los leads que no responden deben recibir una secuencia limitada de seguimientos automáticos. Si no reaccionan, dejar de perseguirlos sin intervención humana.",
    disqualification:
      "Si no existe encaje, necesidad relevante o el prospecto busca algo que Vende Veloz no ofrece, cerrar el flujo sin intervención humana y sin inventar dolores.",
    evidenceRule:
      "Las afirmaciones del vendedor sobre posibles problemas o beneficios no prueban que el prospecto tenga esa necesidad. Priorizar lo expresado por el prospecto y los datos objetivos de su operación.",
  },
  priorities: {
    primary: [
      "Control operativo",
      "Alumnos y apoderados",
      "Planes, ciclos y horarios",
      "Pagos completos y parciales",
      "Saldos pendientes",
      "Control de ingresos",
      "Siguiente ciclo y renovación",
      "Adopción real",
    ],
    secondary: [
      "Matrícula online",
      "Automatización de tareas administrativas",
      "Menor dependencia de WhatsApp",
      "Control de cupos",
    ],
    tertiary: ["Asistencia y sesiones", "Inventario y productos"],
  },
  writer: {
    ask_more_questions:
      "Identifica qué bloque operativo está más desordenado hoy (alumnos, pagos, horarios, saldos) y formula UNA sola pregunta concreta para entender el contexto. No conviertas la conversación en una encuesta ni repitas preguntas ya respondidas.",
    show_operations_demo:
      "Mensaje breve que muestra cómo se centralizan alumnos, pagos, ventas, saldos, horarios y operación diaria en un solo lugar. Invita a verlo con un video corto o un recorrido de 3-4 pantallas reales. Evita prometer funcionalidades que no se demostraron.",
    show_online_enrollment_demo:
      "Cuando el prospecto menciona matrícula online, explica cómo funciona el formulario de inscripción, qué datos captura y cómo llegan los registros al sistema sin digitación manual. Aclara que es opcional y se activa cuando la academia lo necesita.",
    present_price:
      "Contextualiza con claridad: S/497 es puesta en marcha + adopción (pago único); después S/197 al mes hasta 50 alumnos activos; desde el alumno 51 se cobra +S/1 por alumno activo adicional. No ofrezcas descuentos que no existen y no negocies el precio base por WhatsApp.",
    schedule_call:
      "Transición breve a una llamada humana. Pide el dato faltante (horario o teléfono) sin inventarlo. Aclara que el objetivo de la llamada es ordenar la complejidad, no presionar la compra.",
    schedule_follow_up:
      "Reconoce el timing expresado por el prospecto. Si habló de una temporada futura, prepara el seguimiento cerca del pico sin presionar. No inventes fechas: registra el interés y retoma cuando corresponda.",
    disqualify:
      "Cierre breve y respetuoso. Reconoce que Vende Veloz no es la solución correcta para esa academia en este momento. No sigas buscando dolores artificiales ni intentes revivir la conversación.",
  },
  jev_questions: {
    real_operational_need: {
      type: "noul",
      enabled: true,
      instructions:
        "¿Existe evidencia de que esta academia tiene actualmente una necesidad operativa real que Vende Veloz 365 puede ayudar a resolver?",
      criteria: {
        true:
          "Existen procesos manuales, información dispersa, dependencia excesiva de WhatsApp, Excel o papel, dificultad para consultar la operación o una necesidad concreta relacionada con alumnos, pagos, ventas, horarios, asistencia, matrículas u otras capacidades existentes del producto.",
        false:
          "La operación relevante ya está adecuadamente resuelta o no existe evidencia de una necesidad operativa actual.",
      },
    },
    product_fit: {
      type: "score",
      enabled: true,
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
      enabled: true,
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
      enabled: true,
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
      enabled: true,
      instructions:
        "Determina exclusivamente el horizonte temporal de compra o implementación. No uses como evidencia las fechas u horarios para llamadas, demos, reuniones o seguimientos comerciales. Que un prospecto quiera reunirse hoy, mañana o la próxima semana no significa que quiera implementar en ese plazo. Si solo se conoce cuándo quiere conversar pero no cuándo quiere implementar, elige unknown.",
      criteria: {
        now:
          "El prospecto expresa explícitamente que quiere contratar, comenzar, implementar o resolverlo ahora o en los próximos días.",
        soon:
          "El prospecto expresa explícitamente que quiere implementar dentro de las próximas semanas o pocos meses, pero no inmediatamente.",
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
      enabled: true,
      instructions:
        "Determina cuál es el ángulo de valor más relevante para continuar comercialmente con este prospecto en este momento. Elige según la necesidad expresada o inferida del contexto. No prometas generación de demanda, ventas ni nuevos alumnos.",
      criteria: {
        operational_control:
          "El principal valor es centralizar alumnos, pagos, ventas, saldos, horarios, asistencia y la operación diaria de la academia en un solo lugar.",
        reduce_whatsapp_dependency:
          "El principal problema es depender demasiado de WhatsApp para consultas, matrículas, seguimiento, pagos o coordinación con apoderados y alumnos.",
        online_enrollment:
          "El prospecto ha expresado específicamente una necesidad relacionada con matrícula online, recepción de inscripciones o automatización de ese proceso.",
        reduce_manual_work:
          "El principal valor es reducir tareas repetitivas, duplicidad de registro o trabajo administrativo manual del equipo de la academia.",
        no_relevant_value_now:
          "El producto puede corresponder al tipo de academia, pero actualmente no existe una necesidad, motivación de cambio o problema concreto que justifique continuar comercialmente.",
      },
    },
    next_action: {
      type: "choice",
      enabled: true,
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
      enabled: true,
      instructions:
        "¿Existe una razón clara por la que este prospecto necesite una llamada humana antes de poder continuar o cerrar razonablemente por WhatsApp?",
      criteria: {
        true:
          "La operación es compleja, existen múltiples sedes o decisores, requiere API, integraciones o desarrollos especiales, hay necesidades difíciles de resolver por chat o el prospecto solicita explícitamente una reunión.",
        false:
          "La conversación puede continuar, mostrar el producto, presentar precio y potencialmente cerrar razonablemente por WhatsApp.",
      },
    },
  },
  prohibitions: {
    neverPromise: [
      "Generación de alumnos",
      "Demanda asegurada",
      "Ventas garantizadas",
      "ROI prometido",
      "Recuperación de inversión",
      "Pérdidas de ventas por WhatsApp sin evidencia",
      "Falsas señales de escasez o urgencia",
    ],
    prohibitedClaims: [
      "Garantizar alumnos",
      "Garantizar ventas",
      "Asegurar crecimiento de la matrícula",
      "Devolver la inversión",
      "Multiplicar la matrícula por un factor determinado",
    ],
  },
  handoff: {
    auto:
      "Escalar si el prospecto lo pide explícitamente, si hay objeciones complejas o múltiples decisores.",
    auto_close:
      "Mantener auto hasta instrucciones de pago; derivar a humano solo si surge complejidad o el prospecto lo pide.",
    human: "Mantener humano; no reagendar automáticamente.",
    wait: "Recordar al prospecto en el momento acordado sin presionar.",
    stop: "No insistir.",
  },
  urgency_rules:
    "Preparación antes de temporada alta cuando el contexto del prospecto lo justifique. No asumir estacionalidad idéntica para todas las academias. No inventar urgencia.",
};

/**
 * Snapshot V1 validado en build time. Si el literal de arriba dejara
 * de cumplir el contrato, `parse(...)` lanza y el build falla.
 */
export const VENDE_VELOZ_PLAYBOOK_V1: ConfigV1 = ConfigV1Schema.parse(
  VENDE_VELOZ_PLAYBOOK_V1_RAW
);

export type VendeVelozPlaybookV1 = typeof VENDE_VELOZ_PLAYBOOK_V1;
