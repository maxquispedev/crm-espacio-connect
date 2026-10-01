# Data Model — 008 Sales Playbook

> Schema version **1.0** (semver: mayor = breaking, menor = aditivo,
> patch = fix interno). El loader rechaza `schema_version` desconocido.

## Tablas

### `sales_playbook`

Un playbook por organización en V1 (UNIQUE `organization_id`). La forma
está lista para multi-playbook (futuro): se identifica por `slug` dentro
de la organización, pero **no se expone gestión multi en V1**.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | prefijo `sp_` |
| `organization_id` | text NOT NULL FK→organization.id | UNIQUE |
| `slug` | text NOT NULL | `"vende-veloz-365"` en V1 |
| `label` | text NOT NULL | nombre humano |
| `created_at` | timestamptz NOT NULL default now() | |
| `updated_at` | timestamptz NOT NULL default now() | |

Índices:
- UNIQUE(`organization_id`)
- INDEX(`slug`)

### `sales_playbook_version`

Una fila por versión. Inmutable una vez insertada. Las versiones
`published` se reemplazan por archive-and-insert-new-draft en
transacción.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | prefijo `spv_` |
| `organization_id` | text NOT NULL FK→organization.id | redundante con playbook para queries |
| `playbook_id` | text NOT NULL FK→sales_playbook.id | |
| `version_number` | integer NOT NULL | autoincremental por playbook |
| `status` | text NOT NULL | enum: `draft`, `published`, `archived` |
| `schema_version` | text NOT NULL | semver del config |
| `product_json` | jsonb NOT NULL | subdoc `product` |
| `policy_json` | jsonb NOT NULL | subdoc `commercial_policy` |
| `offer_json` | jsonb NOT NULL | subdoc `offer` |
| `priorities_json` | jsonb NOT NULL DEFAULT '{}'::jsonb | `primary`/`secondary`/`tertiary` |
| `writer_json` | jsonb NOT NULL DEFAULT '{}'::jsonb | instrucciones por `next_action` |
| `jev_questions_json` | jsonb NOT NULL | mapa de preguntas |
| `prohibitions_json` | jsonb NOT NULL DEFAULT '{}'::jsonb | `neverPromise` (también en offer) + `prohibitedClaims` |
| `handoff_json` | jsonb NOT NULL DEFAULT '{}'::jsonb | `handoffByLane` |
| `urgency_rules` | text | default `null` |
| `notes` | text | comentario humano del cambio |
| `created_by` | text NOT NULL | `session.user.id` |
| `created_at` | timestamptz NOT NULL default now() | |
| `published_at` | timestamptz | NULL hasta publicar |
| `published_by` | text | NULL hasta publicar |
| `archived_at` | timestamptz | NULL hasta archivar |

Índices:
- UNIQUE(`playbook_id`, `version_number`)
- UNIQUE INDEX parcial: `WHERE status = 'published'` por `playbook_id`
- UNIQUE INDEX parcial: `WHERE status = 'draft'` por `playbook_id`
- INDEX(`organization_id`, `status`)
- INDEX(`organization_id`, `created_at`)

### `lead` (modificación aditiva)

Dos columnas nuevas, ambas NULL mientras no haya playbook:

| Columna | Tipo | Notas |
|---|---|---|
| `last_jev_playbook_version_id` | text FK→sales_playbook_version.id NULL | snapshot de la versión |
| `last_jev_playbook_schema_version` | text NULL | snapshot del schema_version |

No FK física (CONSTRAINT) opcional; el spec la deja FK lógica. Razón:
permitir limpieza de versiones viejas sin romper FK de snapshots
históricos. La trazabilidad por la versión congelada en el JSONB
`last_jev_decision` se mantiene incluso si la fila se borra.

## Config shape (schema_version 1.0)

Bloques, todos validados por Zod (`src/lib/sales/playbook/schema.ts`):

```ts
const Product = z.object({
  name: z.string().min(1).max(120),
  one_liner: z.string().min(1).max(500),
  who_it_is_for: z.array(z.string().min(1).max(300)).min(1).max(20),
  core_jobs: z.array(z.string().min(1).max(200)).min(1).max(30),
  not_the_product: z.array(z.string().min(1).max(300)).max(20),
  how_it_starts: z.string().min(1).max(500),
});

const Implementation = z.object({
  price: z.string().min(1).max(20), // texto para el writer (ej. "S/497")
  kind: z.string().min(1).max(40),
  includes: z.array(z.string().min(1).max(300)).min(1).max(20),
  does_not_include: z.array(z.string().min(1).max(300)).max(20),
});

const Subscription = z.object({
  price: z.string().min(1).max(40),
  includes_active_students: z.number().int().min(1).max(100000),
  extra_active_student: z.string().min(1).max(80),
  active_student_means: z.string().min(1).max(300),
});

const Offer = z.object({
  currency: z.enum(["PEN", "USD", "MXN", "EUR"]), // set inicial; se amplía si la org lo necesita
  setup: z.number().int().min(0).max(1_000_000),
  monthlyBase: z.number().int().min(0).max(1_000_000),
  includedActiveStudents: z.number().int().min(1).max(100000),
  extraPerActiveStudent: z.number().int().min(0).max(100000),
  setupIsOneTime: z.boolean(),
  implementation: z.object({
    purpose: z.string().min(1).max(200),
    includes: z.array(z.string().min(1).max(200)).min(1).max(20),
  }),
  neverPromise: z.array(z.string().min(1).max(200)).min(1).max(20),
});

const Policy = z.object({
  defaultChannel: z.enum(["WhatsApp", "WhatsApp+SMS", "WhatsApp+Email"]),
  goal: z.string().min(1).max(800),
  automationFirst: z.string().min(1).max(800),
  autoClose: z.string().min(1).max(800),
  humanHandoff: z.string().min(1).max(800),
  futureInterest: z.string().min(1).max(800),
  noResponse: z.string().min(1).max(800),
  disqualification: z.string().min(1).max(800),
  evidenceRule: z.string().min(1).max(800),
});

const Priorities = z.object({
  primary: z.array(z.string().min(1).max(200)).min(1).max(8),
  secondary: z.array(z.string().min(1).max(200)).max(8),
  tertiary: z.array(z.string().min(1).max(200)).max(8),
});

const Writer = z.object({
  ask_more_questions: z.string().min(1).max(1500),
  show_operations_demo: z.string().min(1).max(1500),
  show_online_enrollment_demo: z.string().min(1).max(1500),
  present_price: z.string().min(1).max(1500),
  schedule_call: z.string().min(1).max(1500),
  schedule_follow_up: z.string().min(1).max(1500),
  disqualify: z.string().min(1).max(1500),
});

const QuestionChoice = z.object({
  type: z.literal("choice"),
  enabled: z.boolean(),
  instructions: z.string().min(1).max(2000),
  criteria: z.record(z.string(), z.string().min(1).max(500)),
});

const QuestionNoul = z.object({
  type: z.literal("noul"),
  enabled: z.boolean(),
  instructions: z.string().min(1).max(2000),
  criteria: z.object({
    true: z.string().min(1).max(500),
    false: z.string().min(1).max(500),
  }),
});

const QuestionScore = z.object({
  type: z.literal("score"),
  enabled: z.boolean(),
  instructions: z.string().min(1).max(2000),
  criteria: z.array(z.string().min(1).max(500)).min(2).max(7),
});

const Question = z.union([QuestionChoice, QuestionNoul, QuestionScore]);

const ProtectedKeys = z.enum(["next_action", "needs_human_call"]);

const Questions = z.record(
  z.string().min(1).max(60).regex(/^[a-z_]+$/),
  Question
).refine(
  (qs) => qs.next_action?.type === "choice" && qs.needs_human_call?.type === "noul",
  "next_action y needs_human_call son estructurales: deben existir con su tipo."
);

const Prohibitions = z.object({
  neverPromise: z.array(z.string().min(1).max(200)).max(20),
  prohibitedClaims: z.array(z.string().min(1).max(200)).max(20),
});

const Handoff = z.object({
  auto: z.string().max(500).optional(),
  auto_close: z.string().max(500).optional(),
  human: z.string().max(500).optional(),
  wait: z.string().max(500).optional(),
  stop: z.string().max(500).optional(),
});

const ConfigV1 = z.object({
  schema_version: z.literal("1.0"),
  product: Product,
  offer: Offer,
  commercial_policy: Policy,
  priorities: Priorities,
  writer: Writer,
  jev_questions: Questions,
  prohibitions: Prohibitions,
  handoff: Handoff.default({}),
  urgency_rules: z.string().max(1000).nullable().default(null),
});
```

### Guardarraíles Jev (Corte 5)

- `next_action` y `needs_human_call` deben estar presentes.
- Sus `type` (`choice` y `noul` respectivamente) son inmutables.
- Sus `criteria`/`instructions` son editables.
- Preguntas estructurales adicionales (`real_operational_need`,
  `product_fit`, `motivation_to_change`, `purchase_intent`,
  `buying_timing`, `main_value_proposition`) son **requeridas** en V1.
  Editables en `instructions`/`criteria`. Su `type` no se cambia. pueden
  desactivarse (`enabled: false`), en cuyo caso el motor las omite del
  state — pero las dos protegidas siguen.
- Preguntas nuevas (`key` libre) son **analíticas**: el motor no las
  consume, solo las persiste para análisis. Su `type` es cualquiera de
  los 3 soportados. No cuentan para `next_action` ni `needs_human_call`.

## Anexo V1 — "Vende Veloz 365 — Academia Bajo Control"

El bootstrap siembra este objeto (resumen; el detalle literal vive en
`src/lib/sales/playbook/v1.ts`):

```yaml
schema_version: "1.0"
product:
  name: "Vende Veloz 365"
  one_liner: "Ten tu academia bajo control, sin depender de Excel, papel
    y WhatsApp para saber qué está pasando."
  who_it_is_for: [academias deportivas, academias de natación en Perú,
    negocios con alumnos/apoderados/planes/cobros recurrentes]
  core_jobs: [alumnos y apoderados,planes/ciclos/horarios,pagos completos
    y parciales,saldos pendientes,control de ingresos,siguiente ciclo,
    renovación,adopción real,matrícula online opcional]
  not_the_product: [no genera alumnos,no gestiona pauta,no es CRM genérico,
    no es ERP contable,no retiene fondos]
  how_it_starts: "Empezamos por entender la operación y configuramos
    contigo. Carga inicial acordada desde información utilizable.
    Acompañamiento de adopción durante el primer mes."
offer:
  currency: "PEN"
  setup: 497
  monthlyBase: 197
  includedActiveStudents: 50
  extraPerActiveStudent: 1
  setupIsOneTime: true
  implementation:
    purpose: "adopción real"
    includes: [configuración acordada,planes/cursos/horarios,niveles/cupos/
      ciclos cuando aplique,carga inicial acordada,usuarios,capacitación,
      primeras operaciones reales,acompañamiento 30 días,dominio primer
      año cuando aplique]
  neverPromise: [generación de alumnos,demanda,ventas,ROI,recuperación
    de inversión,pérdidas de ventas por WhatsApp sin evidencia,escasez
    falsa]
commercial_policy:
  defaultChannel: "WhatsApp"
  goal: "Avanzar comercialmente de forma automática todo lo posible y
    reservar la intervención humana para los casos donde aporte valor
    real."
  automationFirst: "El agente puede obtener contexto, explicar el
    producto, mostrar demos o videos, presentar precio, resolver
    preguntas estándar, hacer seguimiento e intentar cerrar sin
    intervención humana."
  autoClose: "Si el prospecto quiere avanzar y el caso es estándar,
    sin complejidad especial, el agente puede continuar hasta
    instrucciones de pago e implementación."
  humanHandoff: "Escalar a humano cuando exista complejidad,
    integraciones o API, múltiples sedes o decisores, negociación u
    objeciones importantes, necesidades especiales o una solicitud
    explícita de conversación humana."
  futureInterest: "Si existe interés real pero la implementación
    corresponde a una temporada o fecha futura, programar seguimiento
    automático cerca de ese momento."
  noResponse: "Los leads que no responden deben recibir una secuencia
    limitada de seguimientos automáticos. Si no reaccionan, dejar de
    perseguirlos sin intervención humana."
  disqualification: "Si no existe encaje, necesidad relevante o el
    prospecto busca algo que Vende Veloz no ofrece, cerrar el flujo sin
    intervención humana."
  evidenceRule: "Las afirmaciones del vendedor sobre posibles
    problemas o beneficios no prueban que el prospecto tenga esa
    necesidad. Priorizar lo expresado por el prospecto y los datos
    objetivos de su operación."
priorities:
  primary: [control operativo,alumnos y apoderados,planes/ciclos/
    horarios,pagos completos y parciales,saldos pendientes,control de
    ingresos,siguiente ciclo / renovación,adopción real]
  secondary: [matrícula online,automatización,menor dependencia de
    WhatsApp,control de cupos]
  tertiary: [asistencia/sesiones,inventario/productos]
writer:
  ask_more_questions: "..."
  show_operations_demo: "..."
  show_online_enrollment_demo: "..."
  present_price: "Contextualiza: S/497 es puesta en marcha + adopción;
    después S/197/mes hasta 50 activos; +S/1 desde el 51. Sin
    descuentos inventados."
  schedule_call: "Transición breve a humano. No inventar horario."
  schedule_follow_up: "Reconocer timing. Si habló de temporada futura,
    preparar antes del pico sin presionar. No inventar fechas."
  disqualify: "Cierre breve y respetuoso. No seguir buscando dolores
    artificiales."
prohibitions:
  neverPromise: [generación de alumnos,demanda,ventas,ROI,recuperación
    de inversión,pérdidas de ventas por WhatsApp sin evidencia,escasez
    falsa]
  prohibitedClaims: [garantizar alumnos,garantizar ventas,asegurar
    crecimiento,devolver inversión,multiplicar la matrícula por X]
handoff:
  auto: "Escalar si el prospecto lo pide explícitamente, si hay
    objeciones complejas o múltiples decisores."
  auto_close: "Mantener auto hasta instrucciones de pago; derivar a
    humano solo si surge complejidad o lo pide."
  human: "Mantener humano; no reagendar automáticamente."
  wait: "Recordar al prospecto en el momento acordado sin presionar."
  stop: "No insistir."
urgency_rules: "Preparación antes de temporada alta cuando el contexto
  del prospecto lo justifique. No asumir estacionalidad idéntica para
  todos. No inventar urgencia."
```

> El detalle de las instrucciones del writer vive en
> `src/lib/sales/playbook/v1.ts` (literal exportado) para que el editor
> pueda mostrarlo como default y para que tests snapshot lo bloqueen.

## Estado en `lead`

Se agregan dos columnas (migration aditiva en 0008):

- `last_jev_playbook_version_id text NULL`
- `last_jev_playbook_schema_version text NULL`

Persistencia: en `runSalesOrchestratorTurn.persistDecision`, antes del
update, se obtiene `playbook_version_id` del loader y se guarda junto
con `schema_version`. El snapshot completo (`lead.last_jev_decision`
JSONB) sigue conteniendo el config relevante para reproducibilidad.

## Loader runtime

```ts
// src/lib/sales/playbook/loader.ts
export async function getPublishedForOrg(orgId: string): Promise<ConfigV1 | null>;
export async function getDraftForOrg(orgId: string): Promise<ConfigV1 | null>;
export async function getConfigByVersionId(versionId: string): Promise<{config: ConfigV1; schema_version: string; playbook_id: string; version_number: number}>;
```

Cache: por organización, TTL 60s, invalidado por `POST /api/playbook/publish`
y `POST /api/playbook/rollback`.

## Snapshot esperado del `last_jev_decision` JSONB

```json
{
  "playbook_version_id": "spv_abc123",
  "playbook_schema_version": "1.0",
  "playbook_version_number": 3,
  "snapshot": { /* mismo de hoy */ },
  "decision": { /* mismo de hoy */ },
  "plan": { /* mismo de hoy */ },
  "requestId": null,
  "model": null
}
```

Las claves nuevas (`playbook_*`) son aditivas. El reader del runtime las
ignora si están ausentes (compatibilidad con snapshots históricos).