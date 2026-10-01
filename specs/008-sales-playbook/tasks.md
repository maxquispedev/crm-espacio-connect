# Tasks — 008 Sales Playbook

> Estado durable de la feature. Marcar `[x]` solo cuando el corte se haya
> cerrado en verde (gate técnico + self-test de su alcance + un commit).

## Convenciones

- `Txx` = id de tarea. Las dependencias bloquean: si `T205` depende de
  `T204`, ejecutar en orden.
- `**/**` = archivo creado o modificado; entre corchetes el alcance.
- Cada corte cierra con un único commit y working tree limpio.
- Cada tarea con `Pxxx` en la columna "Status" se actualiza al cerrarla.

---

## Corte 1 — Modelo y persistencia (T101..T109)

> Schema + migración + tipos + bootstrap. NO tocar runtime productivo.

- [x] **T101** — Leer auditoría del spec (`research.md`) y Drizzle
  schema actual (`src/lib/db/schema.ts`).
  Done in this commit.
- [x] **T102** — Agregar tablas `sales_playbook` y `sales_playbook_version`
  en `src/lib/db/schema.ts` con prefijos `sp_` / `spv_` (`src/lib/db/ids.ts`).
  Índices parciales UNIQUE para `draft`/`published` por `playbook_id`.
  - Columnas `last_jev_playbook_version_id` y `last_jev_playbook_schema_version`
    en `lead` (nullable; additive).
  - `drizzle/0008_sales_playbook.sql` generada y editada a mano con el
    patrón `IF NOT EXISTS` + `DO $$ … EXCEPTION WHEN duplicate_object THEN null $$`.
  - Migración re-ejecutable (correr dos veces sin error).
  Status: P0 (placeholder; este turno solo crea el SDD).

- [x] **T103** — `src/lib/sales/playbook/schema.ts` con Zod
  versionado. Exportar `ConfigV1Schema` (`schema_version: "1.0"`) y
  `parseConfigV1(input)`. Validación estricta: rechaza payloads que
  no cumplen, devuelve errores formateados.
  Status: P0.

- [x] **T104** — `src/lib/sales/playbook/v1.ts` con el contenido
  literal del Anexo V1 ("Vende Veloz 365 — Academia Bajo Control").
  Exportar `VENDE_VELOZ_PLAYBOOK_V1: ConfigV1` validado en build time
  con `ConfigV1Schema.parse(...)`.
  Status: P0.

- [x] **T105** — `src/lib/sales/playbook/store.ts`: funciones puras
  sobre BD con `scoped()`.
  - `getPlaybookForOrg(orgId)`
  - `getPublishedVersionForOrg(orgId)`
  - `getDraftVersionForOrg(orgId)`
  - `getVersionById(orgId, versionId)`
  - `listVersionsForOrg(orgId)`
  - `createDraft(orgId, fromPublished: boolean, notes, createdBy)`
  - `updateDraft(orgId, patch)`
  - `publishDraft(orgId, notes, publishedBy)`
  - `rollbackToVersion(orgId, versionId, notes, publishedBy)`
  Status: P0.

- [x] **T106** — `src/lib/sales/playbook/bootstrap.ts`: función
  `bootstrapOrgIfNeeded(orgId)` que:
  - Si no existe `sales_playbook` para la org Y `agent_profile.salesOrchestratorEnabled = true`,
    crea el playbook (slug="vende-veloz-365") y publica la V1.
  - Idempotente: re-ejecutable sin error.
  - Disparado en `instrumentation.ts` para cada org que cumple la condición
    (best-effort, no bloquea el boot).
  Status: P0.

- [x] **T107** — `tests/unit/playbook-schema.test.ts`: cobertura Zod
  (payloads válidos e inválidos, schema_version desconocido, preguntas
  estructurales faltantes, `next_action` con type incorrecto, tamaños
  máximos).
  Status: P0.

- [x] **T108** — `tests/unit/playbook-bootstrap.test.ts`: cobertura
  del bootstrap (idempotencia, solo si `salesOrchestratorEnabled`,
  contenido V1 correcto).
  Status: P0.

- [x] **T109** — `tests/unit/playbook-store.test.ts`: cobertura de
  `store` (CRUD, índices parciales UNIQUE, tenant isolation, rollback,
  publish concurrente).
  Status: P0.

**Cierre del corte 1**:

- `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en verde.
- Migración aplicada dos veces sin error.
- Bootstrap idempotente verificado en test unit.
- Working tree limpio, un commit: `feat(playbook): schema versionado + bootstrap V1`.

---

## Corte 2 — API + versionado (T201..T208)

- [x] **T201** — `app/api/playbook/route.ts` (GET): devuelve `playbook`,
  `published`, `draft`. 404 si la org no tiene playbook.
- [x] **T202** — `app/api/playbook/draft/route.ts` (POST): crea draft
  desde publicada (409 si ya hay draft).
- [x] **T203** — `app/api/playbook/draft/route.ts` (PUT): actualiza
  draft, valida Zod del documento entero post-patch.
- [x] **T204** — `app/api/playbook/validate/route.ts` (POST): valida
  sin persistir. Detalle de errores en `details[]`.
- [x] **T205** — `app/api/playbook/publish/route.ts` (POST):
  transacción atómica: archive + publish. `notes` requerido.
- [x] **T206** — `app/api/playbook/rollback/route.ts` (POST):
  republica archivada. Rechaza si `schema_version` desconocido sin
  migrador.
- [x] **T207** — `app/api/playbook/versions/route.ts` (GET) +
  `app/api/playbook/versions/[id]/route.ts` (GET): listado y detalle
  con `scoped()`.
- [x] **T208** — Tests de endpoints cubriendo:
  - Tenant isolation (cross-org).
  - Draft duplicado → 409.
  - Payload inválido → 422 con detalles.
  - Rollback cross-org → 404.
  - Publish concurrente → 409.

**Cierre del corte 2**:

- Gate técnico en verde.
- Self-test E2E manual contra `pnpm dev`: flujo publicar y rollback
  (ver `quickstart.md` §2..6).
- Working tree limpio, un commit: `feat(playbook): API draft/publish/rollback`.

---

## Corte 3 — Runtime (T301..T307)

- [x] **T301** — `src/lib/sales/playbook/loader.ts`: `getPublishedForOrg`,
  `getDraftForOrg`, `getConfigByVersionId`. Cache en memoria TTL 60s,
  invalidado en publish/rollback (`onPlaybookChange`).
- [x] **T302** — `src/server/sales/build-state.ts`: en `buildJevSalesState`,
  cargar la config publicada via loader y poblar `state.product` /
  `state.commercial_policy`. Si no hay publicada, fallback explícito a
  `VENDE_VELOZ_PRODUCT` / `VENDE_VELOZ_COMMERCIAL_POLICY` con
  `console.warn` (solo primera vez por proceso).
- [x] **T303** — `src/server/sales/writer.ts`: aceptar override
  `product`/`policy`/`offer` (ya estaba en la firma). Usar el override
  si llega; fallback a constantes si llega `null` (no rompe tests
  existentes). Reemplazar `nextActionInstruction(action)` para que
  use `writer[action]` del config (con fallback interno).
- [x] **T304** — `src/server/sales/follow-ups/follow-up-writer.ts`:
  mismo patrón. Usar override y leer `writer` por `next_action` cuando
  esté disponible (mapeo desde `reason`).
- [x] **T305** — `src/server/sales/orchestrator.ts`: resolver y pasar
  el config publicado al writer. Persistir en `lead`:
  - `last_jev_playbook_version_id`
  - `last_jev_playbook_schema_version`
  - Añadir `playbook_version_id`, `playbook_schema_version`,
    `playbook_version_number` al JSONB `last_jev_decision`.
- [x] **T306** — `src/server/ai/prompts.ts` (o punto de inyección
  equivalente): incluir `agent_profile.tone`, `instructions`,
  `escalationRules` en el system prompt del writer comercial cuando
  Sales Orchestrator está activo.
- [x] **T307** — Tests:
  - `tests/unit/playbook-fallback.test.ts` — sin published, fallback a
    constantes con warning una sola vez.
  - `tests/unit/playbook-snapshot.test.ts` — snapshot persiste
    `playbook_version_id` correctamente.
  - Regresión del Sales Orchestrator existente (`sales-orchestrator.test.ts`)
    en verde.

**Cierre del corte 3**:

- Gate técnico en verde.
- Self-test E2E: un inbound sintético + wa-mock + jev-mock + ai-mock →
  verificar en logs que el system prompt del writer cita el producto
  del playbook y que `lead.last_jev_playbook_version_id` está
  poblado.
- Working tree limpio, un commit: `feat(playbook): runtime consume playbook publicado`.

---

## Corte 4 — UI Playbook (T401..T407)

- [x] **T401** — Refactor `agent-client.tsx`: introducir `Tabs` (o
  equivalente) con `Comportamiento` / `Conocimiento` / `Sales
  Playbook` / `Sales Orchestrator` / `Seguimientos`. Mantener
  comportamiento actual.
- [x] **T402** — `components/agent/playbook/playbook-client.tsx`:
  contenedor. Refetch al montar, estados de carga, toaster de éxito.
- [x] **T403** — `components/agent/playbook/playbook-published-card.tsx`:
  muestra la versión publicada con `created_at`, `version_number`,
  `schema_version`, `notes`. Botón "Crear draft desde esta versión"
  (abre el editor).
- [x] **T404** — `components/agent/playbook/playbook-draft-editor.tsx`:
  editor por bloques (Producto, Oferta, Política, Prioridades,
  Writer, Prohibiciones, Handoff, Urgencia). Cada bloque es un
  formulario (NO JSON crudo). Validación cliente con feedback.
- [x] **T405** — `components/agent/playbook/playbook-versions-list.tsx`:
  historial de versiones, click → detalle + botón "Rollback a esta
  versión".
- [x] **T406** — Acciones: `Crear draft` → POST `/api/playbook/draft`.
  `Guardar cambios` → PUT `/api/playbook/draft` con `validate`
  cliente previo. `Publicar` → POST `/api/playbook/publish` con
  confirmación. `Rollback` → POST `/api/playbook/rollback` con
  confirmación y motivo.
- [x] **T407** — E2E UI (`tests/e2e/us-sales-playbook.md` + extensión
  de `scripts/e2e-selftest.mjs`): abrir tab Playbook → editar un
  campo del writer → guardar → publicar → ver historial.

**Cierre del corte 4**:

- Gate técnico + E2E Playwright en verde.
- Working tree limpio, un commit: `feat(playbook): UI editor por bloques`.

---

## Corte 5 — Editor Jev avanzado (T501..T507)

- [x] **T501** — `components/agent/playbook/jev-questions-editor.tsx`:
  lista de preguntas del `jev_questions`. Indicador visual de cuáles
  son **estructurales** (no editables en `key`/`type`) y cuáles son
  **analíticas** (flexibles).
- [x] **T502** — Para cada pregunta: edición de `instructions`,
  `criteria` (choice como tabla, score como lista, noul como true/false).
  Toggle `enabled`. Reordenar con flechas.
- [x] **T503** — Crear pregunta nueva: selector de tipo (`choice`,
  `noul`, `score`), key validada `^[a-z_]+$`, instrucciones
  iniciales. Se guarda como `analítica` (no se permite crear nuevas
  estructurales).
- [x] **T504** — Duplicar pregunta existente: copia con nuevo key
  sufijo `_copy`. No permite duplicar las estructurales.
- [x] **T505** — Server: `PUT /api/playbook/draft` valida que no se
  intenta cambiar `key` o `type` de las protegidas. Test dedicado.
- [x] **T506** — UX: las protegidas muestran un candado y tooltip
  explicando por qué. Las analíticas son editables libremente.
- [x] **T507** — E2E: cambiar criterio de `next_action`,
  desactivar `product_fit` (debe seguir permitiéndose porque no es
  protegida), crear pregunta analítica nueva.

**Cierre del corte 5**:

- Gate técnico + tests de guardarraíles verdes + E2E.
- Working tree limpio, un commit: `feat(playbook): editor Jev con guardarraíles`.

---

## Corte 6 — Laboratorio comercial (T601..T608)

- [x] **T601** — `src/server/lab/personas.ts`: añadir 6 personas V1
  comerciales (`academia_natacion_inicial`,
  `academia_consultora_presupuesto`, `academia_insatisfecha_otro`,
  `academia_temporada_alta_futuro`, `academia_con_multiples_sedes`,
  `academia_pregunta_fuera_contexto`). Cada una con script y
  contexto. Mantener las 6 ferreteras con prefijo `legacy_*` o
  aislarlas tras un flag (`legacyPersonas = true`).
- [x] **T602** — `src/server/lab/runner.ts`: ejecutar el pipeline
  REAL (`runSalesOrchestratorTurn` con `is_test=true`). El sender ya
  lanza excepción en `is_test=true`. Validar que no se invoca
  WhatsApp real (spy sobre `graphRequest`).
- [x] **T603** — Persistir `playbook_version_id` y
  `playbook_schema_version` por caso (columna nueva en `agent_test_case`
  vía migración aditiva 0008b o JSONB en `transcript`/`detalle`).
  Decisión en este corte: usar columnas dedicadas
  (`playbook_version_id`, `playbook_schema_version`).
- [x] **T604** — Expected outcomes humanos: extender `agent_test_case`
  con `expected_next_action`, `expected_lane`, `expected_handoff`
  (nullable). Setear en la corrida o manualmente.
- [x] **T605** — Comparación Published vs Draft: nueva ruta
  `POST /api/lab/runs` con `{ "playbook_mode": "draft" }` que
  ejecuta contra el draft activo. UI muestra diff por caso.
- [x] **T606** — UI del Laboratorio (`components/lab/lab-client.tsx`):
  selector de modo (Published / Draft / ambos), tabla comparativa
  por caso con tilde verde/rojo cuando hay expected outcomes.
- [x] **T607** — Tests del runner:
  - sandbox no toca WhatsApp real;
  - persiste `playbook_version_id`;
  - respetar fallback si no hay published.
- [x] **T608** — E2E: lanzar corrida Published + Draft, ver diff.

**Cierre del corte 6**:

- Gate técnico + tests verdes + E2E.
- Working tree limpio, un commit: `feat(lab): laboratorio comercial con Published vs Draft`.

---

## Corte 7 — Casos reales + bootstrap final + auditoría (T701..T708)

- [x] **T701** — UI "Guardar conversación como caso" en el panel
  lateral de la conversación. Botón con confirmación.
- [x] **T702** — Server minimiza PII: el caso persistido contiene
  `transcript` (textos del lead y del vendedor), `playbook_version_id`,
  `expected_next_action` (editable), `expected_lane` (editable).
  NO contiene `phone`, `email`, `wa_identity`, `ctwa_clid`, URLs.
- [x] **T703** — Confirmar al boot (instrumentation) que la org con
  `salesOrchestratorEnabled=true` tiene una versión publicada de la
  V1. Si no la tiene, log explícito. Decisión documentada en
  `docs/playbook.md` sobre el fallback: **mantener** los
  `VENDE_VELOZ_*` como `DEFAULTS_ONLY` reusables en tests; el
  runtime siempre prefiere la publicada.
- [x] **T704** — `docs/playbook.md`: guía del dueño (cómo crear
  draft, cómo publicar, cuándo rollback, qué hace el fallback).
- [x] **T705** — E2E final (`scripts/e2e-selftest.mjs` sección 012):
  flujo completo en las dos configuraciones:
  - Publicada cargada → decisión de Jev cita el producto del playbook.
  - Fallback (forzado borrando la publicada en test) → decisión cita
    `VENDE_VELOZ_PRODUCT` con warning.
  - Cross-tenant: GET `/api/playbook` con sesión de otra org no leak.
- [x] **T706** — `docs/CURRENT_STATE.md`: sección de specs cerrada,
  historia técnica, decisiones, riesgos conocidos.
- [x] **T707** — Verificación global: `bash -n scripts/ai/run-sales-playbook.sh`,
  `pnpm typecheck && pnpm lint && pnpm build && pnpm test`,
  `pnpm test:e2e` (lo que el entorno permita).
- [x] **T708** — Cierre: commit final
  `feat(playbook): cerrar feature 008 — playbook durable V1 publicado`.

---

## Riesgos vivos

- Si el Corte 3 tarda más de lo previsto por complejidad del loader,
  Cortar 6 y 7 en dos (experimentos de loader por separado).
- Si el Laboratorio V1 diverge mucho de las ferreteras en métrica
  verde/rojo, **no** intentar promediar; reportar honestamente y dejar
  al usuario decidir si las viejas siguen corriendo.

## Decisiones que cambian el plan

- Agregar `agent_profile` flag `playbookEnabled` (default true cuando
  `salesOrchestratorEnabled`) → no. El flag actual ya es suficiente.
- Multi-playbook por org → **fuera del 008**. La forma lo permite; no
  se expone UI ni runtime.
- Importador de los 89 checkpoints → **fuera del 008**. Documentado
  como follow-up.