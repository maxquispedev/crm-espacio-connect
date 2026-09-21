import type { AutomationLane } from "@/server/sales/lanes";
import type {
  VendeVelozCommercialPolicy,
  VendeVelozProduct,
} from "@/server/sales/vende-veloz";

export type JevConversationTurn = {
  from: "lead" | "seller";
  text: string;
};

/**
 * Hechos durables ya conocidos. No reenviar snapshots Jev ni PII.
 * Timestamps en ISO 8601.
 */
export type JevDurableFacts = {
  automationLane?: AutomationLane;
  demoShownAt?: string;
  pricePresentedAt?: string;
  paymentInstructionsSentAt?: string;
  humanRequestedAt?: string;
  nextFollowUpAt?: string;
  followUpCount?: number;
  followUpReason?: string;
};

/**
 * State que el CRM enviará a Jev. Lo construye el CRM; sin resumen LLM.
 * No incluir teléfono, email, wa_identity, metadata ni actual_outcome.
 */
export type JevSalesState = {
  product: VendeVelozProduct;
  commercial_policy: VendeVelozCommercialPolicy;
  facts: JevDurableFacts;
  conversation: JevConversationTurn[];
};
