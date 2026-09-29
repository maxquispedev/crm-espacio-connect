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

- [ ] B1. Migración aditiva y re-ejecutable `drizzle/00XX_meta_capi.sql`
  con dos tablas nuevas:
  - `conversion_event (id text PK cev_, organization_id NOT NULL,
    conversation_id NOT NULL FK, event_name text NOT NULL CHECK in
    ('QualifiedLead','Purchase'), custom_data jsonb NOT NULL,
    payload jsonb NOT NULL, status text NOT NULL CHECK in
    ('sent','failed','skipped'), fbtrace_id text NULL, error_message
    text NULL, created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, conversation_id, event_name))`;
  - `capi_settings (id text PK ccs_, organization_id NOT NULL UNIQUE
    FK, dataset_id text NOT NULL, access_token_ciphertext text NULL,
    access_token_last4 text NULL, qualified_stage_id text NULL FK
    pipeline_stage(id), updated_at timestamptz NOT NULL DEFAULT now())`.
- [ ] B2. `src/lib/db/ids.ts`: prefijos `cev_`, `ccs_`. `src/lib/db/
  schema.ts`: las dos tablas y relaciones (`ad_attribution` de 006 ya
  existente).
- [ ] B3. `src/lib/env.ts`: documentar `ATRIBUCION` (off por defecto;
  valores válidos: `'on' | '' | ausente`).
- [ ] B4. `src/server/attribution/flag.ts`: `isCapiEnabled()` siguiendo
  el patrón de los flags existentes (agenda/flag). **Apagada por
  defecto**; cualquier valor distinto de `'on'` ⇒ apagada.
- [ ] B5. `src/lib/meta/capi.ts`: payload, catálogo cerrado de eventos
  (solo `QualifiedLead`, `Purchase`), validación Zod, traducción de
  centavos→unidades si aplica, lectura del acuse `events_received`,
  clasificación `sent`/`failed` con motivo textual. Reusa el
  `graphRequest` de `lib/meta/client.ts`.
- [ ] B6. `src/server/attribution/settings.ts`: lectura/escritura de
  `capi_settings` con cifrado AES-256-GCM (`lib/crypto`). Hacia el
  cliente solo `last4` y estado; nunca a logs.
- [ ] B7. `src/server/attribution/conversions.ts`:
  - `reportStageChange({ organizationId, conversationId, fromStage,
    toStage, customData })`:
    - guardrail `is_test` → `skipped` con motivo;
    - guardrail flag apagada → `skipped` con motivo;
    - guardrail sin `ctwa_clid` (consultar `ad_attribution` de 006) →
      `skipped` con motivo;
    - dedup: `ON CONFLICT (organization_id, conversation_id,
      event_name) DO NOTHING` con escritura previa en `conversion_event`
      con `status = 'skipped'` si no aplica;
    - elegir evento según mapeo:
      - `toStage.kind = 'won'` y el evento no fue reportado antes para
        esta conversación → `Purchase` (con `value`/`currency` **solo
        si** el lead tiene monto válido; si no, sin ellos);
      - `toStage.id === settings.qualifiedStageId` y el evento no fue
        reportado antes → `QualifiedLead`;
      - si no, sin cambios;
    - emitir por `POST /{dataset_id}/events` con `action_source =
      "business_messaging"` y `messaging_channel = "whatsapp"`;
    - `user_data`: solo `ctwa_clid` (hash con SHA-256 según contrato
      Meta) + `whatsapp_business_account_id`;
    - acuse: `events_received >= 1` → `sent` con `fbtrace_id`;
      cualquier otra cosa → `failed` con `error_message` textual;
  - `emitConversion(...)` queda **público** con su dedup, su acuse y
    su registro de actividad (es el mismo del upstream; permite que un
    fork agregue el espejo `InitiateCheckout` documentado si quiere,
    sin re-arquitectura).
- [ ] B8. Enganchar `reportStageChange` en el gateway del Corte A:
  - se llama **DESPUÉS** del commit exitoso (nunca dentro de la
    transacción larga);
  - se llama **fuera** de cualquier `try/catch` que afecte la respuesta
    al usuario;
  - el resultado (sent/failed/skipped) va a `conversion_event` y es
    consultable por API;
  - un fallo de Meta **jamás** revierte el cambio de etapa.
- [ ] B9. APIs `/api/settings/capi`:
  - `GET`: devuelve `capi_settings` saneado (sin ciphertext, solo
    `dataset_id`, `access_token_last4`, `qualified_stage_id`, `updated_at`)
    o 404 si la bandera está apagada;
  - `POST/PATCH`: guarda `dataset_id`, token opcional (cifrado),
    `qualified_stage_id`; valida con Zod; valida que la etapa
    seleccionada sea del tenant y tenga `kind = 'open'`;
  - autenticación Better Auth + tenant (`scoped()`); 404 si bandera
    apagada.
- [ ] B10. API `/api/settings/capi/events`: lista `conversion_event` del
  tenant para la tabla de actividad; 404 si bandera apagada; paginación
  simple.
- [ ] B11. `src/app/api/dev/wa-mock/**` (o capa equivalente): el mock de
  Graph aprende `POST {dataset}/events` para el Corte C — para Corte B
  basta con que el adapter `lib/meta/capi.ts` sea testeable contra un
  cliente inyectable.
- [ ] B12. Unit tests:
  - `capi-payload`: payload exacto (campos, `action_source`,
    `messaging_channel`, `user_data` solo con `ctwa_clid` +
    `whatsapp_business_account_id`);
  - `capi-flag`: apagada por defecto, encendida solo con `ATRIBUCION=on`;
  - `conversions`: mapeo de etapa → evento, dedup, guardrails
    (`is_test`, sin `ctwa_clid`, sin dataset, sin etapa calificada),
    `Purchase` sin `value` inventado, `events_received >= 1` →
    `sent`;
  - `stage-gateway` ya cubierto en A9.
- [ ] B13. Self-test con mocks: `WA_MOCK_ENABLED=true`,
  `OPENROUTER_BASE_URL` → ai-mock, mock de `{dataset}/events`. Sin
  llamada real a Meta.
- [ ] B14. Gate técnico: `pnpm typecheck && pnpm lint && pnpm build &&
  pnpm test`.
- [ ] B15. Working tree limpio. Un commit:
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
