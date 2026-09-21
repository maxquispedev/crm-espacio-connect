import type { AutomationLane } from "@/server/sales/lanes";
import type {
  VendeVelozCommercialPolicy,
  VendeVelozOffer,
  VendeVelozProduct,
} from "@/server/sales/vende-veloz";

export type JevConversationTurn = {
  from: "lead" | "business";
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
 * State que el CRM enviará a Jev. Lo construye el CRM; sin resumen LLM.
 * No incluir teléfono, email, wa_identity, IDs Meta, notas ni secrets.
 */
export type JevSalesState = {
  product: VendeVelozProduct;
  commercial_policy: VendeVelozCommercialPolicy;
  commercial_offer: VendeVelozOffer;
  crm_state: JevCrmState;
  conversation: JevConversationTurn[];
};

/** IDs para persistir la decisión después. El builder no escribe BD. */
export type JevPersistTarget = {
  organizationId: string;
  conversationId: string;
  contactId: string;
  leadId: string | null;
};
