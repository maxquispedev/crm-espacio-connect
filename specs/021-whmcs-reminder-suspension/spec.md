# 021 — Recordatorio y suspensión WHMCS

## Specify / clarify
Agregar invoice.reminder → invoice_reminder y service.suspended → service_suspended,
exclusivamente es_PE approved. Created/paid conservan contratos e idiomas.
WHMCS controla fechas y confirma suspensión por impago; CRM no agenda ni calcula.
Reminder exige reminderId estable por recordatorio lógico (no intento HTTP).
Suspensión exige suspensionId estable por transición efectiva, serviceId, invoiceId,
client, service.productName/domain y factura Unpaid con balance positivo y serviceId
asociado. invoiceId/invoice pueden ser null cuando WHMCS no puede resolver asociación:
reservar y marcar failed con invoice_unavailable sin contacto ni sender. Asociaciones
contradictorias fallan igual. Nunca elegir otra factura o derivar plan de items.
Dedup: JSON tuple [invoiceId,reminderId] y [serviceId,suspensionId]; IDs numéricos
canónicos. Nueva suspensión debe tener nuevo suspensionId aunque misma factura.
BODY reminder: nombre, número, total moneda, DD/MM/YYYY. Suspensión: nombre,
producto - dominio, número, balance moneda. Botón suffix solo invoiceId.
Sin recursos internos desde WHMCS, sin secretos/PII adicional en ledger, sin retries.

## Aceptación / verify
HMAC, schemas, variables, botón, plantilla exacta, tenant, sandbox, concurrencia,
failed/reserved/completed sin reenvío, IDs distintos, sin factura válida y regresiones.
Gates typecheck/lint/build/test y E2E local happy/unhappy con Graph simulado.
No push/deploy ni cambios WHMCS. Contrato final docs/WHMCS_EVENTS.md.
