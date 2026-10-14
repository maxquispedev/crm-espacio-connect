import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  defaultInvoiceCreatedDeps, processWhmcsTemplate, reserveEvent,
  WhmcsIntegrationError, type InvoiceCreatedDeps,
} from "./invoice-created";
import {
  INVOICE_REMINDER_EVENT, INVOICE_REMINDER_TEMPLATE,
  SERVICE_SUSPENDED_EVENT, SERVICE_SUSPENDED_TEMPLATE,
  buildInvoiceReminderTemplateVariables, buildServiceSuspendedTemplateVariables,
  reminderExternalId, suspensionExternalId,
  type InvoiceReminderPayload, type ServiceSuspendedPayload,
} from "./payload";

export async function findApprovedNotificationTemplate(organizationId: string, name: string) {
  const rows = await getDb().select({ id: schema.template.id }).from(schema.template)
    .where(scoped(schema.template.organizationId, organizationId,
      eq(schema.template.name, name), eq(schema.template.language, "es_PE"),
      eq(schema.template.status, "approved"))).limit(1);
  return rows[0] ?? null;
}

function notificationDeps(eventType: string, templateName: string): InvoiceCreatedDeps {
  return {
    ...defaultInvoiceCreatedDeps,
    reserveEvent: (input) => reserveEvent({ ...input, eventType }),
    findApprovedInvoiceTemplate: (org) => findApprovedNotificationTemplate(org, templateName),
  };
}

export function processInvoiceReminder(payload: InvoiceReminderPayload,
  deps = notificationDeps(INVOICE_REMINDER_EVENT, INVOICE_REMINDER_TEMPLATE)) {
  return processWhmcsTemplate({ client: payload.client,
    externalId: reminderExternalId(payload),
    variables: buildInvoiceReminderTemplateVariables(payload),
    urlButtonSuffix: String(payload.invoiceId),
  }, deps);
}

export function processServiceSuspended(payload: ServiceSuspendedPayload,
  deps = notificationDeps(SERVICE_SUSPENDED_EVENT, SERVICE_SUSPENDED_TEMPLATE)) {
  const variables = buildServiceSuspendedTemplateVariables(payload);
  return processWhmcsTemplate({ client: payload.client,
    externalId: suspensionExternalId(payload), variables,
    urlButtonSuffix: String(payload.invoiceId),
    validate: () => {
      if (variables.length !== 4) throw new WhmcsIntegrationError(422,
        "invoice_unavailable", "Factura pendiente asociada no disponible");
    },
  }, deps);
}
