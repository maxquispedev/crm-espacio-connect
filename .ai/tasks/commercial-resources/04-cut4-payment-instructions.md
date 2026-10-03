# Corte 4 — Acción explícita de instrucciones de pago

Objetivo único del corte 4 del spec 011. Commit previsto: `feat(sales): entregar instrucciones de pago configuradas`.

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

Depende de 1–3: reconstruir estado actual y revisar evidencia de verificación de
videos registrada tras pausa. Si falta, STOP con precondición operativa pendiente,
no implementar ni afirmar validación productiva; no lanzar envíos reales por tu cuenta.
Implementa SOLO send_payment_instructions según contracts/payment-action.md.
Extensión explícita 1.1 con ocho acciones, sin hack schedule_call. Preserva
1.0 siete acciones y V2 canónica/fixture/hash; nuevo V3 deriva extensión de pago.
Loader/store/schema/version gates, tipos/normalizer/decision, preguntas/criterios,
resolver, writer, orquestador, playbook/editor, catálogos outcomes Lab y mocks
que necesiten adaptación deben quedar coherentes. Update draft a 1.1 explícito;
no auto-migrar/publish/reescribir Published o histórico, ni modificar pricing.
Jev reconoce confirmación de querer pagar; precio/demo de pagos/voucher no
suficientes. Precedencia HUMAN/disqualify intacta. Entrega autorizada estándar
primero, handoff commercial posterior; writer de transición HUMAN no debe
suprimir accidentalmente instrucciones de pago autorizadas.
Código renderiza destinos EXACTOS de recursos de cobro validados. No tomar
cuentas/URLs de KB, transcript, perfil ni output LLM; preferir plantilla completa
controlada para evitar alucinaciones. Todos métodos configurados en orden
transferencia/Yape/link; omitir ausentes. Sin métodos: transición honesta + humano.
PaymentInstructionsSentAt solo post-entrega de instrucciones (también simulación
sandbox); no por decisión/handoff/texto fallback/error. Después handoff humano
para confirmación/implementación; no won, cobranza real, servicio activado o
voucher validado. Sandbox cero WhatsApp/Graph/upload/follow-ups/CAPI externos.
Tests de acción explícita y negativas, normalizer por versión, resolver y
prioridades, writer con intento de destinos falsos, exactitud de datos,
ausencia/errores sin fact, handoff posterior, tenant y sandbox, UI upgrade
1.0→draft 1.1→publicar→rollback 1.0. V2 hash-freeze sigue verde sin debilitarlo.
E2E pipeline happy/unhappy observando instrucciones recibidas, fact y handoff;
probar también Published 1.0 compatible. Documentar paso de publicación 1.1
y señalar sincronización de la decisión comercial en Obsidian sin copiarla.

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
