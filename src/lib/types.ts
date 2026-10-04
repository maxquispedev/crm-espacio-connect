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

/** Razones visibles en el resumen del lead (incluye bloqueos/agotamiento). */
export type LeadFollowUpReason =
  | SalesFollowUpReason
  | "no_reply_exhausted"
  | "template_required"
  | "follow_up_failed";

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

/**
 * 013 C2 — Estado operativo de la atención humana, YA DERIVADO en lectura
 * (spec §3.1, plan §3.3/§4.1).
 *
 * `needsAttentionNow` es lo ÚNICO que decide la cola "Por atender", y llega
 * calculado por el servidor en `deriveAttention` (`src/server/inbox/attention.ts`):
 * `pending` O (`deferred` con `due_at` ya vencido). El cliente NO lo recalcula —
 * si lo hiciera, el conteo del chip y el listado podrían discrepar por clocks
 * distintos.
 */
export type AttentionDto = {
  state: "pending" | "waiting_client" | "deferred";
  /** ISO-8601; solo presente en `deferred` (CHECK de coherencia en BD). */
  dueAt: string | null;
  /** Razón del compromiso ("jueves 10:00"), visible en la Agenda (corte 3). */
  note: string | null;
  /** Requiere acción humana AHORA: es la definición de la cola, no un extra. */
  needsAttentionNow: boolean;
};

/**
 * 013 C3 — Grupos de la Agenda humana. El grupo lo decide el SERVIDOR
 * (`src/server/inbox/agenda-buckets.ts`) contra un reloj y una zona horaria
 * explícitos; el cliente solo pinta el resultado. Nótese que estos cinco son
 * grupos de COMPROMISOS, no estados: no son fases operativas (spec §2.3).
 */
export type AgendaBucketName = "overdue" | "today" | "tomorrow" | "week" | "later";

/**
 * 013 C3 — Un recordatorio humano: una fecha que una persona se girdó para
 * retomar una conversación. NO es un seguimiento automático, no tiene
 * plantilla y no dispara ningún envío (plan §5 D-5).
 */
export type ReminderDto = {
  conversationId: string;
  /** Para "Abrir conversación" (la Bandeja abre por `?contact=`). */
  contact: { id: string; name: string; phone: string | null };
  /** ISO-8601 UTC, tal cual se guarda en BD. */
  dueAt: string;
  /** Razón del compromiso; texto libre escrito por el operador. */
  note: string | null;
  state: AttentionDto["state"];
  bucket: AgendaBucketName;
  /**
   * Derivado en el servidor: vencido ⇒ vuelve a "Por atender". Es el mismo
   * criterio que usa la Bandeja, para que ambas superficies coincidan.
   */
  needsAttentionNow: boolean;
};

/** 013 C3 — Respuesta de `GET /api/reminders`. */
export type AgendaDto = {
  /** Instante de referencia con el que se calcularon los grupos. */
  generatedAt: string;
  /** Zona con la que se agrupó por día local. */
  timeZone: string;
  buckets: Record<AgendaBucketName, ReminderDto[]>;
  total: number;
};

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
  /**
   * 006 — Origen del anuncio de Meta cuando llegó desde un CTWA. Aditivo.
   * Subset reducido para la lista: solo lo que el badge necesita.
   */
  anuncio: AnuncioListaDto | null;
  /**
   * 013 C2 — Atención humana de la conversación. ADITIVO y OPCIONAL: los
   * consumidores que no lo conocen siguen compilando y no cambian de
   * comportamiento. `null` (o ausente) significa que no hay estado humano: la IA
   * es la dueña, nunca hubo handoff, o el estado se resolvió.
   */
  attention?: AttentionDto | null;
};

/**
 * 006 — Origen del anuncio, subset reducido para la bandeja y el pipeline.
 * Sin `ctwa_clid`, sin `body`, sin `imageAssetId` — eso vive en `AnuncioDto`.
 */
export type AnuncioListaDto = {
  headline: string | null;
  sourceId: string | null;
  sourceType: string | null;
};

/**
 * 006 — DTO completo del origen del anuncio (panel del contacto).
 * El `ctwaClid` NUNCA sale por API: se reduce a `hasCtwaClid: boolean`.
 */
export type AnuncioDto = AnuncioListaDto & {
  sourceUrl: string | null;
  body: string | null;
  mediaType: string | null;
  imageAssetId: string | null;
  hasCtwaClid: boolean;
  capturedAt: string;
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

/**
 * Snapshot operativo de Jev (sin probabilities crudas).
 *
 * Corte 3 — T305: los campos son opcionales. Si el playbook publicado
 * apaga una pregunta o el proveedor no la trae, el campo se OMITE del
 * DTO (no se serializa como `null` ni se inventa un default). El
 * cliente puede distinguir "no presente" de "valor neutral" con
 * `'nextAction' in dto.snapshot`.
 */
export type SalesSnapshotDto = {
  nextAction?: string;
  buyingTiming?: string;
  realOperationalNeed?: number;
  productFit?: number;
  purchaseIntent?: number;
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
  followUpCount: number;
  followUpReason: string | null;
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
  /**
   * 006 — Fuente efectiva del contacto ("anuncio" / "publicacion" /
   * "desconocida" / lo capturado a mano). Backwards compatible: si no se
   * calcula, queda `null`.
   */
  source: string | null;
};
