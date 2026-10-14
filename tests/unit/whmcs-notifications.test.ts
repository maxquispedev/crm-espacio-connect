import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { invoiceReminderSchema, serviceSuspendedSchema, reminderExternalId, suspensionExternalId,
  type InvoiceReminderPayload, type ServiceSuspendedPayload } from "@/server/integrations/whmcs/payload";
import { processInvoiceReminder, processServiceSuspended, findApprovedNotificationTemplate } from "@/server/integrations/whmcs/notifications";
import type { InvoiceCreatedDeps, ReservedEvent } from "@/server/integrations/whmcs/invoice-created";

const db = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: () => db }));
export const reminder: InvoiceReminderPayload = {
  event: "invoice.reminder", reminderId: "due-2026-10-15", invoiceId: 1296,
  client: { id: 123, name: "Mateo", phone: "+51 999999999" },
  invoice: { number: "F-1296", total: "49.99", currency: "USD", dueDate: "2026-10-15" },
};
export const suspension: ServiceSuspendedPayload = {
  event: "service.suspended", suspensionId: "transition-456", serviceId: 42, invoiceId: 1296,
  client: reminder.client,
  service: { productName: "Espacio Impulsa", domain: "ejemplo.com", status: "Suspended", suspensionReason: "nonpayment" },
  invoice: { serviceId: 42, number: "F-1296", currency: "USD", balance: "49.99", status: "Unpaid" },
};
function fixture() {
  const events = new Map<string, { id: string; status: "reserved" | "completed" | "failed"; messageId: string | null }>();
  const deps: InvoiceCreatedDeps = {
    findOrgBySlug: vi.fn(async () => ({ id: "org_ev" })),
    reserveEvent: vi.fn(async ({ externalId }): Promise<ReservedEvent> => {
      const existing = events.get(externalId);
      if (existing) return { kind: "existing", ...existing };
      events.set(externalId, { id: externalId, status: "reserved", messageId: null });
      return { kind: "created", id: externalId };
    }),
    markEvent: vi.fn(async ({ id, status, messageId }) => { events.set(id, { id, status, messageId: messageId ?? null }); }),
    findApprovedInvoiceTemplate: vi.fn(async () => ({ id: "tpl" })),
    getOrCreateContact: vi.fn(async () => ({ contact: { id: "ct" }, isNew: false })) as unknown as InvoiceCreatedDeps["getOrCreateContact"],
    getOrCreateConversation: vi.fn(async () => ({ id: "cv", isTest: false })) as unknown as InvoiceCreatedDeps["getOrCreateConversation"],
    sendTemplate: vi.fn(async () => ({ messageId: "msg" })),
  };
  return { deps, events };
}
describe.each([
  { name: "reminder", payload: reminder, parse: invoiceReminderSchema, process: (d: InvoiceCreatedDeps) => processInvoiceReminder(reminder, d), vars: ["Mateo", "F-1296", "49.99 USD", "15/10/2026"] },
  { name: "suspension", payload: suspension, parse: serviceSuspendedSchema, process: (d: InvoiceCreatedDeps) => processServiceSuspended(suspension, d), vars: ["Mateo", "Espacio Impulsa - ejemplo.com", "F-1296", "49.99 USD"] },
])("$name", ({ payload, parse, process, vars }) => {
  it("valida contrato y rechaza selección interna / ID inválido", () => {
    expect(parse.safeParse(payload).success).toBe(true);
    for (const key of ["organizationId", "templateId", "phoneNumberId", "contactId"]) {
      expect(parse.safeParse({ ...payload, [key]: "evil" }).success).toBe(false);
    }
    expect(parse.safeParse({ ...payload, invoiceId: "0001" }).success).toBe(false);
    expect(parse.safeParse({ ...payload, client: null }).success).toBe(false);
  });
  it("variables, botón, tenant y contacto reutilizado", async () => {
    const { deps } = fixture(); await process(deps);
    expect(deps.findOrgBySlug).toHaveBeenCalledWith("espacio-veloz");
    expect(deps.getOrCreateContact).toHaveBeenCalledWith("org_ev", "51999999999", "Mateo");
    expect(deps.sendTemplate).toHaveBeenCalledWith({ organizationId: "org_ev", conversationId: "cv", templateId: "tpl", variables: vars, urlButtonSuffix: "1296" });
  });
  it("duplicado concurrente y completado no reenvían", async () => {
    const { deps } = fixture(); const results = await Promise.all([process(deps), process(deps)]);
    expect(results.filter((r) => r.duplicate)).toHaveLength(1);
    await process(deps); expect(deps.sendTemplate).toHaveBeenCalledTimes(1);
  });
  it("reserva existente sin messageId nunca reenvía", async () => {
    const { deps } = fixture();
    vi.mocked(deps.reserveEvent).mockResolvedValue({ kind: "existing", id: "reserved", status: "reserved", messageId: null });
    expect(await process(deps)).toEqual({ ok: true, duplicate: true, status: "reserved" });
    expect(deps.getOrCreateContact).not.toHaveBeenCalled();
    expect(deps.sendTemplate).not.toHaveBeenCalled();
  });
  it("plantilla ausente registra failed y no reintenta", async () => {
    const { deps, events } = fixture(); vi.mocked(deps.findApprovedInvoiceTemplate).mockResolvedValue(null);
    await expect(process(deps)).rejects.toMatchObject({ code: "template_unavailable" });
    expect([...events.values()][0]?.status).toBe("failed");
    expect(await process(deps)).toMatchObject({ duplicate: true, status: "failed" });
    expect(deps.sendTemplate).not.toHaveBeenCalled();
  });
  it("sandbox no envía", async () => {
    const { deps } = fixture(); vi.mocked(deps.getOrCreateConversation).mockResolvedValue({ id: "cv", isTest: true } as Awaited<ReturnType<InvoiceCreatedDeps["getOrCreateConversation"]>>);
    await expect(process(deps)).rejects.toMatchObject({ code: "sandbox_violation" });
    expect(deps.sendTemplate).not.toHaveBeenCalled();
  });
  it("fallo del sender se registra sin retry", async () => {
    const { deps } = fixture(); vi.mocked(deps.sendTemplate).mockRejectedValue(new Error("provider"));
    await expect(process(deps)).rejects.toThrow("provider");
    expect(await process(deps)).toMatchObject({ status: "failed", duplicate: true });
    expect(deps.sendTemplate).toHaveBeenCalledTimes(1);
  });
});
it("fechas reales y amounts estrictos", () => {
  for (const dueDate of ["2026-02-30", "2026-13-01"]) expect(invoiceReminderSchema.safeParse({ ...reminder, invoice: { ...reminder.invoice, dueDate } }).success).toBe(false);
  expect(invoiceReminderSchema.safeParse({ ...reminder, invoice: { ...reminder.invoice, total: "abc" } }).success).toBe(false);
  expect(serviceSuspendedSchema.safeParse({ ...suspension, service: { ...suspension.service, productName: "" } }).success).toBe(false);
});
it.each([null, { ...suspension.invoice!, serviceId: 99 }, { ...suspension.invoice!, balance: "0.00" }])("factura no inequívoca: %j", async (invoice) => {
  const { deps, events } = fixture();
  await expect(processServiceSuspended({ ...suspension, invoice }, deps)).rejects.toMatchObject({ code: "invoice_unavailable" });
  expect([...events.values()][0]?.status).toBe("failed");
  expect(deps.getOrCreateContact).not.toHaveBeenCalled(); expect(deps.sendTemplate).not.toHaveBeenCalled();
});
it("invoiceId null registra error controlado", async () => {
  const { deps } = fixture(); await expect(processServiceSuspended({ ...suspension, invoiceId: null }, deps)).rejects.toMatchObject({ code: "invoice_unavailable" });
});
it("facturas, recordatorios, servicios y suspensiones futuras no colisionan", async () => {
  const { deps } = fixture();
  await processInvoiceReminder(reminder, deps);
  await processInvoiceReminder({ ...reminder, invoiceId: 1297 }, deps);
  await processInvoiceReminder({ ...reminder, reminderId: "due-new" }, deps);
  await processServiceSuspended(suspension, deps);
  await processServiceSuspended({ ...suspension, serviceId: 43, invoice: { ...suspension.invoice!, serviceId: 43 } }, deps);
  await processServiceSuspended({ ...suspension, suspensionId: "transition-457" }, deps);
  expect(deps.sendTemplate).toHaveBeenCalledTimes(6);
  expect(reminderExternalId({ ...reminder, invoiceId: "1296" })).toBe(reminderExternalId(reminder));
  expect(suspensionExternalId({ ...suspension, serviceId: "42" })).toBe(suspensionExternalId(suspension));
});
it.each(["invoice_reminder", "service_suspended"])("query exacta scoped approved es_PE: %s", async (name) => {
  const where = vi.fn((_condition: SQL) => ({ limit: vi.fn(async () => [{ id: "correct" }]) }));
  db.select.mockReturnValue({ from: () => ({ where }) });
  expect(await findApprovedNotificationTemplate("org_ev", name)).toEqual({ id: "correct" });
  const query = new PgDialect().sqlToQuery(where.mock.calls[0]![0] as SQL);
  expect(query.params).toEqual(["org_ev", name, "es_PE", "approved"]);
});
