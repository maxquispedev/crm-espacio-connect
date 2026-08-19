import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { digitsOnly } from "@/lib/search";
import {
  getOrCreateContact,
  getOrCreateConversation,
} from "@/server/inbox/ingest";
import { sendTemplate, TemplateError } from "@/server/whatsapp/templates";
import { SendError } from "@/server/inbox/send";
import {
  findOrgBySlug,
  markEvent,
  WhmcsIntegrationError,
  type ReservedEvent,
} from "@/server/integrations/whmcs/invoice-created";

export { WhmcsIntegrationError };
import {
  buildInvoicePaidTemplateVariables,
  INVOICE_PAID_EVENT,
  INVOICE_PAID_TEMPLATE,
  invoiceExternalId,
  WHMCS_ORG_SLUG,
  WHMCS_SOURCE,
  type InvoicePaidPayload,
} from "@/server/integrations/whmcs/payload";

export type InvoicePaidDeps = {
  findOrgBySlug: (slug: string) => Promise<{ id: string } | null>;
  reserveEvent: (input: {
    organizationId: string;
    externalId: string;
  }) => Promise<ReservedEvent>;
  markEvent: (input: {
    organizationId: string;
    id: string;
    status: "completed" | "failed";
    messageId?: string | null;
  }) => Promise<void>;
  findApprovedPaidTemplate: (
    organizationId: string
  ) => Promise<{ id: string } | null>;
  getOrCreateContact: typeof getOrCreateContact;
  getOrCreateConversation: typeof getOrCreateConversation;
  sendTemplate: typeof sendTemplate;
};

/**
 * Reserva durable de `invoice.paid`. El UNIQUE incluye `event_type`, así que
 * convive con `invoice.created` del mismo `invoiceId`.
 */
export async function reservePaidEvent(input: {
  organizationId: string;
  externalId: string;
}): Promise<ReservedEvent> {
  const db = getDb();
  const inserted = await db
    .insert(schema.integrationEvent)
    .values({
      id: newId("integrationEvent"),
      organizationId: input.organizationId,
      source: WHMCS_SOURCE,
      eventType: INVOICE_PAID_EVENT,
      externalId: input.externalId,
      status: "reserved",
    })
    .onConflictDoNothing({
      target: [
        schema.integrationEvent.organizationId,
        schema.integrationEvent.source,
        schema.integrationEvent.eventType,
        schema.integrationEvent.externalId,
      ],
    })
    .returning();
  if (inserted[0]) return { kind: "created", id: inserted[0].id };

  const existing = await db
    .select({
      id: schema.integrationEvent.id,
      status: schema.integrationEvent.status,
      messageId: schema.integrationEvent.messageId,
    })
    .from(schema.integrationEvent)
    .where(
      scoped(
        schema.integrationEvent.organizationId,
        input.organizationId,
        eq(schema.integrationEvent.source, WHMCS_SOURCE),
        eq(schema.integrationEvent.eventType, INVOICE_PAID_EVENT),
        eq(schema.integrationEvent.externalId, input.externalId)
      )
    )
    .limit(1);
  const row = existing[0];
  if (!row) {
    throw new WhmcsIntegrationError(
      500,
      "internal",
      "No se pudo reservar el evento"
    );
  }
  return {
    kind: "existing",
    id: row.id,
    status: row.status,
    messageId: row.messageId,
  };
}

/**
 * Elige `invoice_paid` approved del tenant. Misma preferencia de idioma
 * que `invoice.created`: `es_MX`, luego `es`/`es_*`, luego la más antigua.
 */
export async function findApprovedPaidTemplate(
  organizationId: string
): Promise<{ id: string } | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.template.id,
      language: schema.template.language,
      createdAt: schema.template.createdAt,
    })
    .from(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        organizationId,
        eq(schema.template.name, INVOICE_PAID_TEMPLATE),
        eq(schema.template.status, "approved")
      )
    );
  if (rows.length === 0) return null;
  const preferred =
    rows.find((t) => t.language === "es_MX") ??
    rows.find((t) => t.language === "es" || t.language.startsWith("es_")) ??
    [...rows].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    )[0];
  return preferred ? { id: preferred.id } : null;
}

export const defaultInvoicePaidDeps: InvoicePaidDeps = {
  findOrgBySlug,
  reserveEvent: reservePaidEvent,
  markEvent,
  findApprovedPaidTemplate,
  getOrCreateContact,
  getOrCreateConversation,
  sendTemplate,
};

function normalizeClientPhone(raw: string): string {
  const digits = digitsOnly(raw);
  if (digits.length < 7 || digits.length > 15) {
    throw new WhmcsIntegrationError(
      422,
      "invalid_phone",
      "Teléfono inválido"
    );
  }
  return digits;
}

export type ProcessInvoicePaidResult = {
  ok: true;
  duplicate: boolean;
  status: "reserved" | "completed" | "failed";
  messageId?: string;
};

/**
 * Orquesta invoice.paid para Espacio Veloz. At-most-once: un evento ya
 * reserved/failed/completed no reenvía. Sin botón URL.
 */
export async function processInvoicePaid(
  payload: InvoicePaidPayload,
  deps: InvoicePaidDeps = defaultInvoicePaidDeps
): Promise<ProcessInvoicePaidResult> {
  const org = await deps.findOrgBySlug(WHMCS_ORG_SLUG);
  if (!org) {
    throw new WhmcsIntegrationError(
      409,
      "org_not_found",
      "Organización no configurada"
    );
  }

  const phone = normalizeClientPhone(payload.client.phone);
  const externalId = invoiceExternalId(payload.invoiceId);

  const reserved = await deps.reserveEvent({
    organizationId: org.id,
    externalId,
  });
  if (reserved.kind === "existing") {
    return {
      ok: true,
      duplicate: true,
      status: reserved.status,
      ...(reserved.messageId ? { messageId: reserved.messageId } : {}),
    };
  }

  try {
    const { contact } = await deps.getOrCreateContact(
      org.id,
      phone,
      payload.client.name
    );
    const conversation = await deps.getOrCreateConversation(org.id, contact.id);
    if (conversation.isTest) {
      throw new WhmcsIntegrationError(
        409,
        "sandbox_violation",
        "No se puede usar una conversación de prueba"
      );
    }

    const template = await deps.findApprovedPaidTemplate(org.id);
    if (!template) {
      throw new WhmcsIntegrationError(
        409,
        "template_unavailable",
        "Plantilla no disponible"
      );
    }

    const result = await deps.sendTemplate({
      organizationId: org.id,
      conversationId: conversation.id,
      templateId: template.id,
      variables: buildInvoicePaidTemplateVariables(payload),
    });

    await deps.markEvent({
      organizationId: org.id,
      id: reserved.id,
      status: "completed",
      messageId: result.messageId,
    });
    return {
      ok: true,
      duplicate: false,
      status: "completed",
      messageId: result.messageId,
    };
  } catch (err) {
    await deps.markEvent({
      organizationId: org.id,
      id: reserved.id,
      status: "failed",
    });
    if (err instanceof WhmcsIntegrationError) throw err;
    if (err instanceof TemplateError) {
      throw new WhmcsIntegrationError(422, err.code, "No se pudo enviar la plantilla");
    }
    if (err instanceof SendError) {
      throw new WhmcsIntegrationError(403, err.code, "No se pudo enviar la plantilla");
    }
    throw err;
  }
}
