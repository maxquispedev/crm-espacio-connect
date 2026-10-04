# Corte 1 — Estado durable de atención y recordatorios humanos

Objetivo único del corte 1 del spec `013-operator-workspace`. Commit previsto:
`feat(inbox): persistir atención y recordatorios humanos`.

## Reconstruir contexto — obligatorio antes de modificar

Sesión NUEVA e independiente de `mcode exec`, desde la raíz del repo. No dependas del
chat, de otra sesión ni de resume. Un corte = un objetivo = un commit.

1. Lee **completo**: `AGENTS.md`, `.specify/memory/constitution.md`,
   `docs/CURRENT_STATE.md` y `CLAUDE.md`.
2. Lee `specs/013-operator-workspace/spec.md` → `plan.md` → `tasks.md` →
   `quickstart.md`. **El spec manda**: si el código lo contradice, el código está mal.
3. Lee los docs de dominio: `docs/SALES_ORCHESTRATOR.md`, `docs/SALES_FOLLOW_UPS.md`
   y el contexto de tenant de `docs/AUDITORIA_BASE_ESPACIO_CONNECT.md`.
4. Choke points a verificar en el código real (los nombres **plan.md §2** los verificó;
   confirma que siguen vigentes):
   - `applyHandoff()` en `src/server/ai/delivery.ts` (handoff único de IA → humano).
   - Inbound y `ingestManualEcho` en `src/server/inbox/ingest.ts`.
   - Outbound `origin: "operator"` en `src/server/inbox/send.ts`.
   - `updateConversation()` en `src/server/inbox/queries.ts` (`reactivate`, `aiEnabled`,
     `markRead`).
   - `moveLeadStage()` en `src/server/leads/stage-gateway.ts` (`kind: won | lost`).
   - `sales_follow_up_job` y `lead.nextFollowUpAt` en `src/lib/db/schema.ts`.
5. Patrones a copiar: tabla `commercial_resource` + `drizzle/0009_*.sql` + journal
   `idx: 11`; `src/lib/db/ids.ts` (prefijos); `src/server/sales/follow-ups/store.ts`
   (tenant scope e idempotencia).
6. Comprueba `git status --short` limpio, guarda el HEAD inicial y revisa `git log`.
   Si tu corte ya tiene commit, **STOP** sin crear duplicado. Si faltan dependencias de
   un corte anterior, **STOP** con diagnóstico. Nunca `reset`/`checkout`/`clean`/
   `stash`/`rebase`.

Código y tests reales > documentos históricos. Reevalúa el Constitution Check. Si hay
ambigüedad bloqueante, no inventes negocio ni amplíes alcance: para y reporta.

## Trabajo autorizado y límites

Implementa **solo** el contrato durable de la atención humana:

- Tabla dedicada `conversation_attention` (`ca_` en `ids.ts`), con `organization_id`
  NOT NULL, UNIQUE `(organization_id, conversation_id)`, CHECK de coherencia
  `deferred`⇔`due_at`, índices org-first. Migración aditiva **re-ejecutable** +
  journal. Sigue el patrón de 0009; revisa el SQL generado antes de commitear.
- `src/server/inbox/attention.ts` con la API mínima de `plan.md` §3.4:
  `markAttentionPending`, `markAttentionWaitingClient`, `scheduleHumanReminder`,
  `clearAttention`, lectura para DTO/listado. Todo con `scoped()`, upsert idempotente
  y validación de que `pending`/`waiting_client` solo existen con `handoffAt != null`.
- Los enganches de `plan.md` §3.5, uno por punto de estrangulamiento, **best-effort
  seguro**: un fallo al escribir la atención no puede tumbar el envío ni la ingesta.
- `markRead` **no** toca la atención. Abrir no resuelve.
- Reglas de `spec.md` §3.4: reactivar IA limpia; `aiEnabled=false` → pendiente; etapa
  `cliente`/`perdido` limpia; recordatorio futuro no sobrevive a que el cliente escriba.
- El vencimiento es **derivado** (`deferred` con `due_at <= now()`). **No** hay worker,
  cron, lease ni intervalo.

**Prohibido** (consecuencias duraderas, no preferencias):

- Enviar WhatsApp desde un recordatorio humano. Ninguna llamada a Graph, sender,
  plantillas ni al store de follow-ups. Sin entrada en el worker.
- Reutilizar `sales_follow_up_job` o `lead.nextFollowUpAt` como recordatorio humano.
  Las 5 razones están en `plan.md` §5 (D-2, D-3).
- Tocar `src/server/sales/follow-ups/**`, cadencias, worker, seeding, `automationLane`,
  `followUpCount/Reason` o los errores `human_lane`/`handoff_active`. Es regresión
  prohibida (FR-1.9).
- UI, endpoints nuevos, DTO nuevo, Agenda o "Por atender": son los cortes 2 y 3.
- Etapas operativas en el pipeline, plantillas WhatsApp, dependencias externas,
  secretos, o refactors oportunistas ajenos a este corte.

## Tests obligatorios

Ciclo completo de los 10 pasos de `spec.md` §3.2, incluidos: handoff → pendiente;
abrir no resuelve; reply manual → `waiting_client`; recordatorio futuro; inbound antes
del vencimiento → pendiente; vencido → pendiente (derivado, sin proceso); programar
otro; reactivar IA; `cliente`/`perdido`; aislamiento tenant A/B (una conversación de
otra org es invisible e inmodificable); y un **spy que falle si el sender/Graph es
invocado** desde el camino de recordatorio humano. Incluye constraints y
re-ejecución de la migración sobre BD de prueba si hay ejecutables; si no, dilo
explícitamente (los dobles en memoria **no** sustituyen PostgreSQL).

Regresión obligatoria **sin modificar expectativas**:
`tests/unit/sales-follow-up-*.test.ts`, `sales-orchestrator`, `sales-writer`,
`handoff`, `media-send`, `playbook-*`, `lab-preview-*`.

## Gates y evidencia obligatorios

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Este corte no tiene UI nueva; el self-test E2E de comportamiento aplica a los cortes
con superficie observable (2–5). Si aun así puedes ejercitar el camino real con app +
PostgreSQL + mocks, hazlo; si no, registra el intento y la causa. Nunca declares READY
sin E2E ejecutado. Diagnostica, corrige y re-verifica tú mismo hasta verde; si un gate
falla de forma no resoluble, conserva los cambios y **DETENTE con fallo explícito**, sin
commitear como si estuviera cerrado.

## Cierre de esta sesión

1. Actualiza `specs/013-operator-workspace/tasks.md` SOLO con el estado real de este
   corte: tareas marcadas, comandos, resultados, regresión, pendientes. No marques
   cortes futuros.
2. Actualiza `docs/CURRENT_STATE.md`: objetivo, cambios, decisiones técnicas,
   evidencia, archivos clave, siguiente paso exacto.
3. Actualiza `docs/SALES_FOLLOW_UPS.md` solo si el contrato de follow-ups cambió
   (no debería: este corte es aditivo y no toca el motor). Señala la decisión de
   producto para sincronizar en Obsidian.
4. Revisa `git diff`, `git diff --check` y `git diff --cached`; staging de ficheros
   concretos, sin `git add` indiscriminado.
5. **EXACTAMENTE UN commit atómico** con implementación + tests + docs. Sin commits
   intermedios, `amend`, `merge`, `rebase`, `push` ni deploy.
6. Verifica HEAD distinto, un solo commit desde el HEAD inicial y árbol limpio.
   Reporta hash, gates y estado E2E honesto.
