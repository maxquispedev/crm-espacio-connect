/**
 * Personas del Laboratorio.
 *
 * Dos conjuntos con propósitos distintos:
 *
 *   - `LEGACY_PERSONAS`: las 6 personas ferreteras originales (tienda de
 *     ferretería). Prefijadas `legacy_*` desde el Corte 6 (Feature 008)
 *     porque evalúan el AGENTE genérico, no el pipeline comercial. NO se
 *     eliminan: siguen siendo el baseline de regresión, y las corridas
 *     viejas del histórico las referencia por su key original (ver
 *     `LEGACY_KEY_ALIASES`).
 *
 *   - `SALES_PERSONAS`: las 6 personas V1 comerciales (academias
 *     deportivas). Son las que ejercitan el pipeline REAL
 *     (Sales Orchestrator + Jev + resolver + writer) contra el playbook.
 *
 * Determinismo: el cliente simulado no usa LLM, son secuencias fijas.
 * El agente que responde es el REAL.
 */

export type Persona = {
  key: string;
  label: string;
  description: string;
  /** Teléfono sintético estable (jamás un número real). */
  phone: string;
  contactName: string;
  script: string[];
  /**
   * `legacy` → corre contra el agente genérico (`runAgentTurn`).
   * `sales`  → corre contra el pipeline comercial real
   * (`runSalesOrchestratorTurn` con override de playbook).
   */
  cohort: PersonaCohort;
};

export type PersonaCohort = "legacy" | "sales";

export const LEGACY_PERSONAS: Persona[] = [
  {
    key: "legacy_comprador_decidido",
    label: "Comprador decidido",
    description: "Sabe lo que quiere y va directo a comprar.",
    phone: "5210000000001",
    contactName: "[Prueba] Comprador decidido",
    cohort: "legacy",
    script: [
      "Hola, buenas tardes",
      "¿Tienen taladros inalámbricos disponibles?",
      "Perfecto, ¿cuánto cuesta el más vendido?",
      "Me convence, lo compro. ¿Cómo pago?",
    ],
  },
  {
    key: "legacy_pregunton_precios",
    label: "Preguntón de precios",
    description: "Pregunta precio tras precio sin decidirse.",
    phone: "5210000000002",
    contactName: "[Prueba] Preguntón de precios",
    cohort: "legacy",
    script: [
      "Hola, ¿qué precio tiene el martillo?",
      "¿Y el desarmador de cruz?",
      "¿Cuánto la caja de clavos de 2 pulgadas?",
      "¿Hay descuento si llevo varias cosas?",
      "Ok, lo voy a pensar",
    ],
  },
  {
    key: "legacy_cliente_enojado",
    label: "Cliente enojado",
    description: "Llega molesto por un problema con su compra.",
    phone: "5210000000003",
    contactName: "[Prueba] Cliente enojado",
    cohort: "legacy",
    script: [
      "Oigan, esto es el colmo",
      "Compré una lijadora la semana pasada y ya no prende, es una porquería",
      "¿Me van a responder o qué? Quiero una solución YA",
      "Pues espero que sí porque no pienso perder mi dinero",
    ],
  },
  {
    key: "legacy_fuera_de_kb",
    label: "Pregunta fuera del conocimiento",
    description: "Pregunta algo que el knowledge base no cubre.",
    phone: "5210000000004",
    contactName: "[Prueba] Fuera del conocimiento",
    cohort: "legacy",
    script: [
      "Hola, una pregunta",
      "¿Cuál es su política de garantías y devoluciones?",
      "¿Y si el producto falla a los dos meses me lo cambian?",
      "¿Dónde reclamo la garantía?",
    ],
  },
  {
    key: "legacy_pide_humano",
    label: "Pide un humano",
    description: "Quiere ser atendido por una persona (debe escalar).",
    phone: "5210000000005",
    contactName: "[Prueba] Pide humano",
    cohort: "legacy",
    script: [
      "Hola",
      "Tengo un asunto delicado con un pedido",
      "Prefiero que me atienda una persona, quiero hablar con un humano",
      "Gracias",
    ],
  },
  {
    key: "legacy_errores_modismos",
    label: "Errores y modismos",
    description: "Escribe con faltas de ortografía y modismos mexicanos.",
    phone: "5210000000006",
    contactName: "[Prueba] Errores y modismos",
    cohort: "legacy",
    script: [
      "ke onda, si benden pintura?",
      "oiga y no le sabe si tienen tiner",
      "cuanto x el galon d pintura blanca pa interiores",
      "va, orita paso x la tienda, sale",
    ],
  },
];

/**
 * Las 6 personas V1 comerciales: directoras y owners de academias
 * deportivas. Cada guion da a Jev algo real que evaluar (necesidad
 * operativa, fit, intención, timing, valor) y permite que el dueño
 * declare un outcome esperado por caso (T604).
 */
export const SALES_PERSONAS: Persona[] = [
  {
    key: "v1_academia_natacion_consultora",
    label: "Academia de natación — consultora",
    description:
      "Consultora que evalúa el sistema para una academia; necesidad operativa clara.",
    phone: "5210000000101",
    contactName: "[Prueba] Academia natación consultora",
    cohort: "sales",
    script: [
      "Hola, soy Patricia, consultora de una academia de natación. Vi su anuncio y me interesa.",
      "La verdad es que hoy no tenemos sistema: los registros se anotan en una libreta y se pierden.",
      "Necesito que los papás puedan ver sus datos y que yo vea quién no ha pagado este mes.",
      "¿Qué tan rápido se pone algo así?",
      "Y el costo, más o menos, para una academia de 200 alumnos.",
    ],
  },
  {
    key: "v1_academia_presupuesto_libre",
    label: "Academia — presupuesto libre",
    description:
      "Directora de academia pequeña; sin presupuesto aprobado y sin prisa.",
    phone: "5210000000102",
    contactName: "[Prueba] Academia presupuesto libre",
    cohort: "sales",
    script: [
      "Buenas, soy Laura, de una academia de fútbol en el sur.",
      "Me interesa saber más, pero ahorita no tengo un presupuesto aprobado.",
      "Si me pueden mandar lo que manejan, lo reviso con mis socios.",
      "Luego vemos, ahorita no hay ninguna urgencia.",
      "Gracias por la info.",
    ],
  },
  {
    key: "v1_academia_insatisfecha_otro_sistema",
    label: "Academia — insatisfecha de otro sistema",
    description:
      "Ya probó otra plataforma y está decepcionada; compara sin compromiso.",
    phone: "5210000000103",
    contactName: "[Prueba] Academia insatisfecha",
    cohort: "sales",
    script: [
      "Hola, soy Marco. Llevo un año con otra plataforma y la verdad no me gustó.",
      "Se me cae el sistema y no responden a tiempo los mensajes de los papás.",
      "Me están pidiendo cambiar, pero no me han dicho nada nuevo todavía.",
      "¿Ustedes tienen WhatsApp integrado de verdad?",
      "Porque si es solo una página web, no me sirve.",
    ],
  },
  {
    key: "v1_academia_temporada_alta_futuro",
    label: "Academia — temporada alta futura",
    description:
      "Sabe que viene un pico y quiere estar lista, pero todavía no compra.",
    phone: "5210000000104",
    contactName: "[Prueba] Academia temporada alta",
    cohort: "sales",
    script: [
      "Hola, soy Valeria, directora de una academia de natación.",
      "El próximo trimestre empieza temporada alta y se nos van a llenar los grupos.",
      "El año pasado nos desbordamos managing la inscripción con hojas de cálculo.",
      "Quiero tenerlo resuelto antes de que empiece, pero aún no decido nada.",
      "¿Me pueden ayudar a dejarlo listo?",
    ],
  },
  {
    key: "v1_academia_multiples_sedes_decisores",
    label: "Academia — varias sedes y decisores",
    description:
      "Red con dos sedes; el dueño no decide solo y necesita escalar a un socio.",
    phone: "5210000000105",
    contactName: "[Prueba] Academia múltiples sedes",
    cohort: "sales",
    script: [
      "Buenas tardes, soy Andrés. Tengo dos sedes de academia de yoga.",
      "La decisión no es solo mía, la comparto con mi hermana.",
      "Necesitamos hablar con ella, porque ella maneja los números.",
      "¿Pueden agendar una llamada con los dos?",
      "Si es para la próxima semana mejor, esta semana estoy fuera.",
    ],
  },
  {
    key: "v1_academia_fuera_contexto_internet",
    label: "Academia — fuera de contexto de internet",
    description:
      "Directora sin operador previo en internet; eligió el canal por confianza.",
    phone: "5210000000106",
    contactName: "[Prueba] Academia fuera de contexto",
    cohort: "sales",
    script: [
      "Hola, soy Carmen, de una academia de danza.",
      "Una vecina me pasó su WhatsApp, no los conozco de nada.",
      "Nunca he hecho esto por internet, no sé ni cómo se compran esas cosas.",
      "¿Cómo sé que no me van a engañar?",
      "Y si no me convence, ¿me devuelven el dinero?",
    ],
  },
];

/** Todas las personas, en el orden en que se crean los casos. */
export const PERSONAS: Persona[] = [...SALES_PERSONAS, ...LEGACY_PERSONAS];

/**
 * Personas por cohorte. El runner comercial (Corte 6) corre las `sales`
 * contra el pipeline real; el modo legacy corre las `legacy` contra el
 * agente genérico.
 */
export const PERSONAS_BY_COHORT: Record<PersonaCohort, Persona[]> = {
  sales: SALES_PERSONAS,
  legacy: LEGACY_PERSONAS,
};

export const PERSONA_LABELS: Record<string, string> = Object.fromEntries(
  PERSONAS.map((p) => [p.key, p.label])
);

/**
 * Compatibilidad hacia atrás: las corridas creadas antes del Corte 6
 * guardaron los keys sin prefijo (`comprador_decidido`, etc.). Para que
 * el histórico siga mostrando su etiqueta y no la key cruda, se mapean
 * los aliases legacy a su key actual.
 */
export const LEGACY_KEY_ALIASES: Record<string, string> = {
  comprador_decidido: "legacy_comprador_decidido",
  pregunton_precios: "legacy_pregunton_precios",
  cliente_enojado: "legacy_cliente_enojado",
  fuera_de_kb: "legacy_fuera_de_kb",
  pide_humano: "legacy_pide_humano",
  errores_modismos: "legacy_errores_modismos",
};

/** Resuelve un key persistido (viejo o nuevo) a su persona vigente. */
export function findPersona(key: string): Persona | undefined {
  const resolved = LEGACY_KEY_ALIASES[key] ?? key;
  return PERSONAS.find((p) => p.key === resolved);
}

/** Etiqueta legible para un key persistido, tolerando aliases legacy. */
export function personaLabel(key: string): string {
  const p = findPersona(key);
  return p ? p.label : key;
}
