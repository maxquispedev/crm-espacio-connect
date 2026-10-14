# Contrato receptor WHMCS — spec 021

POST `/api/integrations/whmcs/events`, Content-Type `application/json`.
WHMCS firma los bytes exactos del JSON enviado:
`X-EV-Timestamp`: segundos Unix; `X-EV-Signature`: `sha256=` + hex HMAC-SHA256
con WHMCS_WEBHOOK_SECRET sobre `<timestamp>.<rawBody>` (UTF-8).
Tolerancia ±300 segundos. No registrar secretos. No se modifica HMAC existente.

## invoice.reminder

```json
{
  "event": "invoice.reminder",
  "reminderId": "due-2026-10-15",
  "invoiceId": 1296,
  "client": { "id": 123, "name": "Mateo", "phone": "51999999999" },
  "invoice": {
    "number": "F-1296",
    "currency": "USD",
    "total": "49.99",
    "dueDate": "2026-10-15"
  }
}
```

WHMCS decide y dispara un día antes del vencimiento. CRM solo formatea fecha,
sin scheduler, cron ni cálculo del día de envío. `reminderId` identifica el
recordatorio lógico: por ejemplo `due-<dueDate>` para este aviso D−1. El mismo
recordatorio conserva ID en todos los intentos; un vencimiento nuevo puede tener
otro ID. No generar UUID nuevo por petición HTTP ni reenviar cambiando el ID.
Dedup externalId = JSON.stringify([String(invoiceId), reminderId]).
Plantilla exacta `invoice_reminder`, idioma `es_PE`, status `approved`, tenant
resuelto por slug `espacio-veloz`. Sin fallback a otros idiomas.
BODY: `Mateo`, `F-1296`, `49.99 USD`, `15/10/2026`.

## service.suspended

```json
{
  "event": "service.suspended",
  "suspensionId": "transition-456",
  "serviceId": 42,
  "invoiceId": 1296,
  "client": { "id": 123, "name": "Mateo", "phone": "51999999999" },
  "service": {
    "productName": "Espacio Impulsa",
    "domain": "ejemplo.com",
    "status": "Suspended",
    "suspensionReason": "nonpayment"
  },
  "invoice": {
    "serviceId": 42,
    "number": "F-1296",
    "currency": "USD",
    "balance": "49.99",
    "status": "Unpaid"
  }
}
```

Enviar únicamente tras confirmar suspensión efectiva por falta de pago.
`suspensionId` es un identificador durable de esa transición efectiva, creado y
persistido en WHMCS. Debe mantenerse en retries y cambiar en una suspensión futura,
aunque servicio/factura sean iguales. Dedup externalId =
JSON.stringify([String(serviceId), suspensionId]); deliberadamente no incluye
invoiceId: cambiar factura en el mismo evento no autoriza otro mensaje.

`productName` debe salir del producto real del servicio; `domain` del dominio
asociado. No usar descripción de items, no inventar nombre ni agrupar servicios.
Una suspensión por servicio. `invoice.serviceId` declara que la factura corresponde
inequívocamente al servicio de este evento, y debe coincidir con el serviceId
superior. `invoiceId` identifica exactamente esa factura (número visible puede
ser distinto). `balance` es el saldo pendiente de la factura, no su total pagado.
WHMCS debe validar propiedad por client y asociación por su modelo real, estado
Unpaid y saldo positivo antes de enviar. CRM no consulta WHMCS ni puede corroborar
externamente estas declaraciones autenticadas.

Si falta factura inequívoca, enviar todos los demás campos válidos y
`"invoiceId": null, "invoice": null`. El CRM reserva, marca `failed`, responde
422 `invoice_unavailable` y no crea contacto/conversación ni envía. Factura con
serviceId diferente, saldo cero o solo uno de los dos campos null falla igual.
Factura ausente (campo omitido), estado distinto de Unpaid o importe malformado:
400 invalid_body, sin reserva. No elegir la primera/última factura arbitraria.
Si WHMCS tiene varios candidatos, debe enviar null en ambos campos.

Plantilla exacta `service_suspended`, `es_PE`, `approved`, tenant espacio-veloz.
BODY: `Mateo`, `Espacio Impulsa - ejemplo.com`, `F-1296`, `49.99 USD`.

## Validación y botón común

Campos del ejemplo obligatorios; null solo donde se indica. IDs invoice/service:
enteros positivos hasta 2147483647 o strings decimales positivos de hasta 20
caracteres sin ceros iniciales. reminderId/suspensionId: 1–100 caracteres de
`[A-Za-z0-9._:-]`. client.id conserva contrato histórico: número entero positivo
o string 1–40; name 1–120; phone 7–32 antes de normalización, 7–15 dígitos después.
Producto 1–200; dominio 1–253; número de factura 1–40. currency: tres letras
mayúsculas; total/balance: string decimal con 1–15 dígitos enteros y dos decimales.
dueDate: fecha real YYYY-MM-DD. Espacios exteriores se recortan en campos
textuales indicados por schemas. Producto/dominio son obligatorios, no inferidos.

Ambas plantillas tienen cuatro variables BODY y botón URL dinámico índice 0.
Meta configura texto `Ver orden de pago` y base
`https://clientes.espacioveloz.com/viewinvoice.php?id=`. CRM envía solamente
`String(invoiceId)` como `urlButtonSuffix`; nunca una URL recibida desde WHMCS.
Meta debe aprobar las plantillas Utility/Servicio en es_PE y el operador debe
sincronizarlas al CRM antes de enviar eventos. CRM no registra ni aprueba plantillas.

No aceptar selección interna: organizationId, organization, organizationSlug,
phoneNumberId, wabaId, templateId, conversationId, contactId en raíz → 400.
Otros extras se descartan como en los contratos anteriores. Nunca se usan IDs
internos del payload. Sandbox is_test → 409 sandbox_violation sin Graph.
invoice.created/invoice.paid conservan contratos, formato, idiomas e idempotencia.

## Resultados, idempotencia y límites

200 primera entrega aceptada:
`{"ok":true,"duplicate":false,"status":"completed","messageId":"msg_..."}`.
completed significa Graph aceptó y el outbound se persistió: no confirma entrega
al destinatario; el mensaje conserva pending hasta los webhooks de estado.
200 duplicado retorna duplicate=true y status reserved/completed/failed existente,
con messageId cuando está disponible. Un 200 duplicate con failed NO es entrega.
401 firma ausente/inválida o timestamp vencido; 400 JSON/schema inválidos;
422 evento no soportado/factura no disponible; 409 plantilla no disponible,
sandbox u organización no configurada; 429 límite de 120 requests/minuto;
422/403 errores controlados heredados del sender; 500 error interno sanitizado.

Unique existente (organization_id, source, event_type, external_id) reserva ANTES
de efectos. No tablas ni migraciones nuevas. Un duplicado concurrente o cualquier
evento reserved/failed/completed nunca reenvía. No retries automáticos en CRM.
Crash después de reservar puede dejar reserved sin envío; fallo tras aceptación
de Graph puede dejar entrega incierta/failed sin messageId en ledger. Igual que
created/paid, se prioriza evitar duplicados: no se garantiza exactly-once ni
recuperación automática. Reconciliar ledger/outbound/Meta manualmente antes de
cualquier intervención. No regenerar IDs para saltarse dedup después de un fallo.
JSON/schema inválidos y HMAC inválido no generan ledger ni guardan payload/PII.

## Trabajo posterior en whmcs-espacio-connect

1. Agregar hook D−1 controlado por WHMCS con reminderId estable por factura/fecha.
2. Agregar hook de suspensión efectiva por nonpayment; producto y dominio reales.
3. Resolver factura pendiente mediante asociación real service/client; si ninguna
   o múltiples, emitir null sin link ni selección arbitraria.
4. Persistir suspensionId por transición y reutilizarlo en todos los intentos.
5. Serializar estos contratos y firmar rawBody con mecanismo HMAC existente.
6. Interpretar duplicate/status y no reintentar envíos fallidos cambiando IDs.
7. Verificar plantillas Meta aprobadas/sincronizadas y realizar prueba de proveedor
   con destinatario autorizado tras implementar hooks. Este repo no toca WHMCS.

## Verificación local reproducible

`pnpm --pm-on-fail=ignore test tests/unit/whmcs`

E2E usa Next real, BD desechable con todas las migraciones existentes y servidor
Graph local; ningún secreto ni destinatario real. Instalar embedded-postgres fuera
del proyecto, por ejemplo `npm install --prefix /tmp/whmcs-021-tools embedded-postgres`.
Luego, sin app/build concurrente en .next:

```bash
E2E_EMBEDDED_POSTGRES_MODULE=/tmp/whmcs-021-tools/node_modules/embedded-postgres/dist/index.js node scripts/e2e-whmcs-notifications.mjs
```

Puertos exclusivos 3021/3034/55442. Crea carpeta temporal y detiene procesos al
terminar; conserva DB/log para inspección. Nunca usa DATABASE_URL productiva.
Evidencia y pendientes globales: specs/021-whmcs-reminder-suspension/tasks.md.
