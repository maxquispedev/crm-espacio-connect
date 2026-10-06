# 020 — regresión comercial 031

Ejecutar con app Next dev real + PostgreSQL dedicado migrado + proveedores HTTP
locales. `WA_MOCK_ENABLED=true`, `JEV_MODEL` ficticio y endpoints Jev/Writer/Graph
al puerto del proveedor mock; sin cuentas ni datos productivos.

```
E2E_SECTION=031 node --env-file=/tmp/conversation-020.env scripts/e2e-selftest.mjs
```

El corte reutiliza el arnés 021 (no otro sender/motor): conexión, bootstrap Published,
videos sintéticos, inbound HTTP, outbox Graph y texto/caption del hilo real;
status sent explícito antes de verificar facts. Cubre 015 A–E/happy/unhappy y:

- A–D: headline pagos/verano/control/centralización, beneficio + UNA pregunta,
  texto corto, cero video/fact y sin dolor supuesto; body secundario de pagos.
- E: primer opener + Más información; mismo opener determinístico rechazado,
  retry Writer explícito que amplía. Otro Más información con retry duplicado:
  cero outbound, reason durable, cero facts/jobs, IA operable al siguiente inbound.
- F/G: Con excel → priorización → primer Todos → demo general, acción efectiva
  y decisión Jev auditadas. Segundo Todos: un único video, sin priorización nueva.
- H: Con excel → pagos/saldos → video correcto → precio natural S/247.
- I: Precio / Cuánto cuesta directamente sin exigir cantidad; 70 activos S/267.
- Sandbox: Todos con demo local, cero Graph.

Regresiones adicionales 028 (evidencia/handoff), 029 (media/freshness/reserva/
ledger/addressing/tenant), y arnés dedicado follow-ups 018. Los tests de 020
incluyen ambigüedad, prioridades superiores, texto pendiente, tenant/manual,
fallo/unknown y inbound durante retry. No validan interpretación de proveedores
reales ni sustituyen la suite general histórica (pendientes previos documentados).
