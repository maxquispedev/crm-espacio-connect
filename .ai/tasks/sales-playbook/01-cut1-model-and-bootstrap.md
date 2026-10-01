# CUT 1 — Sales Playbook: modelo + persistencia + bootstrap V1 multi-org

Lee obligatoriamente, en este orden:

- AGENTS.md
- `.specify/memory/constitution.md`
- `docs/CURRENT_STATE.md`
- `docs/sdd-workflow.md`
- `specs/008-sales-playbook/spec.md`
- `specs/008-sales-playbook/plan.md`
- `specs/008-sales-playbook/tasks.md`
- `specs/008-sales-playbook/research.md`
- `specs/008-sales-playbook/data-model.md`
- `specs/008-sales-playbook/contracts/playbook-config.md`
- `docs/SALES_ORCHESTRATOR.md`
- `src/server/sales/vende-veloz.ts` (referencia de la V1 a sembrar)
- `src/server/sales/questions.ts` (option keys de `next_action`,
  `buying_timing`, `main_value_proposition` son contrato del
  resolver/writer)
- `src/server/sales/build-state.ts`
- `src/server/sales/writer.ts`
- `src/server/sales/follow-ups/follow-up-writer.ts`
- `src/server/sales/normalize.ts` (qué exige el normalizer hoy)
- `src/server/sales/decision.ts` (`SalesDecision` actual)
- `src/server/sales/resolve-plan.ts` (qué usa `buyingTiming.choice`)
- `src/lib/db/schema.ts`
- `src/lib/db/ids.ts`
- `drizzle/0007_meta_capi.sql` (patrón de migración
  re-ejecutable)
- tests unitarios relevantes

Objetivo único:

implementar T101–T109 del Corte 1. Persistencia + tipos Zod +
bootstrap multi-org determinista. NO tocar runtime productivo. NO
cambiar la firma de ninguna función existente del Sales
Orchestrator.

Tareas concretas:

1. **T102** — Schema y migración.
   - Agregar tablas `sales_playbook` y `sales_playbook_version`
     en `src/lib/db/schema.ts` con prefijos `sp_` y `spv_`
     (registrar en `src/lib/db/ids.ts`).
   - Índices parciales UNIQUE: uno para `status='published'` por
     `playbook_id`, otro para `status='draft'` por `playbook_id`.
   - Agregar columnas `last_jev_playbook_version_id` y
     `last_jev_playbook_schema_version` (ambas nullable, additive)
     en `lead`.
   - Generar y editar a mano la migración
     `drizzle/0008_sales_playbook.sql` con el patrón
     `IF NOT EXISTS` + `DO $$ … EXCEPTION WHEN duplicate_object
     THEN null $$`. Debe ser **re-ejecutable** (correr dos veces
     sin error). Usar `--> statement-breakpoint` entre sentencias.

2. **T103** — `src/lib/sales/playbook/schema.ts`.
   - Definir el Zod versionado tal cual `data-model.md` § "Config
     shape (schema_version 1.0)".
   - Exportar `ConfigV1Schema` (z.object con
     `schema_version: literal("1.0")`).
   - Exportar `parseConfigV1(input)`. Devuelve
     `{ ok: true, data }` o
     `{ ok: false, error }` con
     `details: { path: (string|number)[], message: string, code: string }[]`.
   - **Guardarraíles Jev** vía `superRefine`:
     - `engine-required` (`next_action`, `needs_human_call`):
       presencia obligatoria, `type` exacto, `enabled = true`,
       no eliminables.
     - `next_action.criteria` debe contener **exactamente** las 7
       option keys:
       `['ask_more_questions', 'show_operations_demo',
       'show_online_enrollment_demo', 'present_price',
       'schedule_call', 'schedule_follow_up', 'disqualify']`.
     - `buying_timing.criteria` debe contener **exactamente** las 5
       option keys:
       `['now', 'soon', 'future_season', 'unknown',
       'no_current_plan']`.
     - `main_value_proposition.criteria` debe contener
       **exactamente** las 5 option keys del V1 (verificar contra
       `src/server/sales/questions.ts`).
     - `analytical/custom` (cualquier otra key) son libres
       siempre que cumplan el regex `^[a-z_]+$` (≤ 60 chars).

4. **T104** — `src/lib/sales/playbook/v1.ts`.
   - Exportar `VENDE_VELOZ_PLAYBOOK_V1: ConfigV1` validado en
     build time con `ConfigV1Schema.parse(...)`.
   - Contenido exacto del Anexo V1 en `data-model.md`.
   - El texto completo de las instrucciones del writer debe ser
     el definido en el brief del usuario (no resumido). Si una
     sección requiere texto extenso (más de 1500 chars por el
     límite del schema), partir en dos oraciones separadas por
     `\n\n`.

5. **T105** — `src/lib/sales/playbook/store.ts`.
   - Funciones puras sobre BD con `scoped()`:
     - `getPlaybookForOrg(orgId)`
     - `getPublishedVersionForOrg(orgId)`
     - `getDraftVersionForOrg(orgId)`
     - `getVersionById(orgId, versionId)`
     - `listVersionsForOrg(orgId)`
     - `createDraft(orgId, notes, createdBy)`
     - `updateDraft(orgId, patch)`
     - `publishDraft(orgId, notes, publishedBy)`
     - `rollbackToVersion(orgId, versionId, notes, publishedBy)`
     - `loadActiveQuestionsForVersion(versionId, schema_version)`:
       para usar desde el loader runtime. **Sin cache.**
   - Para `publishDraft`: transacción atómica:
     1. archive el `published` actual (UPDATE … SET
        status='archived', archived_at=now());
     2. UPDATE el draft → status='published',
        published_at=now(), published_by.
   - Para `rollbackToVersion`: equivalente, pero en lugar de
     actualizar el draft se republica una versión existente.
   - Para `createDraft`: INSERT con
     `version_number = max + 1` por `playbook_id`. Si ya hay
     draft, lanzar `DraftAlreadyOpenError`.
   - Todas las funciones deben usar `scoped()` y respetar UNIQUE
     parcial (`draft` y `published` únicos).

6. **T106** — `src/lib/sales/playbook/bootstrap.ts`. **MULTI-ORG
   DETERMINISTA, sin "primera org".**
   - `bootstrapAllEnabledOrgs(): Promise<{ created: string[];
     skipped: string[] }>`:
     1. `SELECT organization_id FROM agent_profile WHERE
        sales_orchestrator_enabled = true` (query explícita).
     2. Para cada `orgId` único, llamar a
        `bootstrapOrgIfNeeded(orgId)`.
   - `bootstrapOrgIfNeeded(orgId)`: siembra solo si NO existe
     `sales_playbook` para esa org. Crea el playbook
     (slug="vende-veloz-365") y publica la V1.
   - Idempotente: re-ejecutable sin error.
   - Disparar en `instrumentation.ts` con
     `await bootstrapAllEnabledOrgs()` best-effort
     (try/catch + log por org, no bloquea el boot).

7. **T107–T109** — Tests:
   - `tests/unit/playbook-schema.test.ts`:
     - payload completo válido → ok;
     - schema_version incorrecto → fail;
     - `next_action` sin type "choice" → fail con detalle;
     - `needs_human_call` sin type "noul" → fail con detalle;
     - `next_action` con `enabled = false` → fail con
       `code: 'engine_required_disabled'`;
     - `next_action.criteria` con key extra (`extra_option`) →
       fail con `code: 'choice_keys_mismatch'`;
     - `buying_timing.criteria` con key renombrada (`soon_renamed`)
       → fail con `code: 'choice_keys_mismatch'`;
     - `main_value_proposition.criteria` con key fuera del set V1
       → fail;
     - tamaños máximos respetados
       (writer.instruction > 1500 → fail);
     - `priorities.primary` vacío → fail.
   - `tests/unit/playbook-bootstrap.test.ts`: **multi-org
     determinista**:
     - 2 orgs con `salesOrchestratorEnabled=true` → ambas reciben
       su V1, cada una con su propio `playbook_id` /
       `version_id`. Tests confirman que NO hay cruce de
       `organization_id`.
     - 1 org enabled + 1 disabled → solo la enabled se siembra.
     - Segunda ejecución del bootstrap → cero duplicados.
     - **NO** usar `LIMIT 1` en ningún punto; usar enumeración
       explícita.
   - `tests/unit/playbook-store.test.ts`: CRUD, índices parciales
     UNIQUE, tenant isolation (cross-org → null), rollback,
     publish concurrente.

Restricciones duras:

- **NO** cambiar runtime (`build-state.ts`, `writer.ts`, etc.).
- **NO** modificar `VENDE_VELOZ_*` salvo para renombrar
  documentado.
- **NO** añadir endpoints (eso es Corte 2).
- **NO** tocar `agent_profile` schema.
- **NO** introducir dependencias nuevas.
- **NO** `SELECT organization.id LIMIT 1`. Enumerar
  explícitamente por `agent_profile.salesOrchestratorEnabled=true`.

Verificación:

- `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en
  verde.
- Migración aplicada dos veces sin error (test manual).
- Tests nuevos verdes.
- Snapshot test: `ConfigV1Schema.parse(VENDE_VELOZ_PLAYBOOK_V1)` no
  lanza.

Cierre:

- Actualizar `tasks.md` marcando T101–T109 con evidencia real
  (no usar `Status: P0`; usar `✅ done` solo cuando esté cerrado
  en este corte).
- Working tree limpio.
- Un commit con mensaje:
  `feat(playbook): schema versionado + bootstrap V1`

NO empieces Corte 2.