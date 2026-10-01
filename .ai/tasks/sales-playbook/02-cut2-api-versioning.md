# CUT 2 — Sales Playbook: API + versionado

Lee obligatoriamente, en este orden:

- AGENTS.md
- `.specify/memory/constitution.md`
- `docs/CURRENT_STATE.md`
- `specs/008-sales-playbook/spec.md`
- `specs/008-sales-playbook/plan.md`
- `specs/008-sales-playbook/tasks.md`
- `specs/008-sales-playbook/contracts/playbook-api.md`
- `specs/008-sales-playbook/data-model.md`
- `src/lib/sales/playbook/store.ts` (creado en Corte 1)
- `src/lib/sales/playbook/schema.ts`
- `src/app/api/agent/profile/route.ts` (referencia de patrón API)
- `src/lib/api.ts` (`withAuth`, `apiError`, `parseBody`)
- tests existentes de APIs tenant-safe

Objetivo único:

implementar T201–T208 del Corte 2. Endpoints REST tenant-safe para
draft/update/validate/publish/rollback/list. Sin tocar runtime.
Sin tocar UI.

Tareas concretas:

1. **T201** — `src/app/api/playbook/route.ts` (GET).
   - `withAuth(session => ...)`.
   - Cargar `playbook` (puede ser null), `published` (puede ser null),
     `draft` (puede ser null).
   - Si los tres son null → 404 `not_found`.
   - 200 con `{ playbook, published, draft }`.

2. **T202** — `src/app/api/playbook/draft/route.ts` (POST).
   - Body: `{ notes?: string }`.
   - Llama a `store.createDraft(session.organizationId, fromPublished=true, notes, session.user.id)`.
   - 201 con `{ draft }`.
   - 409 `draft_already_open` si ya hay draft.
   - 422 `no_published_baseline` si no hay publicada y el caller pasó
     `from_published: true`. (En V1 el caller no puede forzar false —
     siempre se crea desde la publicada o desde la V1 default si no
     hay publicada.)

3. **T203** — `src/app/api/playbook/draft/route.ts` (PUT).
   - Body: patch parcial:
     ```ts
     {
       product?: ProductV1 | null;
       offer?: OfferV1 | null;
       commercial_policy?: PolicyV1 | null;
       priorities?: PrioritiesV1 | null;
       writer?: WriterV1 | null;
       jev_questions?: Record<string, QuestionV1> | null;
       prohibitions?: ProhibitionsV1 | null;
       handoff?: HandoffV1 | null;
       urgency_rules?: string | null;
       notes?: string | null;
     }
     ```
   - Cargar draft actual, mergear patch, validar `ConfigV1Schema.parse(merged)`.
   - Si validación falla → 422 con `details[]`.
   - 404 `no_draft` si no hay draft activo.
   - 200 con `{ draft }`.

4. **T204** — `src/app/api/playbook/validate/route.ts` (POST).
   - Body: documento entero.
   - `ConfigV1Schema.safeParse(body)`:
     - 200 `{ ok: true }` si pasa.
     - 422 `validation_failed` con `details[]` mapeados de
       `error.issues`.

5. **T205** — `src/app/api/playbook/publish/route.ts` (POST).
   - Body: `{ notes: string }`. `notes` requerido (≥ 3 chars).
   - Transacción atómica con `store.publishDraft(...)`.
   - 200 con `{ published, archived }`. Si no había publicada antes,
     `archived` es null.
   - 404 `no_draft` si no hay draft.
   - 409 si por concurrencia otro caller ya publicó.

6. **T206** — `src/app/api/playbook/rollback/route.ts` (POST).
   - Body: `{ version_id: string, notes: string }`.
   - Cargar la versión objetivo; si `schema_version` no es "1.0",
     rechazar con 422 `unknown_schema_version` salvo que exista
     migrador registrado (en V1 solo "1.0" es válido).
   - Transacción atómica con `store.rollbackToVersion(...)`.
   - 200 con `{ published, archived }`.
   - 404 si la versión no pertenece a la org.

8. **T207** — Listado y detalle.
   - `src/app/api/playbook/versions/route.ts` (GET): lista resumida
     `{ id, version_number, schema_version, status, notes, created_at,
     published_at, archived_at, size_bytes }`. Orden
     `version_number DESC`.
   - `src/app/api/playbook/versions/[id]/route.ts` (GET): detalle
     completo.

9. **T208** — Tests:
   - `tests/unit/playbook-api.test.ts`:
     - tenant isolation (cross-org);
     - draft duplicado → 409;
     - payload inválido → 422 con `details[]`;
     - rollback cross-org → 404;
     - publish concurrente → 409 (mock store con mutex).
     - GET `/api/playbook` cuando no hay playbook → 404.
     - GET `/api/playbook` con sesión OK → 200.

Restricciones:

- **NO** crear UI todavía.
- **NO** cambiar runtime ni tests existentes.
- **NO** añadir lógica de cache (eso es Corte 3).
- Todas las APIs usan `withAuth` y `scoped()`. Ningún path directo a BD.

Verificación:

- `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en verde.
- Self-test E2E manual contra `pnpm dev` con mocks:
  - `GET /api/playbook` → 200 con V1.
  - `POST /api/playbook/draft` → 201.
  - `POST /api/playbook/draft` otra vez → 409.
  - `PUT /api/playbook/draft` con writer inválido → 422 con detalles.
  - `POST /api/playbook/publish` → 200.
  - `POST /api/playbook/rollback` con version_id de la V1 → 200.
  - GET cross-org (cookie de otra org) → solo ve sus propias versiones.
- `tests/unit/playbook-api.test.ts` verde.

Cierre:

- `tasks.md`: T201–T208 marcados con evidencia.
- Working tree limpio.
- Un commit:
  `feat(playbook): API draft/publish/rollback`

NO empieces Corte 3.