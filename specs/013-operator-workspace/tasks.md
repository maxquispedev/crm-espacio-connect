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

- [x] T101 Spec, plan, Constitution Check y análisis del código real (choke points)
- [x] T102 `ca_` en `src/lib/db/ids.ts`; tabla `conversation_attention` en `schema.ts`
- [x] T103 Migración `0010` re-ejecutable + `idx: 12` en el journal Drizzle
- [x] T104 `src/server/inbox/attention.ts`: `markAttentionPending`,
      `markAttentionWaitingClient`, `scheduleHumanReminder`, `clearAttention`,
      `getAttention`/`listAttention`; todo con `scoped()` y upsert idempotente
- [x] T105 Enganche `applyHandoff` → `pending`
- [x] T106 Enganche inbound durante HUMAN → `pending` (y `ingestManualEcho` →
      `waiting_client`)
- [x] T107 Enganche outbound `origin=operator` → `waiting_client`
- [x] T108 Enganche `reactivate` → limpiar; `aiEnabled=false` → `pending`;
      `markRead` **no** toca atención
- [x] T109 Enganche `moveLeadStage` a `won`/`lost` → limpiar
- [x] T110 Tests unitarios: ciclo de 10 pasos, derivación, constraints, tenant A/B,
      cero Graph
- [x] T111 Regresión follow-ups automáticos sin expectativas modificadas
- [x] T112 Gate completo verde; **E2E NO ejecutado** (causa registrada abajo)
- [x] T113 Documentación, evidencia, un commit, árbol limpio

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
| handoff → Por atender | 2 | pendiente | **verde** (`attention-hooks`) |
| abrir no equivale a resolver | 1/2 | pendiente | **verde** (`attention-state`, `attention-hooks`) |
| reply manual → estado coherente | 1 | pendiente | **verde** (`attention-hooks`: echo + outbound) |
| recordatorio futuro → Agenda, fuera de Por atender | 3 | pendiente | pendiente |
| inbound antes de vencimiento → Por atender | 3 | pendiente | pendiente |
| recordatorio vencido → Por atender | 3 | pendiente | pendiente |
| programar otro recordatorio | 3 | pendiente | pendiente |
| reactivar IA | 1/4 | pendiente | **verde** (`attention-hooks`) |
| Cliente / Perdido | 1 | pendiente | **verde** (`attention-hooks`) |
| aislamiento tenant | 1 | pendiente | **verde** (`attention-state`, `attention-hooks`) |
| cero Graph en recordatorio humano | 1 | pendiente | **verde** (`attention-no-send`) |
| follow-ups automáticos sin regresión | 1/5 | pendiente | **verde** (100 tests, sin tocar expectativas) |

## Evidencia

### CUT 1 — 2026-10-04 · commit `feat(inbox): persistir atención y recordatorios humanos`

Base: `33fb80e` (árbol limpio al empezar). Choke points verificados en el código
real antes de tocar nada: los seis de `plan.md` §2/§3.5 existen y son los puntos
únicos (`applyHandoff`, `ingestInboundMessage`, `ingestManualEcho`,
`persistOutbound` con `origin:"operator"`, `updateConversation`, `moveLeadStage`).

**Qué entró**

- `drizzle/0010_conversation_attention.sql` + journal `idx: 12`
  (`tag: 0010_conversation_attention`). Escrita a mano: `pnpm db:generate` emitió
  un diff de snapshot completo que recreaba tablas existentes y hacía
  `DROP INDEX "test_run_org_running_uq"`. Revisado el SQL generado y descartado,
  igual que en el corte comercial (0009).
- `src/lib/db/schema.ts`: `conversation_attention` con `organization_id` NOT NULL +
  FK, UNIQUE `(organization_id, conversation_id)`, CHECK de estado y CHECK
  bidireccional `deferred` ⇔ `due_at`, tres índices org-first.
- `src/server/inbox/attention.ts`: la API de `plan.md` §3.4 + `deriveAttention`
  (derivación en un solo lugar, la reutiliza el corte 2), `AttentionError`,
  `clearAttentionForContact` y `bestEffortAttention`.
- Seis enganches best-effort, uno por punto de estrangulamiento.
- `tests/fixtures/mem-db.ts`: doble de BD en memoria con ORM/`schema`/`scoped()`
  REALES (interpreta el SQL que Drizzle genera). Los constraints de PostgreSQL NO
  los comprueba esto: para eso está la suite opt-in.

**Comandos y resultados**

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | verde |
| `pnpm lint` | verde (0 errores; 3 warnings preexistentes de `build-state.ts` / `anuncio-origen.tsx`) |
| `pnpm build` | verde |
| `pnpm test` | verde: **107 ficheros, 1193 tests** en verde, 9 skipped |
| `pnpm vitest run tests/unit/attention-state.test.ts` | 27 tests verdes (ciclo de 10 pasos + tenant A/B + derivación) |
| `pnpm vitest run tests/unit/attention-hooks.test.ts` | 25 tests verdes (los 6 enganches, `markRead` intacto, best-effort) |
| `pnpm vitest run tests/unit/attention-no-send.test.ts` | 6 tests verdes (estructural + dinámico, cero Graph) |
| `pnpm vitest run tests/unit/attention-migration.test.ts` | 6 verdes + **5 skipped** (opt-in sin PostgreSQL) |

**Regresión obligatoria, sin modificar ninguna expectativa** (`git diff --name-only
-- tests/` vacío):
`tests/unit/sales-follow-up-*.test.ts`, `sales-orchestrator`, `sales-writer`,
`handoff`, `media-send` → 9 ficheros / 100 tests verdes.
`playbook-*` + `lab-preview-*` → 18 ficheros / 210 tests verdes.

**E2E de comportamiento: NO EJECUTADO (PENDIENTE con causa).**
Intento real: app construida arrancada en `:3111` con los mocks →
`GET /api/health` devuelve **503 `db_unavailable`** con
`ECONNREFUSED 127.0.0.1:5432`. En esta máquina no hay `postgres`, `psql`,
`pg_ctl`, `initdb` ni `docker`, así que no hay forma de levantar la BD
dedicada que exigen el harness y `migrate`. Playwright y Chromium sí están
instalados: el único bloqueo es la base de datos. Este corte no añade UI, ni
endpoint, ni DTO, así que la superficie observable empieza en el corte 2
(`tests/e2e/` y `scripts/e2e-selftest.mjs`); aun así el E2E real de la
`conversation_attention` debe ejecutarse en el corte 5 o en cuanto haya
PostgreSQL. **No se declara READY.**

**Decisiones que se apartan de una lectura literal (quedan trazadas aquí)**

1. **FR-1.10 vs spec §3.4.** `pending`/`waiting_client` se validan contra
   "la IA no es la dueña" = `handoffAt != null || aiEnabled === false`, no
   solo contra `handoffAt != null`. Con la regla literal, `aiEnabled=false`
   sin handoff (alcanzable desde el interruptor del panel de conversación)
   no podría generar el `pending` que el propio §3.4 exige. La invariante que
   FR-1.10 protege —"si la IA es dueña, no hay estado humano"— se cumple
   íntegra: con la IA activa y sin handoff no se escribe nada.
2. **`moveLeadStage` solo limpia con cambio REAL de etapa.** El no-op a la misma
   etapa documenta que no hace lecturas extra; no se rompió ese contrato de
   rendimiento. El efecto práctico (un lead ya en `cliente` al que se le
   reactivara la IA y se apagara después) se resuelve al moverlo a cualquier
   etapa y de vuelta.
3. **Extras del módulo sobre el mínimo de §3.4**, todos condicionados por lo que
   el corte 2/3 necesita y sin superficie nueva: `deriveAttention` (evita
   duplicar la derivación), `clearAttentionForContact` (el lead es el segundo
   anclaje del contrato), `ATTENTION_NOTE_MAX_LENGTH` (recorte defensivo, el
   Zod del endpoint irá en el corte 3) y `AttentionError` con
   `conversation_not_found | ai_owns_conversation | due_in_past`.

**Lo que este corte NO abre**

`docs/SALES_FOLLOW_UPS.md` **no se tocó**: el contrato de follow-ups no cambia
(`src/server/sales/follow-ups/**` intacto, sin entradas nuevas en el worker, sin
`automationLane`/`followUpCount`/`human_lane`/`handoff_active`). El test
`attention-no-send.test.ts` ata esa frontera por código: si alguien importa el
módulo desde el motor, o el motor desde el módulo, la suite falla.

Bootstrap 2026-10-04: creados `spec.md`, `plan.md`, `tasks.md` y `quickstart.md` de
este spec, más el runner `scripts/ai/run-operator-workspace-mcode.sh` y los prompts
`.ai/tasks/operator-workspace/01..05`. **Cero código funcional de 013 en este
commit.** CUT 1 no iniciado.

Pendientes históricos que este spec **no** cierra: E2E 020/021/022 y los 4 tests
PostgreSQL opt-in (`tests/unit/commercial-resource-postgres.test.ts`). Constitución IX
sigue abierta hasta que CUT 5 tenga E2E real ejecutado.
