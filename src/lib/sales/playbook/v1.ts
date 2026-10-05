import { ATTENDANCE_KNOWLEDGE } from "@/server/sales/commercial-evidence";
import { DEMO_EVIDENCE_RULE } from "@/lib/sales/demo-evidence";
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
      ATTENDANCE_KNOWLEDGE,
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
    setup: 0,
    monthlyBase: 247,
    includedActiveStudents: 50,
    extraPerActiveStudent: 1,
    setupIsOneTime: true,
    implementation: {
      purpose: "adopción real durante el primer mes, asistida e incluida sin costo de implementación",
      includes: [
        "Entender cómo trabaja la academia",
        "Configuración acordada con funciones existentes",
        "Planes, cursos, horarios, niveles, cupos y ciclos cuando aplique",
        "Carga inicial acordada desde información utilizable",
        "Usuarios y capacitación",
        "Primeras operaciones reales asistidas",
        "Acompañamiento de adopción durante 30 días",
        "Primer mes pagado por adelantado",
        "Sin permanencia obligatoria",
        "Dominio .com del primer año cuando la academia lo necesita; si ya tiene uno, se conecta el existente",
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
      "Que la renovación del dominio desde el segundo año esté incluida o se anuncie su costo de antemano",
      "Que la renovación del dominio sea el argumento que encabeza la venta",
    ],
  },
  commercial_policy: {
    defaultChannel: "WhatsApp",
    goal:
      "Esta es la primera cohorte: el objetivo es aprender de la compra, la adopción, el uso y la retención reales. No maximizar margen ni forzar el cierre autónomo de punta a punta. Un turno que filtra tráfico, entrega información honesta y escala a una persona a tiempo vale más que uno que presiona por cerrar.",
    automationFirst:
      "El agente puede obtener el contexto mínimo, explicar el producto, mostrar demos o videos, presentar el precio vigente, resolver preguntas estándar y hacer seguimiento. Puede dejar de insistir cuando no hay encaje.",
    autoClose:
      "Si el prospecto quiere avanzar y el caso es estándar, el agente puede llegar hasta el precio y las condiciones y escalar a una persona para el cierre. En esta fase no se exige cerrar la venta de manera autónoma de punta a punta.",
    humanHandoff:
      "Escalar a humano ante avance comercial genuino (intención clara de avanzar, decisor identificado, acuerdo en curso) o cuando el prospecto lo pida explícitamente. También con complejidad, múltiples sedes o decisores, negociación u objeciones importantes, o preguntas materiales de funcionalidad, implementación, integración o condición sin evidencia. Las capacidades documentadas se responden normalmente, sin exponer incertidumbre.",
    futureInterest:
      "Si existe interés real pero la implementación corresponde a una temporada o fecha futura, programar seguimiento automático cerca de ese momento, sin inventar la fecha.",
    noResponse:
      "Los leads que no responden deben recibir una secuencia limitada de seguimientos automáticos. Si no reaccionan, dejar de perseguirlos sin intervención humana.",
    disqualification:
      "Si no existe encaje, necesidad relevante o el prospecto busca algo que Vende Veloz no ofrece, cerrar el flujo sin intervención humana y sin inventar dolores.",
    evidenceRule:
      `${DEMO_EVIDENCE_RULE} Pregunta comercial material sin evidencia: schedule_call/HUMAN silencioso. Falta de contexto de la academia: ask_more_questions. Capacidad documentada: responder. No inventar ni exponer incertidumbre.`,
  },
  priorities: {
    primary: [
      "Intención real de avanzar",
      "Necesidad operativa real y expresada",
      "Encaje con academias y escuelas deportivas",
      "Control operativo",
      "Alumnos y apoderados",
      "Pagos, saldos y control de ingresos",
      "Adopción real durante el primer mes",
    ],
    secondary: [
      "Contexto mínimo para decidir",
      "Planes, ciclos y horarios",
      "Matrícula online",
      "Control de cupos",
      "Menor dependencia de WhatsApp",
    ],
    tertiary: ["Asistencia y sesiones", "Inventario y productos"],
  },
  writer: {
    ask_more_questions:
      "Si el lead consulta una capacidad documentada (incluida asistencia/sesiones), responde primero de forma breve y correcta; luego puedes hacer UNA pregunta útil. Si falta evidencia material, handoff silencioso. Identifica qué bloque operativo está más desordenado hoy (alumnos, pagos, horarios, saldos) y formula UNA sola pregunta concreta para entender el contexto. No conviertas la conversación en una encuesta ni repitas preguntas ya respondidas.",
    show_operations_demo:
      "Mensaje breve que muestra cómo se centralizan alumnos, pagos, ventas, saldos, horarios y operación diaria en un solo lugar. Invita a verlo con un video corto o un recorrido de 3-4 pantallas reales. Evita prometer funcionalidades que no se demostraron.",
    show_online_enrollment_demo:
      "Cuando el prospecto menciona matrícula online, explica cómo funciona el formulario de inscripción, qué datos captura y cómo llegan los registros al sistema sin digitación manual. Aclara que es opcional y se activa cuando la academia lo necesita.",
    present_price:
      "Presenta la oferta vigente con claridad y sin rodeos: la implementación asistida está incluida y no tiene costo de setup, así que no existe fee por adelantado; el primer mes se paga por adelantado; la mensualidad es S/247 al mes hasta 50 alumnos activos y desde el alumno 51 se suma +S/1 por alumno activo adicional; no hay permanencia obligatoria. Menciona el dominio .com del primer año solo si la academia lo necesita. No menciones la renovación del dominio: desde el segundo año se cobra aparte y no encabeza el pitch. No ofrezcas descuentos que no existen, no negocies el precio base por WhatsApp y no entregues un resumen de contrato, condiciones legales ni letra chica: si el prospecto los pide, escala a una persona.",
    schedule_call:
      "Handoff interno silencioso: devuelve text=null. No anuncies derivación a equipo, persona o asesor, ni generes una transición artificial. El humano toma la conversación desde el CRM.",
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
        "¿Existe evidencia de que esta academia tiene actualmente una necesidad operativa real que Vende Veloz 365 puede ayudar a resolver? En esta fase de aprendizaje pesa más la intención comercial expresada que el tamaño de la academia: una necesidad concreta en una academia pequeña vale más que un mensaje genérico de una grande.",
      criteria: {
        true:
          "Existen procesos manuales, información dispersa, falta de control, dependencia excesiva de WhatsApp, Excel o papel, dificultad para consultar la operación o una necesidad concreta relacionada con alumnos, pagos, ventas, horarios, asistencia, matrículas u otras capacidades existentes del producto.",
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
        "Evalúa el nivel actual de intención comercial del lead basándote únicamente en lo que ha expresado o hecho dentro de la conversación. Diferencia curiosidad, evaluación e intención concreta de avanzar. Esta pregunta es la principal para filtrar tráfico: un mensaje que demuestra avance genuino pesa más que un prospecto que solo tiene un negocio grande o muchas preguntas. No midas intención por el tamaño de la academia ni por su facturación.",
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
        "Determina cuál es el ángulo de valor más relevante para continuar comercialmente con este prospecto en este momento. Elige según la necesidad expresada o inferida del contexto, con el mínimo contexto necesario. No prometas generación de demanda, ventas ni nuevos alumnos, y no conviertas la renovación del dominio en el argumento principal: desde el segundo año se cobra aparte.",
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
      enabled: true,
      instructions:
        "Decide la siguiente acción comercial. En esta fase de aprendizaje el objetivo es filtrar tráfico y avanzar solo a los leads que muestran intención, no forzar el cierre autónomo de punta a punta. Pide el contexto mínimo indispensable con UNA sola pregunta concreta cuando falte un dato que cambia la decisión, y nunca conviertas la conversación en una encuesta. No repreguntes lo ya respondido, no inventes dolores y no persigas a quien no ha reaccionado. Si hay avance comercial genuino o el prospecto pide hablar con una persona, la acción correcta es escalar, no insistir.",
      criteria: {
        ask_more_questions:
          "Curiosidad inicial o falta de contexto: hola / quiero información / más información requieren un beneficio breve y UNA pregunta útil, sin demo.",
        show_operations_demo:
          "El prospecto expresó una necesidad operativa concreta o pidió explícitamente un demo/ver cómo funciona. El anuncio no prueba necesidad. Ante curiosidad genérica usar ask_more_questions.",
        show_online_enrollment_demo:
          "El prospecto expresó una necesidad concreta de matrícula online o pidió explícitamente ver ese proceso. El anuncio y la curiosidad genérica no bastan: usar ask_more_questions.",
        present_price:
          "El prospecto ya entiende el valor relevante, existe suficiente contexto y muestra interés concreto para presentar la propuesta económica.",
        schedule_call:
          "Pregunta material sin evidencia confiable: handoff humano silencioso. También complejidad de operación, múltiples sedes/decisores, necesidades especiales o solicitud explícita de humano. Una capacidad o integración documentada se responde sin handoff innecesario.",
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
        "¿Existe una razón clara por la que este prospecto necesite una llamada humana antes de poder continuar o cerrar razonablemente por WhatsApp? En esta fase, el avance comercial genuino y la petición explícita de una persona son motivo suficiente para escalar. No exijas un cierre autónomo de punta a punta: es aceptable y correcto dejar el cierre a una persona.",
      criteria: {
        true:
          "No existe evidencia para responder una pregunta comercial material, o la operación es compleja, hay múltiples sedes/decisores, negociación, desarrollos especiales o solicitud explícita de humano. No escalar solo por falta de contexto de la academia ni por preguntar una capacidad documentada.",
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
      "Renovación del dominio incluida desde el segundo año",
      "Permanencia obligatoria o cancelación anticipada sin costo",
    ],
    prohibitedClaims: [
      "Garantizar alumnos",
      "Garantizar ventas",
      "Asegurar crecimiento de la matrícula",
      "Devolver la inversión",
      "Multiplicar la matrícula por un factor determinado",
      "Cobrar un costo de implementación que ya está incluido",
    ],
  },
  handoff: {
    auto:
      "Escalar si el prospecto pide explícitamente una persona, si hay avance comercial genuino o si aparece una objeción importante, negociación o múltiples decisores. No se exige cerrar la venta de forma autónoma en esta fase.",
    auto_close:
      "Mantener la conversación hasta entregar precio y condiciones con claridad, y derivar a una persona para el cierre. No prometer instrucciones de pago ni insistir si el prospecto no confirma avance.",
    human: "Mantener humano; no reagendar automáticamente.",
    wait: "Recordar al prospecto en el momento acordado sin presionar.",
    stop: "No insistir.",
  },
  urgency_rules:
    "En esta cohorte la urgencia la pone la academia, no el vendedor. No usar escasez, cuenta regresiva ni urgencia artificial. La preparación antes de una temporada alta solo se menciona si el propio prospecto habla de esa temporada. Si el prospecto no muestra intención, no transmitas presión: es preferible devolver un turno honesto que un cierre forzado.",
};

/**
 * Snapshot V1 validado en build time. Si el literal de arriba dejara
 * de cumplir el contrato, `parse(...)` lanza y el build falla.
 */
export const VENDE_VELOZ_PLAYBOOK_V1: ConfigV1 = ConfigV1Schema.parse(
  VENDE_VELOZ_PLAYBOOK_V1_RAW
);

export type VendeVelozPlaybookV1 = typeof VENDE_VELOZ_PLAYBOOK_V1;
