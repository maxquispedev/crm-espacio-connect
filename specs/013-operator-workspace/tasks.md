# Tasks — 013 Operator Workspace

**Estado durable de este spec.** Base limpia de arranque:
`ef83302262f9b147ded271ba4d1d5b323f88e344`
(`fix(sales): hacer silencioso el handoff humano`).

Regla de este archivo: refleja el estado **real**. Una casilla solo se marca cuando
hay evidencia (comando + resultado). Un corte fallido deja su trabajo para una sesión
nueva; nunca se descarta ni se auto-revierte.

Spec activo: `specs/013-operator-workspace/spec.md` · `plan.md` · este archivo.
Runner: `scripts/ai/run-operator-workspace-mcode.sh` (sesión mcode nueva por corte).
Prompts de corte: `.ai/tasks/operator-workspace/`.

---

## Mapa de cortes

| Corte | Objetivo | Commit objetivo | Sesión |
|---|---|---|---|
| CUT 1 | Estado durable de atención y recordatorios humanos | `feat(inbox): persistir atención y recordatorios humanos` | `01-cut1-attention-state.md` |
| CUT 2 | Bandeja "Por atender" | `feat(inbox): añadir cola por atender` | `02-cut2-por-atender-queue.md` |
| CUT 3 | Agenda y programación humana | `feat(inbox): añadir agenda de recordatorios humanos` | `03-cut3-agenda-human-reminders.md` |
| CUT 4 | Flujo operativo / UX integrada | `feat(inbox): integrar flujo operativo de atención` | `04-cut4-operational-flow.md` |
| CUT 5 | Verificación del workspace | `test(inbox): verificar workspace operativo` | `05-cut5-verification.md` |

Cortes 6–8 (rebrand + rediseño) viven en `specs/014-espacio-connect-rebrand/tasks.md`.

---

## CUT 1 — Estado durable de atención y recordatorios humanos

- [ ] T101 Spec, plan, Constitution Check y análisis del código real (choke points)
- [ ] T102 `ca_` en `src/lib/db/ids.ts`; tabla `conversation_attention` en `schema.ts`
- [ ] T103 Migración `0010` re-ejecutable + `idx: 12` en el journal Drizzle
- [ ] T104 `src/server/inbox/attention.ts`: `markAttentionPending`,
      `markAttentionWaitingClient`, `scheduleHumanReminder`, `clearAttention`,
      `getAttention`/`listAttention`; todo con `scoped()` y upsert idempotente
- [ ] T105 Enganche `applyHandoff` → `pending`
- [ ] T106 Enganche inbound durante HUMAN → `pending` (y `ingestManualEcho` →
      `waiting_client`)
- [ ] T107 Enganche outbound `origin=operator` → `waiting_client`
- [ ] T108 Enganche `reactivate` → limpiar; `aiEnabled=false` → `pending`;
      `markRead` **no** toca atención
- [ ] T109 Enganche `moveLeadStage` a `won`/`lost` → limpiar
- [ ] T110 Tests unitarios: ciclo de 10 pasos, derivación, constraints, tenant A/B,
      cero Graph
- [ ] T111 Regresión follow-ups automáticos sin expectativas modificadas
- [ ] T112 Gate completo + E2E (o PENDIENTE explícito con causa)
- [ ] T113 Documentación, evidencia, un commit, árbol limpio

## CUT 2 — Bandeja "Por atender"

- [ ] T201 `ConversationDto` + `attention` aditivo; LEFT JOIN scropeado en
      `listConversations` (patrón `adAttribution`), sin N+1
- [ ] T202 `needsAttentionNow` derivado en un único lugar
- [ ] T203 Chip "Por atender (N)" con conteo correcto, antes de `Todas`
- [ ] T204 Inclusión: handoff nuevo, inbound durante HUMAN, recordatorio vencido
- [ ] T205 Exclusión: recordatorio futuro, `waiting_client`, sin estado
- [ ] T206 `Todas` / `No leídas` / `Anuncios` / filtro de etapa intactos
- [ ] T207 Tests del filtro y del conteo
- [ ] T208 Gate + E2E de UI (o PENDIENTE con causa)
- [ ] T209 Evidencia, un commit, árbol limpio

## CUT 3 — Agenda y programación humana

- [ ] T301 Store de consulta con buckets `overdue/today/tomorrow/week/later`
- [ ] T302 `GET /api/reminders` (org de sesión, sin org en el body)
- [ ] T303 `POST /api/reminders` (Zod: `dueAt` **futura**, `note` opcional recortada)
- [ ] T304 `DELETE /api/reminders/[conversationId]` (cancelar)
- [ ] T305 Acción "Recordarme" en la conversación en HUMAN
- [ ] T306 Vista Agenda: vencidos / hoy / mañana / esta semana / más adelante, con
      contacto, fecha/hora, nota y estado
- [ ] T307 Vencido → Por atender; inbound antes → Por atender inmediato
- [ ] T308 Programar un segundo recordatorio tras atender el anterior
- [ ] T309 Cero envíos: ningún camino desde la Agenda hasta Graph/sender
- [ ] T310 Tests de bucketing (UTC/local), fecha límite, tenant, cero Graph
- [ ] T311 Gate + E2E (o PENDIENTE con causa)
- [ ] T312 Evidencia, un commit, árbol limpio

## CUT 4 — Flujo operativo / UX integrada

- [ ] T401 Revisión de naming: "Atención humana", "Marcar atendido / Esperando
      respuesta", "Recordarme", "Reactivar IA"
- [ ] T402 Nada de `handoffAt`, lanes, jobs ni timestamps internos en copy visible
- [ ] T403 Nav con Agenda y conteo de vencidos
- [ ] T404 Acciones coherentes en la conversación
- [ ] T405 Estado humano/IA con la misma semántica en lista, hilo y Agenda
- [ ] T406 (Opcional) Automáticos read-only con 👤/🤖, sin reimplementar el motor
- [ ] T407 Gate + E2E de UI (o PENDIENTE con causa)
- [ ] T408 Evidencia, un commit, árbol limpio

## CUT 5 — Verificación del workspace

- [ ] T501 Sección nueva aislada en `scripts/e2e-selftest.mjs` (patrón 020/022)
- [ ] T502 Guion `tests/e2e/` del workspace
- [ ] T503 handoff → Por atender
- [ ] T504 abrir no resuelve
- [ ] T505 reply manual → estado coherente
- [ ] T506 recordatorio futuro en Agenda y fuera de Por atender
- [ ] T507 inbound antes de vencimiento → Por atender
- [ ] T508 recordatorio vencido → Por atender
- [ ] T509 programar otro recordatorio
- [ ] T510 reactivar IA
- [ ] T511 Cliente / Perdido
- [ ] T512 aislamiento tenant con dos organizaciones
- [ ] T513 ningún recordatorio humano toca Graph automáticamente
- [ ] T514 follow-ups automáticos existentes sin regresión
- [ ] T515 Gate completo + E2E real (o PENDIENTE con causa exacta)
- [ ] T516 Cierre: `tasks.md`, `docs/CURRENT_STATE.md`, docs de dominio, un commit

---

## Casos E2E mínimos (CUT 5) — estado

| Caso | CUT | E2E | Unitario |
|---|---|---|---|
| handoff → Por atender | 2 | pendiente | pendiente |
| abrir no equivale a resolver | 1/2 | pendiente | pendiente |
| reply manual → estado coherente | 1 | pendiente | pendiente |
| recordatorio futuro → Agenda, fuera de Por atender | 3 | pendiente | pendiente |
| inbound antes de vencimiento → Por atender | 3 | pendiente | pendiente |
| recordatorio vencido → Por atender | 3 | pendiente | pendiente |
| programar otro recordatorio | 3 | pendiente | pendiente |
| reactivar IA | 1/4 | pendiente | pendiente |
| Cliente / Perdido | 1 | pendiente | pendiente |
| aislamiento tenant | 1 | pendiente | pendiente |
| cero Graph en recordatorio humano | 1 | pendiente | pendiente |
| follow-ups automáticos sin regresión | 1/5 | pendiente | pendiente |

## Evidencia

_(Sin evidencia todavía. Este bloque es bootstrap: ningún corte implementado.)_

Bootstrap 2026-10-04: creados `spec.md`, `plan.md`, `tasks.md` y `quickstart.md` de
este spec, más el runner `scripts/ai/run-operator-workspace-mcode.sh` y los prompts
`.ai/tasks/operator-workspace/01..05`. **Cero código funcional de 013 en este
commit.** CUT 1 no iniciado.

Pendientes históricos que este spec **no** cierra: E2E 020/021/022 y los 4 tests
PostgreSQL opt-in (`tests/unit/commercial-resource-postgres.test.ts`). Constitución IX
sigue abierta hasta que CUT 5 tenga E2E real ejecutado.
