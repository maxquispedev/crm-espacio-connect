# Corte 1 — Fundación y persistencia

Objetivo único del corte 1 del spec 011. Commit previsto: `feat(commercial): persistir recursos comerciales`.

## Reconstruir contexto — obligatorio antes de modificar

Esta es una sesión NUEVA e independiente de codex exec, desde raíz del repo.
No dependas del chat, otra sesión ni resume. Un corte = un objetivo = un commit.

1. Lee AGENTS.md completo, .specify/memory/constitution.md y docs/CURRENT_STATE.md.
2. Lee specs/011-commercial-resources/spec.md → plan.md → tasks.md, research.md
   y contracts/resources.md, contracts/payment-action.md, quickstart.md.
3. Revisa specs/008-sales-playbook, 009-playbook-runtime-admin y
   010-playbook-playground-ux (spec/plan/tasks) contra código actual.
4. Lee docs/SALES_ORCHESTRATOR.md, SALES_FOLLOW_UPS.md, playbook.md y contexto
   tenant de AUDITORIA_BASE_ESPACIO_CONNECT.md. Lee definición de self-test en CLAUDE.md.
5. Código: src/lib/db/{schema,tenant,ids}.ts; src/server/whatsapp/media.ts;
   src/server/inbox/send.ts; src/server/ai/delivery.ts;
   src/server/sales/{orchestrator,writer,resolve-plan,build-state,questions,
   answers,normalize,decision,state,client}.ts; src/lib/sales/playbook/*;
   src/components/agent/agent-client.tsx y playbook/*; APIs media/kb/playbook;
   src/server/lab/{runner,sandbox-case}.ts y endpoint lab/preview.
6. Lee código y tests creados por los cortes anteriores, suites media-send,
   send-media-kind-override, sales-orchestrator, sales-writer, sales-resolve-plan,
   sales-questions-freeze, playbook-* y arnés scripts/e2e-selftest.mjs.
7. Comprueba git status limpio, guarda HEAD inicial y revisa git log.
   Si tu corte ya tiene commit, STOP sin crear duplicado. Si faltan dependencias,
   STOP con diagnóstico, no implementes otro corte. Nunca reset/checkout/clean.

Código/tests actuales > documentos históricos. Reevalúa Constitution Check;
si hay ambigüedad bloqueante no inventes negocio ni amplíes alcance.

## Trabajo autorizado y límites

Implementa SOLO la fundación de recursos tenant-safe: tabla commercial_resource,
slots cerrados demo_enrollment_panel/demo_payments_balances/demo_online_enrollment
más payment_instructions, referencia media_asset y payload de cobro tipado.
Lee contracts/resources.md y ajusta detalle técnico al mecanismo real de migración.
Migración aditiva re-ejecutable; índices org-first/unique; IDs y store con scoped().
Rechaza media ajena, kind incorrecto y payload inválido. Ausencia = no configurado.
Sin UI, endpoints HTTP nuevos, uploads administrativos, runtime, prompts ni Jev.
No introducir payment action; no archivos MP4 reales, defaults de cuentas o URLs.
Tests: lectura/escritura y upsert por slot, tenant A/B, rechazo media cross-tenant,
validación de transferencias/Yape/link y vacío, migración/aplicación repetida sobre
BD de prueba si disponible. Regresión sales/playbook/media actuales verdes.
Documentar contrato de store/modelo y cualquier restricción no probada en BD.

## Gates y evidencia obligatorios

Implementa cambios pequeños SOLO de este corte y tests del comportamiento.
Ejecuta suites relevantes y el gate mínimo completo de AGENTS.md:

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Para comportamiento observable, extiende y EJECUTA self-test E2E existente,
camino feliz y camino infeliz con app+PostgreSQL+mocks y UI real donde aplique.
Itera diagnóstico/fix/verificación dentro de este corte. Nunca uses is_test
contra WhatsApp real ni contactes destinatarios productivos para verificar.
Si un gate técnico falla, registra diagnóstico y DETENTE con fallo, conserva
cambios y no hagas commit como si estuviera cerrado. Si E2E no puede ejecutarse
por entorno, registra comando, causa, verificaciones reales y PENDIENTE tanto en
tasks.md como CURRENT_STATE; se puede commitear implementación con gates técnicos
verdes, pero NO marcar verificación E2E cumplida ni declarar READY punta a punta.

## Cierre de esta sesión

1. Actualiza specs/011-commercial-resources/tasks.md SOLO con estado real de tu
   corte, comandos/resultados, E2E y pendientes. No marcar cortes futuros.
2. Actualiza docs/CURRENT_STATE.md con objetivo, cambios, decisión técnica,
   evidencia, archivos clave, E2E pendiente si corresponde y siguiente paso exacto.
3. Actualiza docs de dominio/contratos cuando cambien; señala Obsidian si cambió
   decisión comercial. No introducir secretos, videos reales ni servicios nuevos.
4. Revisa git diff, git diff --check y git diff --cached antes de commit;
   staging de archivos concretos de este corte, sin git add indiscriminado.
5. Realiza EXACTAMENTE UN commit atómico con implementación+tests+docs. No commits
   intermedios ni amend de commits previos, merge, rebase ni push/deploy.
6. Verifica HEAD distinto, un solo commit desde HEAD inicial y working tree
   limpio. Reporta hash, gates y estado E2E honesto.
7. STOP. No iniciar otro corte, no ejecutar runner ni codex exec anidado.
