import type {
  BuyingTimingAnswer,
  MainValuePropositionAnswer,
  MotivationToChangeAnswer,
  NeedsHumanCallAnswer,
  NextActionAnswer,
  ProductFitAnswer,
  PurchaseIntentAnswer,
  RealOperationalNeedAnswer,
} from "@/server/sales/answers";

/**
 * Decisión comercial de Jev, ya normalizada.
 * No incluye lane: eso lo decide el resolver determinístico.
 */
export type SalesDecision = {
  realOperationalNeed: RealOperationalNeedAnswer;
  productFit: ProductFitAnswer;
  motivationToChange: MotivationToChangeAnswer;
  purchaseIntent: PurchaseIntentAnswer;
  buyingTiming: BuyingTimingAnswer;
  mainValueProposition: MainValuePropositionAnswer;
  nextAction: NextActionAnswer;
  needsHumanCall: NeedsHumanCallAnswer;
};

/**
 * JSON crudo del proveedor. Solo el normalizer lo interpreta.
 * El adaptador HTTP puede persistirlo en `lead.last_jev_decision`.
 */
export type JevRawProviderResponse = unknown;

/**
 * Forma observada en el harness de evaluación. No es un contrato HTTP
 * validado; no usar fuera del normalizer.
 */
export type JevProviderAnswer =
  | { type: "noul"; noul: number }
  | {
      type: "choice";
      choice: string;
      probabilities: Record<string, number>;
      confidence: number;
    }
  | {
      type: "score";
      score: number;
      legend: Record<string, string>;
      probabilities: Record<string, number>;
      confidence: number;
    };

export type JevNormalizeSuccess = {
  ok: true;
  decision: SalesDecision;
};

export type JevNormalizeFailure = {
  ok: false;
  error: string;
};

export type JevNormalizeResult = JevNormalizeSuccess | JevNormalizeFailure;

/**
 * Frontera: raw provider response → normalizer → SalesDecision → resto del CRM.
 * La implementación llega en un commit posterior (sin HTTP aquí).
 */
export type NormalizeJevResponse = (
  raw: JevRawProviderResponse
) => JevNormalizeResult;
