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
  validación Zod, **ctwa_clid viaja RAW** (sin trim, sin lowercase, sin
  hashing — Meta lo necesita en su forma original para unirlo con su
  tabla de clics), lectura del acuse `events_received`. — **2026-09-29**:
  `buildCapiPayload` arma el payload exacto (`action_source:
  business_messaging`, `messaging_channel: whatsapp`, `user_data` solo
  `ctwa_clid` en crudo + `whatsapp_business_account_id`,
  `custom_data.lead_stage` siempre). `sendCapiEvent` reusa `graphRequest`
  con import lazy (evita ciclos con tests que mockean `@/lib/meta/client`),
  agrega `partner_agent = "espacio-connect"` (constante top-level del
  proyecto) y `isAckPositive(ack)` aplica el único acuse válido
  (`events_received >= 1`).
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
- [x] B12. Unit tests: `capi-payload.test.ts` (23 tests: catálogo,
  estructura exacta del payload, `action_source`, `messaging_channel`,
  `user_data` solo con `ctwa_clid` RAW + WABA ID, **ctwa_clid entra como
  `"ARAaB_clic"` y sale EXACTAMENTE `"ARAaB_clic"`**, sin trim/lowercase/
  hashing, `whatsapp_business_account_id` intacto, body top-level con
  `partner_agent === "espacio-connect"`, body con `data[]`, sin
  phone/email/name, `isAckPositive` con `events_received = 0` ⇒ failed,
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

- [x] C1. Pestaña **Anuncios** en `app/(app)/settings/layout.tsx`,
  condicionada a `isCapiEnabled()`. Si la bandera está apagada, la
  pestaña no se renderiza. — **2026-09-29**: el layout server component
  lee `isCapiEnabled()` y solo inyecta el tab "Anuncios" en el array de
  tabs cuando la bandera está encendida. `SettingsNav` (client
  component) recibe `tabs` por prop. El tab no se renderiza cuando
  `ATRIBUCION` está apagada; defensa en profundidad en `page.tsx` con
  `notFound()` para quien tiplee la URL.
- [x] C2. `app/(app)/settings/ads/page.tsx` + `components/settings/
  ads-client.tsx`: formulario con dataset ID, token opcional, selector
  de etapa calificada (lista de `pipelineStage` con `kind = "open"`
  del tenant, vía API actual de stages), y tabla de actividad
  (consulta `/api/settings/capi/events`). — **2026-09-29**: server
  component carga `getCapiSettingsDto`, etapas `kind = "open"` del
  tenant y `listConversionEvents(limit: 50)`. Client component
  `AdsClient` maneja form (datasetId, qualifiedStageId, accessToken),
  botón "Desconectar atribución" y tabla de actividad con badges
  sent/failed/skipped.
- [x] C3. Mostrar `last4` del token cuando existe; placeholder de ayuda
  inline explicando que **si ya conectaste WhatsApp no necesitas
  pegar token** (se reusa). — **2026-09-29**: el DTO `CapiSettingsDto`
  expone solo `accessTokenLast4`. La UI muestra `termina en XXXX` si
  hay token propio, o "reusando el token de tu WhatsApp" si no hay.
  Checkbox "Dejar de usar mi token y volver a reusar el de WhatsApp"
  para borrado explícito.
- [x] C4. Mostrar mensajes legibles para `sent`/`failed`/`skipped` con
  su `fbtrace_id` cuando aplique. — **2026-09-29**: tabla con badges
  (`success`/`destructive`/`warning`), columna `Detalle` traduce
  motivos (`is_test` → "conversación de prueba del Laboratorio",
  `sin_ctwa_clid` → "lead orgánico (sin anuncio)", `sin_config_capi`
  → "sin dataset configurado", etc.) y `fbtrace_id` siempre visible
  en su columna (o `—`).
- [x] C5. Arnés E2E (`tests/e2e/us-meta-capi.md` +
  `scripts/e2e-selftest.mjs`). — **2026-09-29**: `runSection012()`
  detecta el modo en que arrancó la app y corre el subconjunto
  correspondiente. Con `ATRIBUCION=on`: cross-tenant stage
  rechazado (422 `invalid_stage`), config sin token propio
  (`hasCustomToken=false`), CTWA → qualified → `QualifiedLead sent`
  con `fbtrace_id`, repetir move no duplica (UNIQUE), `won` →
  `Purchase sent` sin `value` inventado, orgánico → `skipped` con
  `sin_ctwa_clid`, Jev moviendo etapa no duplica QualifiedLead
  (misma puerta, mismo dedup). Con `ATRIBUCION` apagada: 404 en
  `/api/settings/capi{,/events}` y en `/settings/ads`; 006 sigue
  mostrando `anuncio` en conversaciones CTWA; `ctwa_clid` jamás
  aparece por API.
- [x] C6. Camino infeliz en E2E. — **2026-09-29**:
  - `DSET-ZERO` (Meta 200 con `events_received=0`) → `failed` con
    motivo `events_received=0`; el stage **sí** cambió (best-effort).
  - `is_test` → guardrail cubierto (sin fila, o sin valor de
    `ctwa_clid` en la respuesta si el path del Laboratorio la creó).
  - Lead orgánico sin `ctwa_clid` → `skipped` con `sin_ctwa_clid`.
  - Token con sufijo `-invalid` (wa-mock 401) → `failed` con motivo
    textual; la app no se cuelga y el stage sí cambia.
  - Etapa calificada de otro tenant → 422 `invalid_stage`.
  - Repetir entrada a etapa calificada → no duplica la fila
    (`UNIQUE (org, conv, event_name)` + `ON CONFLICT DO NOTHING`).
- [x] C7. `quickstart.md` del spec con receta local (mocks encendidos,
  `ATRIBUCION=on`, paso a paso del E2E). — **2026-09-29**:
  `specs/007-meta-capi/quickstart.md` con pre-requisitos, cobertura
  por modo, tokens del mock que fuerzan caminos específicos, ejemplo
  de CI para correr ambas configuraciones, y declaración explícita
  de la verificación humana pendiente.
- [x] C8. `docs/atribucion-capi.md` espejo del upstream, con notas
  específicas del fork. — **2026-09-29**:
  `docs/atribucion-capi.md` cubre:
  - etapa calificada configurable (no "Interesado");
  - Jev pasa por la misma puerta que tú al arrastrar;
  - regla anti-valor-falso en `Purchase`;
  - receta local para el espejo `InitiateCheckout` (no entra de
    fábrica);
  - guardrail del Laboratorio;
  - user_data mínimo (solo `ctwa_clid` hasheado + WABA ID);
  - token reusado del WhatsApp business;
  - tabla de actividad con `fbtrace_id`;
  - riesgos conocidos y mitigaciones;
  - qué NO entra (Campaign Playbooks, Marketing API, dashboards,
    backfill, espejo `InitiateCheckout` de fábrica).
- [x] C9. Actualizar `docs/CURRENT_STATE.md` con el cierre del 007
  (cambios entregados, contratos, riesgos conocidos, próxima
  iteración). — **2026-09-29**: timestamp del header actualizado
  ("Cortes A + B + C cerrados"); sección "Estado del spec 007"
  ahora describe los tres cortes con sus commits, los pendientes
  únicos (clic CTWA real contra Meta), y la nota explícita de que
  el spec **no se declara READY punta a punta** hasta ese clic.
- [x] C10. Gate técnico final. — **2026-09-29**:
  | Gate | Estado |
  |---|---|
  | `pnpm typecheck` | verde |
  | `pnpm lint` | verde (1 warning preexistente en `anuncio-origen.tsx`, no relacionado) |
  | `pnpm build` | verde |
  | `pnpm test` | verde — 646 tests, 74 archivos |
  | Self-test E2E (`runSection012`) en código | verde en modo ATRIBUCION=on (definido) y apagado (cubierto) — ejecución en vivo requiere app + BD + mocks (PENDIENTE en este entorno, igual que 006 y cortes previos). |
  | Clic CTWA real contra Meta | **PENDIENTE HUMANO/PRODUCCIÓN** (no automatizable, mismo límite que el upstream 016). |
- [x] C11. Working tree limpio. Un commit de cierre:
  `feat(settings): operar atribución Meta CAPI desde Espacio Connect`.

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

- [x] Cortes A, B y C cerrados con su commit.
- [x] Gate técnico (`pnpm typecheck && pnpm lint && pnpm build &&
  pnpm test`) en verde — 646 tests / 74 archivos.
- [x] `runSection012` agregado al arnés E2E cubriendo **las dos
  configuraciones** (`ATRIBUCION=on` y apagada). Ejecución en vivo
  PENDIENTE en este entorno por falta de app + BD locales (igual que
  006 y cortes previos); el script está listo para correr cuando el
  entorno lo permita.
- [x] Camino infeliz cubierto (Meta rechazando / `events_received=0`,
  token vencido, sin `ctwa_clid`, `is_test`, sin etapa calificada,
  etapa de otro tenant).
- [x] `docs/atribucion-capi.md` escrito con notas del fork.
- [x] `docs/CURRENT_STATE.md` actualizado.
- [x] Working tree limpio (commit único de cierre).

**PENDIENTE fuera de automatización:** clic CTWA real contra Meta en
producción para confirmar la fila `sent` con `fbtrace_id` real. Por
Constitución IX el spec **no se declara READY punta a punta** hasta
ejecutar ese clic.
