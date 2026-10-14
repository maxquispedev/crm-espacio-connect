# Plan / analyze
1. Agregar schemas aislados y helpers de formato nuevos reutilizando existentes.
2. Extraer orquestación created a helper común con wrapper idéntico; reserva admite
   eventType con default created. Paid queda intacto. Nuevos handlers usan helper.
3. Resolver template exacto name/es_PE/approved/scoped; factura inválida se comprueba
   tras reserva antes de efectos. Unique existente suficiente, sin migración.
4. Extender route, unitarios/regresión, self-test HTTP local con DB y Meta mock.
5. Gates, contratos, checkpoint, evidencia y pendientes.

Constitution Check I–IX: conforme antes y después del diseño. Tenant/scoped,
HMAC existente, sender único, sandbox, ledger UNIQUE, sin servicios/schema/cron/UI.
At-most-once conserva límite crash/entrega incierta: no reintentar automáticamente.
