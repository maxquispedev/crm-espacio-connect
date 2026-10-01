# CUT 1 — Sales Playbook: modelo + persistencia + bootstrap V1

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
- `src/server/sales/questions.ts`
- `src/server/sales/build-state.ts`
- `src/server/sales/writer.ts`
- `src/server/sales/follow-ups/follow-up-writer.ts`
- `src/lib/db/schema.ts`
- `src/lib/db/ids.ts`
- `drizzle/0007_meta_capi.sql` (patrón de migración re-ejecutable)
- tests unitarios relevantes

Objetivo único:

implementar T101–T109 del Corte 1. Persistencia + tipos + bootstrap
V1. NO tocar runtime productivo. NO cambiar la firma de ninguna
función existente del Sales Orchestrator.

Tareas concretas:

1. **T102** — Schema y migración.
   - Agregar tablas `sales_playbook` y `sales_playbook_version` en
   `src/lib/db/schema.ts` con prefijos `sp_` y `spv_` (registrar en
   `src/lib/db/ids.ts`).
   - Índices parciales UNIQUE: uno para `status='published'` por
     `playbook_id`, otro para `status='draft'` por `playbook_id`.
   - Agregar columnas `last_jev_playbook_version_id` y
     `last_jev_playbook_schema_version` (ambas nullable, additive) en
     `lead`.
   - Generar y editar a mano la migración `drizzle/0008_sales_playbook.sql`
     con el patrón `IF NOT EXISTS` + `DO $$ … EXCEPTION WHEN
     duplicate_object THEN null $$`. Debe ser **re-ejecutable**
     (correr dos veces sin error). Usar `--> statement-breakpoint`
     entre sentencias.

2. **T103** — `src/lib/sales/playbook/schema.ts`.
   - Definir el Zod versionado tal cual `data-model.md` § "Config shape
     (schema_version 1.0)".
   - Exportar `ConfigV1Schema` (z.object con `schema_version: literal("1.0")`).
   - Exportar `parseConfigV1(input)`. Devuelve `{ ok: true, data }` o
     `{ ok: false, error }` con `details: { path: (string|number)[], message: string }[]`.
   - **Guardarraíl Jev**: `next_action` debe tener `type: "choice"` y
     `needs_human_call` debe tener `type: "noul"`. Si falla, el Zod rechaza
     con path `["jev_questions", "<key>", "type"]`.

3. **T104** — `src/lib/sales/playbook/v1.ts`.
   - Exportar `VENDE_VELOZ_PLAYBOOK_V1: ConfigV1` validado en build
     time con `ConfigV1Schema.parse(...)`.
   - Contenido exacto del Anexo V1 en `data-model.md`.
   - El texto completo de las instrucciones del writer debe ser el
     definido en el brief del usuario (no resumido). Si una sección
     requiere texto extenso (más de 1500 chars por el límite del
     schema), partir en dos oraciones separadas por `\n\n`.

4. **T105** — `src/lib/sales/playbook/store.ts`.
   - Funciones puras sobre BD con `scoped()`:
     - `getPlaybookForOrg(orgId): Promise<{ id, slug, label, ... } | null>`
     - `getPublishedVersionForOrg(orgId): Promise<Version | null>`
     - `getDraftVersionForOrg(orgId): Promise<Version | null>`
     - `getVersionById(orgId, versionId): Promise<Version | null>`
     - `listVersionsForOrg(orgId): Promise<VersionSummary[]>`
     - `createDraft(orgId, fromPublished: boolean, notes, createdBy)`
     - `updateDraft(orgId, patch)`
     - `publishDraft(orgId, notes, publishedBy)`
     - `rollbackToVersion(orgId, versionId, notes, publishedBy)`
   - Para `publishDraft`: transacción atómica:
     1. archive el `published` actual (UPDATE … SET status='archived', archived_at=now());
     2. UPDATE el draft → status='published', published_at=now(),
        published_by.
   - Para `rollbackToVersion`: equivalente, pero en lugar de
     actualizar el draft se republica una versión existente.
   - Para `createDraft`: INSERT con `version_number = max + 1` por
     `playbook_id`. Si ya hay draft, lanzar `DraftAlreadyOpenError`.
   - Todas las funciones deben usar `scoped()` y respetar UNIQUE
     parcial (`draft` y `published` únicos).

5. **T106** — `src/lib/sales/playbook/bootstrap.ts`.
   - `bootstrapOrgIfNeeded(orgId): Promise<{ created: boolean, version_id?: string }>`
   - Lógica:
     1. SELECT `agent_profile` WHERE org_id = `orgId`.
     2. Si `salesOrchestratorEnabled !== true` → return `{ created: false }`.
     3. SELECT `sales_playbook` WHERE org_id = `orgId`.
     4. Si ya existe → return `{ created: false }`.
     5. INSERT `sales_playbook` (slug="vende-veloz-365").
     6. INSERT `sales_playbook_version` con
        `version_number=1`, `status='published'`, config = V1,
        `published_at=now()`, `published_by='bootstrap'`,
        `notes='V1 sembrada por bootstrap — Academia Bajo Control'`.
   - Idempotente: re-ejecutable sin error.
   - Llamar desde `instrumentation.ts` para cada org que cumpla la
     condición (best-effort, no bloquea el boot). Detectar orgs:
     `SELECT organization.id … LIMIT 1` o usar `scoped()` con el
     contexto actual. Si no hay sesión activa, no hacer nada.

6. **T107–T109** — Tests:
   - `tests/unit/playbook-schema.test.ts`: V1
     - payload completo válido → ok;
     - schema_version incorrecto → fail;
     - `next_action` sin type "choice" → fail con detalle;
     - `needs_human_call` sin type "noul" → fail con detalle;
     - tamaños máximos respetados (writer.instruction > 1500 → fail);
     - priorities.primary vacío → fail.
   - `tests/unit/playbook-bootstrap.test.ts`: idempotencia + solo si
     `salesOrchestratorEnabled` + contenido V1 correcto.
   - `tests/unit/playbook-store.test.ts`: CRUD, índices parciales
     UNIQUE, tenant isolation (cross-org → null), rollback, publish
     concurrente.

Restricciones duras:

- **NO** cambiar runtime (`build-state.ts`, `writer.ts`, etc.).
- **NO** modificar `VENDE_VELOZ_*` salvo para renombrar documentado.
- **NO** añadir endpoints (eso es Corte 2).
- **NO** tocar `agent_profile` schema.
- **NO** introducir dependencias nuevas.

Verificación:

- `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en verde.
- Migración aplicada dos veces sin error (test manual).
- Tests nuevos verdes.
- Snapshot test: `ConfigV1Schema.parse(VENDE_VELOZ_PLAYBOOK_V1)` no
  lanza.

Cierre:

- Actualizar `tasks.md` marcando T101–T109 con evidencia real.
- Working tree limpio.
- Un commit con mensaje:
  `feat(playbook): schema versionado + bootstrap V1`

NO empieces Corte 2.