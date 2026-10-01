# Research — 008 Sales Playbook

> Antes del spec. Investigación de las capas que se separan, de los
> callsites que tienen que cambiar, y de los puntos donde el runtime
> **realmente** debe ser configurable (no decorativo).

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

**Las option keys de las `choice` son contrato del resolver/writer**:

- `next_action`: 7 fijas (`ask_more_questions`,
  `show_operations_demo`, `show_online_enrollment_demo`,
  `present_price`, `schedule_call`, `schedule_follow_up`,
  `disqualify`). Verificado en `src/server/sales/serialize-ui.ts`
  (`NEXT_ACTIONS`) y en `src/server/sales/normalize.ts`
  (`isNextAction`, `isBuyingTiming`, `isMainValueProposition`).
- `buying_timing`: 5 fijas (`now`, `soon`, `future_season`,
  `unknown`, `no_current_plan`). Usada por `resolve-plan.ts`
  (branch `future_season` → `schedule_follow_up`) y por
  `follow-up-writer.ts` (línea de timing).
- `main_value_proposition`: 5 fijas del V1
  (`control_operativo`, `alumnos_apoderados`, `planes_ciclos`,
  `pagos_saldos`, `siguiente_ciclo`). Verificar contra
  `questions.ts` (criterios exactos).

### Instrucciones del writer

`src/server/sales/writer.ts` tiene `nextActionInstruction(action)` y
`HUMAN_HANDOFF_INSTRUCTION` quemadas. `src/server/sales/follow-ups/follow-up-writer.ts`
tiene `reasonInstruction(reason, attemptNumber)` y reglas duras en
el system prompt quemadas.

## 2. Callsites que consumen los congelados

| Archivo | Importa | Lo usa para |
|---|---|---|
| `src/server/sales/build-state.ts` | `VENDE_VELOZ_PRODUCT`, `VENDE_VELOZ_COMMERCIAL_POLICY` | `JevSalesState.product` / `.commercial_policy` |
| `src/server/sales/writer.ts` | `VENDE_VELOZ_PRODUCT`, `VENDE_VELOZ_COMMERCIAL_POLICY`, `VENDE_VELOZ_OFFER` | system prompt del writer |
| `src/server/sales/orchestrator.ts` | `VENDE_VELOZ_OFFER` | pasar al writer |
| `src/server/sales/follow-ups/follow-up-writer.ts` | los tres | system prompt del follow-up writer |
| `src/server/sales/normalize.ts` | `JEV_SALES_QUESTIONS_V2` | exige 8 answers; valida types y option keys |
| `src/server/sales/decision.ts` | tipos de los 8 fields | `SalesDecision` exige los 8 fields |
| `src/server/sales/resolve-plan.ts` | tipos | branch `future_season`; usa `buyingTiming.choice` |
| `src/server/sales/follow-ups/follow-up-writer.ts` | tipos | usa `mainValueProposition.choice`, `buyingTiming.choice` |
| `src/server/sales/serialize-ui.ts` | tipos | snapshot DTO con 5 fields |

**Acción Corte 3**: introducir overrides opcionales en cada uno
de esos firmas (`product?`, `policy?`, `offer?`, `questions?`) ya
está **hecho** en `WriteSalesReplyInput`, `WriteFollowUpInput` y
`JevEvaluateInput`. Falta:

1. Que el orquestador y el worker de follow-ups pasen los overrides.
2. Que `buildJevSalesState` los use.
3. Que `normalizeJevResponse` acepte `activeQuestions` y
   `knownSignalKeys`.
4. Que `SalesDecision` se vuelva nullable en los 6 known signals.
5. Que `resolve-plan` / `writer` / `follow-up-writer` /
   `serialize-ui` toleren `null`.

## 3. Por qué el runtime NO es decorativo

El bootstrap anterior proponía "el editor Jev puede
activar/desactivar/añadir preguntas" pero el motor seguía enviando
las 8 fijas a Jev y exigiendo las 8 en el normalizer. Eso era
**decorativo**. Esta versión rediseña el motor para que:

1. `buildJevSalesState` recibe el `config.jev_questions` del
   playbook publicado.
2. Calcula `activeQuestions = filterActive(jev_questions)` (todas
   con `enabled=true` excepto las `engine-required`, que
   adicionalmente deben estar presentes).
3. `evaluateJev({ state, questions: activeQuestions })` envía el
   set activo.
4. `normalizeJevResponse(raw, activeQuestions, knownSignalKeys)`
   sabe qué exigir y qué tolerar.
6. `SalesDecision` acepta campos nullable; los consumidores
   toleran `null`.

Este refactor está acotado al Corte 3 y es testeable de extremo a
extremo.

## 4. Agent Profile (ya existe)

`agent_profile`:

- `enabled`, `salesOrchestratorEnabled`, `salesFollowUpsEnabled`,
  `salesFollowUpTemplateId` (flags)
- `name`, `tone`, `instructions`, `escalationRules`, `greeting`
  (texto)

Hoy `tone`/`instructions`/`escalationRules` **no llegan al writer
comercial** (solo al agente inline legacy). El Corte 3 lo cablea.

## 5. Tres clases de preguntas Jev

Definidas en `spec.md` § "Contrato dinámico con Jev":

| Clase | Cantidad V1 | Inmutabilidad |
|---|---|---|
| `engine-required` | 2 (`next_action`, `needs_human_call`) | key, type, enabled, deleted fijos. Option keys (en `choice`) fijos. Descriptions editables. |
| `known signals` | 6 (`real_operational_need`, `product_fit`, `motivation_to_change`, `purchase_intent`, `buying_timing`, `main_value_proposition`) | key, type fijos. Option keys (en `choice`: `buying_timing`, `main_value_proposition`) fijos. Desactivables con fallback. |
| `analytical/custom` | libres | todas editables |

El refactor de `normalizeJevResponse` y `SalesDecision` vive en el
Corte 3 (T304–T305). El editor vive en el Corte 5 (T501–T507).

## 6. Fallbacks documentados para `known signals` ausentes

- `buying_timing === null` →
  `resolve-plan` trata como `"unknown"` (el branching
  `future_season` se omite). Writer omite la línea de timing.
- `main_value_proposition === null` → writer continúa sin ángulo
  específico.
- `real_operational_need === null` → resolver no usa la señal;
  no cambia el plan.
- `product_fit`, `motivation_to_change`, `purchase_intent` ===
  `null` → solo se guardan en BD para auditoría; no afectan el
  resolver.

En ningún caso la ausencia de una `known signal` rompe el turno.

## 7. Override de Playbook solo en `is_test=true`

```ts
type RunSalesOrchestratorTurnOpts = {
  playbookOverride?: { config, versionId, schemaVersion, versionNumber };
};

if (opts.playbookOverride && !conv.is_test) {
  throw new Error("playbook_override_forbidden_in_production");
}
```

- Producción: `playbookOverride === undefined`. Cero overhead.
- Laboratorio: override permitido; el flujo carga la versión
  solicitada por `playbook_mode`.

## 8. Patrón existente de migraciones re-ejecutables

`drizzle/0007_meta_capi.sql`:

` (revisado):

- `CREATE TABLE IF NOT EXISTS` para la tabla.
- `DO $$ BEGIN … ALTER TABLE … ADD CONSTRAINT … EXCEPTION WHEN
  duplicate_object THEN null $$` para FK.
- `CREATE INDEX IF NOT EXISTS` para índices.
- Bloques separados por `--> statement-breakpoint` (Drizzle).

Para los índices parciales UNIQUE en `sales_playbook_version`,
Drizzle genera SQL estándar; el patrón a mano es:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "sales_playbook_version_one_published"
  ON "sales_playbook_version" ("playbook_id")
  WHERE "status" = 'published';
```

Para `0008b` (ALTER `agent_test_case`), Postgres 9.6+ soporta
`ALTER TABLE … ADD COLUMN IF NOT EXISTS`.

## 9. Patrón existente de APIs tenant-safe

Todas las rutas usan `withAuth(session => ...)` y `scoped()`.
Para PUT/POST con Zod se usa `parseBody(req, zodSchema)`. Errores
uniformes con `apiError(status, code, message)`.

El patrón para endpoints de Playbook sigue siendo ese mismo.

## 10. Patrón de tests

`tests/unit/`:

- `vi.mock("@/lib/db", ...)` con un `thenableChain` que devuelve
  filas precargadas.
- `vi.mock("@/lib/ai", () => ({ chatJson: vi.fn() }))` para
  simulaciones de LLM.
- Snapshots de config en tests de bootstrap.

Para E2E, `tests/e2e/*.md` define los guiones;
`scripts/e2e-selftest.mjs` los automatiza con
`WA_MOCK_ENABLED=true`, `OPENROUTER_BASE_URL` → `ai-mock`,
`TYPESAFE_JEV_ENDPOINT` → `jev-mock`.

## 11. ¿Por qué separar columnas tipadas y no un `config_json` único?

Pro:

- SQL legible: SELECT de `product_json`, `offer_json`, etc. para
  queries específicas sin deserializar todo.
- Migraciones futuras más fáciles (alterar `product_json` sin
  tocar `writer_json`).
- Validación columna por columna con Zod `safeParse` (más
  rápido, mensajes más específicos).

Con:

- Tamaño total mayor en BD (mitigado: < 32 KB sigue siendo
  trivial).
- Más columnas en `INSERT/UPDATE`.

**Decisión**: columnas tipadas. La serialización final al estado
Jev sigue siendo un objeto único (igual que el actual).

## 12. ¿Por qué mantener `VENDE_VELOZ_*` como DEFAULTS_ONLY?

Pro:

- El motor tiene un fallback **explícito y testeado**.
- Los tests que asumen config congelado siguen funcionando.
- La migración es gradual: nadie tiene que migrar config a
  mano.

Con:

- Una fuente más de "verdad" que mantener sincronizada con la V1.

**Mitigación**: tests snapshot comparan `VENDE_VELOZ_*` ↔
`v1.ts` y rompen el CI si se desincronizan.

## 13. ¿Por qué SIN cache en V1?

- Volumen actual bajo (decenas de turnos/turno, no miles).
- Jev + writer cuestan muchísimo más que un SELECT directo.
- Publish/rollback con efecto inmediato importa más que microoptimizar.
- Consistencia después de editar/publicar es lo crítico.

Optimización futura (LRU/TTL/invalidación) solo si métricas lo
exigen.

## 14. ¿Por qué el override es exclusivo de `is_test`?

- Producción NUNCA debe aceptar override: la fuente de verdad es
  SIEMPRE la publicada.
- El Laboratorio es el único caso donde se quiere probar una
  versión distinta (Draft, archivada) sin publicarla.
- El override como `if (override && !is_test) throw` es un
  guardrail simple y testeable.

## 15. Decisiones abiertas que NO entraron en este spec

- Multi-playbook por organización con asignación por conversación.
- Versionado por canal (WhatsApp hoy, quizá Instagram mañana).
- Importador de los 89 checkpoints históricos.
- Editor visual de workflows.
- Cache de playbook en runtime.

Quedan fuera del 008.