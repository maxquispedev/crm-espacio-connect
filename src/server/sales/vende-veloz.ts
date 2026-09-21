/**
 * Producto, política y oferta congelados.
 * Fuente: docs/SALES_ORCHESTRATOR.md §§5–6. No reescribir el texto.
 */

export const VENDE_VELOZ_PRODUCT = {
  name: "Vende Veloz 365",
  purpose: "centralizar la operación diaria de una academia deportiva",
  positioning:
    "Vende Veloz ayuda a organizar alumnos, matrículas, pagos, ventas, horarios y asistencia desde un solo sistema. Puede comenzar con procesos manuales y activar automatizaciones posteriormente. No genera demanda ni nuevos alumnos por sí solo.",
  capabilities: [
    "alumnos y apoderados",
    "matrículas",
    "pagos",
    "ventas",
    "saldos pendientes",
    "horarios",
    "cupos",
    "asistencia",
    "renovaciones",
    "caja",
    "matrícula online opcional",
    "pagos online opcionales",
  ],
} as const;

export type VendeVelozProduct = typeof VENDE_VELOZ_PRODUCT;

export const VENDE_VELOZ_COMMERCIAL_POLICY = {
  default_channel: "WhatsApp",
  goal: "avanzar comercialmente sin convertir el chat en una encuesta",
  human_call:
    "solo cuando exista complejidad, múltiples decisores, integraciones, varias sedes, necesidades especiales o solicitud explícita",
  future_interest:
    "si el prospecto tiene interés real pero indicó una temporada o fecha futura, no presionar el cierre inmediato; programar seguimiento",
  disqualification:
    "si está satisfecho con su solución actual y no existe necesidad ni motivación concreta de cambio, no seguir preguntando solo para encontrar un problema",
} as const;

export type VendeVelozCommercialPolicy = typeof VENDE_VELOZ_COMMERCIAL_POLICY;

export const VENDE_VELOZ_OFFER = {
  currency: "PEN",
  setup: 497,
  monthlyBase: 197,
  includedActiveStudents: 50,
  extraPerActiveStudent: 1,
  setupIsOneTime: true,
  implementation: {
    purpose: "adopción real",
    includes: [
      "configuración del flujo acordado",
      "carga de datos acordada",
      "usuarios",
      "capacitación",
      "primeras operaciones reales",
      "acompañamiento inicial",
    ],
  },
  neverPromise: [
    "generación de alumnos",
    "demanda",
    "ventas",
  ],
} as const;

export type VendeVelozOffer = typeof VENDE_VELOZ_OFFER;
