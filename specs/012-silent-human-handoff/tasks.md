# Tasks — 012

Base limpia: 9a218b1ad4c866cff0e8224791b7fde4a621b04c.

- [x] T01 Contexto obligatorio, spec, clarify, plan, Constitution Check y analyze.
- [x] T02 Writer determinístico y renderer/defaults sin anuncios.
- [x] T03 Tests obligatorios y arnés E2E actualizados.
- [x] T04 Suites relevantes y gate completo.
- [ ] T05 Self-test E2E feliz/infeliz local (pendiente hasta evidencia).
- [x] T06 Docs, evidencia, revisión, único commit y STOP limpio.

## Evidencia de cierre — 2026-10-04

IMPLEMENTADO / GATES TÉCNICOS VERDES; E2E PENDIENTE. No READY punta a punta.
Commit único: `fix(sales): hacer silencioso el handoff humano`. Hash por
`git log -1 --format='%H %s'`, padre 9a218b1ad4c866cff0e8224791b7fde4a621b04c.

- Writer: pago autorizado antes de guard HUMAN; handoff puro retorna null sin
  LLM/perfil/instrucciones antiguas. applyHandoff y resolver conservados.
- Pago: destinos exactos, partición por métodos, CTA de comprobante y fallback
  natural; facts solo tras entrega completa. Sin copy de escalamiento/activación.
- Prueba rápida: contrato writer.text ahora string|null para HUMAN puro con
  handoff realmente aplicado; UI indica ausencia de mensaje automático. Vacío
  inesperado mantiene no_writer_output. Este ajuste evita regresión del sandbox.
- Tests reales de writer/orquestador/delivery/sender con BD en memoria cubren
  null sin outbound y handoff aplicado, schedule_call producción/sandbox, prioridad
  HUMAN sobre demo/pago, pago exacto/CTA/ausente/fallos/entrega parcial, cero
  Graph/sender en sandbox. No equivalen a PostgreSQL ni E2E vivo.
- Regresión: `pnpm --pm-on-fail=ignore exec vitest run tests/unit/sales-*.test.ts
  tests/unit/playbook-*.test.ts tests/unit/handoff.test.ts tests/unit/media-send.test.ts
  tests/unit/send-media-kind-override.test.ts` **438/438**, 38 archivos, exit 0.
  Log `/tmp/silent-handoff-regression-local.log`. Primer intento sandbox EPERM
  del test HTTP localhost; repetición con sockets habilitados verde.
- Prueba rápida: `pnpm --pm-on-fail=ignore exec vitest run
  tests/unit/lab-preview-*.test.ts`: **27/27**, exit 0.
  Log `/tmp/silent-handoff-preview.log`.
- Gate completo final: `pnpm --pm-on-fail=ignore typecheck &&
  pnpm --pm-on-fail=ignore lint && pnpm --pm-on-fail=ignore build &&
  pnpm --pm-on-fail=ignore test`: **exit 0**, **1129 pass / 4 skipped**,
  103 archivos verdes / 1 omitido. Log `/tmp/silent-handoff-gates.log`.
  Lint: 0 errores, 3 warnings preexistentes (img anuncio-origen, dos disable
  sin uso build-state). Primer gate sandbox types/lint/build verdes, test HTTP
  EPERM; gate final completo con sockets locales habilitados.
- Primer dirigido: dos aserciones suponían aiEnabled=false, pero applyHandoff
  real pausa mediante handoffAt; se corrigió para verificar ese contrato intacto.
  Otra fixture dejó de partirse por copy más corto: se añadió Yape válido para
  conservar el caso segunda parte fallida sin fact/retry. Corregidos y verdes.
- `node --check scripts/e2e-commercial-payment.mjs` y
  `node --check scripts/e2e-selftest.mjs`, `git diff --check`: exit 0.
- Arnés E2E 022 actualizado para copy/CTA, vacío, schedule_call sin outbound y
  HUMAN prioritario sin mensajes ni outbox. Intento real:
  `APP_BASE_URL=http://127.0.0.1:3000
  DATABASE_URL=postgresql://local_test:local_test@127.0.0.1:5432/commercial_resources_test_c4
  E2E_SECTION=022 WA_MOCK_ENABLED=true BOT_API_KEY=e2e-local-placeholder
  META_GRAPH_BASE_URL=http://127.0.0.1:3033/graph
  OPENROUTER_BASE_URL=http://127.0.0.1:3033
  TYPESAFE_JEV_ENDPOINT=http://127.0.0.1:3033/jev
  pnpm --pm-on-fail=ignore test:e2e` (variables exportadas en el mismo comando).
  **exit 1: ECONNREFUSED 127.0.0.1:3000**, antes del setup y de cualquier escenario.
  Sin ejecutables postgres/psql/pg_ctl/docker. Log `/tmp/silent-handoff-e2e.log`.
  E2E feliz/infeliz y UI vivos PENDIENTES; no se atribuye éxito a mocks unitarios.
- Constitution Check final: I–IV/VI–VIII preservados; V gate verde;
  IX pendiente en vivo. Persisten pendientes históricos 020/021/022/PG.
- Archivos clave: sales writer/payment-resource/orchestrator; defaults playbook
  v1/payment-extension; API/UI preview; tests writer/payment/demo-delivery/preview;
  arnés 022; docs SALES_ORCHESTRATOR/playbook/CURRENT_STATE.
- Sin deploy, runner, publicación ni modificación de filas productivas; cero
  WhatsApp real. Decisión comercial pendiente de sincronizar en Obsidian.
- Siguiente paso exacto (fuera de esta sesión): app + PostgreSQL dedicada migrada
  + mocks localhost:3033 + Chromium según quickstart 011, ejecutar E2E_SECTION=022
  y verificar Prueba rápida HUMAN silenciosa en UI. Registrar evidencia.
  STOP tras commit limpio; no iniciar otra tarea.
