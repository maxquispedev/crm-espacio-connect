# Guion E2E — Sales Follow-ups automáticos

> Conducido por `pnpm test:e2e` (`scripts/e2e-selftest.mjs`) contra la app
> con mocks (`WA_MOCK_ENABLED=true`, wa-mock + ai-mock). Jev se sustituye
> por `/api/dev/jev-mock` cuando TypeSafe no está configurado.
> El tick de 6h/18h/48h se adelanta con `POST /api/dev/follow-ups/run`
> (gate `mockGuard`: 404 fuera de mocks).

## Preparación

1. En `/agent`: Orchestrator ON + Seguimientos automáticos ON.
2. Agente global encendido. Sin plantilla 24h (caso E).

## Camino feliz

A. Inbound → el agente responde → `nextFollowUpAt` queda programado.
B. Job vencido (harness expire) dentro de ventana → follow-up observable
   en el hilo / wa-mock outbox. No llama a Meta real.
C. Nuevo inbound → `nextFollowUpAt` null (pending cancelado).
D. Tres envíos de la secuencia → `lane=stop` + `no_reply_exhausted`
   (**Dormido**). Pipeline **no** pasa a `lost`.

## Camino infeliz

E. Ventana 24h cerrada y sin plantilla → `followUpReason=template_required`,
   sin texto libre por Graph.

## Horario comercial (spec 018)

Regla: los follow-ups **automáticos** solo salen con
`09:00 <= hora local < 20:00` en `America/Lima` (20:00 es límite **exclusivo**).
El tick acepta `now` para fijar la hora local de decisión, así que el arnés
puede provocar madrugada y mediodía a cualquier hora de la corrida.

F. Job vencido reclamado a las **02:00 Lima** → cero outbound en el outbox del
   mock (cero Graph), el job vuelve a `pending` con `outside_business_hours`,
   `due_at` en el próximo **09:00 Lima**, `lead.next_follow_up_at` sincronizado
   y **sin** consumir `attempt_number` ni `run_attempts`.
G. El **mismo** job, reclamado ya dentro del horario (14:00 Lima), se envía una
   sola vez y conserva su número de intento.

Ejecutado por `scripts/e2e-follow-ups.mjs` (sección "horario comercial") y por
el bloque de follow-ups de `scripts/e2e-selftest.mjs`.

Cleanup: apaga Orchestrator y follow-ups (flujo legacy intacto).
