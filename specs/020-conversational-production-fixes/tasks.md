# Tasks — estado durable

- [x] T001 Contexto obligatorio, código/tests, spec, clarify, plan y analyze.
- [x] T002 Opener semántico de anuncios A–D y fallback.
- [x] T003 Guard de priorización amplia, routing general y snapshot original.
- [x] T004 Duplicados pre-envío + retry único + silencio auditable/freshness.
- [x] T005 Copy precio, reglas Writer y bootstrap/refuerzo Published previas.
- [x] T006 Unit/integración A–I, ambigüedad/prioridades/tenant/sandbox/unhappy.
- [x] T007 E2E comercial específico y regresiones 015–018 app/PG/mocks.
- [x] T008 typecheck/lint/build/test y diff --check.
- [x] T009 Docs/estado/evidencia/limitaciones y commit atómico sin push/deploy.

## Checkpoint implementación

Guards mínimos en conversation-guards/resolver/orchestrator; adOpeningTopic en
routing; opener y retry en Writer; copy natural en bootstrap/fallback con refuerzo
runtime para Published previas. Sin schema/campañas/precios ni sender nuevo.

E2E 031 **83/83**, app Next dev :3020, PostgreSQL 18.4 :55441/base exclusiva
commercial_resources_test_conversation, proveedor HTTP :3033, ffmpeg sintético
solo /tmp. Incluye 021 original entero (015 y demos), A–I y sandbox. Cero Graph
real. Regresiones 028 **32/32**, 029 **55/55** (otra base exclusiva
commercial_resources_test_safety), follow-ups 018 **48/48**. Todos exit 0.

Incidentes del arnés resueltos: faltaba JEV_MODEL ficticio y se usaba canned mock;
031 preview inicialmente enviaba from:seller aunque su contrato solo admite lead.
Se corrigió fixture a Con excel → Writer prioriza → Todos y pasó con demo local.
Tests de DB en memoria actualizados para nueva lectura scoped de texto IA;
no se corrigió runtime comercial ajeno a este alcance.

## Evidencia final

Base limpia: `106ce0f` (019). Rama main, un solo commit:
`fix(sales): advance conversations without repeated questions or replies`.
Sin push/deploy, sin modificación del repo Jev ni de Published de producción.

Gates finales: typecheck exit 0; lint exit 0 (3 warnings preexistentes: img y
2 eslint-disable en build-state); test exit 0 **1547 pass / 9 skipped**, 125
archivos (124 pass/1 skipped), **55 nuevos** frente a 1492. Build final exit 0
(advertencia CSS duration preexistente). git diff --check exit 0.
Mismos scripts pnpm con --pm-on-fail=ignore, como specs previos. Sin cambios
package.json/lockfile. Tests/build/E2E necesitaron sockets localhost fuera del
sandbox restringido; auto-review autorizó las corridas locales.

Comandos reproducibles (env ficticio local, jamás .env productivo):

```bash
pnpm --pm-on-fail=ignore typecheck
pnpm --pm-on-fail=ignore lint
pnpm --pm-on-fail=ignore build
pnpm --pm-on-fail=ignore test
E2E_SECTION=031 PATH=/tmp/conversation-bin:$PATH LD_LIBRARY_PATH=/tmp/commercial-export-tools/libs node --env-file=/tmp/conversation-020.env scripts/e2e-selftest.mjs
E2E_SECTION=028 PATH=/tmp/conversation-bin:$PATH LD_LIBRARY_PATH=/tmp/commercial-export-tools/libs node --env-file=/tmp/conversation-020.env scripts/e2e-selftest.mjs
FOLLOW_UP_E2E=1 E2E_COMMERCIAL_PROVIDER_PORT=3033 node --env-file=/tmp/conversation-020.env scripts/e2e-follow-ups.mjs
E2E_SECTION=029 PATH=/tmp/conversation-bin:$PATH LD_LIBRARY_PATH=/tmp/commercial-export-tools/libs node --env-file=/tmp/conversation-safety.env scripts/e2e-selftest.mjs
```

App para cada base: node --env-file=<env> node_modules/next/dist/bin/next dev
--port 3020. Env seguridad usa la base *_safety y E2E_SAFETY_PROVIDER_PORT=3033.
JEV_MODEL ficticio y los tres endpoints al proveedor localhost:3033. Todas las
migraciones versionadas aplicadas vía scripts/migrate.mjs; sin migración nueva.
embedded-postgres y ffmpeg-static solo en /tmp; vídeos sintéticos, sin dependencias
runtime nuevas. Chromium usa libs locales. App dev detenida antes de build para
no compartir .next. Logs de corridas en /tmp/conversation-{test,build,typecheck,
lint,e2e-031,e2e-028,e2e-029,e2e-followups}.log.

Incidentes adicionales de fixtures: mocks comerciales de follow-ups y 029
retornaban exactamente la misma respuesta al segundo inbound; el guard nuevo
correctamente los silenció y bloqueó la expectativa de reanudación del arnés.
Se cambió SOLO el mock comercial para aportar información adicional (writer de
follow-ups y todo runtime 017/018 intactos). Corridas repetidas hasta verde.
Tests de freeze se alinearon al copy del primer pago, manteniendo números,
política y hash canónico. Esto no se atribuye a fallos históricos del runtime.

## Límites y siguiente paso

No se ejecutó suite E2E histórica completa: los pendientes documentados de 018
(precondición de org y crash UI 011) siguen abiertos. No interpretación de Jev/LLM
reales ni prueba productiva. 9 tests opt-in omitidos siguen pendientes históricos.
El guard de todos es deliberadamente estrecho: no infiere necesidad de otras
respuestas ni contexto remoto. Dedupe textual no cubre paráfrasis; ventana de 10
textos recientes, Unicode/case/whitespace; manuales y failed excluidos.

Constitution Check final I–IX: tenant/scoped, opt-in, sandbox, sender único,
idempotencia, reservas, ledger/status y freshness intactos; sin nuevos servicios,
PII/logs, schema, UI, campañas, scoring o pricing. Happy/unhappy observables verdes.
Docs de dominio y checkpoint actualizados. Regla comercial «Todos» requiere
sincronización en Obsidian; no se escribe ni duplica detalle técnico allí.
Siguiente paso exacto: el operador hace push/deploy habitual del commit local.
No requiere migración nueva ni republicar playbook para recibir guards/copy.
