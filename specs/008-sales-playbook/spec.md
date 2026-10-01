# 008 — Sales Playbook versionado

**Branch**: `008-sales-playbook` · **Carril**: ciclo completo (Principio VI) ·
**Fecha de apertura**: 2026-09-30 · **Estado**: **EN IMPLEMENTACIÓN** —
Cortes 1–5 cerrados (modelo, API, runtime dinámico, UI, editor Jev).
**Corte 6 (Laboratorio comercial) implementado**: pipeline real con
override de Playbook solo en `is_test=true`, comparación Published vs
Draft y expected outcomes humanos. **E2E en vivo PENDIENTE** (falta
stack local). Corte 7 sin empezar.

> Convierte la estrategia comercial de Vende Veloz —hoy congelada en
> TypeScript en `src/server/sales/vende-veloz.ts` y
> `src/server/sales/questions.ts`— en **configuración durable,
> versionada, tenant-safe y editable sin redeploy**. El motor de Sales
> Orchestrator / Jev / Writer / Follow-ups deja de ser el "dueño del
> qué decir" y se queda con el "cómo decidir y redactar".

## Origen y motivación

La estrategia comercial de Vende Veloz es **iterativa por naturaleza**:
producción → conversaciones reales → evidencia → aprendizaje →
modificar estrategia → probar regresión → publicar → nueva producción.
Hoy, cada cambio estratégico (una pregunta nueva de Jev, un criterio
más estricto, una instrucción distinta del writer, un cambio en la
oferta, una prioridad que sube o baja) **requiere redeploy**. Eso
está mal.

Lo que el operador quiere tocar cada semana:

- el **producto** (quién es, qué hace, qué no);
- el **posicionamiento** y la **promesa**;
- la **oferta** y el **pricing**;
- las **prioridades** comerciales (qué dolor liderar);
- las **prohibiciones** (qué jamás prometer);
- la **política comercial** (automático vs handoff vs descalificar);
- las **preguntas y criterios** de Jev;
- las **instrucciones del writer** por `next_action`;
- la **política de handoff** por lane.

Lo que NO se quiere tocar cada semana (sigue siendo código, no
configuración):

- el cliente HTTP de TypeSafe/Jev;
- la sanitización de respuestas del proveedor;
- el resolver determinístico;
- los lanes, sus efectos y el `moveLeadStage`;
- el pipeline de mensajes;
- el worker de follow-ups;
- el envío a WhatsApp;
- la captura del `ad_attribution`;
- la emisión CAPI.

## Principio arquitectónico

**Tres capas, separadas de verdad**:

1. **Motor (código)** — el "cómo decidir". Tipos, normalización,
   resolver, lanes, writer de WhatsApp, follow-ups engine,
   guardarraíles. Tiene *contratos* (`SalesPlaybookConfig`
   versionado por `schema_version`) y *adaptadores* para leer la
   config actual del runtime.
2. **Playbook (configuración versionada)** — el "qué decir". Producto,
   posicionamiento, promesa, oferta, pricing, prioridades,
   prohibiciones, política, preguntas de Jev, criterios,
   instrucciones del writer, política de handoff, contexto temporal.
   Por organización, versionada, con draft/publish/rollback.
3. **Knowledge base (hechos)** — lo concreto del negocio. NO es
   estrategia. El agente lo usa como referencia factual; Jev no
   decide con KB.

El runtime SIEMPRE consume una **versión publicada**. Si una
organización no tiene playbook publicado, el motor cae a un fallback
explícito, y ese caso queda visible y debe corregirse (no es el modo
permanente).

## Lo que ya está (no se repite)

- **Sales Orchestrator (Jev)**: cliente TypeSafe, normalización,
  build-state, resolver (`resolveSalesPlan`), lanes, writer,
  follow-ups, persistencia y reporte de decisiones. El motor está
  cerrado y congelado. Solo se le agregan **adaptadores** que
  consumen `ConfigV1` desde BD, con override opcional para tests.
- **Agent Profile**: ya guarda `name`, `tone`, `instructions`,
  `escalationRules`, `greeting` (más flags `salesOrchestratorEnabled`
  / `salesFollowUpsEnabled`). Esos campos **no se duplican** en el
  playbook: son del agente y deben llegar al writer comercial como
  contexto de estilo.
- **Stage Gateway (007)**: la única puerta que cambia `lead.stageId`.
  El playbook no la toca.
- **CAPI (007)**: el reporte de QualifiedLead/Purchase. No se toca.
- **Laboratorio existente**: 6 personas ferreteras, judge heurístico,
  runner in-memory. Se **evoluciona**, no se reescribe.
- **Migraciones Drizzle re-ejecutables** (`0000`..`0007`): patrón
  `IF NOT EXISTS` + `DO $$ … EXCEPTION WHEN duplicate_object THEN null $$`.

## Concepto durable

### `sales_playbook`

Un playbook por organización en V1. La forma está **preparada** para
múltiples playbooks/campañas en el futuro (slug + label + estado) sin
implementar un gestor multicampaña. En V1: 1 fila por `organization_id`.

### `sales_playbook_version`

Cada cambio material se materializa en una **versión** inmutable con un
`version_number` autoincremental por playbook. Estados:

| Estado | Reglas |
|---|---|
| `draft` | Una sola activa por playbook (índice parcial UNIQUE). Editable. |
| `published` | Una sola activa por playbook (índice parcial UNIQUE). Inmutable. El runtime la consume. |
| `archived` | Versión previamente publicada que se "durmió" al publicar una nueva. Conserva valor histórico. |

Reglas duras:

- `version_number` único por `playbook_id`.
- Al publicar: la versión publicada anterior pasa a `archived`
  automáticamente dentro de la misma transacción.
- Al hacer rollback: se republica la versión elegida y la publicada
  actual pasa a `archived`. El contenido en sí no se modifica (las
  versiones son inmutables).
- No se permite editar una `published`. Para cambiar, se crea un
  nuevo `draft` desde la publicada actual o se duplica cualquier
  versión histórica.
- El config viaja con un `schema_version` (string semver) para que
  el motor pueda migrar o rechazar configs antiguas.

### Trazabilidad

- Cada decisión de Jev persiste en `lead.last_jev_decision` un
  snapshot que incluye `playbook_version_id`,
  `playbook_schema_version` y `playbook_version_number`. Eso permite
  reconstruir **qué estrategia** atendió esa conversación aunque el
  playbook haya cambiado después.
- Cada corrida del Laboratorio guarda `playbook_version_id` por caso
  para que la comparación Published vs Draft sea limpia.
- El estado Jev (`buildJevSalesState`) carga la versión publicada al
  construir el `product` y `commercial_policy` que viajan a Jev.
  **Jev nunca ve el draft** en producción: si solo hay draft, el
  estado se rechaza (no degradar a un estado ambiguo en
  producción).

## Contrato dinámico con Jev (no decorativo)

El motor **realmente** envía a Jev el set activo de preguntas del
playbook publicado. Esto **no** es decorativo: significa refactor
controlado de `evaluateJev`, `normalizeJevResponse` y `SalesDecision`
durante el Corte 3. Tres clases bien diferenciadas:

### 1) `engine-required` (2 preguntas)

Son el **contrato duro** del resolver. Sin ellas no hay turno.

| key | type | opción / noul | contrato |
|---|---|---|---|
| `next_action` | `choice` | option keys fijas = `['ask_more_questions', 'show_operations_demo', 'show_online_enrollment_demo', 'present_price', 'schedule_call', 'schedule_follow_up', 'disqualify']` | El resolver consume `nextAction.choice`. Las 7 keys **no se pueden renombrar ni añadir/quitar**. |
| `needs_human_call` | `noul` | noul ∈ ℝ | El resolver consume `needsHumanCall.noul`. La key/type no se pueden cambiar. |

Reglas:

- `key`, `type`, `enabled` y `deleted` son **inmutables**.
- `instructions` y `criteria` (descripciones) sí editables.
- `next_action.criteria` debe contener **exactamente** las 7 option
  keys de arriba (las descripciones pueden cambiar; los keys no).
- Su ausencia en la respuesta de Jev invalida el turno.

### 2) `known signals` (6 preguntas V1)

Son **señales comerciales** que el motor reconoce. Si la respuesta
llega, se usa. Si no llega (porque la pregunta fue desactivada, no
fue respondida o devolvió un shape inválido) — el motor aplica
fallback documentado.

| key | type | opción / score | consumidor | fallback si ausente |
|---|---|---|---|---|
| `real_operational_need` | `noul` | noul ∈ ℝ | persistencia + UI | sin efecto en plan |
| `product_fit` | `score` | score ∈ ℝ | persistencia + UI | sin efecto en plan |
| `motivation_to_change` | `score` | score ∈ ℝ | persistencia + UI | sin efecto en plan |
| `purchase_intent` | `score` | score ∈ ℝ | persistencia + UI | sin efecto en plan |
| `buying_timing` | `choice` | option keys fijas = `['now', 'soon', 'future_season', 'unknown', 'no_current_plan']` | resolver (`future_season` → schedule_follow_up); follow-up writer; writer línea de timing | resolver trata como `"unknown"`; writer omite línea de timing |
| `main_value_proposition` | `choice` | option keys = las 5 contractuales (`operational_control`, `reduce_whatsapp_dependency`, `online_enrollment`, `reduce_manual_work`, `no_relevant_value_now`) | writer (ángulo) | writer continúa sin ángulo específico |

Reglas:

- `key`, `type` y —si `choice`— las **option keys** son inmutables.
- `instructions` y descripciones de criterios son editables.
- `enabled = false` desactiva la pregunta: el motor la omite del
  payload a Jev; la respuesta ausente se interpreta como `null` con
  su fallback.
- Desactivar `buying_timing` o `main_value_proposition` **no rompe
  el resolver**: los fallbacks son explícitos.

### 3) `analytical/custom` (libres, no contratadas)

Preguntas creadas por el usuario. El motor las **no** consume para
decidir; las persiste en `decision.signals[key]` para auditoría y
análisis posterior.

- `key` libre validado `^[a-z_]+$` (≤ 60 chars).
- `type` libre: `choice` / `noul` / `score`.
- Se pueden crear, desactivar, renombrar (dentro de la misma
  versión), eliminar y duplicar.
- Su presencia/ausencia **nunca** afecta al resolver ni al writer.

### Refactor de `SalesDecision`

`SalesDecision` pasa a tener `nextAction` y `needsHumanCall`
**requeridos**, y los 6 `known signals` **nullable**. Sus
consumidores (`resolve-plan`, `writer`, `follow-up-writer`,
`serialize-ui`) toleran `null` con los fallbacks de la tabla
anterior.

`SalesDecision.signals: Record<string, NormalizedAnswer>` preserva
analíticas y futuras preguntas.

### Contrato genérico de tipos para preguntas dinámicas

El código actual usa `type JevSalesQuestionsV2 = typeof
JEV_SALES_QUESTIONS_V2`, que es **un literal type de las 8
preguntas congeladas** y NO admite `analytical/custom` arbitrarias
ni preguntas con campos renombrados sin modificar el tipo TS.

El Corte 3 introduce un **contrato genérico runtime** que reemplaza
el acoplamiento literal. La forma concreta (en
`src/server/sales/questions.ts` y `src/server/sales/client.ts`)
debe parecerse conceptualmente a:

```ts
// Tipo runtime para una pregunta Jev (genérica, no literal).
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

// Mapa dinámico de preguntas (engine-required + known signals +
// analytical/custom) sin literal types que limiten el conjunto.
export type JevQuestions = Readonly<
  Record<string, JevQuestionDefinition>
>;
```

Reglas:

- `JEV_SALES_QUESTIONS_V2` sigue existiendo como `DEFAULTS_ONLY`
  reusables en tests y debe satisfacer este contrato genérico
  (sus tipos concretos `NextActionAnswer`, `BuyingTimingAnswer`,
  `MainValuePropositionAnswer`, etc., se mantienen donde los
  necesite el normalizer para narrowar).
- `evaluateJev({ state, questions })` ahora acepta
  `JevQuestions | undefined` (no el literal type).
- `normalizeJevResponse(raw, activeQuestions, knownSignalKeys)`
  recibe las definitions realmente enviadas (no las 8 fijas).
- **Sin `as any` ni casts inseguros**: los `NextActionAnswer`,
  `BuyingTimingAnswer`, `MainValuePropositionAnswer`,
  `RealOperationalNeedAnswer`, etc., se mantienen como narrow
  types del normalizer; el resto usa `Record<string,
  NormalizedAnswer>` y nunca se salta TypeScript.
- `analytical/custom` puede añadirse sin modificar tipos
  TypeScript cada vez: el mapa es abierto y el normalizer los
  preserva en `signals`.
- `engine-required` sigue validado por Zod + guardarraíles
  (Corte 1, Corte 5).

## Contrato funcional (negocio)

### A) Producto y posicionamiento

Campos editables: `name`, `one_liner`, `who_it_is_for`, `core_jobs`,
`not_the_product`, `how_it_starts`. Limites de tamaño coherentes con
el estado actual (ver `VENDE_VELOZ_PRODUCT`).

### B) Oferta y pricing

Campos editables: `currency`, `setup`, `setupIsOneTime`,
`monthlyBase`, `includedActiveStudents`, `extraPerActiveStudent`,
`implementation.purpose`, `implementation.includes`, `neverPromise`.
Tipos numéricos validados; `setup` y `monthlyBase` enteros ≥ 0;
`includedActiveStudents` ≥ 1; `neverPromise` lista no vacía.

### C) Política comercial

Campos editables como objeto:

- `defaultChannel` (enum cerrado);
- `goal` (texto);
- `automationFirst`, `autoClose`, `humanHandoff`, `futureInterest`,
  `noResponse`, `disqualification`, `evidenceRule` (cada uno texto
  medio largo, ≤ 800 chars).

### D) Prioridades comerciales

Tres listas ordenadas:

- `priorities.primary` (1–8 items);
- `priorities.secondary` (0–8 items);
- `priorities.tertiary` (0–8 items).

Cada item ≤ 200 chars. El writer las usa para **frasear** el ángulo,
no para puntuar: la decisión puntual sigue siendo de Jev.

### E) Writer por `next_action`

Para cada uno de los 7 `next_action` (`ask_more_questions`,
`show_operations_demo`, `show_online_enrollment_demo`,
`present_price`, `schedule_call`, `schedule_follow_up`,
`disqualify`) un bloque de texto instructivo. Texto ≤ 1500 chars.
Si el editor no pone nada, el motor usa un fallback interno (las
instrucciones actuales) y queda visible como "heredado del default"
en la UI.

### F) Jev — `engine-required`, `known signals`, `analytical/custom`

Ver **Contrato dinámico con Jev** arriba. La UI muestra badges
distintos por clase y candados según la inmutabilidad.

### G) Prohibiciones

- `neverPromise` ya viene del bloque de oferta.
- `prohibitedClaims` adicional: lista libre de cosas que el writer
  tiene prohibido afirmar (ej. "ROI", "generamos alumnos"). Cada
  item ≤ 200 chars.

### H) Contexto temporal / estacionalidad

- `urgencyRules`: texto libre (≤ 1000 chars) sobre cuándo
  corresponde activar tono de "temporada alta" en función del
  contexto del prospecto. Default conservador: no inventar urgencia.

### I) Handoff policy por lane

- `handoffByLane`: objeto `{ auto: string, auto_close: string,
  human: string, wait: string, stop: string }`. Cada valor ≤ 500
  chars y describe cuándo la lane deriva a humano. Si vacío, el
  motor usa su default interno.

## Loader runtime (sin cache en V1)

```ts
// src/lib/sales/playbook/loader.ts
export async function getPublishedConfigForOrg(orgId: string): Promise<ConfigV1 | null>;
export async function getDraftConfigForOrg(orgId: string): Promise<ConfigV1 | null>;
export async function getConfigByVersionId(orgId: string, versionId: string):
  Promise<{ config: ConfigV1; schema_version: string; version_number: number; status: 'draft' | 'published' | 'archived' } | null>;
```

**Sin cache en memoria**, **sin TTL**, **sin invalidación**.
Publish/rollback toma efecto en el siguiente turno. Razón: el
volumen actual bajo hace que un SELECT sea más barato que la
complejidad de mantener un cache coherente; Jev + writer cuestan
muchísimo más que esa lectura. Optimización futura solo si métricas
lo exigen.

## Override de Playbook (solo `is_test=true`)

El runtime productivo NUNCA acepta override. Toda override es
rechazada salvo que `conversation.is_test === true`.

```ts
// runSalesOrchestratorTurn(conv, opts: { playbookOverride?: ConfigV1 })
if (opts.playbookOverride !== undefined && !conv.is_test) {
  throw new Error("playbook_override_forbidden_in_production");
}
```

El override carga la config de un `version_id` específico (o de la
publicada). Es la vía del **Laboratorio comercial** para probar
Published vs Draft sin publicar.

Uso:

- Producción normal → `opts.playbookOverride === undefined`.
- Lab con `playbook_mode: "published"` → override = publicada actual.
- Lab con `playbook_mode: "draft"` → override = draft activo.
- Lab con `playbook_mode: "archived:N"` → override = versión N.
- Cualquier intento de override sobre `is_test === false` → lanza
  (es un error de programación, no un input válido).

## Bootstrap multi-org determinista (sin "primera org")

El bootstrap **NO** usa `SELECT organization.id LIMIT 1` ni
heurísticas similares. Es enumerativo:

1. Query explícita:
   `SELECT organization_id FROM agent_profile WHERE
   sales_orchestrator_enabled = true`.
2. Para cada `orgId` único, llamar a
   `bootstrapOrgIfNeeded(orgId)`.
3. `bootstrapOrgIfNeeded` siembra solo si NO existe
   `sales_playbook` para esa org.

Idempotencia:

- Re-ejecutable: si todas las orgs con orchestrator enabled ya
  tienen playbook, cero inserciones.
- Una org con `salesOrchestratorEnabled = false` nunca se siembra.
- Cruce cero entre organization_id.

Disparo:

- `instrumentation.ts` invoca `await bootstrapAllEnabledOrgs()`
  best-effort en el boot. Try/catch + log explícito por org; no
  bloquea el arranque.
- Tests cubren el escenario con 2 orgs enabled, 1 enabled + 1
  disabled, segunda ejecución sin duplicados, y cero cruce
  cross-tenant.

## Sandbox del Laboratorio comercial (sin efectos residuales)

Las corridas del Laboratorio usan conversaciones `is_test=true`.
Garantías:

1. **Cero invocación a WhatsApp real**: el sender ya lanza excepción
   si `is_test=true`. Spy sobre `graphRequest` lo verifica.
2. **Cero scheduling de follow-ups**: el orquestador detecta
   `is_test=true` y NO llama a `scheduleNextFollowUp`. La fila
   `sales_follow_up_job` queda vacía para esa conversación al
   terminar la corrida.
3. **Cero invocación a CAPI**: el reporte CAPI ya respeta
   `is_test=true` (regla existente del Corte 6 de 007).
4. **Contacto y lead de prueba NO visibles** en operación normal
   (filtrado por flag en queries UI / API; ya existe en el repo).
5. **Override de Playbook solo aquí**: nunca llega a conversación
   productiva.

## Conversación real → caso de evaluación (PII minimizada)

El flujo "Guardar conversación como caso" se materializa en el Corte
7. Política de PII:

- El caso persistido contiene **únicamente**:
  - `transcript: [{ role: 'cliente' | 'agente', text: string }]`
    (solo texto; nunca adjuntos binarios, URLs ni IDs de media).
  - `playbook_version_id`, `playbook_schema_version`.
  - `expected_next_action`, `expected_lane`, `expected_handoff`
    (editables).
  - Metadata no identificante estrictamente necesaria (por
    ejemplo, longitud de la conversación, idioma detectado,
    número aproximado de turnos).
- **NO** contiene, bajo ninguna circunstancia:
  - `lead_id`, `contact_id`, `conversation_id` (de origen).
  - `phone`, `email`, `wa_identity`.
  - `ctwa_clid`, `source_id`, `source_url`, IDs Meta.
  - Ningún otro token, ID interno ni combinación de campos que
    permita resolver nuevamente la identidad del lead, contacto o
    conversación original.
- El endpoint recibe `conversation_id` únicamente como **input
  autenticado** para leer la conversación del tenant. El valor
  NO se guarda dentro del caso anonimizado.
- Confirmación explícita al usuario antes de guardar: "no se
  incluirá número de teléfono, email ni identificador de
  contacto".

## Fuera de alcance (no entra en este spec)

- Reescribir el motor (resolver, lanes, persistencia, sender).
- Campañas múltiples, gestor de campañas, asignación de playbook por
  conversación. La V1 admite multi-playbook estructuralmente, pero
  **no expone UI ni runtime** para elegir.
- Marketing API, CAPI, automatización de pauta.
- Constructor visual de workflows ("Zapier interno").
- Importar los 89 checkpoints históricos de `jevveloz` como dataset
  del Laboratorio. Se deja previsto el camino (importador) pero no
  se ejecuta en este spec — pertenece a un corte posterior si la
  evidencia lo justifica.
- Cache de playbook en runtime.
- `/api/dev/playbook-cache-invalidate`.

## Plan por cortes

Siete cortes, gate técnico + self-test (mocks) verde al final de
cada uno. Working tree limpio, un commit por corte.

- **Corte 1 — Modelo y persistencia.** Drizzle schema + migración
  re-ejecutable + tipos Zod del config + bootstrap multi-org
  determinista que siembra la V1 ("Vende Veloz 365 — Academia Bajo
  Control") para cada organización con
  `salesOrchestratorEnabled=true`. Tests del esquema, del bootstrap
  multi-org y del store. **Sin tocar runtime productivo.**
- **Corte 2 — API + versionado.** Endpoints tenant-safe para leer,
  crear draft, actualizar, validar, publicar, rollback y listar
  versiones. Validación estricta (Zod) en server-side que rechaza
  payloads que rompan el contrato de option keys. Tests de endpoints
  cubriendo tenant isolation, draft único, published único, rollback,
  schema incompatible rechazado, intento de renombrar option keys.
- **Corte 3 — Runtime dinámico.** `buildJevSalesState` carga la
  versión publicada y reemplaza los congelados
  `VENDE_VELOZ_PRODUCT` / `VENDE_VELOZ_COMMERCIAL_POLICY`. El motor
  pasa a Jev el set **activo** del playbook (no las 8 fijas):
  `evaluateJev({ state, questions })` recibe el subconjunto filtrado
  por `enabled=true`. `normalizeJevResponse(raw, activeQuestions,
  knownSignalKeys)` distingue `engine-required` (falla si falta) de
  `known signals` (acepta `null` con fallback) y de `analytical`
  (preserva en `signals`). `SalesDecision` refactor compatible
  con campos nullable. Override de Playbook aceptable **solo** si
  `conv.is_test === true`; en otro caso lanza. Sin cache. Writer y
  follow-up writer aceptan override. `agent_profile.tone` /
  `instructions` / `escalationRules` llegan al writer comercial.
  Scheduling de follow-ups suprimido en `is_test=true`. Snapshot de
  versión persistido. Regresión completa del Sales Orchestrator.
- **Corte 4 — UI Playbook.** Evolución de `agent-client.tsx` con
  sección "Sales Playbook". Editor por bloques (NO JSON crudo):
  producto, oferta, policy, prioridades, writer, handoff. Botones
  para crear draft, validar, publicar, rollback. Versión visible.
- **Corte 5 — Editor Jev avanzado.** Lista de preguntas con
  badges por clase (`engine-required` 🔒 / `known signal` 📊 /
  `analytical/custom` ➕). Guardarraíles duros: option keys de
  `next_action`, `buying_timing`, `main_value_proposition`
  inmutables. Reordenar, desactivar, añadir analítica, duplicar.
- **Corte 6 — Laboratorio comercial.** Ejecución del pipeline real
  (conversation sandbox → Jev con questions de la versión activa →
  resolver → writer → cero efectos residuales) sin WhatsApp real.
  Override de Playbook aceptado solo en `is_test=true`. Expected
  outcomes humanos por caso. Comparación Published vs Draft.
  Persistencia de `playbook_version_id` por caso.
- **Corte 7 — Casos reales + bootstrap final + auditoría.** UI
  "Guardar conversación como caso" con minimización de PII.
  Confirmación de la V1 "Academia Bajo Control" publicada para
  cada org con orchestrator enabled. Decisión explícita sobre el
  fallback (mantener como `DEFAULTS_ONLY` reusables en tests).
  E2E (Playwright + mocks). Documentación actualizada. Cierre.

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| **I. Seguridad** | El config nunca contiene secretos. Validación de tamaño/forma en runtime con Zod (rechaza payloads abusivos antes de tocar BD). En el flujo "guardar conversación como caso" se minimiza PII: no se persiste phone, email, wa_identity, ctwa_clid, ni IDs que permitan reconstruir el contacto. |
| **II. Soberanía** | Cero dependencias nuevas. La capa de persistencia es la misma Drizzle + PostgreSQL del repo. El editor es UI propia. No entra ningún proveedor externo. |
| **III. Multi-tenancy** | `organization_id NOT NULL` en `sales_playbook`, `sales_playbook_version` y todas las queries de bootstrap. Todo acceso por `scoped()`. El bootstrap enumera explícitamente `agent_profile WHERE sales_orchestrator_enabled = true` y siembra por `orgId` sin heurísticas cross-tenant. |
| **IV. Idempotencia** | Índices parciales UNIQUE en (`draft`/`published` por `playbook_id`) más UNIQUE(`playbook_id`, `version_number`). Migración re-ejecutable. Bootstrap multi-org idempotente. |
| **V. Calidad verificable** | Gate técnico + unit tests para schema/Zod/store puro/bootstrap multi-org/runtime dinámico + tests de integración del runtime con override + E2E (Playwright + mocks) en cada corte que toque UI o runtime. |
| **VI. Specs antes de código** | Este spec + plan + tasks preceden al código. |
| **VII. Trazabilidad** | `playbook_version_id`, `playbook_schema_version`, `playbook_version_number` en cada decisión Jev persistida (columnas denormalizadas en `lead` + JSONB `last_jev_decision`) y en cada caso del Laboratorio. Decisiones no obvias (defaults_only, fallback, guardarraíles Jev, override solo en is_test, suppress follow-ups en sandbox) documentadas aquí y en `plan.md`. |
| **VIII. Foco vertical** | El playbook es un documento versionado con editor; no un constructor de workflows. Los 7 `next_action` siguen siendo los del motor; sus option keys son contrato. |
| **IX. Verificación en vivo** | Self-test por corte. El Corte 7 corre la suite E2E con mocks y verifica Published vs Draft en el Laboratorio, además del camino de fallback. |

**Resultado del gate**: PASA sin violaciones. No requiere enmienda
constitucional. No entra ningún proveedor nuevo; toda la superficie
nueva corre en el mismo proceso Node.

## Riesgos conocidos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Una organización activa queda sin playbook publicado tras un rollback mal hecho | El fallback al hardcode es explícito y solo se desactiva explícitamente. Cualquier conversación cuya decisión se haya tomado con el fallback queda registrada con `playbook_version_id = null`. |
| El editor deja publicar un payload inválido que rompe Jev | Validación Zod en server-side antes del INSERT; rechazo con error legible. `next_action`, `needs_human_call`, `buying_timing`, `main_value_proposition` con guardarraíles duros (type/keys/opción keys). Test dedicado. |
| Cambios en `next_action` o `needs_human_call` destruyen el resolver | El Zod marca esas como `engine-required` (no se puede cambiar `type` ni `key`); el editor UI no expone esas dos columnas; los tests cubren el intento de saltarse la protección. |
| Crecimiento de config_json a algo no mantenible | El config se almacena en columnas tipadas (`product_json`, `policy_json`, `offer_json`, `priorities_json`, `writer_json`, `jev_questions_json`, `prohibitions_json`, `handoff_json`, `urgency_rules`) para legibilidad en SQL; el Zod es versionado por `schema_version`. |
| Versionado del schema evoluciona y rompe drafts viejos | El campo `schema_version` se valida al publicar/reactivar; si una versión vieja no migra, se rechaza con motivo legible y se exige crear un nuevo draft. |
| El editor Jev se convierte en un Zapier | El editor no crea ni modifica lanes. Solo edita instrucciones/criterios/orden/enabled. El motor es el dueño de los efectos. |
| Bootstrap mete V1 en una org que no la quiere | Solo se siembra para orgs con `sales_orchestrator_enabled = true`. Sin esa condición, cero inserciones. |
| Override de Playbook llega a producción | Server-side: `if (override && !is_test) throw`. La única vía para pasar override es a través del Laboratorio, donde `is_test=true` está garantizado. |
| Laboratorio deja follow-ups pendientes que afectan producción | `runSalesOrchestratorTurn` con `is_test=true` no llama a `scheduleNextFollowUp`. Cero filas en `sales_follow_up_job` por corrida de laboratorio. Test dedicado. |
| Latencia del runtime por leer BD en cada turno | En V1, no se espera. Optimización futura solo si métricas lo exigen. |

## Definición de Hecho

Una feature no está "Hecha" hasta que:

1. `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en
   verde.
2. `pnpm test:e2e` en verde con la app viva y mocks encendidos, en
   la ruta del flujo real y el camino infeliz (config inválida,
   schema incompatible, dos organizaciones distintas sin leakage,
   override rechazado en producción, sandbox sin efectos
   residuales).
3. **Cada** organización con `salesOrchestratorEnabled=true` tiene
   una versión publicada con el contenido del Anexo V1 y el Sales
   Orchestrator runtime consume esa versión (no el hardcode) en al
   menos una corrida E2E.
4. `docs/CURRENT_STATE.md` actualizado al cerrar la feature.
5. `docs/playbook.md` escrito con la guía del dueño.
6. Decisión explícita sobre el fallback: se mantiene como
   `DEFAULTS_ONLY` reusables en tests; el runtime prefiere la
   publicada.
7. Working tree limpio, un commit por corte, sin secretos.
## Hotfix productivo del Laboratorio — 2026-10-01

Corrida Draft real detectó outcomes vacíos: faltaba el lead y se omitía la
entrega sandbox. Cada caso sales debe crear contacto archivado único por
run/case y lead nuevo en la primera etapa open por position del tenant; sin
etapa open falla explícitamente. Facts comerciales arrancan con defaults
limpios, sin reutilización entre Published/Draft ni corridas. Writer entrega
por `deliverReply` sandbox: persiste outbound e historial/facts sin WhatsApp,
follow-ups ni CAPI externos. Transcript y actuals se copian a agent_test_case
antes del judge; limpieza en finally por cascada de contacto conserva el
resultado durable. Pipeline excluye todos los contactos archivados. Expected
manualmente nullable nunca oculta actual. Sin cambios al Playbook V1/V2.
