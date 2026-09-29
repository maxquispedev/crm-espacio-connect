# Tasks — 007 — Meta CAPI para leads Click-to-WhatsApp

> Tres cortes estrictamente secuenciales. Cada uno cierra con gate técnico
> verde y self-test de su alcance antes de pasar al siguiente. El orden
> **no es negociable**: la puerta única de etapa (Corte A) precede a CAPI
> (Corte B), y la UI/E2E (Corte C) cierra.
>
> Referencia upstream: `kevinrivm/vocero-crm` · commits
> `0a154ea2711ad5350e20451c573a7863b926cfed` y
> `75124422bba2298bb21cf3e712cae16b31f01ce2`. Adaptado al fork con Jev
> y la elección de etapa calificada configurable.

## Corte A — Puerta única de etapa (refactor neutro)

> **Objetivo**: una sola puerta runtime para `lead.stageId`, tenant-safe,
> testeada. **Sin CAPI, sin cambios observables, sin llamadas externas.**
> Migrar los 6 callsites runtime conservando `updatedAt`/`lastActivityAt`/
> `position` y los hechos/lanes de Jev.

- [x] A1. Auditar los 6 callsites runtime de `lead.stageId`
  (pipeline/leads/[id], pipeline/stages/[id], bot/reset, ai/pipeline,
  sales/orchestrator, inbox/lead-activity) y confirmar que el seed
  (`server/seed/demo.ts`) queda fuera del scope del gateway. — **2026-09-29**:
  auditoría completa. Los 6 callsites runtime están listados en el
  `plan.md` y el gateway está escrito asumiendo ese inventario.
- [x] A2. Crear `src/server/leads/stage-gateway.ts` con
  `moveLeadStage(input: { organizationId, leadId, toStageId, actor,
  reason? })`. Validar tenant y etapa destino del mismo tenant
  (`scoped()`); aceptar `position` opcional; actualizar `stageId`,
  `position`, `updatedAt`, `lastActivityAt` igual que los writes
  actuales; sin emitir eventos externos. — **2026-09-29**:
  `src/server/leads/stage-gateway.ts` expone `moveLeadStage`,
  `bulkMoveLeadsToStage`, `createLeadInStage` y `findFirstOpenStage`;
  errores tipados con `StageGatewayError { code, message }` para que las
  rutas traduzcan al contrato HTTP preexistente. Acepta `extra` para que
  Jev conserve su atomicidad sin acoplar el gateway al Sales Orchestrator.
- [x] A3. Migrar `app/api/pipeline/leads/[id]/route.ts` al gateway
  (drag/drop). Misma respuesta HTTP, mismo SQL efectivo. — **2026-09-29**:
  la ruta ahora resuelve la operación por `moveLeadStage` con
  `actor: "human"`, `reason: "drag_drop"`. `invalid_stage` →
  422 `invalid_stage`; `lead_not_found` → 404 `not_found`. Mismo
  shape de respuesta `{ lead }`.
- [x] A4. Migrar `app/api/pipeline/stages/[id]/route.ts` al gateway en
  bucle (bulk move al eliminar/mover etapa). Misma respuesta, mismas
  filas afectadas. — **2026-09-29**: la reasignación masiva al eliminar
  una etapa (`?moveTo=`) pasa por `bulkMoveLeadsToStage` con
  `actor: "human"`, `reason: "bulk_stage_delete"`. La validación de
  `moveTo === id` queda en la ruta antes del gateway.
- [x] A5. Migrar `app/api/bot/reset/route.ts` al gateway (reset de
  conversación → primer stage). Conservar el `actor: 'system'`. —
  **2026-09-29**: el `try/catch` best-effort del reset ahora envuelve
  `moveLeadStage` con `actor: "system"`, `reason: "bot_reset"`.
- [x] A6. Migrar `src/server/ai/pipeline.ts` al gateway (acciones del
  agente inline). `actor: 'agent'`. Conservar `lastActivityAt` y
  `updatedAt` exactamente como hoy. — **2026-09-29**: `moveLeadToStage`
  (helper interno) resuelve el `leadId` por `contactId` dentro del
  tenant y delega al gateway con `lastActivityAt: new Date()`,
  `actor: "agent"`, `reason: "ai_move_stage"`. Si el contacto aún no
  tiene lead, no falla: lo deja en manos del Laboratorio / próxima
  inbound. Si el gateway rechaza (`StageGatewayError`), se loguea
  como warning sin romper el turno.
- [x] A7. Migrar `src/server/sales/orchestrator.ts` al gateway
  (Jev/Sales Orchestrator). `actor: 'agent'`. **Crítico**: el patch
  `stageId = nextStageId` desaparece como write directo; Jev llama al
  gateway. Conservar lanes y hechos (`decision.facts`) intactos. —
  **2026-09-29**: `persistDecision` arma un `basePatch` (lane, snapshot,
  `lastJevError`, `lastActivityAt`, `followUpReason` cuando schedule) y
  lo pasa al gateway vía `extra`. El UPDATE sale con `stageId`,
  `updatedAt` y los hechos de Jev en el mismo SET, conservando la
  atomicidad original. Si el gateway rechaza, se persiste el resto del
  patch para no perder estado durable: el gateway es estricto, la
  decisión de Jev no. **No existe ya ningún write directo de
  `lead.stageId` en `server/sales/`.**
- [x] A8. Migrar `src/server/inbox/lead-activity.ts` al gateway para la
  asignación del primer stage al crear lead por inbound. `actor:
  'system'`. — **2026-09-29**: la asignación del primer inbound usa
  `findFirstOpenStage(organizationId)` + `createLeadInStage({ ...,
  actor: "system", reason: "first_inbound", lastActivityAt: at })`.
  El gateway calcula `position = max+1` del destino y conserva el
  `onConflictDoNothing` original.
- [x] A9. Tests del gateway:
  - tenant isolation (cross-tenant access → rechazo);
  - no-op mismo stage (no escribe);
  - operador/API (drag/drop devuelve mismo response);
  - movimiento producido por Jev (lane/facts intactos);
  - `kind = "won"` y `kind = "lost"` aceptados;
  - regresión del Sales Orchestrator (comparar salida del turno antes
    y después del refactor). — **2026-09-29**: `tests/unit/stage-gateway.test.ts`
    cubre los 6 ángulos con un mock de BD que valida los SET/UPDATE.
  Cobertura efectiva:
  - `moveLeadStage`: 11 tests (mueve, posición explícita, tenant
    isolation, lead inexistente, no-op mismo stage, `extra` con mismo
    stage, Jev lane/facts, won, lost, open, `lastActivityAt` explícito);
  - `bulkMoveLeadsToStage`: 3 tests (cross-tenant, no-op mismo,
    reasignación masiva);
  - `createLeadInStage`: 4 tests (crea con timestamp, cross-tenant,
    idempotencia `onConflictDoNothing`, position auto `max+1`);
  - `findFirstOpenStage`: 2 tests (primera open, ignora won/lost).
  Regresión del Sales Orchestrator cubierta por
  `tests/unit/sales-orchestrator.test.ts` (que sigue verde tras la
  migración, con un ajuste mínimo del mock para proveer los SELECTs
  adicionales que el gateway ahora hace explícitos).
- [x] A10. Gate técnico: `pnpm typecheck && pnpm lint && pnpm build &&
  pnpm test`. Sin cambios observables en UI ni en respuestas de API. —
  **2026-09-29**:
  | Gate | Estado |
  |---|---|
  | `pnpm typecheck` | verde |
  | `pnpm lint` | verde (1 warning preexistente en `anuncio-origen.tsx`, no relacionado) |
  | `pnpm build` | verde |
  | `pnpm test` | verde — 614 tests, 71 archivos |
  | E2E en vivo | **PENDIENTE** — sin app local ni PostgreSQL activa en este entorno (igual que en el cierre de 006 y los cortes previos de follow-ups). El self-test del Corte C cubrirá los caminos con `ATRIBUCION=on` y apagada. |
- [x] A11. Working tree limpio. Un commit:
  `refactor(pipeline): centralizar cambios de etapa del lead`. — **2026-09-29**.

## Corte B — CAPI core + schema + APIs (sin UI final)

> **Objetivo**: reportar `QualifiedLead` y `Purchase` desde la puerta del
> Corte A, con dedup, best-effort, mock equivalente al upstream. Sin UI
> final salvo tipos estrictamente necesarios.

- [x] B1. Migración aditiva y re-ejecutable `drizzle/0007_meta_capi.sql`
  con dos tablas nuevas (`conversion_event`, `capi_settings`). —
  **2026-09-29**: `0007_meta_capi.sql` re-ejecutable (IF NOT EXISTS en
  tablas/índices/check, DO con EXCEPTION WHEN duplicate_object para FK).
  UNIQUE principal `(organization_id, conversation_id, event_name)` con
  check de catálogo cerrado y de status.
- [x] B2. `src/lib/db/ids.ts`: prefijos `cev_`, `ccs_`. `src/lib/db/
  schema.ts`: las dos tablas y relaciones (`ad_attribution` de 006 ya
  existente). — **2026-09-29**: `conversionEvent` y `capiSettings`
  declarados con `organizationId NOT NULL` y FK con ON DELETE CASCADE
  según el patrón del repo.
- [x] B3. `src/lib/env.ts`: documentar `ATRIBUCION` (off por defecto;
  valores válidos: `'on' | '' | ausente`). — **2026-09-29**:
  `ATRIBUCION: z.string().optional()`. `.env.example` añade la guía
  inline completa.
- [x] B4. `src/server/attribution/flag.ts`: `isCapiEnabled()` siguiendo
  el patrón de los flags existentes. — **2026-09-29**: `isCapiEnabled()`
  reemplaza al placeholder `false` del Corte A. `atribucionEnabled()`
  queda como compat.
- [x] B5. `src/lib/meta/capi.ts`: payload, catálogo cerrado de eventos,
  validación Zod, hash SHA-256 de `ctwa_clid`, lectura del acuse
  `events_received`. — **2026-09-29**: `buildCapiPayload` arma el
  payload exacto (`action_source: business_messaging`, `messaging_channel:
  whatsapp`, `user_data` solo `ctwa_clid` hasheado + `whatsapp_business_account_id`,
  `custom_data.lead_stage` siempre). `sendCapiEvent` reusa `graphRequest`
  con import lazy (evita ciclos con tests que mockean `@/lib/meta/client`).
  `isAckPositive(ack)` aplica el único acuse válido (`events_received >= 1`).
- [x] B6. `src/server/attribution/settings.ts`: lectura/escritura de
  `capi_settings` con cifrado AES-256-GCM. — **2026-09-29**:
  `getCapiSettings` (descifra server-side), `getCapiSettingsDto` (DTO
  saneado sin ciphertext), `upsertCapiSettings` (preserva token
  existente si no se pasa uno nuevo), `isQualifiedStageForTenant`
  (valida que la etapa sea del tenant y `kind = "open"`).
- [x] B7. `src/server/attribution/conversions.ts`:
  `reportStageChange({ organizationId, conversationId, fromStage,
  toStage, dealValue?, dealCurrency? })` con guardrails
  (flag apagada, `is_test`, sin `ctwa_clid`, sin config, sin token),
  dedup durable (consulta previa + `ON CONFLICT DO NOTHING` del INSERT),
  mapeo de evento (`won` ⇒ `Purchase`, `qualifiedStageId` ⇒
  `QualifiedLead`), `user_data` mínimo con `ctwa_clid` hasheado y
  `whatsapp_business_account_id`, `Purchase` con `value`/`currency`
  solo si el lead tiene monto válido (nunca `0`). `events_received >= 1`
  ⇒ `sent` con `fbtrace_id`; cualquier otra cosa ⇒ `failed` con motivo
  textual. `emitConversion(...)` queda público como punto de extensión
  para futuros hooks (receta de `InitiateCheckout` documentada).
- [x] B8. Enganchar `reportStageChange` en el gateway del Corte A:
  `src/server/attribution/report-on-stage-change.ts` exporta
  `reportStageChangeOnMove(...)` (single lead) y
  `reportStageChangeOnBulkMove(...)` (bulk). Los callers
  (`app/api/pipeline/leads/[id]`, `app/api/pipeline/stages/[id]`,
  `server/sales/orchestrator.ts`, `server/ai/pipeline.ts`) llaman
  `void reportStageChangeOnMove(...)` **DESPUÉS** del commit del gateway,
  **fuera** de cualquier try/catch que afecte la respuesta al usuario.
  Un fallo de Meta jamás revierte el cambio de etapa — el desenlace
  queda escrito en `conversion_event` y es consultable por API.
- [x] B9. APIs `/api/settings/capi`: `GET` devuelve el DTO saneado o 404
  si la bandera está apagada. `PUT` guarda `datasetId`, token opcional,
  `qualifiedStageId` (validado contra `kind = "open"` del tenant). —
  **2026-09-29**: autenticación Better Auth + tenant (`scoped()`); 404
  si bandera apagada.
- [x] B10. API `/api/settings/capi/events`: lista `conversion_event` del
  tenant para la tabla de actividad. — **2026-09-29**: `limit`
  opcional (default 50, max 200); 404 si bandera apagada.
- [x] B11. `src/app/api/dev/wa-mock/**` aprende `POST {dataset}/events`.
  — **2026-09-29**: el mock devuelve acuse positivo con `fbtrace_id`.
  `DSET-FAIL` fuerza error 400; `DSET-ZERO` fuerza `events_received=0`
  para el camino infeliz de tests.
- [x] B12. Unit tests: `capi-payload.test.ts` (19 tests: catálogo,
  estructura exacta del payload, `action_source`, `messaging_channel`,
  `user_data` solo con `ctwa_clid` hasheado + WABA ID, hash SHA-256
  trim+lowercase, `isAckPositive` con `events_received = 0` ⇒ failed,
  Purchase sin `value` inventado, traducción de errores Meta);
  `capi-flag.test.ts` (7 tests: apagada por defecto, solo `'on'`
  enciende, `atribucionEnabled` compat); `capi-conversions.test.ts`
  (casos puros de anti-valor-falso + acuse).
- [x] B13. Self-test con mocks: el adaptador `lib/meta/capi.ts` es
  testeable contra `global.fetch` (los unit tests cubren los caminos
  del adapter). El mock de `{dataset}/events` está cableado en B11.
  El self-test E2E en vivo (sección 012 del arnés) se implementa
  en el Corte C.
- [x] B14. Gate técnico: `pnpm typecheck && pnpm lint && pnpm build &&
  pnpm test` en verde. — **2026-09-29**:
  | Gate | Estado |
  |---|---|
  | `pnpm typecheck` | verde |
  | `pnpm lint` | verde (1 warning preexistente en `anuncio-origen.tsx`, no relacionado) |
  | `pnpm build` | verde |
  | `pnpm test` | verde — 646 tests, 74 archivos |
  | E2E en vivo | **PENDIENTE** — el self-test del Corte C corre el flujo real con la app levantada (igual que en 006 y follow-ups). |
- [x] B15. Working tree limpio. Un commit:
  `feat(attribution): reportar QualifiedLead y Purchase a Meta CAPI`.

## Corte C — UI + E2E + cierre

> **Objetivo**: pantalla Ajustes → Anuncios, arnés E2E en las dos
> configuraciones, guía del dueño con notas del fork.

- [ ] C1. Pestaña **Anuncios** en `app/(app)/settings/layout.tsx`,
  condicionada a `isCapiEnabled()`. Si la bandera está apagada, la
  pestaña no se renderiza.
- [ ] C2. `app/(app)/settings/ads/page.tsx` + `components/settings/
  ads-client.tsx`: formulario con dataset ID, token opcional, selector
  de etapa calificada (lista de `pipelineStage` con `kind = "open"`
  del tenant, vía API actual de stages), y tabla de actividad
  (consulta `/api/settings/capi/events`).
- [ ] C3. Mostrar `last4` del token cuando existe; placeholder de ayuda
  inline explicando que **si ya conectaste WhatsApp no necesitas
  pegar token** (se reusa).
- [ ] C4. Mostrar mensajes legibles para `sent`/`failed`/`skipped` con
  su `fbtrace_id` cuando aplique.
- [ ] C5. Arnés E2E (`tests/e2e/us-meta-capi.md` +
  `scripts/e2e-selftest.mjs`):
  - con `ATRIBUCION=on`: configuraci ón → guardar → mover lead a
    etapa calificada → ver `QualifiedLead sent` con `fbtrace_id`;
    mover lead a etapa ganada → ver `Purchase sent` con `value`/
    `currency`; mover sin monto → ver `Purchase sent` sin
    `value`/`currency`;
  - con `ATRIBUCION` apagada: pestaña Anuncios no aparece; APIs CAPI
    devuelven 404; arrastre de tarjeta sigue funcionando sin
    efectos externos.
- [ ] C6. Camino infeliz en E2E:
  - Meta rechazando (`{dataset}/events` mock devuelve error) → fila
    `failed` con motivo; lead **sí** quedó movido;
  - sin `ctwa_clid` (lead orgánico, no vino de anuncio) → fila
    `skipped` con motivo;
  - `is_test = true` → fila `skipped` con motivo;
  - sin etapa calificada configurada → fila `skipped` con motivo;
  - token vencido → fila `failed` con motivo; la app no se cuelga.
- [ ] C7. `quickstart.md` del spec con receta local (mocks encendidos,
  `ATRIBUCION=on`, paso a paso del E2E).
- [ ] C8. `docs/atribucion-capi.md` espejo del upstream, con notas
  específicas del fork:
  - etapa calificada configurable (no "Interesado");
  - Jev pasa por la misma puerta que tú al arrastrar;
  - regla anti-valor-falso en `Purchase`;
  - receta local para el espejo `InitiateCheckout` (no entra de
    fábrica);
  - guardrail del Laboratorio.
- [ ] C9. Actualizar `docs/CURRENT_STATE.md` con el cierre del 007
  (cambios entregados, contratos, riesgos conocidos, próxima
  iteración).
- [ ] C10. Gate técnico final: `pnpm typecheck && pnpm lint && pnpm
  build && pnpm test && pnpm test:e2e` en las dos configuraciones.
- [ ] C11. Working tree limpio. Un commit de cierre:
  `feat(attribution): UI Ajustes Anuncios, E2E en dos configuraciones y docs`.

## Dependencias entre cortes

- B depende de A (la puerta única debe existir antes de enganchar
  `reportStageChange`).
- C depende de B (la API y el modelo de actividad deben existir antes de
  la UI y el E2E).

## Riesgos conocidos al ejecutar

| Riesgo | Tarea que lo mitiga |
|---|---|
| Jev saltándose CAPI por bypass directo | A7 + B8 |
| Doble webhook duplicando evento | B1 (`UNIQUE`) + B7 (`ON CONFLICT`) |
| Valor falso envenenando optimización | B7 (Purchase sin `value`/`currency` si no hay monto válido) |
| Meta devolviendo 200 con evento tirado | B5 + B7 (`events_received >= 1` es el único acuse) |
| Hardcodear "Interesado" | B6 + B9 (selector configurable por tenant) |
| Optimizar campaña de ventas con `QualifiedLead` | C8 (documentado en `docs/atribucion-capi.md`) |
| Flag encendida en producción sin querer | B4 (apagada por defecto) + C5 (E2E en dos configuraciones) |

## Definition of Done (007)

- [ ] Cortes A, B y C cerrados con su commit.
- [ ] Gate técnico (`pnpm typecheck && pnpm lint && pnpm build &&
  pnpm test`) en verde.
- [ ] `pnpm test:e2e` en verde con la app viva y mocks encendidos, en
  **las dos configuraciones** (`ATRIBUCION=on` y apagada).
- [ ] Camino infeliz cubierto (Meta rechazando, token vencido, sin
  `ctwa_clid`, `is_test`, sin etapa calificada).
- [ ] `docs/atribucion-capi.md` escrito con notas del fork.
- [ ] `docs/CURRENT_STATE.md` actualizado.
- [ ] Working tree limpio.
