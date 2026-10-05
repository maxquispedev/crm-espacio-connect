import { ATTENDANCE_KNOWLEDGE } from "./commercial-evidence";
/**
 * Producto, política y oferta congelados.
 * Freeze local: docs/SALES_ORCHESTRATOR.md §§5–6.
 * Origen validado: jevveloz/config/product.json y
 * jevveloz/config/commercial-policy.json.
 *
 * `VENDE_VELOZ_OFFER` es ayuda determinística del writer/CRM.
 * No forma parte del State enviado a Jev.
 */

export const VENDE_VELOZ_PRODUCT = {
  name: "Vende Veloz 365",
  one_liner:
    "Sistema web para academias deportivas en Perú. Centraliza la operación diaria; no es un CRM de ventas ni una agencia de marketing.",
  who_it_is_for: [
    "Academias y escuelas de natación, karate, running, fútbol, baile, artes marciales y disciplinas similares",
    "Negocios que trabajan con alumnos, apoderados, planes, horarios, cupos y cobros recurrentes",
  ],
  core_jobs: [
    "Alumnos y apoderados",
    "Matrículas",
    "Disciplinas y actividades",
    "Horarios y cupos",
    "Pagos, ventas, saldos y caja",
    ATTENDANCE_KNOWLEDGE,
    "Renovaciones",
    "Promociones, cupones, productos e inventario",
    "Matrícula online opcional",
  ],
  not_the_product: [
    "No genera alumnos por sí solo ni gestiona pauta publicitaria",
    "No es un CRM genérico de pipeline de ventas",
    "No es una app de socios de gimnasio ni un ERP contable",
    "No retiene fondos ni cobra comisión por venta",
  ],
  how_it_starts:
    "El equipo puede registrar alumnos, matrículas y cobros desde el primer día. La web de matrícula y los pagos automáticos son opcionales.",
  implementation: {
    price: "Incluida, sin costo de implementación",
    kind: "incluida; el primer mes se paga por adelantado",
    includes: [
      "Entender cómo trabaja la academia",
      "Definir el uso del sistema",
      "Configuración con funciones existentes",
      "Carga inicial acordada",
      "Usuarios y capacitación",
      "Primer mes pagado por adelantado",
      "Sin permanencia obligatoria",
      "30 días de acompañamiento del uso real",
      "Dominio .com del primer año cuando la academia lo necesita; si ya tiene uno, se conecta el existente",
    ],
    does_not_include: [
      "Digitación o migración ilimitada",
      "Desarrollos personalizados",
      "Gestión de publicidad o consultoría continua de marketing",
      "Renovación del dominio desde el segundo año, que se cotiza aparte y no se usa como argumento de venta",
    ],
  },
  subscription: {
    price: "S/247 al mes",
    includes_active_students: 50,
    extra_active_student: "S/1 por alumno activo adicional desde el 51",
    active_student_means:
      "Alumno con matrícula vigente. El historial no aumenta la mensualidad.",
  },
} as const;

export type VendeVelozProduct = typeof VENDE_VELOZ_PRODUCT;

export const VENDE_VELOZ_COMMERCIAL_POLICY = {
  default_channel: "WhatsApp",
  goal: "Avanzar comercialmente de forma automática todo lo posible y reservar la intervención humana para los casos donde aporte valor real.",
  automation_first:
    "El agente puede obtener contexto, explicar el producto, mostrar demos o videos, presentar precio, resolver preguntas estándar, hacer seguimiento e intentar cerrar sin intervención humana.",
  auto_close:
    "Si el prospecto quiere avanzar y el caso es estándar, sin complejidad especial, el agente puede continuar hasta instrucciones de pago e implementación.",
  human_handoff:
    "Escalar a humano cuando exista complejidad, integraciones o API, múltiples sedes o decisores, negociación u objeciones importantes, necesidades especiales o una solicitud explícita de conversación humana.",
  future_interest:
    "Si existe interés real pero la implementación corresponde a una temporada o fecha futura, programar seguimiento automático cerca de ese momento.",
  no_response:
    "Los leads que no responden deben recibir una secuencia limitada de seguimientos automáticos. Si no reaccionan, dejar de perseguirlos sin intervención humana.",
  disqualification:
    "Si no existe encaje, necesidad relevante o el prospecto busca algo que Vende Veloz no ofrece, cerrar el flujo sin intervención humana.",
  evidence_rule:
    "Las afirmaciones del vendedor sobre posibles problemas o beneficios no prueban que el prospecto tenga esa necesidad. Priorizar lo expresado por el prospecto y los datos objetivos de su operación.",
} as const;

export type VendeVelozCommercialPolicy = Omit<typeof VENDE_VELOZ_COMMERCIAL_POLICY, "evidence_rule"> & { evidence_rule: string };

export const VENDE_VELOZ_OFFER = {
  currency: "PEN",
  setup: 0,
  monthlyBase: 247,
  includedActiveStudents: 50,
  extraPerActiveStudent: 1,
  setupIsOneTime: true,
  implementation: {
    purpose: "adopción real durante el primer mes, incluida y sin costo de implementación",
    includes: [
      "configuración del flujo acordado",
      "carga de datos acordada",
      "usuarios",
      "capacitación",
      "primeras operaciones reales",
      "acompañamiento inicial",
      "primer mes pagado por adelantado",
      "sin permanencia obligatoria",
      "dominio .com del primer año cuando la academia lo necesita",
    ],
  },
  neverPromise: [
    "generación de alumnos",
    "demanda",
    "ventas",
    "que la renovación del dominio desde el segundo año esté incluida",
    "que la renovación del dominio sea el argumento principal de la venta",
  ],
} as const;

export type VendeVelozOffer = typeof VENDE_VELOZ_OFFER;
