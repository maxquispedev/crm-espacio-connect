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

Cleanup: apaga Orchestrator y follow-ups (flujo legacy intacto).
