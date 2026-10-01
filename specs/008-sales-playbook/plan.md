# Implementation Plan: 008 — Sales Playbook versionado

**Branch**: `008-sales-playbook` | **Date**: 2026-09-30 | **Spec**: [spec.md](./spec.md)
**Estado**: **PLANIFICADA / NO IMPLEMENTADA** · **Carril**: **ciclo
completo** (Principio VI) — toca el modelo de datos (dos tablas nuevas),
publica un contrato HTTP (`/api/playbook/*`) y evoluciona la UI del
agente.

## Summary

Siete cortes, en este orden estricto:

1. **Persistencia**: dos tablas, migración re-ejecutable, schema Zod
   versionado, bootstrap **multi-org determinista** (sin "primera
   org") que siembra la V1 ("Academia Bajo Control") en cada
   organización con `salesOrchestratorEnabled=true`. Sin tocar
   runtime.
2. **API de versionado**: draft / update / validate / publish /
   rollback / list con tenant isolation, validación server-side que
   rechaza payloads que rompan el contrato de option keys.
3. **Runtime dinámico**: `buildJevSalesState` carga la versión
   publicada; el motor pasa a Jev el **set activo** del playbook;
   `normalizeJevResponse` se vuelve configurable y acepta el set
   activo + la lista de `known signals`; `SalesDecision` se refactor
   a nullable con fallbacks explícitos en `resolve-plan` /
   `writer` / `follow-up-writer`; agent profile
   (tone/instructions/escalation) llega al writer comercial;
   override de Playbook SOLO si `conversation.is_test === true`;
   sin cache. Snapshot de versión persistido. Scheduling de follow-ups
   suprimido en sandbox.
4. **UI Playbook**: editor en `agent-client.tsx`, bloques por
   sección, badges por clase de pregunta, botones para crear draft /
   guardar / validar / publicar / rollback.
5. **Editor Jev avanzado**: editor de `engine-required` /
   `known signals` / `analytical/custom` con guardarraíles duros
   (option keys de `next_action`, `buying_timing`,
   `main_value_proposition` inmutables).
6. **Laboratorio comercial**: pipeline real en sandbox con
   override de Playbook, expected outcomes humanos por caso,
   comparación Published vs Draft. Sin efectos residuales (cero
   follow-ups, cero WhatsApp real, cero CAPI).
7. **Casos reales + bootstrap final + auditoría**: UI para guardar
   conversación como caso con PII minimizada. Decisión sobre el
   fallback. E2E. Docs. Cierre.

Lo que sube es el modelo de la estrategia; lo que no se toca es el
motor. El runtime pasa de "conocer la estrategia" a "consultar la
estrategia publicada en su versión X" — y el contrato con Jev pasa
de "las 8 fijas" a "el set activo del playbook".

## Technical Context

**Language/Version**: TypeScript estricto (`strict` +
`noUncheckedIndexedAccess`), Node 22.

**Primary Dependencies**: **ninguna nueva**. Persistencia con Drizzle
existente, validación con Zod existente, cifrado por `lib/crypto`
(no aplica — el playbook no guarda secretos), cliente UI propio.

**Storage**: PostgreSQL + Drizzle. Migración aditiva
(`drizzle/0008_*.sql`) con el patrón `IF NOT EXISTS` + `DO $$ …
EXCEPTION WHEN duplicate_object THEN null $$` que ya usan 006 y
007. Migración adicional 0008b para columnas del laboratorio
(`agent_test_case`).

**Testing**: Vitest para las piezas puras (Zod schema, helpers de
versión, bootstrap multi-org puro, fallback) + tests de integración
que cubren runtime con override + tests del normalizer refactorizado
+ tests del override guard + tests de sandbox sin efectos
residuales. E2E (`scripts/e2e-selftest.mjs` extendido) en cada
corte que toque UI o runtime.

**Target Platform**: el mismo monolito self-hosted. Sin procesos ni
servicios nuevos. Sin colas externas.

**Performance Goals**: la carga de la versión publicada ocurre una
vez por turno del orquestador (`SELECT` directo, sin cache). El
volumen actual bajo hace que un SELECT sea más barato que la
complejidad de mantener un cache coherente; Jev + writer cuestan
muchísimo más que esa lectura. Optimización futura solo si métricas
lo exigen.

**Constraints**:

- `organization_id` por `scoped()` en cada acceso.
- `sales_playbook` UNIQUE por `organization_id`.
- `sales_playbook_version`: UNIQUE(`playbook_id`, `version_number`).
- Índices parciales UNIQUE: una `draft` y una `published` por
  `playbook_id`.
- `config_json` validado contra `schema_version` antes de cualquier
  INSERT.
- `next_action`, `needs_human_call`, `buying_timing`,
  `main_value_proposition`: `key`, `type` y (cuando `choice`)
  option keys protegidos.
- `engine-required` nunca desactivables ni eliminables.
- `known signals` desactivables con fallback seguro.
- `analytical/custom` libres, pero su presencia/ausencia no afecta
  al resolver.
- No exponer el config a logs ni a endpoints de debug sin
  redacción.

**Scale/Scope**: en V1, 1 versión publicada + 1 draft activo + N
versiones archivadas por organización. El tamaño del config es
bounded por Zod (< 32 KB por versión razonable). Multi-playbook por
org reservado, no expuesto.

## Project Structure (post-cortes)

```
specs/008-sales-playbook/
├── spec.md · plan.md · tasks.md
├── research.md                   # investigación previa (análisis de capas)
├── data-model.md                 # shape exacto del config + diagrama
├── quickstart.md                 # self-test con mocks
└── contracts/
    ├── playbook-config.md        # shape del config + schema_version
    └── playbook-api.md           # endpoints REST internos

src/
├── lib/
│   ├── db/
│   │   ├── schema.ts             # + sales_playbook, sales_playbook_version
│   │   └── ids.ts                # + sp_, spv_ prefijos
│   └── sales/
│       ├── playbook/
│       │   ├── schema.ts         # NUEVO — Zod versionado del config
│       │   ├── v1.ts             # NUEVO — contenido exacto del Anexo V1
│       │   ├── store.ts          # NUEVO — acceso a BD con scoped()
│       │   ├── version.ts        # NUEVO — helpers de versionado (publish/rollback)
│       │   ├── bootstrap.ts      # NUEVO — bootstrap multi-org determinista
│       │   └── loader.ts         # NUEVO — getPublished/Draft/ByVersionId (SIN cache)
│       └── (sigue intacto: vende-veloz.ts ahora se queda como DEFAULT_ONLY)
├── server/
│   ├── sales/
│   │   ├── build-state.ts        # MOD — cargar config publicado + set activo de preguntas
│   │   ├── normalize.ts          # MOD — refactor a (raw, activeQuestions, knownSignals)
│   │   ├── decision.ts           # MOD — SalesDecision con campos nullable + signals
│   │   ├── writer.ts             # MOD — aceptar override de config + tolerar null en decision
│   │   ├── orchestrator.ts       # MOD — pasar set activo a Jev, snapshot versión,
│   │   │                         #       override solo en is_test, suprimir follow-ups sandbox
│   │   ├── resolve-plan.ts       # MOD — fallback buying_timing = "unknown"
│   │   ├── follow-ups/follow-up-writer.ts # MOD — override config + fallback null
│   │   └── (resto intacto)
│   └── ai/
│           └── prompts.ts         # MOD — incluir tone/instructions/escalation del agent profile
├── app/
│   └── api/playbook/
│       ├── route.ts              # GET: published + draft activos
│       ├── draft/route.ts        # POST: create; PUT: update
│       ├── validate/route.ts     # POST: validate (no persiste)
│       ├── publish/route.ts      # POST: publish (transacción)
│       ├── rollback/route.ts     # POST: rollback to version N
│       └── versions/
│           ├── route.ts          # GET: list
│           └── [id]/route.ts     # GET: detail
├── components/
│   └── agent/
│       ├── agent-client.tsx      # MOD — orquesta tabs existentes + playbook
│       ├── playbook/
│       │   ├── playbook-client.tsx       # NUEVO
│       │   ├── playbook-published-card.tsx  # NUEVO
│       │   ├── playbook-draft-editor.tsx    # NUEVO
│       │   ├── playbook-versions-list.tsx   # NUEVO
│       │   └── jev-questions-editor.tsx     # NUEVO (Corte 5)
│       └── (resto intacto)
├── app/(app)/lab/
│   ├── page.tsx                  # MOD — lanzar corrida con config publicado o override
│   └── (sigue intacto)
└── server/lab/
    ├── runner.ts                 # MOD — ejecutar pipeline real + override + sandbox
    ├── judge.ts                  # sin cambios (sigue siendo el juez heurístico)
    └── personas.ts               # sigue con las 6 ferreteras + 6 nuevas V1

drizzle/0008_sales_playbook.sql         # migración aditiva (schema + leads)
drizzle/0008b_lab_playbook_columns.sql  # ALTER agent_test_case (Corte 6)
tests/unit/
├── playbook-schema.test.ts        # Zod
├── playbook-store.test.ts        # CRUD de versiones
├── playbook-bootstrap.test.ts    # multi-org determinista + idempotencia
├── playbook-jev-questions.test.ts # set activo + fallback + signals
├── playbook-fallback.test.ts     # fallback cuando no hay published
├── playbook-snapshot.test.ts     # persistencia de playbook_version_id
├── playbook-override-guard.test.ts # override rechazado si !is_test
└── playbook-lab-suppress-followups.test.ts # sandbox sin follow-ups
tests/e2e/us-sales-playbook.md
```

## Fases

**Fase 0 — Research** ✅ en este `plan.md` y en `research.md`.
Auditoría de las llamadas runtime a `VENDE_VELOZ_PRODUCT` /
`VENDE_VELOZ_OFFER` / `VENDE_VELOZ_COMMERCIAL_POLICY` /
`JEV_SALES_QUESTIONS_V2` hecha.

**Fase 1 — Diseño** ✅ este `plan.md`, `spec.md`, `data-model.md`.

**Fase 2 — Tareas** → `tasks.md`.

**Fase 3 — Implementación por corte** — cada corte cierra con gate
técnico + self-test de su alcance antes de pasar al siguiente.

## Callsites auditados del hardcode (Corte 3)

| Archivo | Línea(s) | Lo que se reemplazará / adaptará |
|---|---|---|
| `src/server/sales/build-state.ts` | líneas donde se inyecta `state.product` / `state.commercial_policy` | Reemplazar por `loader.getPublishedConfigForOrg(org)`. Fallback a `VENDE_VELOZ_*` con `console.warn` una vez por proceso. |
| `src/server/sales/normalize.ts` | `normalizeJevResponse` exige 8 answers | Refactor a `normalizeJevResponse(raw, activeQuestions, knownSignalKeys)`. `engine-required` falla si falta; `known signals` admiten `null` con fallback; `analytical` se preserva en `signals`. |
| `src/server/sales/decision.ts` | `SalesDecision` exige 8 fields | Refactor a nullable los 6 `known signals`. `nextAction` y `needsHumanCall` siguen requeridos. `signals: Record<...>` para extras. |
| `src/server/sales/writer.ts` | lee `decision.mainValueProposition.choice` y `decision.buyingTiming.choice` | Tolerar `null` con omisión de línea. |
| `src/server/sales/resolve-plan.ts` | `decision.buyingTiming.choice === "future_season"` | Si `null` → tratar como `"unknown"`; el branching `future_season` se omite. |
| `src/server/sales/orchestrator.ts` | `evaluateJev({ state })` sin `questions` | Pasar `questions: filterActive(config.jev_questions)`. `is_test=true` permite `playbookOverride`. `is_test=true` suprime `scheduleNextFollowUp`. Persistir `last_jev_playbook_version_id` etc. |
| `src/server/sales/follow-ups/follow-up-writer.ts` | `lastDecision.mainValueProposition.choice`, `lastDecision.buyingTiming.choice` | Tolerar `null` con fallback. |
| `src/server/sales/serialize-ui.ts` | `extractSnapshot` lee 5 fields concretos | Tolerar `null`; los ausentes se omiten. |
| `src/server/ai/prompts.ts` (o equivalente) | no cita `agent_profile.tone`/`instructions`/`escalationRules` | Cablear en el system prompt del writer comercial. |

Las referencias a `VENDE_VELOZ_PRODUCT` / `VENDE_VELOZ_OFFER` /
`VENDE_VELOZ_COMMERCIAL_POLICY` / `JEV_SALES_QUESTIONS_V2` siguen
existiendo como **DEFAULTS_ONLY** que el motor consume solo en el
camino de fallback. Tests cubren esa rama.

## Refactor del normalizer y de `SalesDecision` (Corte 3, T304–T305)

```ts
// Antes
export type SalesDecision = {
  realOperationalNeed: RealOperationalNeedAnswer;
  productFit: ProductFitAnswer;
  motivationToChange: MotivationToChangeAnswer;
  purchaseIntent: PurchaseIntentAnswer;
  buyingTiming: BuyingTimingAnswer;       // choice, 5 option keys
  mainValueProposition: MainValuePropositionAnswer; // choice, 5 option keys
  nextAction: NextActionAnswer;            // choice, 7 option keys (engine-required)
  needsHumanCall: NeedsHumanCallAnswer;    // noul (engine-required)
};

// Después
export type SalesDecision = {
  nextAction: NextActionAnswer;            // engine-required
  needsHumanCall: NeedsHumanCallAnswer;    // engine-required
  realOperationalNeed: RealOperationalNeedAnswer | null;       // known signal
  productFit: ProductFitAnswer | null;
  motivationToChange: MotivationToChangeAnswer | null;
  purchaseIntent: PurchaseIntentAnswer | null;
  buyingTiming: BuyingTimingAnswer | null;
  mainValueProposition: MainValuePropositionAnswer | null;
  signals: Record<string, NormalizedAnswer>;
};
```

`normalizeJevResponse` se vuelve:

```ts
function normalizeJevResponse(
  raw: unknown,
  activeQuestions: Readonly<Record<string, JevQuestionDefinition>>,
  knownSignalKeys: readonly string[]
): Result<SalesDecision, NormalizeError>;
```

Donde `JevQuestionDefinition` es el **contrato genérico runtime**
introducido en este corte (ver § "Contrato genérico de tipos para
preguntas dinámicas" abajo). El normalizer recibe las
definitions realmente enviadas (no las 8 fijas).

### Contrato genérico de tipos para preguntas dinámicas

El código actual usa `type JevSalesQuestionsV2 = typeof
JEV_SALES_QUESTIONS_V2` — un literal type de las 8 congeladas que
NO admite `analytical/custom` arbitrarias.

El Corte 3 introduce un contrato genérico runtime:

```ts
// src/server/sales/questions.ts
export type JevQuestionDefinition =
  | {
      type: 'choice';
      instructions: string;
      enabled: boolean;
      criteria: Record<string, string>;
    }
  | {
      type: 'noul';
      instructions: string;
      enabled: boolean;
      criteria: { true: string; false: string };
    }
  | {
      type: 'score';
      instructions: string;
      enabled: boolean;
      criteria: string[];
    };

export type JevQuestions = Readonly<Record<string, JevQuestionDefinition>>;
```

Reglas:

- `JEV_SALES_QUESTIONS_V2` (DEFAULTS_ONLY) sigue existiendo y debe
  satisfacer `JevQuestionDefinition`. Sus tipos concretos
  (`NextActionAnswer`, `BuyingTimingAnswer`,
  `MainValuePropositionAnswer`, etc.) se mantienen donde los
  necesite el normalizer para narrow.
- `evaluateJev({ state, questions })` ahora acepta
  `JevQuestions | undefined` (no el literal type).
- `JevSalesState` no cambia de forma.
- **Sin `as any` ni casts inseguros**: las `*Answer` específicas
  se mantienen como narrow types del normalizer; el resto usa
  `Record<string, NormalizedAnswer>` y nunca se salta TypeScript.
- `analytical/custom` puede añadirse sin tocar tipos TS cada vez:
  el mapa es abierto y el normalizer los preserva en
  `decision.signals`.
- `engine-required` (`next_action`, `needs_human_call`) sigue
  validado por Zod + guardarraíles.

Test plan:

- `playbook-jev-questions.test.ts`: una pregunta
  `analytical/custom` (`foo_bar: { type: 'noul', ... }`) compila
  sin casts inseguros, llega al payload de `evaluateJev`, y su
  answer se preserva en `decision.signals['foo_bar']`.

Reglas:

- `next_action`, `needs_human_call`: deben estar en `activeQuestions`,
  `enabled=true`, `type` correcto. Si faltan en la respuesta →
  `fail('missing_required', key)`.
- `known signals`: si la key está en `activeQuestions` y `enabled=true`,
  se intenta parsear; si la respuesta viene mal formada →
  `fail('invalid_answer', key)`; si la key está en
  `activeQuestions` pero `enabled=false` o no viene respuesta →
  `null` (fallback documentado).
- `analytical/custom`: cualquier key extra que venga en la respuesta
  y no esté en `knownSignalKeys` se parsea según su shape y se
  preserva en `signals[key]`.
- `choice`: option keys validadas contra el set V1 contractual:
  - `next_action` (7): `['ask_more_questions',
    'show_operations_demo', 'show_online_enrollment_demo',
    'present_price', 'schedule_call', 'schedule_follow_up',
    'disqualify']`.
  - `buying_timing` (5): `['now', 'soon', 'future_season',
    'unknown', 'no_current_plan']`.
  - `main_value_proposition` (5): `['operational_control',
    'reduce_whatsapp_dependency', 'online_enrollment',
    'reduce_manual_work', 'no_relevant_value_now']`.

  Si una opción está fuera del set → `fail('invalid_choice_key',
  key)`. Las descripciones son editables; las KEYS son contrato.

## Override de Playbook (Corte 3, T306)

```ts
type RunSalesOrchestratorTurnOpts = {
  playbookOverride?: {
    config: ConfigV1;
    versionId: string;
    schemaVersion: string;
    versionNumber: number;
  };
};

async function runSalesOrchestratorTurn(conv, opts) {
  if (opts.playbookOverride && !conv.is_test) {
    throw new Error("playbook_override_forbidden_in_production");
  }
  // ...
}
```

En producción, `opts.playbookOverride` siempre es `undefined`. Solo
el Laboratorio puede inyectarlo, y el Laboratorio solo corre sobre
`is_test=true`.

## Sandbox del Laboratorio (Corte 3, T308 + Corte 6, T605–T607)

Reglas:

1. `conversation.is_test = true` en todas las conversaciones del
   Laboratorio.
2. El sender lanza excepción si alguien intenta enviar WhatsApp en
   `is_test=true`. Spy sobre `graphRequest` lo verifica.
3. `runSalesOrchestratorTurn` con `is_test=true` **no** llama a
   `scheduleNextFollowUp`. Cero filas en `sales_follow_up_job`.
4. CAPI ya respeta `is_test=true` (no emite eventos); guardrail
   existente.
5. Override de Playbook permitido solo aquí.
6. Contacto y lead de prueba NO visibles en operación normal
   (filtros ya existentes).

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| **I. Seguridad** | El config nunca contiene secretos; Zod rechaza payloads que se parecen a credenciales. El override está protegido: solo se acepta si `is_test=true`. En el flujo "guardar conversación como caso" se minimiza PII: no se persiste phone, email, wa_identity, ctwa_clid, ni IDs que permitan reconstruir el contacto. |
| **II. Soberanía** | Cero dependencias nuevas. Persistencia misma, validación misma, UI propia. No entra proveedor externo. |
| **III. Multi-tenancy** | `organization_id NOT NULL` en `sales_playbook` y `sales_playbook_version`; todo acceso por `scoped()`. El bootstrap enumera explícitamente `agent_profile WHERE sales_orchestrator_enabled = true` y siembra por `orgId` sin heurísticas cross-tenant. |
| **IV. Idempotencia** | UNIQUE por (`playbook_id`, `version_number`) + UNIQUE parcial (`draft` y `published` por `playbook_id`). Migración re-ejecutable. Bootstrap multi-org idempotente. |
| **V. Calidad verificable** | Gate técnico + unit tests del Zod, del store puro, del bootstrap multi-org, del normalizer refactorizado, del override guard, del sandbox sin follow-ups + tests de integración del runtime con override + E2E (Playwright + mocks) por corte. |
| **VI. Specs antes de código** | Spec/plan/tasks preceden al código. |
| **VII. Trazabilidad** | `playbook_version_id`, `playbook_schema_version`, `playbook_version_number` en cada decisión Jev persistida (columnas denormalizadas en `lead` + JSONB `last_jev_decision`) y en cada caso del Laboratorio. Decisiones no obvias (defaults_only, fallback, guardarraíles Jev, override solo en is_test, suppress follow-ups en sandbox) documentadas aquí y en `spec.md`. |
| **VIII. Foco vertical** | Editor por bloques, no constructor visual. Los 7 `next_action` siguen siendo los del motor; sus option keys son contrato y no se pueden renombrar desde UI. No entra Zapier. |
| **IX. Verificación en vivo** | Self-test por corte (mocks). El Corte 7 corre E2E con `WA_MOCK_ENABLED=true` y `OPENROUTER_BASE_URL`/`TYPESAFE_JEV_ENDPOINT` apuntando a mocks. |

**Resultado del gate**: PASA sin violaciones. No requiere
enmienda constitucional.

## Complexity Tracking

Ninguna violación que rastrear. La complejidad agregada —un
documento versionado con editor y trazabilidad en el resolver, más
un normalizer configurable— se acota con:

- Default congelado del motor solo como fallback documentado y
  testeado.
- Validación Zod en server-side antes de cualquier persistencia.
- Guardarraíles duros en el editor Jev para `engine-required` y
  option keys de `next_action`, `buying_timing`,
  `main_value_proposition`.
- Bootstrap multi-org determinista (enumera
  `agent_profile.salesOrchestratorEnabled=true`).
- Trazabilidad por `playbook_version_id` en cada decisión
  persistida.
- Override solo en `is_test=true`; sin cache en V1.

## Decisiones de diseño específicas del fork

1. **Una versión `draft` y una `published` por playbook.**
   Garantizado por índices parciales UNIQUE. La UI no tiene que
   negociar ese invariante.
2. **Tres clases de preguntas Jev**: `engine-required` (2),
   `known signals` (6 V1), `analytical/custom` (libres). Las 2
   `engine-required` son inmutables. Las 6 `known signals` son
   desactivables con fallback seguro. Las `analytical` son
   libres. El motor no decorativo: pasa el set activo a Jev y el
   normalizer lo conoce.
3. **Option keys de `next_action`, `buying_timing`,
   `main_value_proposition` son contrato del resolver/writer**:
   no se pueden renombrar ni reordenar desde UI; el Zod y el
   normalizer las validan. Solo las descripciones son editables.
4. **`SalesDecision` se vuelve nullable en los 6 known signals.**
   `resolve-plan` / `writer` / `follow-up-writer` /
   `serialize-ui` aplican fallbacks explícitos cuando el campo
   es `null`.
5. **El `config` se guarda en columnas tipadas**
   (`product_json`, `policy_json`, `offer_json`,
   `priorities_json`, `writer_json`, `jev_questions_json`,
   `prohibitions_json`, `handoff_json`, `urgency_rules`) para
   legibilidad. El snapshot a Jev sigue siendo un objeto único
   (igual que el state actual).
7. **`schema_version` semver** en la fila. El loader rechaza
   configs con `schema_version` desconocido salvo que haya un
   migrador registrado.
8. **Sin cache en V1.** El loader hace `SELECT` directo en cada
   turno. Publish/rollback toma efecto en el siguiente turno.
   Optimización futura solo si métricas lo exigen.
9. **Fallback congelado.** Mientras no exista versión publicada,
   el motor carga `VENDE_VELOZ_*` y `JEV_SALES_QUESTIONS_V2` y
   emite un warning visible. El Corte 7 decide cuándo retirarlo
   (probablemente nunca; sigue como `DEFAULTS_ONLY` reusables en
   tests).
10. **Snapshot por versión en BD.** `lead` gana columnas
    `last_jev_playbook_version_id`,
    `last_jev_playbook_schema_version`. La decisión Jev JSONB
    persiste también `playbook_version_id`,
    `playbook_schema_version`, `playbook_version_number`.
11. **El Laboratorio ejecuta el pipeline real** vía
    `runSalesOrchestratorTurn` con `is_test=true`. Override de
    Playbook permitido solo aquí. Cero filas en
    `sales_follow_up_job` por corrida de laboratorio.
13. **El editor no es JSON crudo**: cada bloque funcional tiene
    su formulario. Las `criteria` de `choice` se editan como
    tabla key/value; las de `score` como lista de bullets.

## Anexo V1 — "Vende Veloz 365 — Academia Bajo Control"

> El bootstrap siembra exactamente este objeto como `published` de
> cada organización con `sales_orchestrator_enabled=true`.

(El contenido exacto del Anexo V1 vive en
`src/lib/sales/playbook/v1.ts` y se documenta en `data-model.md`.)

## Riesgos y mitigaciones (resumen)

- Organización activa queda sin playbook → fallback explícito +
  tests.
- Editor publica payload inválido → Zod server-side + guardarraíles
  duros para option keys.
- Cambios rompen `next_action` / `needs_human_call` /
  `buying_timing` / `main_value_proposition` → guardarraíles duros
  + tests.
- Schema evoluciona y rompe drafts viejos → migradores registrados.
- Editor Jev se convierte en Zapier → solo edita
  instrucciones/criterios/orden/enabled; no añade lanes ni efectos.
- Bootstrap siembra org equivocada → enumeración explícita de
  `agent_profile.salesOrchestratorEnabled=true`; nunca
  `LIMIT 1`.
- Override llega a producción → server-side
  `if (override && !is_test) throw`.
- Sandbox deja follow-ups activos → `is_test=true` salta
  `scheduleNextFollowUp`.

## Definición de Hecho por corte

- **Corte 1**: gate técnico + tests del Zod/store/bootstrap
  multi-org verdes; cero cambio en runtime productivo; working
  tree limpio; un commit.
- **Corte 2**: gate técnico + tests de endpoints verdes (tenant
  isolation, draft único, published único, rollback, schema
  incompatible, intento de renombrar option keys); working tree
  limpio; un commit.
- **Corte 3**: gate técnico + tests del normalizer refactorizado +
  tests del override guard + tests del sandbox sin follow-ups +
  regresión del Sales Orchestrator verde; working tree limpio; un
  commit.
- **Corte 4**: gate técnico + E2E UI editor verde; working tree
  limpio; un commit.
- **Corte 5**: gate técnico + tests de guardarraíles Jev verdes;
  E2E UI editor Jev verde; working tree limpio; un commit.
- **Corte 6**: gate técnico + tests del runner nuevo verdes; E2E
  laboratorio comercial verde; working tree limpio; un commit.
- **Corte 7**: gate técnico + decisión documentada sobre el
  fallback + E2E final en las dos configuraciones (Published /
  Fallback / Sandbox) verde + `docs/CURRENT_STATE.md` y
  `docs/playbook.md` actualizados; working tree limpio; un commit
  final.

La feature 008 no se declara Hecha hasta que los siete cortes
estén verdes.
## Plan del hotfix 2026-10-01

1. Reutilizar findFirstOpenStage/createLeadInStage y defaults del schema con
   contacto nuevo por caso, archivado y con identidad sandbox run/case.
2. Invocar deliverReply también en is_test y conservar supresión de follow-ups.
3. Copiar transcript/outcomes antes de judge y limpiar contacto en finally
   (cascade lead/conversation/messages; agent_test_case FK SET NULL).
4. Filtrar archivedAt IS NULL en board; regresiones con builder, orquestador,
   resolver y delivery reales, Jev/writer mock, aislamiento y caminos infelices.
5. Gates globales, E2E según disponibilidad y un commit atómico.

Constitution Check: tenant scope obligatorio; sin nuevas dependencias/schema,
sender único con barrera sandbox existente; cero cambios comerciales.
