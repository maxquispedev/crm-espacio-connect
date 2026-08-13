import { createHmac } from "node:crypto";
import { getEnv } from "@/lib/env";
import { nextN } from "@/server/dev/wa-mock-state";

/**
 * Construye un payload real de Meta y lo entrega al webhook público por
 * loopback (127.0.0.1: mismo proceso, sin salir a la red). Se firma con el
 * META_APP_SECRET real si está configurado — así el self-test ejercita la
 * capa 2 de verdad.
 */
export async function deliverToWebhook(payload: unknown): Promise<Response> {
  const env = getEnv();
  const raw = JSON.stringify(payload);
  const port = process.env.PORT ?? "3000";
  const url = `http://127.0.0.1:${port}/api/webhooks/wa/${env.META_WEBHOOK_VERIFY_TOKEN}`;

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (env.META_APP_SECRET) {
    const sig = createHmac("sha256", env.META_APP_SECRET)
      .update(raw, "utf8")
      .digest("hex");
    headers["x-hub-signature-256"] = `sha256=${sig}`;
  }
  return fetch(url, { method: "POST", headers, body: raw });
}

/** 008 — Campos de adjunto que aceptan los payloads simulados. */
type MockMediaInput = {
  /** media id de Graph simulado (servible por wa-mock/media-file). */
  mediaId?: string;
  mimeType?: string;
  caption?: string;
  filename?: string;
  location?: Record<string, unknown>;
};

const MOCK_BINARY_TYPES = new Set(["image", "video", "audio", "document", "sticker"]);

function applyMockContent(
  message: Record<string, unknown>,
  type: string,
  input: { text?: string } & MockMediaInput
): void {
  if (type === "text") {
    message.text = { body: input.text ?? "hola" };
  } else if (type === "location") {
    message.location = input.location ?? {
      latitude: 21.019,
      longitude: -101.257,
      name: "Oficina",
    };
  } else if (MOCK_BINARY_TYPES.has(type)) {
    const media: Record<string, unknown> = {
      id: input.mediaId ?? `mockmedia_${nextN()}`,
      mime_type:
        input.mimeType ?? (type === "audio" ? "audio/ogg" : "image/jpeg"),
    };
    if (input.caption) media.caption = input.caption;
    if (input.filename) media.filename = input.filename;
    message[type] = media;
  }
}

export function buildInboundPayload(input: {
  wabaId: string;
  phoneNumberId: string;
  /** Teléfono del remitente. Omite y usa `fromUserId` para simular BSUID (003). */
  from?: string;
  /** BSUID del remitente — puede venir solo o junto a `from`. */
  fromUserId?: string;
  name?: string;
  type?: string;
  text?: string;
  waMessageId?: string;
  timestamp?: number;
} & MockMediaInput) {
  const type = input.type ?? "text";
  const message: Record<string, unknown> = {
    id: input.waMessageId ?? `wamid.mock.in.${nextN()}`,
    timestamp: String(input.timestamp ?? Math.floor(Date.now() / 1000)),
    type,
  };
  if (input.from) message.from = input.from;
  if (input.fromUserId) message.from_user_id = input.fromUserId;
  applyMockContent(message, type, input);

  const contactEntry: Record<string, unknown> = {
    profile: { name: input.name ?? "Cliente" },
  };
  if (input.from) contactEntry.wa_id = input.from;
  if (input.fromUserId) contactEntry.user_id = input.fromUserId;

  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: input.wabaId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "5215500000000",
                phone_number_id: input.phoneNumberId,
              },
              contacts: [contactEntry],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

/**
 * 008 — Payload de echo de coexistence (`smb_message_echoes`): un mensaje que
 * el dueño mandó A MANO desde la app de WhatsApp Business del teléfono.
 */
export function buildEchoPayload(input: {
  wabaId: string;
  phoneNumberId: string;
  /** wa_id del LEAD destinatario. */
  to: string;
  /** Número del negocio (remitente del echo). */
  from?: string;
  type?: string;
  text?: string;
  waMessageId?: string;
  timestamp?: number;
  /** Variante defensiva: entregar bajo la clave `messages` en vez de `message_echoes`. */
  useMessagesKey?: boolean;
} & MockMediaInput) {
  const type = input.type ?? "text";
  const message: Record<string, unknown> = {
    id: input.waMessageId ?? `wamid.mock.echo.${nextN()}`,
    timestamp: String(input.timestamp ?? Math.floor(Date.now() / 1000)),
    type,
    from: input.from ?? "5215500000000",
    to: input.to,
  };
  applyMockContent(message, type, input);

  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: input.wabaId,
        changes: [
          {
            field: "smb_message_echoes",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "5215500000000",
                phone_number_id: input.phoneNumberId,
              },
              ...(input.useMessagesKey
                ? { messages: [message] }
                : { message_echoes: [message] }),
            },
          },
        ],
      },
    ],
  };
}

export function buildStatusPayload(input: {
  wabaId: string;
  phoneNumberId: string;
  waMessageId: string;
  status: string;
  recipientId?: string;
  /** Meta adjunta `errors[]` en los `failed` (ej. 130472 del 2026-08-05). */
  errorCode?: number;
  errorMessage?: string;
}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: input.wabaId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "5215500000000",
                phone_number_id: input.phoneNumberId,
              },
              statuses: [
                {
                  id: input.waMessageId,
                  status: input.status,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: input.recipientId ?? "5215511111111",
                  ...(input.errorCode != null
                    ? {
                        errors: [
                          {
                            code: input.errorCode,
                            title: input.errorMessage ?? "Error de envío",
                            message: input.errorMessage ?? "Error de envío",
                          },
                        ],
                      }
                    : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function buildTemplateStatusPayload(input: {
  wabaId: string;
  name: string;
  language: string;
  event: "APPROVED" | "REJECTED";
  reason?: string;
  templateId?: string;
}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: input.wabaId,
        changes: [
          {
            field: "message_template_status_update",
            value: {
              event: input.event,
              message_template_id: input.templateId ?? `tplmock_${nextN()}`,
              message_template_name: input.name,
              message_template_language: input.language,
              reason: input.reason ?? null,
            },
          },
        ],
      },
    ],
  };
}

export type MockHistoryMessage = {
  from: string;
  to?: string;
  id?: string;
  timestamp: number;
  type?: string;
  text?: string;
  historyStatus?: string;
  mediaId?: string;
  mimeType?: string;
  caption?: string;
};

/**
 * Payload `field: "history"` de coexistence (historial previo al onboarding).
 */
export function buildHistoryPayload(input: {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  phase?: number;
  chunkOrder?: number;
  progress?: number;
  threads: {
    id: string;
    messages: MockHistoryMessage[];
  }[];
  errors?: { code: number; title?: string; message?: string }[];
}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: input.wabaId,
        changes: [
          {
            field: "history",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: input.displayPhoneNumber ?? "5215500000000",
                phone_number_id: input.phoneNumberId,
              },
              history: [
                {
                  metadata: {
                    phase: input.phase ?? 0,
                    chunk_order: input.chunkOrder ?? 1,
                    progress: input.progress ?? 100,
                  },
                  ...(input.errors ? { errors: input.errors } : {}),
                  threads: input.threads.map((thread) => ({
                    id: thread.id,
                    messages: thread.messages.map((m) => {
                      const type = m.type ?? "text";
                      const message: Record<string, unknown> = {
                        from: m.from,
                        id: m.id ?? `wamid.mock.hist.${nextN()}`,
                        timestamp: String(m.timestamp),
                        type,
                        history_context: {
                          status: m.historyStatus ?? "READ",
                        },
                      };
                      if (m.to) message.to = m.to;
                      if (type === "text") {
                        message.text = { body: m.text ?? "" };
                      } else if (type === "media_placeholder") {
                        // sin contenido: el follow-up trae el asset
                      } else if (type === "image") {
                        message.image = {
                          id: m.mediaId ?? `mockmedia_${nextN()}`,
                          mime_type: m.mimeType ?? "image/jpeg",
                          caption: m.caption,
                        };
                      }
                      return message;
                    }),
                  })),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/**
 * Payload `field: "smb_app_state_sync"` (agenda de la WhatsApp Business App).
 */
export function buildStateSyncPayload(input: {
  wabaId: string;
  phoneNumberId: string;
  contacts: {
    action: "add" | "remove";
    phone_number: string;
    full_name?: string;
    first_name?: string;
  }[];
}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: input.wabaId,
        changes: [
          {
            field: "smb_app_state_sync",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "5215500000000",
                phone_number_id: input.phoneNumberId,
              },
              state_sync: input.contacts.map((c) => ({
                type: "contact",
                action: c.action,
                contact: {
                  phone_number: c.phone_number,
                  full_name: c.full_name,
                  first_name: c.first_name,
                },
                metadata: {
                  timestamp: String(Math.floor(Date.now() / 1000)),
                },
              })),
            },
          },
        ],
      },
    ],
  };
}
