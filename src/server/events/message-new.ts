import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { MessageDto, MessageNewPayload } from "@/lib/types";
import { publish } from "@/server/events/bus";

const PREVIEW_MAX = 140;

const TYPE_PREVIEW: Record<string, string> = {
  image: "Imagen",
  audio: "Audio",
  video: "Video",
  document: "Documento",
  sticker: "Sticker",
  location: "Ubicación",
  contacts: "Contacto",
  template: "Plantilla",
};

export type MessageNewContact = {
  id: string;
  name: string;
  phone: string | null;
};

/** Nombre visible del contacto: nombre, teléfono o un fallback neutro. */
export function contactLabel(contact: {
  name: string;
  phone: string | null;
}): string {
  const name = contact.name.trim();
  if (name) return name;
  if (contact.phone) return contact.phone;
  return "Contacto";
}

/** Preview corto para notificación y payload SSE. */
export function messagePreview(
  type: string,
  text: string | null,
  caption?: string | null
): string {
  const raw = (text ?? caption ?? "").trim();
  if (raw) {
    return raw.length > PREVIEW_MAX ? `${raw.slice(0, PREVIEW_MAX - 1)}…` : raw;
  }
  return TYPE_PREVIEW[type] ?? "Mensaje";
}

export function buildMessageNewPayload(input: {
  organizationId: string;
  organizationName: string;
  conversationId: string;
  contactId: string;
  contactName: string;
  message: MessageDto;
}): MessageNewPayload {
  const direction = input.message.direction === "out" ? "out" : "in";
  return {
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    conversationId: input.conversationId,
    contactId: input.contactId,
    contactName: input.contactName,
    direction,
    messageId: input.message.id,
    preview: messagePreview(
      input.message.type,
      input.message.text,
      input.message.media?.caption ?? null
    ),
    message: input.message,
  };
}

/**
 * Publica `message.new` con org, contacto y preview.
 * Si no se pasa contacto, lo resuelve por la conversación (mismo tenant).
 */
export async function publishMessageNew(input: {
  organizationId: string;
  conversationId: string;
  message: MessageDto;
  contact?: MessageNewContact;
}): Promise<void> {
  const ctx = await resolveOrgAndContact(
    input.organizationId,
    input.conversationId,
    input.contact
  );
  publish(input.organizationId, {
    type: "message.new",
    data: buildMessageNewPayload({
      organizationId: input.organizationId,
      organizationName: ctx.organizationName,
      conversationId: input.conversationId,
      contactId: ctx.contactId,
      contactName: ctx.contactName,
      message: input.message,
    }),
  });
}

async function resolveOrgAndContact(
  organizationId: string,
  conversationId: string,
  contact: MessageNewContact | undefined
): Promise<{
  organizationName: string;
  contactId: string;
  contactName: string;
}> {
  const db = getDb();
  const orgRows = await db
    .select({ name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const organizationName = orgRows[0]?.name.trim() || "Organización";

  if (contact) {
    return {
      organizationName,
      contactId: contact.id,
      contactName: contactLabel(contact),
    };
  }

  const rows = await db
    .select({
      id: schema.contact.id,
      name: schema.contact.name,
      phone: schema.contact.phone,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      and(
        eq(schema.conversation.id, conversationId),
        eq(schema.conversation.organizationId, organizationId)
      )
    )
    .limit(1);
  const row = rows[0];
  return {
    organizationName,
    contactId: row?.id ?? "",
    contactName: row ? contactLabel(row) : "Contacto",
  };
}
