import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type {
  JevAdContext,
  JevConversationTurn,
  JevCrmState,
  JevPersistTarget,
  JevSalesState,
} from "@/server/sales/state";
import {
  VENDE_VELOZ_COMMERCIAL_POLICY,
  VENDE_VELOZ_PRODUCT,
} from "@/server/sales/vende-veloz";

/**
 * Política de contexto (sin resumen LLM):
 *
 * 1. `crm_state` lleva los hechos durables (etapa, lane, demo, precio,
 *    pago, humano, follow-ups). Recortar el hilo no borra esos datos.
 * 2. De BD se leen como máximo `FETCH_CAP` mensajes más recientes.
 * 3. Luego se recorta desde lo más reciente hasta `MAX_TURNS` o `MAX_CHARS`,
 *    sin reordenar. Un turno reciente excesivo se recorta; los antiguos
 *    se omiten enteros. Siempre se conserva al menos el turno más reciente.
 *
 * Hotfix 2026-09-30: además del hilo y `crm_state`, cuando la
 * conversación tiene una fila en `ad_attribution` (spec 006), el state
 * lleva `source: "Meta Ads"` y `ad_context` con `source_type`,
 * `headline` y `body`. El contrato jevveloz validado en 89/89 casos
 * incluye esa señal; sin ella Jev descalifica leads orgánicos que
 * escriben "Hola quiero más información" porque no tiene forma de
 * saber que el lead llegó por un anuncio. Ausente para conversaciones
 * orgánicas: el state serializa sin `source` ni `ad_context`.
 */
export const JEV_STATE_CONTEXT = {
  FETCH_CAP: 200,
  MAX_TURNS: 80,
  MAX_CHARS: 24_000,
  MAX_TURN_CHARS: 4_000,
} as const;

export type BuildJevSalesStateInput = {
  organizationId: string;
  conversationId: string;
};

export type BuildJevSalesStateSuccess = {
  ok: true;
  state: JevSalesState;
  persist: JevPersistTarget;
};

export type BuildJevSalesStateFailure = {
  ok: false;
  error: "not_found";
  detail: string;
};

export type BuildJevSalesStateResult =
  | BuildJevSalesStateSuccess
  | BuildJevSalesStateFailure;

/**
 * Arma el state de Jev desde una conversación real. Tenant-safe.
 * No llama a TypeSafe ni escribe BD. Sin lead: degrada, no lanza.
 */
export async function buildJevSalesState(
  input: BuildJevSalesStateInput
): Promise<BuildJevSalesStateResult> {
  const { organizationId, conversationId } = input;
  const db = getDb();

  const convRows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  const convRow = convRows[0];
  if (!convRow) {
    return {
      ok: false,
      error: "not_found",
      detail: "Conversación no encontrada",
    };
  }

  const contactId = convRow.contact.id;

  const leadRows = await db
    .select({
      lead: schema.lead,
      stageName: schema.pipelineStage.name,
    })
    .from(schema.lead)
    .innerJoin(
      schema.pipelineStage,
      eq(schema.lead.stageId, schema.pipelineStage.id)
    )
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .limit(1);
  const leadRow = leadRows[0];

  const messageRows = await db
    .select({
      message: schema.message,
      media: schema.mediaAsset,
    })
    .from(schema.message)
    .leftJoin(
      schema.mediaAsset,
      eq(schema.message.mediaAssetId, schema.mediaAsset.id)
    )
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversationId)
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(JEV_STATE_CONTEXT.FETCH_CAP);

  messageRows.reverse();

  const conversation = trimConversation(
    messageRows.flatMap((row) => {
      const turn = toTurn(row.message, row.media);
      return turn ? [turn] : [];
    })
  );

  // Hotfix 2026-09-30 — contexto comercial de Meta Ads. Tenant-safe:
  // scoped() cierra por organization_id y conversation_id antes del
  // LIMIT 1. La UNIQUE (org, conversation) garantiza que la fila
  // pertenece inequívocamente a esta conversación.
  const adRows = await db
    .select({
      sourceType: schema.adAttribution.sourceType,
      headline: schema.adAttribution.headline,
      body: schema.adAttribution.body,
    })
    .from(schema.adAttribution)
    .where(
      scoped(
        schema.adAttribution.organizationId,
        organizationId,
        eq(schema.adAttribution.conversationId, conversationId)
      )
    )
    .limit(1);
  const adContext = toAdContext(adRows[0]);

  const state: JevSalesState = {
    product: VENDE_VELOZ_PRODUCT,
    commercial_policy: VENDE_VELOZ_COMMERCIAL_POLICY,
    crm_state: toCrmState(leadRow),
    conversation,
    ...(adContext
      ? {
          source: "Meta Ads" as const,
          ad_context: adContext,
        }
      : {}),
  };

  return {
    ok: true,
    state,
    persist: {
      organizationId,
      conversationId,
      contactId,
      leadId: leadRow?.lead.id ?? null,
    },
  };
}

function toCrmState(
  leadRow:
    | {
        lead: typeof schema.lead.$inferSelect;
        stageName: string;
      }
    | undefined
): JevCrmState {
  if (!leadRow) {
    return {
      pipeline_stage: null,
      automation_lane: "auto",
      demo_shown: false,
      price_presented: false,
      payment_instructions_sent: false,
      human_requested: false,
      follow_up_count: 0,
    };
  }

  const { lead, stageName } = leadRow;
  return {
    pipeline_stage: stageName,
    automation_lane: lead.automationLane,
    demo_shown: lead.demoShownAt !== null,
    price_presented: lead.pricePresentedAt !== null,
    payment_instructions_sent: lead.paymentInstructionsSentAt !== null,
    human_requested: lead.humanRequestedAt !== null,
    follow_up_count: lead.followUpCount,
  };
}

/**
 * AdContext estructurado para Jev desde `ad_attribution`. Pura: si la
 * fila no existe o llega vacía, devuelve `null` y el state omite
 * `source` y `ad_context`. Solo transporta tres campos comerciales
 * (`source_type`, `headline`, `body`). Por Constitución I jamás se
 * filtra `ctwa_clid`, `sourceId`, `sourceUrl`, `imageAssetId`, URLs
 * crudas del creativo, ni PII del contacto.
 */
function toAdContext(
  adRow:
    | {
        sourceType: string | null;
        headline: string | null;
        body: string | null;
      }
    | undefined
): JevAdContext | null {
  if (!adRow) return null;
  // Considerar ausente si los tres campos vienen null. Evita emitir un
  // `ad_context: { source_type: null, headline: null, body: null }`
  // inútil que Jev tendría que aprender a ignorar.
  if (
    adRow.sourceType === null &&
    adRow.headline === null &&
    adRow.body === null
  ) {
    return null;
  }
  return {
    source_type: adRow.sourceType,
    headline: adRow.headline,
    body: adRow.body,
  };
}

function toTurn(
  message: typeof schema.message.$inferSelect,
  media: typeof schema.mediaAsset.$inferSelect | null
): JevConversationTurn | null {
  const text = turnText(message, media);
  if (!text) return null;
  return {
    from: message.direction === "in" ? "lead" : "seller",
    text,
  };
}

/**
 * Texto real si existe (cuerpo o caption). Si no, un marcador neutro
 * del tipo de adjunto. Nunca inventa el contenido del archivo.
 */
function turnText(
  message: typeof schema.message.$inferSelect,
  media: typeof schema.mediaAsset.$inferSelect | null
): string | null {
  const real = (message.text ?? media?.caption ?? "").trim();
  if (real) return real;
  return mediaPlaceholder(media?.kind ?? message.type);
}

function mediaPlaceholder(kind: string): string | null {
  switch (kind) {
    case "image":
      return "[imagen]";
    case "audio":
      return "[audio]";
    case "video":
      return "[video]";
    case "document":
      return "[documento]";
    case "sticker":
      return "[sticker]";
    case "location":
      return "[ubicación]";
    case "contacts":
      return "[contactos]";
    default:
      return null;
  }
}

/** Recorte puro del hilo. Exportado para tests; el builder es el único caller de producto. */
export function trimConversation(turns: JevConversationTurn[]): JevConversationTurn[] {
  const clipped = turns.map(clipTurn);
  const selected: JevConversationTurn[] = [];
  let chars = 0;

  for (let i = clipped.length - 1; i >= 0; i -= 1) {
    const turn = clipped[i];
    if (!turn) continue;
    if (selected.length >= JEV_STATE_CONTEXT.MAX_TURNS) break;
    if (
      selected.length > 0 &&
      chars + turn.text.length > JEV_STATE_CONTEXT.MAX_CHARS
    ) {
      break;
    }
    selected.push(turn);
    chars += turn.text.length;
  }

  selected.reverse();
  return selected;
}

function clipTurn(turn: JevConversationTurn): JevConversationTurn {
  if (turn.text.length <= JEV_STATE_CONTEXT.MAX_TURN_CHARS) return turn;
  return {
    ...turn,
    text: `${turn.text.slice(0, JEV_STATE_CONTEXT.MAX_TURN_CHARS)}…`,
  };
}
