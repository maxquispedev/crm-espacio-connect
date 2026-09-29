import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { isCapiEnabled } from "@/server/attribution/flag";
import { getCapiSettings } from "@/server/attribution/settings";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import {
  buildCapiPayload,
  isAckPositive,
  sendCapiEvent,
  type CapiCustomData,
  type CapiEventName,
  type CapiEventPayload,
} from "@/lib/meta/capi";
import type { MetaApiError as MetaApiErrorType } from "@/lib/meta/client";

/**
 * 007 — Reporte de QualifiedLead y Purchase a Meta CAPI.
 *
 * Este módulo es la única frontera que llama a `sendCapiEvent`. Su contrato:
 *
 *  1. Recibe un cambio de etapa efectivo (`fromStageId`, `toStage`).
 *  2. Aplica guardrails: `is_test`, flag apagada, sin `ctwa_clid`, sin
 *     config, sin etapa calificada → fila `skipped` con motivo legible.
 *  3. Decide evento según mapeo:
 *       - `toStage.kind === "won"` y el evento no fue reportado antes
 *         para esta conversación → `Purchase` (con `value`/`currency`
 *         solo si el lead tiene monto válido; sin inventar `0`).
 *       - `toStage.id === settings.qualifiedStageId` y el evento no fue
 *         reportado antes → `QualifiedLead`.
 *  4. Emite `POST /{dataset_id}/events`. Acuse real: `events_received >= 1`.
 *  5. Registra el desenlace en `conversion_event` (sent / failed / skipped)
 *     con `fbtrace_id` cuando aplique.
 *
 * Garantías:
 *  - Best-effort absoluto: un fallo de Meta NUNCA revierte el cambio de
 *    etapa. La excepción se captura y queda escrita en la fila.
 *  - Dedup por `UNIQUE (organization_id, conversation_id, event_name)` con
 *    `ON CONFLICT DO NOTHING`. Dos webhooks o dos moves simultáneos no
 *    duplican.
 *  - `is_test = true` jamás emite nada (guardrail del Laboratorio).
 *  - Nunca se inventan `value`/`currency`. Si no hay monto válido, el
 *    evento sale sin ellos.
 *
 * El gateway del Corte A engancha `reportStageChange` DESPUÉS del commit
 * exitoso del UPDATE. Nunca dentro de la transacción larga.
 */

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type StageSnapshot = {
  id: string;
  /** kind: open | won | lost — define el evento que se dispara. */
  kind: "open" | "won" | "lost";
  name: string;
};

export type ReportStageChangeInput = {
  organizationId: string;
  conversationId: string;
  fromStageId: string;
  toStage: StageSnapshot;
  /** Cuando el caller ya sabe el monto válido del deal; undefined = sin monto. */
  dealValue?: number | null;
  dealCurrency?: string | null;
  /** Caller ya hizo el commit. Aquí se reporta solo, no se vuelve a escribir BD. */
  alreadyCommitted?: true;
};

export type ReportStageChangeResult = {
  status: "sent" | "failed" | "skipped";
  eventName: CapiEventName | null;
  fbtraceId: string | null;
  skipReason?: string;
  errorMessage?: string;
};

// ---------------------------------------------------------------------------
// reportStageChange — el punto de entrada desde el gateway
// ---------------------------------------------------------------------------

/**
 * Reporta el cambio de etapa a Meta CAPI (best-effort).
 *
 * Esta función está diseñada para llamarse DESPUÉS del commit del UPDATE
 * del gateway. NUNCA se debe llamar dentro de la transacción larga: un
 * timeout de Meta no debe dejar la BD esperando.
 *
 * El resultado SIEMPRE queda escrito en `conversion_event`, incluso si fue
 * `skipped` por guardrail. Eso le da al dueño una vista auditable.
 */
export async function reportStageChange(
  input: ReportStageChangeInput
): Promise<ReportStageChangeResult> {
  if (!isCapiEnabled()) {
    return await recordAndReturn(
      buildInputKey(input),
      "skipped",
      null,
      { skipReason: "atribucion_apagada" },
      input
    );
  }

  // Guardrail del Laboratorio: jamás emite.
  if (await isConversationTest(input)) {
    return await recordAndReturn(
      buildInputKey(input),
      "skipped",
      null,
      { skipReason: "is_test" },
      input
    );
  }

  const settings = await getCapiSettings(input.organizationId);
  if (!settings || settings.datasetId.trim().length === 0) {
    return await recordAndReturn(
      buildInputKey(input),
      "skipped",
      null,
      { skipReason: "sin_config_capi" },
      input
    );
  }

  // Decide qué evento aplicar según la etapa destino.
  const eventName = pickEventName(input.toStage, settings.qualifiedStageId);
  if (!eventName) {
    // No es won ni la etapa calificada: no hay nada que reportar.
    // NO escribimos fila: es la situación normal, no un skip con motivo.
    return {
      status: "skipped",
      eventName: null,
      fbtraceId: null,
    };
  }

  // Pre-chequeo de duplicado: si ya hay fila sent para esta combinación,
  // no reenviamos. Esto es OPTIMIZACIÓN (la barrera real es el UNIQUE +
  // ON CONFLICT DO NOTHING del INSERT).
  const dup = await existingEventRow(input, eventName);
  if (dup) {
    return {
      status: dup.status,
      eventName,
      fbtraceId: dup.fbtraceId ?? null,
      skipReason:
        dup.status === "skipped"
          ? dup.skipReason ?? "duplicado"
          : dup.status === "failed"
            ? dup.errorMessage ?? "ya_intentado"
            : "ya_enviado",
    };
  }

  // Necesitamos ctwa_clid (de 006) y token (custom o reusado de WA).
  const attribution = await loadAdAttribution(input);
  if (!attribution || !attribution.ctwaClid) {
    return await recordAndReturn(
      buildInputKey(input),
      "skipped",
      eventName,
      { skipReason: "sin_ctwa_clid" },
      input
    );
  }

  const token = settings.accessToken ?? (await loadWhatsAppToken(input.organizationId));
  if (!token) {
    return await recordAndReturn(
      buildInputKey(input),
      "skipped",
      eventName,
      { skipReason: "sin_token" },
      input
    );
  }

  // Construye custom_data SIN inventar value=0.
  const customData = buildCustomData({
    stage: input.toStage,
    dealValue: input.dealValue ?? null,
    dealCurrency: input.dealCurrency ?? null,
  });

  const payload = buildCapiPayload({
    eventName,
    eventTime: new Date(),
    ctwaClid: attribution.ctwaClid,
    whatsappBusinessAccountId: attribution.wabaId,
    customData,
  });

  // Emisión best-effort: cualquier fallo se traduce a fila `failed`.
  try {
    const result = await sendCapiEvent({
      datasetId: settings.datasetId,
      accessToken: token,
      payload,
    });
    if (isAckPositive(result.ack)) {
      return await recordAndReturn(
        buildInputKey(input),
        "sent",
        eventName,
        { fbtraceId: result.fbtraceId },
        input,
        payload,
        customData
      );
    }
    return await recordAndReturn(
      buildInputKey(input),
      "failed",
      eventName,
      { errorMessage: `events_received=${result.ack.events_received}` },
      input,
      payload,
      customData
    );
  } catch (err) {
    const message = describeError(err);
    return await recordAndReturn(
      buildInputKey(input),
      "failed",
      eventName,
      { errorMessage: message },
      input,
      payload,
      customData
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickEventName(
  toStage: StageSnapshot,
  qualifiedStageId: string | null
): CapiEventName | null {
  if (toStage.kind === "won") return "Purchase";
  if (qualifiedStageId && toStage.id === qualifiedStageId) {
    return "QualifiedLead";
  }
  return null;
}

function buildCustomData(input: {
  stage: StageSnapshot;
  dealValue: number | null;
  dealCurrency: string | null;
}): CapiCustomData {
  const leadStage = input.stage.kind === "won" ? "won" : "qualified";
  const cd: CapiCustomData = { lead_stage: leadStage };
  if (
    input.dealValue !== null &&
    input.dealValue !== undefined &&
    Number.isFinite(input.dealValue) &&
    input.dealValue > 0 &&
    typeof input.dealCurrency === "string" &&
    input.dealCurrency.length === 3
  ) {
    cd.value = input.dealValue;
    cd.currency = input.dealCurrency;
  }
  return cd;
}

function describeError(err: unknown): string {
  // Detectamos MetaApiError por su nombre (import type evita instanceof con
  // mocks que redefinen la clase; el shape name+status+code es estable).
  if (
    err instanceof Error &&
    err.name === "MetaApiError" &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  ) {
    const e = err as MetaApiErrorType;
    const codePart = e.code !== null ? ` code=${e.code}` : "";
    return `Meta respondió ${e.status}${codePart}: ${e.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

async function isConversationTest(input: ReportStageChangeInput): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ isTest: schema.conversation.isTest })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        input.organizationId,
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  return rows[0]?.isTest === true;
}

async function loadAdAttribution(
  input: ReportStageChangeInput
): Promise<{ ctwaClid: string | null; wabaId: string | null } | null> {
  const db = getDb();
  const rows = await db
    .select({
      ctwaClid: schema.adAttribution.ctwaClid,
    })
    .from(schema.adAttribution)
    .where(
      scoped(
        schema.adAttribution.organizationId,
        input.organizationId,
        eq(schema.adAttribution.conversationId, input.conversationId)
      )
    )
    .limit(1);
  const wabaId = await loadWabaId(input.organizationId);
  return rows[0] ? { ctwaClid: rows[0].ctwaClid ?? null, wabaId } : null;
}

async function loadWabaId(organizationId: string): Promise<string | null> {
  const creds = await getCredentialsByOrg(organizationId);
  return creds?.wabaId ?? null;
}

async function loadWhatsAppToken(organizationId: string): Promise<string | null> {
  const creds = await getCredentialsByOrg(organizationId);
  return creds?.token ?? null;
}

async function existingEventRow(
  input: ReportStageChangeInput,
  eventName: CapiEventName
): Promise<
  | {
      status: "sent" | "failed" | "skipped";
      fbtraceId: string | null;
      skipReason: string | null;
      errorMessage: string | null;
    }
  | null
> {
  const db = getDb();
  const rows = await db
    .select({
      status: schema.conversionEvent.status,
      fbtraceId: schema.conversionEvent.fbtraceId,
      skipReason: schema.conversionEvent.skipReason,
      errorMessage: schema.conversionEvent.errorMessage,
    })
    .from(schema.conversionEvent)
    .where(
      and(
        scoped(
          schema.conversionEvent.organizationId,
          input.organizationId
        ),
        eq(schema.conversionEvent.conversationId, input.conversationId),
        eq(schema.conversionEvent.eventName, eventName)
      )
    )
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    status: r.status,
    fbtraceId: r.fbtraceId ?? null,
    skipReason: r.skipReason ?? null,
    errorMessage: r.errorMessage ?? null,
  };
}

function buildInputKey(input: ReportStageChangeInput): {
  organizationId: string;
  conversationId: string;
  eventName: CapiEventName;
} {
  // Helper local: solo se usa cuando ya decidimos eventName; aquí
  // devolvemos QualifiedLead por defecto cuando no hay eventName. La
  // unicidad por event_name en BD evita pisar filas con otro nombre.
  return {
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    eventName: "QualifiedLead",
  };
}

async function recordAndReturn(
  key: { organizationId: string; conversationId: string; eventName: CapiEventName },
  status: "sent" | "failed" | "skipped",
  eventName: CapiEventName | null,
  details: {
    skipReason?: string;
    errorMessage?: string;
    fbtraceId?: string | null;
  },
  input: ReportStageChangeInput,
  payload?: CapiEventPayload,
  customData?: CapiCustomData
): Promise<ReportStageChangeResult> {
  // Las skip-rows sin eventName decidido no se persisten (escenario normal
  // de "no aplica"; no queremos ruido en la tabla de actividad).
  if (!eventName && status === "skipped" && !details.skipReason) {
    return {
      status,
      eventName: null,
      fbtraceId: null,
    };
  }
  const writeKey = eventName ?? key.eventName;
  await persistConversionEvent({
    organizationId: key.organizationId,
    conversationId: key.conversationId,
    eventName: writeKey,
    status,
    customData: customData ?? { lead_stage: stageHint(input.toStage) },
    payload: payload ?? null,
    fbtraceId: details.fbtraceId ?? null,
    errorMessage: details.errorMessage ?? null,
    skipReason: details.skipReason ?? null,
  });
  return {
    status,
    eventName: writeKey,
    fbtraceId: details.fbtraceId ?? null,
    skipReason: details.skipReason,
    errorMessage: details.errorMessage,
  };
}

function stageHint(stage: StageSnapshot): string {
  if (stage.kind === "won") return "won";
  return "qualified";
}

async function persistConversionEvent(input: {
  organizationId: string;
  conversationId: string;
  eventName: CapiEventName;
  status: "sent" | "failed" | "skipped";
  customData: CapiCustomData;
  payload: CapiEventPayload | null;
  fbtraceId: string | null;
  errorMessage: string | null;
  skipReason: string | null;
}): Promise<void> {
  const db = getDb();
  try {
    await db
      .insert(schema.conversionEvent)
      .values({
        id: newId("conversionEvent"),
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        eventName: input.eventName,
        status: input.status,
        customData: input.customData,
        payload: input.payload ?? {},
        fbtraceId: input.fbtraceId,
        errorMessage: input.errorMessage,
        skipReason: input.skipReason,
      })
      .onConflictDoNothing({
        target: [
          schema.conversionEvent.organizationId,
          schema.conversionEvent.conversationId,
          schema.conversionEvent.eventName,
        ],
      });
  } catch (err) {
    // Best-effort absoluto: la tabla de actividad nunca rompe el caller.
    console.warn(
      "[capi] no se pudo registrar el conversion_event:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ---------------------------------------------------------------------------
// API de actividad — listado para la UI Ajustes → Anuncios
// ---------------------------------------------------------------------------

export type ActivityRow = {
  id: string;
  conversationId: string;
  eventName: CapiEventName;
  status: "sent" | "failed" | "skipped";
  fbtraceId: string | null;
  errorMessage: string | null;
  skipReason: string | null;
  customData: CapiCustomData | null;
  createdAt: string;
};

export async function listConversionEvents(input: {
  organizationId: string;
  limit?: number;
}): Promise<ActivityRow[]> {
  const db = getDb();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = await db
    .select()
    .from(schema.conversionEvent)
    .where(scoped(schema.conversionEvent.organizationId, input.organizationId))
    .orderBy(desc(schema.conversionEvent.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    eventName: r.eventName as CapiEventName,
    status: r.status,
    fbtraceId: r.fbtraceId ?? null,
    errorMessage: r.errorMessage ?? null,
    skipReason: r.skipReason ?? null,
    customData: (r.customData ?? null) as CapiCustomData | null,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// emitConversion — API pública para futuros hooks (InitiateCheckout, etc.)
// ---------------------------------------------------------------------------

export type EmitConversionInput = {
  organizationId: string;
  conversationId: string;
  eventName: CapiEventName;
  customData: CapiCustomData;
};

/**
 * Punto de extensión público. Hoy el único caller es `reportStageChange`,
 * pero queda exportado para que un fork que quiera reportar `InitiateCheckout`
 * (receta en `docs/atribucion-capi.md`) lo haga sin re-arquitectura: el
 * mismo dedup, el mismo acuse, la misma fila de actividad.
 */
export async function emitConversion(
  input: EmitConversionInput
): Promise<ReportStageChangeResult> {
  if (!isCapiEnabled()) {
    return {
      status: "skipped",
      eventName: input.eventName,
      fbtraceId: null,
      skipReason: "atribucion_apagada",
    };
  }
  if (await isConversationTestOrg(input)) {
    return {
      status: "skipped",
      eventName: input.eventName,
      fbtraceId: null,
      skipReason: "is_test",
    };
  }
  const settings = await getCapiSettings(input.organizationId);
  if (!settings || settings.datasetId.trim().length === 0) {
    return {
      status: "skipped",
      eventName: input.eventName,
      fbtraceId: null,
      skipReason: "sin_config_capi",
    };
  }
  const dup = await existingEventRowRaw(input);
  if (dup) {
    return {
      status: dup.status,
      eventName: input.eventName,
      fbtraceId: dup.fbtraceId,
      skipReason:
        dup.status === "skipped"
          ? dup.skipReason ?? "duplicado"
          : dup.status === "failed"
            ? dup.errorMessage ?? "ya_intentado"
            : "ya_enviado",
    };
  }
  const attribution = await loadAdAttributionByConv(input);
  if (!attribution || !attribution.ctwaClid) {
    await persistConversionEvent({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      eventName: input.eventName,
      status: "skipped",
      customData: input.customData,
      payload: null,
      fbtraceId: null,
      errorMessage: null,
      skipReason: "sin_ctwa_clid",
    });
    return {
      status: "skipped",
      eventName: input.eventName,
      fbtraceId: null,
      skipReason: "sin_ctwa_clid",
    };
  }
  const token =
    settings.accessToken ?? (await loadWhatsAppToken(input.organizationId));
  if (!token) {
    await persistConversionEvent({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      eventName: input.eventName,
      status: "skipped",
      customData: input.customData,
      payload: null,
      fbtraceId: null,
      errorMessage: null,
      skipReason: "sin_token",
    });
    return {
      status: "skipped",
      eventName: input.eventName,
      fbtraceId: null,
      skipReason: "sin_token",
    };
  }
  const payload = buildCapiPayload({
    eventName: input.eventName,
    eventTime: new Date(),
    ctwaClid: attribution.ctwaClid,
    whatsappBusinessAccountId: attribution.wabaId,
    customData: input.customData,
  });
  try {
    const result = await sendCapiEvent({
      datasetId: settings.datasetId,
      accessToken: token,
      payload,
    });
    if (isAckPositive(result.ack)) {
      await persistConversionEvent({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        eventName: input.eventName,
        status: "sent",
        customData: input.customData,
        payload,
        fbtraceId: result.fbtraceId,
        errorMessage: null,
        skipReason: null,
      });
      return {
        status: "sent",
        eventName: input.eventName,
        fbtraceId: result.fbtraceId,
      };
    }
    await persistConversionEvent({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      eventName: input.eventName,
      status: "failed",
      customData: input.customData,
      payload,
      fbtraceId: result.fbtraceId,
      errorMessage: `events_received=${result.ack.events_received}`,
      skipReason: null,
    });
    return {
      status: "failed",
      eventName: input.eventName,
      fbtraceId: result.fbtraceId,
      errorMessage: `events_received=${result.ack.events_received}`,
    };
  } catch (err) {
    const message = describeError(err);
    await persistConversionEvent({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      eventName: input.eventName,
      status: "failed",
      customData: input.customData,
      payload,
      fbtraceId: null,
      errorMessage: message,
      skipReason: null,
    });
    return {
      status: "failed",
      eventName: input.eventName,
      fbtraceId: null,
      errorMessage: message,
    };
  }
}

async function isConversationTestOrg(input: {
  organizationId: string;
  conversationId: string;
}): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ isTest: schema.conversation.isTest })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        input.organizationId,
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  return rows[0]?.isTest === true;
}

async function existingEventRowRaw(input: EmitConversionInput): Promise<
  | {
      status: "sent" | "failed" | "skipped";
      fbtraceId: string | null;
      skipReason: string | null;
      errorMessage: string | null;
    }
  | null
> {
  const db = getDb();
  const rows = await db
    .select({
      status: schema.conversionEvent.status,
      fbtraceId: schema.conversionEvent.fbtraceId,
      skipReason: schema.conversionEvent.skipReason,
      errorMessage: schema.conversionEvent.errorMessage,
    })
    .from(schema.conversionEvent)
    .where(
      and(
        scoped(
          schema.conversionEvent.organizationId,
          input.organizationId
        ),
        eq(schema.conversionEvent.conversationId, input.conversationId),
        eq(schema.conversionEvent.eventName, input.eventName)
      )
    )
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    status: r.status,
    fbtraceId: r.fbtraceId ?? null,
    skipReason: r.skipReason ?? null,
    errorMessage: r.errorMessage ?? null,
  };
}

async function loadAdAttributionByConv(input: {
  organizationId: string;
  conversationId: string;
}): Promise<{ ctwaClid: string | null; wabaId: string | null } | null> {
  const db = getDb();
  const rows = await db
    .select({ ctwaClid: schema.adAttribution.ctwaClid })
    .from(schema.adAttribution)
    .where(
      scoped(
        schema.adAttribution.organizationId,
        input.organizationId,
        eq(schema.adAttribution.conversationId, input.conversationId)
      )
    )
    .limit(1);
  const wabaId = await loadWabaId(input.organizationId);
  return rows[0] ? { ctwaClid: rows[0].ctwaClid ?? null, wabaId } : null;
}
