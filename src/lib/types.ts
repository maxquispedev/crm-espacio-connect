/** DTOs que viajan por la API interna (lado cliente). */

/** Lane del Sales Orchestrator: quién/qué atiende al lead (no es el pipeline). */
export type AutomationLane =
  | "auto"
  | "auto_close"
  | "wait"
  | "human"
  | "stop";

/** Motivo de un job de seguimiento comercial (`sales_follow_up_job.reason`). */
export type SalesFollowUpReason =
  | "awaiting_reply"
  | "after_demo"
  | "after_price"
  | "scheduled_wait";

/** Estado durable de `sales_follow_up_job`. */
export type SalesFollowUpJobStatus =
  | "pending"
  | "processing"
  | "sent"
  | "cancelled"
  | "blocked"
  | "failed";

/** Motivos de handoff persistidos en conversation.handoff_reason. */
export type HandoffReason =
  | "cliente"
  | "modelo"
  | "error"
  | "ventana"
  | "manual_reply"
  | "commercial";

export type ConversationDto = {
  id: string;
  contact: { id: string; name: string; phone: string | null };
  stageName: string | null;
  aiEnabled: boolean;
  handoffAt: string | null;
  handoffReason: HandoffReason | null;
  lastInboundAt: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  windowOpen: boolean;
  windowRemainingMs: number;
  preview: string | null;
};

/** 008 — Adjunto de un mensaje, para previsualización en el hilo. */
export type MessageMediaDto = {
  assetId: string;
  kind:
    | "image"
    | "video"
    | "audio"
    | "document"
    | "sticker"
    | "location"
    | "contacts";
  mimeType: string | null;
  fileName: string | null;
  fileSize: number | null;
  caption: string | null;
  fetchStatus: "available" | "pending" | "failed";
  /** location {latitude, longitude, name?, address?} / contacts (subset). */
  payload: unknown;
};

export type MessageDto = {
  id: string;
  conversationId: string;
  direction: "in" | "out";
  type: string;
  text: string | null;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  /** Motivo del fallo en lenguaje llano cuando status = "failed". */
  error: string | null;
  aiGenerated: boolean;
  /** 008 — Origen del saliente (en entrantes viene 'operator' y se ignora). */
  origin: "ai" | "operator" | "manual" | "template";
  media: MessageMediaDto | null;
  createdAt: string;
};

/**
 * Payload SSE `message.new`. El hilo sigue usando `message`; las
 * notificaciones de escritorio usan los campos planos (org, contacto, preview).
 */
export type MessageNewPayload = {
  organizationId: string;
  organizationName: string;
  conversationId: string;
  contactId: string;
  contactName: string;
  direction: "in" | "out";
  messageId: string;
  preview: string;
  message: MessageDto;
};

export type TemplateDto = {
  id: string;
  name: string;
  language: string;
  category: string;
  body: string;
  status: "draft" | "pending" | "approved" | "rejected";
  rejectionReason: string | null;
};

export type StageDto = {
  id: string;
  name: string;
  position: number;
  kind: "open" | "won" | "lost";
};

/** Snapshot operativo de Jev (sin probabilities crudas). */
export type SalesSnapshotDto = {
  nextAction: string | null;
  buyingTiming: string | null;
  realOperationalNeed: number | null;
  productFit: number | null;
  purchaseIntent: number | null;
  nextActionConfidence?: number;
  buyingTimingConfidence?: number;
  realOperationalNeedConfidence?: number;
  productFitConfidence?: number;
  purchaseIntentConfidence?: number;
};

/** Estado comercial del lead para el panel de contacto. */
export type ContactSalesDto = {
  lane: AutomationLane;
  lastEvaluatedAt: string | null;
  demoShownAt: string | null;
  pricePresentedAt: string | null;
  nextFollowUpAt: string | null;
  snapshot: SalesSnapshotDto | null;
};

export type ContactDto = {
  id: string;
  name: string;
  /** null en contactos que llegaron solo con BSUID (003). */
  phone: string | null;
  notes: string | null;
  /** Etapa del embudo del lead asociado; null si el contacto no tiene lead. */
  stageName: string | null;
  archivedAt: string | null;
};
