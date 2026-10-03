import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  getPublishedConfigForOrg,
  type LoadedPlaybookVersion,
} from "@/lib/sales/playbook/loader";
import type { ConfigV1 } from "@/lib/sales/playbook/schema";
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
  type VendeVelozCommercialPolicy,
  type VendeVelozProduct,
} from "@/server/sales/vende-veloz";

/**
 * Set<orgId> en memoria de proceso: emitimos `console.warn` solo la
 * PRIMERA vez que una organización NO tiene playbook publicado. Esto
 * evita spam en logs cuando hay muchos turnos concurrentes y deja
 * trazabilidad clara cuando un tenant corre sin playbook.
 *
 * No es cache de la config (el loader no cachea). Solo es el set
 * "ya avisado" del warning. Se descarta al reiniciar el proceso.
 */
const warnedNoPlaybookOrgs = new Set<string>();

/**
 * Interruptor de producción (spec 009, corte 3).
 *
 * `true` = las conversaciones REALES cargan la versión **Published** de su
 * organización. El runtime ya existía (Feature 008) y estaba congelado para
 * el lanzamiento; este corte lo reactiva sin reescribir el motor.
 *
 * Reversible en una línea: volver a `false` devuelve el producto, la
 * política, las preguntas, la oferta y el writer a los defaults
 * hardcodeados (`VENDE_VELOZ_*`, `JEV_SALES_QUESTIONS_V2`), que quedan como
 * **fallback** cuando no hay publicada o la publicada es inválida.
 *
 * NO es un feature flag: no se lee de env, no se combina con otras
 * condiciones y no invalida cache alguno (el loader no cachea; ver
 * `src/lib/sales/playbook/loader.ts`). El override por versión sigue
 * existiendo solo para `is_test` (guard T306 en el orquestador).
 */
export const SALES_PLAYBOOK_RUNTIME_ENABLED = true;

/**
 * Solo para tests: limpia el set de orgs ya avisadas para que el
 * guard `warn-once-per-process` se pueda validar entre tests del
 * mismo archivo sin importar el orden.
 */
export function __resetWarnedNoPlaybookOrgs(): void {
  warnedNoPlaybookOrgs.clear();
}

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
  /**
   * Playbook cargado para este turno. `null` en lanzamiento real o sin publicada
   * (VENDE_VELOZ_*; warning solo ante fallback configurable).
   * El orquestador usa esto para derivar:
   *   - `activeQuestions` (T303): preguntas con `enabled=true`.
   *   - `offer`, `writer.instructions` y `urgency_rules` para el
   *     writer (T307).
   *   - snapshot a persistir en `lead.last_jev_playbook_version_id`
   *     y `last_jev_decision` (T308).
   */
  playbook: LoadedPlaybookVersion | null;
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

  // Lanzamiento: no consultar publicada para conversaciones reales.
  // T302 queda preservado para sandbox/V2. Si el playbook existe, sus
  // bloques `product` y `commercial_policy` pisan los defaults
  // VENDE_VELOZ_*. Si no existe, fallback a los defaults y emitimos
  // warning una sola vez por proceso por organización.
  let playbook: LoadedPlaybookVersion | null = null;
  const usePlaybook = SALES_PLAYBOOK_RUNTIME_ENABLED || convRow.conversation.isTest === true;
  if (usePlaybook) {
    try {
      playbook = await getPublishedConfigForOrg(organizationId);
    } catch (err) {
      // Una fila publicada que no cumple ConfigV1 no debe tumbar el
      // turno. Degradamos al default y registramos para diagnóstico.
      if (!warnedNoPlaybookOrgs.has(organizationId)) {
        warnedNoPlaybookOrgs.add(organizationId);
        // eslint-disable-next-line no-console
        console.warn(
          `[sales] playbook publicado inválido en org=${organizationId}: ${(err as Error).message}. Fallback a VENDE_VELOZ_*.`
        );
      }
      playbook = null;
    }

    if (!playbook && !warnedNoPlaybookOrgs.has(organizationId)) {
      warnedNoPlaybookOrgs.add(organizationId);
      // eslint-disable-next-line no-console
      console.warn(
        `[sales] sin playbook publicado en org=${organizationId}; fallback a VENDE_VELOZ_*.`
      );
    }
  }

  const productFromPlaybook: VendeVelozProduct = playbook
    ? toStateProduct(playbook.config.product)
    : ({ ...VENDE_VELOZ_PRODUCT } as VendeVelozProduct);
  const policyFromPlaybook: VendeVelozCommercialPolicy = playbook
    ? toStatePolicy(playbook.config.commercial_policy)
    : ({ ...VENDE_VELOZ_COMMERCIAL_POLICY } as VendeVelozCommercialPolicy);

  const state: JevSalesState = {
    product: productFromPlaybook,
    commercial_policy: policyFromPlaybook,
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
    playbook,
  };
}

/**
 * `ConfigV1.product` (contrato durable, `src/lib/sales/playbook/schema.ts`)
 * a `JevSalesState.product` (contrato de Jev, snake_case + bloques
 * `implementation`/`subscription`).
 *
 * Corte 3 — el spread `{...VENDE_VELOZ_PRODUCT, ...product}` era
 * INCORRECTO: `ConfigV1.product` no declara `implementation` ni
 * `subscription`, asi que el spread arrastraba los bloques hardcodeados
 * de Vende Veloz al state de CUALQUIER organizacion con playbook
 * publicado (otro negocio heredaba "S/247 al mes" hacia Jev y el
 * writer). Aqui el playbook manda: se mapean sus 6 claves y, si el
 * autor no describe esos dos bloques, se omiten en vez de inventarlos.
 */
function toStateProduct(product: ConfigV1["product"]): VendeVelozProduct {
  return {
    name: product.name,
    one_liner: product.one_liner,
    who_it_is_for: [...product.who_it_is_for],
    core_jobs: [...product.core_jobs],
    not_the_product: [...product.not_the_product],
    how_it_starts: product.how_it_starts,
    // `VendeVelozProduct` es el tipo literal de `as const`: exige
    // `implementation`/`subscription` y fija los textos. El contrato
    // durable no los tiene (van en `offer`), asi que el doble cast es
    // deliberado: el statePublished gana y el precio viaja por `offer`.
  } as unknown as VendeVelozProduct;
}

/**
 * `ConfigV1.commercial_policy` es camelCase (`automationFirst`,
 * `humanHandoff`, ...) porque es el contrato durable que edita el
 * administrador; el state que consume Jev es snake_case.
 *
 * Corte 3 — el spread solo solapaba `goal` y `disqualification`: las
 * otras 6 claves publicadas se perdian en silencio y entraban al state
 * como camelCase que Jev nunca leyo. Aqui el mapeo es explicito y
 * completo, sin defaults: lo que el administrador publico es
 * exactamente lo que Jev evalua.
 */
function toStatePolicy(
  policy: ConfigV1["commercial_policy"]
): VendeVelozCommercialPolicy {
  return {
    default_channel: policy.defaultChannel,
    goal: policy.goal,
    automation_first: policy.automationFirst,
    auto_close: policy.autoClose,
    human_handoff: policy.humanHandoff,
    future_interest: policy.futureInterest,
    no_response: policy.noResponse,
    disqualification: policy.disqualification,
    evidence_rule: policy.evidenceRule,
  } as VendeVelozCommercialPolicy;
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
  message: typeof schema.message.$inferSelect | null | undefined,
  media: typeof schema.mediaAsset.$inferSelect | null
): JevConversationTurn | null {
  const text = turnText(message, media);
  if (!text) return null;
  return {
    from: message?.direction === "in" ? "lead" : "seller",
    text,
  };
}

/**
 * Texto real si existe (cuerpo o caption). Si no, un marcador neutro
 * del tipo de adjunto. Nunca inventa el contenido del archivo.
 */
function turnText(
  message: typeof schema.message.$inferSelect | null | undefined,
  media: typeof schema.mediaAsset.$inferSelect | null
): string | null {
  const real = (message?.text ?? media?.caption ?? "").trim();
  if (real) return real;
  return mediaPlaceholder(media?.kind ?? message?.type ?? "unknown");
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
