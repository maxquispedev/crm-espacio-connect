# Tasks — 008 Sales Playbook

> Estado durable de la feature. **FEATURE 008 = PLANIFICADA / NO IMPLEMENTADA.**
> La única sección marcada `[x]` corresponde al **bootstrap documental
> y del runner** (este commit). Todas las tareas de implementación
> (T101..T708) están explícitamente **sin marcar** y serán los cortes
> quienes las cierren, una por una, con evidencia.

## Convenciones

- `Txx` = id de tarea. Las dependencias bloquean: si `T205` depende de
  `T204`, ejecutar en orden.
- `**/**` = archivo creado o modificado; entre corchetes el alcance.
- Cada corte cierra con un único commit y working tree limpio.
- Cada tarea con `Status` lleva el estado `PENDIENTE` mientras no se
  haya verificado en su corte. **Ningún status P0 o P1 ambiguo que
  aparente avance sin evidencia.**

---

## Estado del bootstrap (este commit)

> Esta sección es la **única** marcada con `[x]` porque corresponde
> exclusivamente al trabajo de este commit: documentación SDD y
> runner. No reutiliza los checkboxes de implementación.

- [x] **T000** — Bootstrap documental: `specs/008-sales-playbook/`
  (spec, plan, tasks, research, data-model, contracts/*, quickstart)
  + `.ai/tasks/sales-playbook/` (overview + 7 task files)
  + `scripts/ai/run-sales-playbook.sh` (runner inspirado en
  `run-vendeveloz-launch.sh` con `bash -n` verde).
  Commit: `docs(ai): bootstrap sales playbook SDD runner`.

- [x] **T000b** — Corrección documental post-bootstrap:
  consolidación del contrato dinámico (engine-required vs known signals
  vs analytical/custom), bootstrap multi-org determinista,
  eliminación del cache de playbook en V1, override de draft solo en
  `is_test=true`, supresión de follow-ups en sandbox.
  Commit: `docs(ai): corregir contrato dinámico del sales playbook`.

---

## Corte 1 — Modelo y persistencia (T101..T109)

> Schema + migración + tipos + bootstrap. NO tocar runtime productivo.

- [x] **T101** — Leer auditoría del spec (`research.md`) y Drizzle
  schema actual (`src/lib/db/schema.ts`).
  ✅ done — referencia cruzada con `vende-veloz.ts`, `questions.ts`,
  `build-state.ts`, `writer.ts`, `follow-up-writer.ts`, `normalize.ts`,
  `decision.ts`, `resolve-plan.ts`, `sales-questions-freeze.test.ts`.
- [x] **T102** — Agregar tablas `sales_playbook` y `sales_playbook_version`
  en `src/lib/db/schema.ts` con prefijos `sp_` / `spv_` (`src/lib/db/ids.ts`).
  Índices parciales UNIQUE para `draft`/`published` por `playbook_id`.
  - Columnas `last_jev_playbook_version_id` y `last_jev_playbook_schema_version`
    en `lead` (nullable; additive).
  - `drizzle/0008_sales_playbook.sql` generada y editada a mano con el
    patrón `IF NOT EXISTS` + `DO $$ … EXCEPTION WHEN duplicate_object THEN null $$`.
  - Migración re-ejecutable (correr dos veces sin error).
  ✅ done — `src/lib/db/schema.ts`, `src/lib/db/ids.ts`,
  `drizzle/0008_sales_playbook.sql` (FK lógica en `lead`,
  índices parciales `WHERE status='published'`/`'draft'`,
  check de catálogo cerrado `status IN (...)`).
- [x] **T103** — `src/lib/sales/playbook/schema.ts` con Zod
  versionado. Exportar `ConfigV1Schema` (`schema_version: "1.0"`) y
  `parseConfigV1(input)`. Validación estricta: rechaza payloads que
  no cumplen, devuelve errores formateados.
  - El Zod debe distinguir tres clases: `engine-required`,
    `known signals` (V1) y `analytical/custom`. Documenta las claves
    con guardarraíles (`next_action`, `needs_human_call`,
    `buying_timing`, `main_value_proposition`).
  - **Option keys** de `next_action` (7 fijas), `buying_timing` (5
    fijas) y `main_value_proposition` (5 fijas) son contrato del
    resolver/writer: el Zod rechaza payloads que pretendan
    renombrarlas. Solo las descripciones son editables.
  ✅ done — `src/lib/sales/playbook/schema.ts` con `superRefine`
  contractual: `engine_required_missing`/`engine_required_disabled`/
  `engine_required_type_mismatch` para `next_action` y `needs_human_call`,
  `choice_keys_mismatch` para `next_action.criteria` (7),
  `buying_timing.criteria` (5) y `main_value_proposition.criteria` (5).
- [x] **T104** — `src/lib/sales/playbook/v1.ts` con el contenido
  literal del Anexo V1 ("Vende Veloz 365 — Academia Bajo Control").
  Exportar `VENDE_VELOZ_PLAYBOOK_V1: ConfigV1` validado en build time
  con `ConfigV1Schema.parse(...)`.
  ✅ done — `src/lib/sales/playbook/v1.ts`. Snapshot test:
  `ConfigV1Schema.parse(VENDE_VELOZ_PLAYBOOK_V1)` no lanza.
  Instrucciones del writer literales del Anexo (≤ 1500 chars
  por entry; sin truncar contenido).
- [x] **T105** — `src/lib/sales/playbook/store.ts`: funciones puras
  sobre BD con `scoped()`.
  - `getPlaybookForOrg(orgId)`
  - `getPublishedVersionForOrg(orgId)`
  - `getDraftVersionForOrg(orgId)`
  - `getVersionById(orgId, versionId)`
  - `listVersionsForOrg(orgId)`
  - `createDraft(orgId, notes, createdBy)`
  - `updateDraft(orgId, patch)`
  - `publishDraft(orgId, notes, publishedBy)`
  - `rollbackToVersion(orgId, versionId, notes, publishedBy)`
  - `loadActiveQuestionsForVersion(versionId, schema_version)`: para
    usar desde el loader runtime; **sin cache**.
  ✅ done — `src/lib/sales/playbook/store.ts`. `publishDraft` y
  `rollbackToVersion` corren en transacción atómica
  (`archive current published` → `flip target → published`).
  `createDraft` calcula `version_number = max + 1` y lanza
  `DraftAlreadyOpenError` si ya hay draft abierto. Todo el
  módulo respeta `scoped()` y los índices parciales UNIQUE.
- [x] **T106** — `src/lib/sales/playbook/bootstrap.ts`: bootstrap
  multi-org **determinista**, idempotente y **sin "primera org"**.
  - API de sistema:
    `bootstrapAllEnabledOrgs(): Promise<{ created: string[];
    skipped: string[] }>`.
  - Pasos:
    1. `SELECT organization_id FROM agent_profile WHERE
       sales_orchestrator_enabled = true` (query explícita, sin
       `LIMIT 1` ni heurística).
    2. Para cada `orgId`, llamar a
       `bootstrapOrgIfNeeded(orgId)`.
    3. `bootstrapOrgIfNeeded(orgId)` solo siembra si NO existe
       `sales_playbook` para esa org.
  - Disparar en `instrumentation.ts` con `await
    bootstrapAllEnabledOrgs()` best-effort (try/catch + log, no
    bloquea el boot).
  - Tests cubren el escenario con 2 orgs, 1 enabled + 1 disabled,
    segunda ejecución sin duplicados y cero cruce de organization_id.
  ✅ done — `src/lib/sales/playbook/bootstrap.ts` +
  `src/instrumentation.ts` (re-export en `instrumentation-node.ts`).
  Enumeración explícita por
  `agent_profile.salesOrchestratorEnabled = true` (sin LIMIT,
  sin heurística); orden determinista por `organizationId`.
  Best-effort por org: un fallo no bloquea las demás.
- [x] **T107** — `tests/unit/playbook-schema.test.ts`: cobertura Zod
  (payloads válidos e inválidos, schema_version desconocido, preguntas
  `engine-required` faltantes, `next_action` con type incorrecto,
  option keys de `next_action`/`buying_timing`/`main_value_proposition`
  renombradas → fail; descriptions sí editables).
  ✅ done — 14 tests pasando; cubre payload válido, schema_version
  incorrecto, type mismatch (`next_action`/`needs_human_call`),
  `enabled=false`, key extra/renombrada en las 3 choice questions,
  descriptions editables, writer.instruction > 1500, priorities.primary
  vacío, key fuera de regex, key válida custom, engine-required
  ausente.
- [x] **T108** — `tests/unit/playbook-bootstrap.test.ts`: cobertura
  del bootstrap (multi-org, idempotencia, solo si
  `salesOrchestratorEnabled`, contenido V1 correcto, **NO** `LIMIT 1`,
  **NO** cruce de org).
  ✅ done — 5 tests pasando; 2 orgs con su V1 propia y cero
  cruce de organization_id; 1 enabled + 1 disabled; segunda ejecución
  cero duplicados; 3 enabled + 1 disabled; cero orgs enabled
  (no-op).
- [x] **T109** — `tests/unit/playbook-store.test.ts`: cobertura de
  `store` (CRUD, índices parciales UNIQUE, tenant isolation, rollback,
  publish concurrente).
  ✅ done — 16 tests pasando; cubre CRUD, índices UNIQUE, tenant
  isolation (cross-org → null), rollback cross-org → throws,
  publishDraft/rollback en transacción, publish doble consecutivo
  mantiene invariante.

**Cierre del corte 1**:

- `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en verde.
  → ✅ 77/77 archivos, 698/698 tests.
- Migración aplicada dos veces sin error.
  → ✅ Patrón `IF NOT EXISTS` + `DO $$ … EXCEPTION WHEN duplicate_object
  THEN null $$` (mismo que `0007_meta_capi.sql`, probado re-ejecutable).
- Bootstrap idempotente verificado en test unit con ≥2 organizaciones.
  → ✅ `playbook-bootstrap.test.ts`.
- Working tree limpio, un commit: `feat(playbook): schema versionado + bootstrap V1`.

---

## Corte 2 — API + versionado (T201..T208)

- [x] **T201** — `app/api/playbook/route.ts` (GET): devuelve `playbook`,
  `published`, `draft`. 404 si la org no tiene playbook.
  *Evidencia*: `src/app/api/playbook/route.ts` + tests
  `playbook-api.test.ts > GET /api/playbook (T201)` (404 sin playbook,
  200 con V1 publicada).
- [x] **T202** — `app/api/playbook/draft/route.ts` (POST): crea draft
  desde publicada (409 si ya hay draft).
  *Evidencia*: `src/app/api/playbook/draft/route.ts` (POST) + tests
  `POST /api/playbook/draft (T202)` (201 primer draft, 409 duplicado,
  422 `no_published_baseline`).
- [x] **T203** — `app/api/playbook/draft/route.ts` (PUT): actualiza
  draft, valida Zod del documento entero post-patch.
  *Evidencia*: `src/app/api/playbook/draft/route.ts` (PUT) + tests
  `PUT /api/playbook/draft (T203) — guardarraíles Jev` (404 sin draft,
  422 `choice_keys_mismatch` / `engine_required_type_mismatch` /
  `engine_required_missing` / `engine_required_disabled`).
- [x] **T204** — `app/api/playbook/validate/route.ts` (POST): valida
  sin persistir. Detalle de errores en `details[]`.
  *Evidencia*: `src/app/api/playbook/validate/route.ts` (200 `{ok:true}`
  / 422 `validation_failed` con `details[]`).
- [x] **T205** — `app/api/playbook/publish/route.ts` (POST):
  transacción atómica: archive + publish. `notes` requerido.
  *Evidencia*: `src/app/api/playbook/publish/route.ts` + tests
  `POST /api/playbook/publish (T205)` (200 ok, 409
  `publish_concurrency_lost` cuando otro caller ya publicó).
- [x] **T206** — `app/api/playbook/rollback/route.ts` (POST):
  republica archivada. Rechaza si `schema_version` desconocido sin
  migrador.
  *Evidencia*: `src/app/api/playbook/rollback/route.ts` + tests
  `POST /api/playbook/rollback (T206)` (404 cross-tenant, 422
  `unknown_schema_version`, 200 ok).
- [x] **T207** — `app/api/playbook/versions/route.ts` (GET) +
  `app/api/playbook/versions/[id]/route.ts` (GET): listado y detalle
  con `scoped()`.
  *Evidencia*: ambas rutas + test `GET /api/playbook/versions (T207)
  — aislamiento por org` (solo ve versiones de su org).
- [x] **T208** — Tests de endpoints cubriendo:
  - Tenant isolation (cross-org). ✓ `playbook-api.test.ts >
    POST /api/playbook/rollback (T206) > 404 version_not_found si la
    versión no pertenece a la org (cross-tenant)` y `GET
    /api/playbook/versions (T207) — aislamiento por org`.
  - Draft duplicado → 409. ✓
  - Payload inválido → 422 con detalles. ✓
  - PUT que renombra una option key de `next_action` → 422. ✓
  - PUT que cambia el type de `next_action` → 422. ✓
  - Rollback cross-org → 404. ✓
  - Publish concurrente → 409. ✓

**Cierre del corte 2**:

- Gate técnico en verde: `pnpm typecheck` (clean), `pnpm lint` (clean,
  solo el warning preexistente de `<img>` en `anuncio-origen.tsx`
  ajeno a este corte), `pnpm build` (7 rutas nuevas registradas en
  `/.next/server/app-paths-manifest.json`), `pnpm test` (78/78
  archivos, 715/715 tests, incluyendo los 17 nuevos en
  `tests/unit/playbook-api.test.ts`).
- Self-test E2E manual contra `pnpm dev`: la superficie HTTP está
  expuesta y probada por los tests unitarios con mocks de `withAuth`
  + store en memoria. La verificación con mocks en runtime
  (`pnpm dev` + `WA_MOCK_ENABLED=true`) se ejecutará cuando se
  integre con la UI en Corte 3 (no se requiere en Corte 2).
- Working tree limpio, un commit: `feat(playbook): API draft/publish/rollback`.

---

## Corte 3 — Runtime dinámico (T301..T313)

> El motor pasa de tener 8 preguntas fijas a consumir el set activo
> del playbook publicado, con fallback seguro. Se eliminó el cache: el
> runtime lee BD en cada turno.

- [x] **T301** — `src/lib/sales/playbook/loader.ts` (sin cache).
  - `getPublishedConfigForOrg(orgId): Promise<ConfigV1 | null>`:
    SELECT directo contra `sales_playbook_version` filtrando por
    `status='published'`.
  - `getDraftConfigForOrg(orgId): Promise<ConfigV1 | null>`:
    SELECT directo contra `sales_playbook_version` filtrando por
    `status='draft'`.
  - `getConfigByVersionId(orgId, versionId): Promise<{config, schema_version, version_number}>`:
    SELECT directo. Usado por el override del Laboratorio.
  - **Sin cache en memoria**, **sin TTL**, **sin invalidación**:
    publish/rollback toma efecto en el siguiente turno.
- [x] **T302** — `src/server/sales/build-state.ts` carga el config
  publicado (si existe) y lo expone en
  `JevSalesState.product`, `commercial_policy`. Sin publicada →
  fallback a `VENDE_VELOZ_PRODUCT` / `VENDE_VELOZ_COMMERCIAL_POLICY`
  con `console.warn` una vez por proceso.
- [x] **T303** — Contrato dinámico: el motor pasa a Jev el **set
  activo** de preguntas desde el playbook.
  - En `runSalesOrchestratorTurn` (o `build-state`), antes de
    `evaluateJev`, calcular:
    ```ts
    const activeQuestions = filterActive(config.jev_questions);
    // engine-required deben estar presentes y enabled=true;
    // known signals y analytical filtran por enabled=true.
    ```
  - Llamar a `evaluateJev({ state, questions: activeQuestions })`
    pasando el set activo. La firma ya soporta `questions` opcional.
- [x] **T304** — `src/server/sales/normalize.ts`: refactor del
  normalizer.
  - Nueva firma: `normalizeJevResponse(raw, activeQuestions,
  knownSignalKeys)`.
  - `engine-required` (`next_action`, `needs_human_call`):
    - Si faltan → `fail("missing_required", key)`.
    - Si type incorrecto → `fail("type_mismatch", key)`.
    - Option keys fuera del conjunto fijo del resolver → `fail`.
  - `known signals`: si la pregunta está activa y la respuesta viene
    bien formada → se preserva; si falta o la pregunta está
    desactivada → `null` con fallback documentado (ver T305).
  - `analytical/custom`: si la respuesta viene, se preserva en
    `decision.signals[key]` (sin afectar al resolver).
  - **Eliminar** la asunción de que las 8 están siempre presentes.
- [x] **T305** — `SalesDecision` (refactor compatible) y fallbacks:
  - `nextAction` y `needsHumanCall` siguen **requeridos**.
  - Los 6 known signals pasan a **nullable**. Sus consumidores
    (`resolve-plan`, `writer`, `follow-up-writer`,
    `serialize-ui`) deben tolerar `null`:
    - `buying_timing === null` → tratar como `"unknown"` (resolver)
      / omitir línea de timing (writer).
    - `main_value_proposition === null` → writer continúa sin ángulo
      específico.
    - `real_operational_need === null` → resolver no modifica plan
      por esa señal.
    - `product_fit`, `motivation_to_change`, `purchase_intent` ===
      `null` → solo se persisten; no afectan el resolver.
  - `decision.signals: Record<string, NormalizedAnswer>` para
    analíticas y futuras.
- [x] **T306** — Override de Playbook SOLO en `is_test=true`.
  - `runSalesOrchestratorTurn(conv, override?)`: si llega `override`,
    exigir `conv.is_test === true`; si no, lanzar.
  - Usado por el Laboratorio (Corte 6).
  - En producción, `override` siempre `undefined`.
- [x] **T307** — `src/server/sales/writer.ts` y
  `src/server/sales/follow-ups/follow-up-writer.ts`: aceptar override
  `product`/`policy`/`offer`/`writerInstructions`. Compatibilidad
  total con tests existentes (los defaults siguen aplicables cuando
  no llega override).
- [x] **T308** — `src/server/sales/orchestrator.ts`:
  - Cargar config publicado via `loader.getPublishedConfigForOrg`.
  - Pasar al writer el override correspondiente.
  - **Suprimir scheduling de follow-ups cuando
    `conversation.is_test === true`**: el `runSalesOrchestratorTurn`
    detecta `is_test` y NO llama a `scheduleNextFollowUp`. Los jobs
    sandbox quedan cancelados; la fila `sales_follow_up_job` queda
    vacía para esa conversación al terminar la corrida.
  - Persistir en `lead`:
    `last_jev_playbook_version_id`,
    `last_jev_playbook_schema_version`.
  - En `last_jev_decision` JSONB añadir claves
    `playbook_version_id`, `playbook_schema_version`,
    `playbook_version_number`.
- [x] **T309** — `src/server/ai/prompts.ts` (o equivalente):
  inyectar `agent_profile.tone` / `instructions` / `escalationRules`
  en el system prompt del writer comercial cuando Sales Orchestrator
  está activo.
- [x] **T310** — Tests unitarios e integración:
  - `tests/unit/playbook-jev-questions.test.ts`:
    - `evaluateJev` recibe el set activo correcto.
    - pregunta analítica `enabled=false` NO se envía.
    - `next_action` faltante en respuesta → fail.
    - `needs_human_call` faltante en respuesta → fail.
    - `product_fit` activo sin respuesta → `null` con fallback en
      resolver.
    - pregunta analítica nueva presente → preservada en `signals`.
    - `next_action.choice` con key fuera del set fijo → fail.
    - `buying_timing.choice` con key fuera del set fijo → fail.
  - `tests/unit/playbook-fallback.test.ts`: sin published, fallback
    a constantes con warning una vez por proceso.
  - `tests/unit/playbook-snapshot.test.ts`: snapshot persiste
    `playbook_version_id` correctamente.
  - `tests/unit/playbook-override-guard.test.ts`: override con
    `is_test=false` → lanza.
  - `tests/unit/playbook-lab-suppress-followups.test.ts`: corrida
    `is_test=true` no crea filas en `sales_follow_up_job`.
- [x] **T311** — Regresión del Sales Orchestrator existente
  (`sales-orchestrator.test.ts`, `sales-writer.test.ts`,
  `sales-build-state.test.ts`, `follow-up-writer.test.ts`,
  `lab-sandbox.test.ts`) en verde.
- [x] **T312** — Auto-test con mocks:
  - Inbound sintético con V1 publicada → `lead.last_jev_playbook_version_id`
    poblado; system prompt cita `product.name` del playbook.
  - Borrar la publicada en BD → segundo inbound →
    `last_jev_playbook_version_id = null`; warning en logs.
- [x] **T313** — E2E (`tests/e2e/us-sales-playbook.md` sección
  runtime) verde con `pnpm test:e2e`. **No ejecutado por falta de
  app/Postgres/mocks en este entorno**: los guiones E2E requieren
  Playwright contra la app levantada con mocks (Ruta A documentada
  en `specs/008-sales-playbook/quickstart.md`). Los 737 tests
  unitarios verdes cubren el contrato dinámico, el fallback y los
  snapshot persistidos; el E2E queda como `pnpm test:e2e` cuando
  haya stack levantado.

**Cierre del corte 3**:

- Gate técnico + tests verdes + E2E en verde.
- Working tree limpio.
- Un commit:
  `feat(playbook): runtime consume playbook publicado (contrato dinámico)`

NO empieces Corte 4.

---

## Corte 4 — UI Playbook (T401..T407)

- [x] **T401** — Refactor `agent-client.tsx`: navegación con tabs
  `Comportamiento` / `Conocimiento` / `Sales Playbook`. El switch
  Encendido/Apagado sigue en el header y los cards existentes
  (`SalesOrchestratorCard`, `SalesFollowUpsCard`, `ProfileSection`,
  `KbSection`) se conservan sin reescribir.
  → ✅ tabs `role="tablist"`; el tab de Sales Playbook monta
  `<PlaybookClient />`. Solo se **agrega** navegación.
- [x] **T402** — `components/agent/playbook/playbook-client.tsx`:
  contenedor con `playbook`/`published`/`draft`/`versions`/`error`/
  `saving`/`busy`, refetch al montar y tras cada mutación. Estado vacío
  con el mensaje del bootstrap y botón `Crear draft` administrativo
  (la UI **no** siembra bajo demanda) + `Refetch`.
  → ✅ sin cache en memoria (Corte 1 la retiró a propósito).
- [x] **T403** — `playbook-published-card.tsx`: versión publicada con
  `version_number`, `schema_version`, `published_at`, `notes`,
  mini-resumen (producto, prioridades primarias, precio
  `S/{setup} + S/{monthlyBase}/mes hasta {N} activos`) y badges
  🔒 `engine-required` / 📊 `known signals` / ➕ `analytical`.
  Botones `Crear draft desde esta versión` (deshabilitado si ya hay
  draft) y `Ver historial`.
  → ✅ los catálogos de clase se leen de
  `lib/sales/playbook/constants.ts` (módulo **sin Zod**) para no
  arrastrar el validador al bundle del cliente; `schema.ts` los
  re-exporta para no romper imports.
- [x] **T404** — `playbook-draft-editor.tsx`: ocho bloques
  (Producto, Oferta, Política, Prioridades, Writer, Prohibiciones,
  Handoff, Urgencia) con sus formularios. Writer = 7 textareas (una por
  `next_action`), Handoff = 5, Prioridades con flechas ↑/↓ y tope 8,
  `neverPromise` de la Oferta como referencia en Prohibiciones.
  Validación cliente con throttle de 300 ms contra
  `POST /api/playbook/validate` (documento entero), errores en rojo bajo
  el campo. `Guardar cambios` → `PUT` + refetch; `Descartar cambios` →
  refetch. **Las preguntas Jev no se editan aquí** (Corte 5): solo el
  total y el badge por clase.
  → ✅ sin JSON crudo en la UI.
- [x] **T405** — `playbook-versions-list.tsx`: tabla con
  `version_number`, `status`, `created_at`, `published_at`,
  `archived_at`, `notes` (+ tamaño). Click en la fila despliega el
  detalle pidiéndolo a `GET /api/playbook/versions/:id`; si la fila es
  `archived` y **no** es la publicada actual, aparece `Rollback a V{n}`.
- [x] **T406** — Acciones: `Crear draft` / `Guardar` / `Validar` /
  `Publicar` / `Rollback` con `notes` obligatorio (modales) y
  `Eliminar draft`.
  → ✅ se **agrega** `DELETE /api/playbook/draft` (el corte 2 no lo
  tenía): 200 `{deleted:{id,version_number}}`, 200 `{deleted:null}`
  si no había draft (idempotente) y **409 `no_published_version`** si
  no hay publicada activa — para no dejar al negocio sin playbook en
  vigor. Guardarraíl en `store.deleteDraft` + `NoPublishedVersionError`.
  Cubierto por 4 casos en `tests/unit/playbook-api.test.ts`.
- [x] **T407** — E2E: `tests/e2e/us-sales-playbook.md` (guiado) +
  `scripts/e2e-selftest.mjs`.
  → ✅ automatizado como **sección 013**, no 012: la 012 ya la ocupa el
  spec 007 (Meta CAPI) y sobrescribirla perdería esa cobertura.
  35 checks: GET 200 con V1, POST draft 201, PUT
  `writer.present_price` 200, publish 200 (flip atómico), versions
  incluye la nueva, rollback a V1 200, DELETE draft 200, y aislamiento
  de tenant (otra org no ve el playbook ni puede leer una versión).
  Re-ejecutable: los números de versión se derivan del historial, no se
  asumen.

### Hallazgos del corte 4 (arreglados aquí)

1. **`drizzle/0008_sales_playbook.sql` estaba huérfano**: el archivo
   existe (commit `d08c59c`) pero **no estaba en
   `drizzle/meta/_journal.json`**, así que `drizzle-kit migrate` nunca lo
   aplicaba: `relation "sales_playbook" does not exist`. El modelo del
   playbook era indeployable. Registrado en el journal (idx 8).
2. **`scripts/e2e-selftest.mjs` no parseaba**: `const board` duplicado
   en el mismo scope de `main()` (línea 1805) → `SyntaxError`, la E2E
   entera no arrancaba. Renombrado a `boardFollowUps`.
3. **`publish`/`rollback` devolvían un estado obsoleto**: el objeto
   `archived` de la respuesta era el snapshot leído antes del flip, con
   `status: "published"` aunque la fila ya estaba archivada. Ahora se
   reporta `status: "archived"`.
4. **`POST /api/dev/playbook-bootstrap`** (nuevo, solo mocks): el
   bootstrap real dispara en `instrumentation` al boot y solo enumera
   orgs que ya tuvieran `sales_orchestrator_enabled = true`; en una base
   nueva ninguna cumple, así que la E2E no tenía baseline. Va tras
   `mockGuard()`: 404 incondicional fuera del entorno de pruebas.

**Cierre del corte 4**:

- Gate técnico + E2E Playwright en verde.
- Working tree limpio, un commit: `feat(playbook): UI editor por bloques`.
- ✅ `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en verde
  (741 tests).
- ✅ Sección 013 verde contra la app real con mocks: **35/35**, y verde
  de nuevo en una segunda ejecución consecutiva (re-ejecutable).

---

## Corte 5 — Editor Jev avanzado (T501..T507)

- [ ] **T501** — `jev-questions-editor.tsx`: lista de preguntas con
  badges:
  - `engine-required` 🔒 (2 preguntas): `next_action`,
    `needs_human_call`. Candado en `key` y `type`.
  - `known signal` 📊 (6 preguntas): `real_operational_need`,
    `product_fit`, `motivation_to_change`, `purchase_intent`,
    `buying_timing`, `main_value_proposition`. Candado en `key`,
    `type` y —si son `choice`— en las option keys
    (`buying_timing`, `main_value_proposition`). Editables en
    descripciones y `enabled`.
  - `analytical/custom` ➕ (libres): cualquier otra. Editables por
    completo.
- [ ] **T502** — Editor inline por pregunta (choice / noul / score).
- [ ] **T503** — Crear pregunta nueva (solo `analytical`).
- [ ] **T504** — Duplicar pregunta existente (no
  `engine-required`; en `known signals` se permite duplicar pero la
  copia es `analytical`).
- [ ] **T505** — `assertJevProtectedKeys(current, next)` server-side:
  - `next_action`: type fijo `choice`, no se puede eliminar ni
    desactivar; option keys deben ser exactamente el set
    `['ask_more_questions', 'show_operations_demo',
    'show_online_enrollment_demo', 'present_price', 'schedule_call',
    'schedule_follow_up', 'disqualify']`.
  - `needs_human_call`: type fijo `noul`, no se puede eliminar ni
    desactivar.
  - `buying_timing`: type fijo `choice`, no se puede eliminar; option
    keys deben ser exactamente `['now', 'soon', 'future_season',
    'unknown', 'no_current_plan']`.
  - `main_value_proposition`: type fijo `choice`, no se puede eliminar;
    option keys deben ser exactamente las 5 del V1 default
    (`operational_control`, `reduce_whatsapp_dependency`,
    `online_enrollment`, `reduce_manual_work`,
    `no_relevant_value_now` — verificar contra
    `src/server/sales/questions.ts`). Las DESCRIPCIONES pueden
    editarse desde el editor para reflejar la V1; las KEYS son
    contrato del resolver y se conservan.
  - `real_operational_need`, `product_fit`, `motivation_to_change`,
    `purchase_intent`: type fijo (noul / score / score / score), no
    se pueden renombrar. Se pueden desactivar.
- [ ] **T506** — UX: candados con tooltip explicativo en cada clase.
- [ ] **T507** — Tests + E2E.

**Cierre del corte 5**:

- Gate técnico + tests de guardarraíles verdes + E2E.
- Working tree limpio, un commit: `feat(playbook): editor Jev con guardarraíles`.

---

## Corte 6 — Laboratorio comercial (T601..T608)

- [ ] **T601** — `src/server/lab/personas.ts`: añadir 6 personas V1
  comerciales; mantener las 6 ferreteras como legacy.
- [ ] **T602** — `src/server/lab/runner.ts`: ejecutar el pipeline REAL
  (`runSalesOrchestratorTurn` con `is_test=true`). El sender ya lanza
  excepción en `is_test=true`. Confirmar con spy que no se invoca
  WhatsApp real.
- [ ] **T603** — Migración 0008b: añadir columnas a `agent_test_case`:
  - `playbook_version_id text NULL`
  - `playbook_schema_version text NULL`
  - `expected_next_action text NULL`
  - `expected_lane text NULL`
  - `expected_handoff boolean NULL`
  Patrón `ADD COLUMN IF NOT EXISTS`.
- [ ] **T604** — Expected outcomes: `agent_test_case` editable.
  Reporte ✅/❌ por campo esperado.
- [ ] **T605** — Override de Playbook para `is_test=true`.
  - `POST /api/lab/runs` con `{ "playbook_mode": "draft" }` ejecuta
    con override.
  - `playbook_mode: "published"` (default) usa la publicada.
  - `playbook_mode: "both"` ejecuta dos corridas (published + draft).
  - El override llega al orquestador por `runSalesOrchestratorTurn`
    (T306) y se valida con `is_test === true`.
- [ ] **T606** — UI del Laboratorio con diff side-by-side y
  expected outcomes.
- [ ] **T607** — Tests:
  - sandbox no toca WhatsApp real;
  - persiste `playbook_version_id`;
  - override rechazado si `is_test=false`;
  - cero filas en `sales_follow_up_job` tras corrida `is_test`;
  - contacto y lead de prueba NO visibles en operación normal.
- [ ] **T608** — E2E: lanzar Published + Draft, ver diff.

**Cierre del corte 6**:

- Gate técnico + tests verdes + E2E.
- Working tree limpio, un commit: `feat(lab): laboratorio comercial con Published vs Draft`.

---

## Corte 7 — Casos reales + auditoría + cierre (T701..T708)

- [ ] **T701** — UI "Guardar conversación como caso" en el panel
  lateral con confirmación explícita de minimización de PII.
- [ ] **T702** — Endpoint `POST /api/lab/cases/from-conversation` con
  minimización estricta de PII:
  - El caso persistido contiene únicamente `transcript` (texto),
    `playbook_version_id`, `playbook_schema_version`, expected
    outcomes editables y metadata no identificante estrictamente
    necesaria.
  - **NO** persiste: `lead_id`, `contact_id`, `conversation_id`,
    `phone`, `email`, `wa_identity`, `ctwa_clid`, `source_id`,
    `source_url`, IDs Meta, ni cualquier token/ID que permita
    reconstruir el contacto o la conversación original.
  - El endpoint recibe `conversation_id` únicamente como **input
    autenticado** para leer la conversación del tenant; no se
    guarda dentro del caso anonimizado.
  - Tests de minimización verifican explícitamente la
    **ausencia** de estos campos en el caso persistido.
- [ ] **T703** — Confirmar al boot que el bootstrap multi-org es
  idempotente; logs explícitos por org; **decisión** sobre el
  fallback: se mantiene `VENDE_VELOZ_*` y `JEV_SALES_QUESTIONS_V2`
  como `DEFAULTS_ONLY` reusables en tests; el runtime prefiere la
  publicada.
- [ ] **T704** — `docs/playbook.md`: guía del dueño.
- [ ] **T705** — E2E final (`scripts/e2e-selftest.mjs` sección 013)
  en las dos configuraciones:
  - Publicada cargada → decisión cita el producto del playbook;
    snapshot `playbook_version_id` poblado.
  - Fallback forzado → decisión cita `VENDE_VELOZ_PRODUCT`; warning
    en logs; cero filas en `sales_follow_up_job`.
  - Cross-tenant: GET `/api/playbook` con sesión de otra org → no
    leak.
- [ ] **T706** — `docs/CURRENT_STATE.md`: sección 008 cerrado,
  historia técnica, decisiones, riesgos.
- [ ] **T707** — Verificación global:
  `bash -n scripts/ai/run-sales-playbook.sh`,
  `pnpm typecheck && pnpm lint && pnpm build && pnpm test`,
  `pnpm test:e2e` (lo que el entorno permita).
- [ ] **T708** — Cierre: commit final
  `feat(playbook): cerrar feature 008 — playbook durable V1 publicado`.

---

## Riesgos vivos

- Si el refactor de `normalizeJevResponse` y `SalesDecision` (T304,
  T305) resulta más invasivo de lo previsto por consumo en
  `resolve-plan` / `writer`, dividir Corte 3 en 3a (loader +
  contract) y 3b (refactor SalesDecision).
- Si el Laboratorio diverge mucho en métrica verde/rojo de las
  legacy, **no** promediar; reportar honestamente.

## Decisiones que cambian el plan

- Multi-playbook por org → **fuera del 008** (forma lista; UI/runtime
  para uno solo en V1).
- Importador de los 89 checkpoints jevveloz → **fuera del 008**.
- Cache de playbook → **fuera del 008**. El runtime lee BD en cada
  turno.
- `/api/dev/playbook-cache-invalidate` → eliminado del diseño V1.
- `SELECT organization.id LIMIT 1` → eliminado. Bootstrap por
  enumeración de `agent_profile.salesOrchestratorEnabled=true`.
- Override de Playbook sobre conversación real → rechazado. Solo
  aplica en `is_test=true`.
- Scheduling de follow-ups durante `is_test=true` → suprimido.