import { z } from "zod";

/**
 * 007 — Cliente de Meta Conversions API (CAPI) para leads Click-to-WhatsApp.
 *
 * Catálogo cerrado (Constitución VIII: foco vertical). El fork solo emite
 * dos eventos:
 *
 *  - `QualifiedLead` cuando el lead entra por primera vez a la etapa
 *    calificada configurable del tenant (no se hardcodea "Interesado").
 *  - `Purchase` cuando el lead entra por primera vez a una etapa
 *    `kind = "won"`.
 *
 * El espejo de `InitiateCheckout` para campañas de venta queda fuera de
 * fábrica a propósito: la receta documentada en `docs/atribucion-capi.md`
 * permite que cada fork lo agregue si quiere.
 *
 * Identidad enviada a Meta (mínima, Constitución I):
 *  - `ctwa_clid` (de `ad_attribution.ctwa_clid` — captura de 006) **en crudo**,
 *    exactamente como lo entregó el referral de Meta. Meta NO exige hashing
 *    para este campo: es el identificador del clic del anuncio, no un dato
 *    personal, y viaja RAW para que Meta pueda unirlo con su tabla de clics.
 *  - `whatsapp_business_account_id` (WABA ID de la conexión del tenant).
 *
 * NUNCA teléfono, nombre, email ni texto del contacto. El ctwa_clid es un
 * identificador de clic, no un dato personal.
 *
 * Body top-level:
 *  - `data[]`: el array con los eventos a reportar.
 *  - `partner_agent`: constante del proyecto que identifica al integrador
 *    ("espacio-connect"). No es configurable por tenant y NO incluye
 *    nombre del cliente ni PII.
 *
 * Acuse real: el único acuse válido es `events_received >= 1`. Si Meta
 * responde 200 pero `events_received = 0`, el caller marca la fila como
 * `failed` con motivo textual.
 */

// ---------------------------------------------------------------------------
// Catálogo y validadores
// ---------------------------------------------------------------------------

export const CAPI_EVENT_NAMES = ["QualifiedLead", "Purchase"] as const;
export type CapiEventName = (typeof CAPI_EVENT_NAMES)[number];

export function isCapiEventName(value: unknown): value is CapiEventName {
  return (
    typeof value === "string" &&
    (CAPI_EVENT_NAMES as readonly string[]).includes(value)
  );
}

const actionSourceSchema = z.literal("business_messaging");
const messagingChannelSchema = z.literal("whatsapp");

/**
 * custom_data que reporta el fork. Mínimo viable y verificable: solo
 * `lead_stage` (etiqueta de la etapa que disparó el evento) y, opcionalmente,
 * `value` + `currency` para `Purchase`.
 *
 * NOTA: jamás se inventa `value = 0`. Si el lead no tiene monto válido, el
 * evento sale sin `value`/`currency` — la regla anti-valor-falso protege la
 * optimización por valor de Meta.
 */
export const customDataSchema = z
  .object({
    lead_stage: z.string().min(1).max(64),
    value: z.number().positive().optional(),
    currency: z.string().length(3).optional(),
  })
  .strict();
export type CapiCustomData = z.infer<typeof customDataSchema>;

export const userDataSchema = z
  .object({
    /**
     * ctwa_clid de 006. Viaja **RAW**, exactamente como lo entregó el
     * referral de Meta: SIN trim, SIN lowercase, SIN hashing. Meta NO
     * exige hashing para este campo (es el identificador del clic del
     * anuncio, no un dato personal) y necesita recibirlo en su forma
     * original para unirlo con su tabla de clics.
     */
    ctwa_clid: z.string().min(1).max(256).optional(),
    /** WABA ID de la conexión del tenant (no es PII). */
    whatsapp_business_account_id: z.string().min(1).max(64).optional(),
  })
  .strict();
export type CapiUserData = z.infer<typeof userDataSchema>;

/** Payload completo que se publica en `POST /{dataset_id}/events`. */
export const capiEventPayloadSchema = z
  .object({
    event_name: z.enum(CAPI_EVENT_NAMES),
    event_time: z.number().int().positive(),
    action_source: actionSourceSchema,
    messaging_channel: messagingChannelSchema,
    user_data: userDataSchema,
    custom_data: customDataSchema,
  })
  .strict();
export type CapiEventPayload = z.infer<typeof capiEventPayloadSchema>;

/** Acuse oficial de Meta. */
export const capiAckSchema = z
  .object({
    events_received: z.number().int().nonnegative(),
    messages: z.array(z.string()).optional(),
    fbtrace_id: z.string().optional(),
  })
  .passthrough();
export type CapiAck = z.infer<typeof capiAckSchema>;

// ---------------------------------------------------------------------------
// partner_agent
// ---------------------------------------------------------------------------

/**
 * Identificador del software que integró el evento. Es una constante del
 * proyecto — NO configurable por tenant y NO incluye nombre del cliente ni
 * PII. Lo exige el contrato de Meta Conversions API para `business_messaging`.
 */
export const PARTNER_AGENT = "espacio-connect" as const;

// ---------------------------------------------------------------------------
// Builder del payload
// ---------------------------------------------------------------------------

export type BuildPayloadInput = {
  eventName: CapiEventName;
  /** Date.now() del lado servidor; deriva en epoch segundos. */
  eventTime: Date;
  ctwaClid: string | null;
  whatsappBusinessAccountId: string | null;
  customData: CapiCustomData;
};

export function buildCapiPayload(input: BuildPayloadInput): CapiEventPayload {
  const userData: CapiUserData = {};
  if (input.ctwaClid && input.ctwaClid.length > 0) {
    // ctwa_clid viaja RAW: sin trim, sin lowercase, sin hashing.
    userData.ctwa_clid = input.ctwaClid;
  }
  if (
    input.whatsappBusinessAccountId &&
    input.whatsappBusinessAccountId.length > 0
  ) {
    userData.whatsapp_business_account_id =
      input.whatsappBusinessAccountId;
  }
  const payload: CapiEventPayload = {
    event_name: input.eventName,
    event_time: Math.floor(input.eventTime.getTime() / 1000),
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: userData,
    custom_data: input.customData,
  };
  return capiEventPayloadSchema.parse(payload);
}

// ---------------------------------------------------------------------------
// Emisión HTTP
// ---------------------------------------------------------------------------

/**
 * Emite un evento a Meta. Devuelve el acuse validado con Zod y un
 * `fbtrace_id` extraído. Lanza `MetaApiError` ante cualquier fallo
 * (status no-2xx, JSON inválido, acuse fuera de contrato).
 *
 * La función NO clasifica sent/failed; esa lógica vive en `conversions.ts`
 * porque es de negocio (events_received >= 1). Esta capa solo traduce.
 */
export type SendCapiEventResult = {
  ack: CapiAck;
  /** El `fbtrace_id` que el soporte de Meta pide para debug. */
  fbtraceId: string | null;
};

export async function sendCapiEvent(input: {
  datasetId: string;
  accessToken: string;
  payload: CapiEventPayload;
}): Promise<SendCapiEventResult> {
  const datasetId = input.datasetId.trim();

  // Import lazy para evitar ciclos con tests que mockean @/lib/meta/client
  // (la suite de orchestrator y otros).
  const { graphRequest, MetaApiError: ApiError } = await import(
    "@/lib/meta/client"
  );

  if (!datasetId) {
    throw new ApiError("dataset_id vacío", {
      status: 500,
      type: "configuration",
    });
  }

  // Meta espera un array `data` con uno o más eventos, y un `partner_agent`
  // top-level que identifica al integrador. Constante del proyecto, no
  // configurable por tenant.
  const body = {
    data: [input.payload],
    partner_agent: PARTNER_AGENT,
  };
  const path = `${datasetId}/events`;

  let raw: unknown;
  try {
    raw = await graphRequest<unknown>(path, {
      method: "POST",
      token: input.accessToken,
      body,
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      err instanceof Error ? err.message : "Fallo al llamar a CAPI",
      { status: 0 }
    );
  }

  // El acuse puede llegar como objeto o como { events_received, messages, fbtrace_id }.
  // Aceptamos un objeto único o el primer elemento de un array.
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const parsed = capiAckSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ApiError(
      "Meta devolvió un acuse CAPI inesperado",
      { status: 200, type: "invalid_ack", details: candidate }
    );
  }
  return {
    ack: parsed.data,
    fbtraceId: parsed.data.fbtrace_id ?? null,
  };
}

/**
 * Criterio único de acuse real: `events_received >= 1`. Cualquier otra
 * cosa (incluido `events_received = 0`) cuenta como fallo.
 */
export function isAckPositive(ack: CapiAck): boolean {
  return typeof ack.events_received === "number" && ack.events_received >= 1;
}
