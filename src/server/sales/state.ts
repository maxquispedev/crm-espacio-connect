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
 * State que el CRM envía a Jev. Lo construye el CRM; sin resumen LLM.
 * No incluir teléfono, email, wa_identity, IDs Meta, notas ni secrets.
 * No incluir `commercial_offer`: esa oferta es ayuda del writer/CRM.
 */
export type JevSalesState = {
  product: VendeVelozProduct;
  commercial_policy: VendeVelozCommercialPolicy;
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
