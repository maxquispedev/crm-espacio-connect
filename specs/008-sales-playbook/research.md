# Research — 008 Sales Playbook

> Antes del spec. Investigación de las capas que se separan y de los
> callsites que tienen que cambiar.

## 1. Lo que está congelado en TS hoy (auditoría mínima)

### Producto y política comercial

`src/server/sales/vende-veloz.ts` exporta:

| Constante | Forma | Lo que hace |
|---|---|---|
| `VENDE_VELOZ_PRODUCT` | `as const` con `name`, `one_liner`, `who_it_is_for`, `core_jobs`, `not_the_product`, `how_it_starts`, `implementation.{price,kind,includes,does_not_include}`, `subscription.{price,includes_active_students,extra_active_student,active_student_means}` | Inyectado en `JevSalesState.product` y referenciado en prompts del writer y del follow-up writer. |
| `VENDE_VELOZ_COMMERCIAL_POLICY` | `as const` con `default_channel`, `goal`, `automation_first`, `auto_close`, `human_handoff`, `future_interest`, `no_response`, `disqualification`, `evidence_rule` | Inyectado en `JevSalesState.commercial_policy` y referenciado en prompts del writer. |
| `VENDE_VELOZ_OFFER` | `as const` con `currency`, `setup`, `monthlyBase`, `includedActiveStudents`, `extraPerActiveStudent`, `setupIsOneTime`, `implementation.{purpose,includes}`, `neverPromise` | Solo ayuda del writer/CRM. No entra al state de Jev. |

### Preguntas de Jev

`src/server/sales/questions.ts` exporta `JEV_SALES_QUESTIONS_V2`:
8 preguntas congeladas (`real_operational_need`, `product_fit`,
`motivation_to_change`, `purchase_intent`, `buying_timing`,
`main_value_proposition`, `next_action`, `needs_human_call`).

### Instrucciones del writer

`src/server/sales/writer.ts` tiene `nextActionInstruction(action)` y
`HUMAN_HANDOFF_INSTRUCTION` quemadas. `src/server/sales/follow-ups/follow-up-writer.ts`
tiene `reasonInstruction(reason, attemptNumber)` y reglas duras en el
system prompt quemadas.

## 2. Callsites que consumen los congelados

| Archivo | Importa | Lo usa para |
|---|---|---|
| `src/server/sales/build-state.ts` | `VENDE_VELOZ_PRODUCT`, `VENDE_VELOZ_COMMERCIAL_POLICY` | `JevSalesState.product` / `.commercial_policy` |
| `src/server/sales/writer.ts` | `VENDE_VELOZ_PRODUCT`, `VENDE_VELOZ_COMMERCIAL_POLICY`, `VENDE_VELOZ_OFFER` | system prompt del writer |
| `src/server/sales/orchestrator.ts` | `VENDE_VELOZ_OFFER` | pasar al writer |
| `src/server/sales/follow-ups/follow-up-writer.ts` | los tres | system prompt del follow-up writer |
| `src/lib/types.ts` | ninguno (los tipos son inferidos) | reexporta |

**Acción Corte 3**: introducir overrides opcionales en cada uno de esos
firmas (`product?`, `policy?`, `offer?`) ya está **hecho** en
`WriteSalesReplyInput` y `WriteFollowUpInput`. Solo falta que el
orquestador y el worker de follow-ups pasen los overrides desde el
loader, y que `buildJevSalesState` los use.

## 3. Agent Profile (ya existe)

`agent_profile`:

- `enabled`, `salesOrchestratorEnabled`, `salesFollowUpsEnabled`,
  `salesFollowUpTemplateId` (flags)
- `name`, `tone`, `instructions`, `escalationRules`, `greeting` (texto)

Hoy `tone`/`instructions`/`escalationRules` **no llegan al writer
comercial** (solo al agente inline legacy). El Corte 3 lo cablea.

## 4. Patrón existente de migraciones re-ejecutables

`drizzle/0007_meta_capi.sql` (revisado):

- `CREATE TABLE IF NOT EXISTS` para la tabla.
- `DO $$ BEGIN … ALTER TABLE … ADD CONSTRAINT … EXCEPTION WHEN
  duplicate_object THEN null $$` para FK.
- `CREATE INDEX IF NOT EXISTS` para índices.
- Bloques separados por `--> statement-breakpoint` (Drizzle).

Para los índices parciales UNIQUE en `sales_playbook_version`, Drizzle
genera SQL estándar; el patrón a mano es:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "sales_playbook_version_one_published"
  ON "sales_playbook_version" ("playbook_id")
  WHERE "status" = 'published';
```

## 5. Patrón existente de APIs tenant-safe

Todas las rutas usan `withAuth(session => ...)` y `scoped(...)`. Para
PUT/POST con Zod se usa `parseBody(req, zodSchema)`. Errores uniformes
con `apiError(status, code, message)`.

El patrón para endpoints de Playbook sigue siendo ese mismo.

## 6. Patrón de tests

`tests/unit/`:

- `vi.mock("@/lib/db", ...)` con un `thenableChain` que devuelve filas
  precargadas.
- `vi.mock("@/lib/ai", () => ({ chatJson: vi.fn() }))` para
  simulaciones de LLM.
- Snapshots de config en tests de bootstrap.

Para E2E, `tests/e2e/*.md` define los guiones; `scripts/e2e-selftest.mjs`
los automatiza con `WA_MOCK_ENABLED=true`, `OPENROUTER_BASE_URL` →
`ai-mock`, `TYPESAFE_JEV_ENDPOINT` → `jev-mock`.

## 7. ¿Por qué separar columnas tipadas y no un `config_json` único?

Pro:

- SQL legible: SELECT de `product_json`, `offer_json`, etc. para queries
  específicas sin deserializar todo.
- Migraciones futuras más fáciles (alterar `product_json` sin tocar
  `writer_json`).
- Validación columna por columna con Zod `safeParse` (más rápido,
  mensajes más específicos).

Con:

- Tamaño total mayor en BD (mitigado: < 32 KB sigue siendo trivial).
- Más columnas en `INSERT/UPDATE`.

**Decisión**: columnas tipadas. La serialización final al estado Jev
sigue siendo un objeto único (igual que el actual).

## 8. ¿Por qué mantener `VENDE_VELOZ_*` como DEFAULTS_ONLY?

Pro:

- El motor tiene un fallback **explícito y testeado**.
- Los tests que asumen config congelado siguen funcionando.
- La migración es gradual: nadie tiene que migrar config a mano.

Con:

- Una fuente más de "verdad" que mantener sincronizada con la V1.

**Mitigación**: tests snapshot comparan
`VENDE_VELOZ_*` ↔ `v1.ts` y rompen el CI si se desincronizan.

## 9. ¿Por qué el cache del loader tiene TTL 60s?

- Balance entre invalidación al cambiar versión y latencia de BD.
- La frecuencia de cambio de playbook es humana (no automat); 60s es
  aceptable.
- Invalidación explícita en publish/rollback.

## 10. Decisiones abiertas que NO entraron en este spec

- Multi-playbook por organización con asignación por conversación.
- Versionado por canal (WhatsApp hoy, quizá Instagram mañana).
- Importador de los 89 checkpoints históricos.
- Editor visual de workflows.

Quedan fuera del 008.