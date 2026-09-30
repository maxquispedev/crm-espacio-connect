import type { AutomationLane } from "@/server/sales/lanes";
import type {
  VendeVelozCommercialPolicy,
  VendeVelozProduct,
} from "@/server/sales/vende-veloz";

export type JevConversationSpeaker = "lead" | "seller";

export type JevConversationTurn = {
  from: JevConversationSpeaker;
  text: string;
};

/**
 * Hechos durables controlados por el CRM. No duplicar aquí lo que
 * solo se infiere leyendo el hilo.
 */
export type JevCrmState = {
  pipeline_stage: string | null;
  automation_lane: AutomationLane;
  demo_shown: boolean;
  price_presented: boolean;
  payment_instructions_sent: boolean;
  human_requested: boolean;
  follow_up_count: number;
};

/**
 * Contexto comercial estructurado del anuncio de Meta que trajo la
 * conversación. Se construye desde `ad_attribution` (spec 006) cuando
 * existe; ausente para conversaciones orgánicas. Es la única vía
 * formal por la que Jev recibe el contexto comercial del anuncio.
 * Por Constitución I, jamás incluye:
 * - `ctwa_clid` (identificador de clic, sensible);
 * - `source_id` ni URLs crudas (no se necesitan para decidir);
 * - `phone` / `email` / `wa_identity` / IDs internos de Meta ni secretos.
 */
export type JevAdContext = {
  /** "ad" (pauta) o "post" (publicación orgánica del propio negocio). */
  source_type: string | null;
  /** Titular del creativo tal como vino en `referral.headline`. */
  headline: string | null;
  /** Cuerpo del creativo tal como vino en `referral.body`. */
  body: string | null;
};

/**
 * State que el CRM envía a Jev. Lo construye el CRM; sin resumen LLM.
 * No incluir teléfono, email, wa_identity, IDs Meta, notas ni secrets.
 * No incluir `commercial_offer`: esa oferta es ayuda del writer/CRM.
 *
 * `source` y `ad_context` son OPCIONALES y solo aparecen cuando la
 * conversación tiene una fila en `ad_attribution` (spec 006). Para
 * conversaciones orgánicas, ambos campos quedan ausentes: el contrato
 * validado por jevveloz admite ese caso (state.source simplemente se
 * omite) y el state serializa sin cambios observables respecto al
 * estado previo al hotfix.
 */
export type JevSalesState = {
  product: VendeVelozProduct;
  commercial_policy: VendeVelozCommercialPolicy;
  crm_state: JevCrmState;
  conversation: JevConversationTurn[];
  /** Canal comercial de origen. Hoy solo "Meta Ads" se emite. */
  source?: "Meta Ads";
  /** Contexto estructurado del anuncio, presente junto con `source`. */
  ad_context?: JevAdContext;
};

/** IDs para persistir la decisión después. El builder no escribe BD. */
export type JevPersistTarget = {
  organizationId: string;
  conversationId: string;
  contactId: string;
  leadId: string | null;
};
