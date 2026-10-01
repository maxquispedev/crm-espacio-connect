# Contract — Sales Playbook Config

> Documento versionado que el motor consume. Schema version
> **1.0**. El loader rechaza `schema_version` desconocido.

## Principios

1. El config describe **estrategia**, no implementación. No
   contiene secretos, IDs internos ni umbrales numéricos del
   resolver.
2. Cada bloque tiene forma **bounded**: Zod valida tamaños. La BD
   nunca acepta un payload > 32 KB.
3. Las preguntas Jev se clasifican en **tres clases**:
   `engine-required`, `known signals`, `analytical/custom`. Ver
   § Clases de preguntas Jev.
4. Las option keys de `next_action`, `buying_timing` y
   `main_value_proposition` son **contrato del resolver/writer**:
   el Zod rechaza payloads que pretendan renombrarlas o
   añadir/quitar keys. Solo las descripciones son editables.
5. El `schema_version` viaja con cada versión persistida para que
   el loader pueda migrar configs antiguas sin romper.

## Forma del documento (Zod, fuente de verdad)

`src/lib/sales/playbook/schema.ts` define el Zod. Este contrato es
la especificación legible.

### `product`

```yaml
name: string           # 1..120
one_liner: string      # 1..500
who_it_is_for: list    # 1..20 items, cada uno 1..300
core_jobs: list        # 1..30 items, cada uno 1..200
not_the_product: list  # 0..20 items, cada uno 1..300
how_it_starts: string  # 1..500
```

### `offer`

```yaml
currency: enum[ PEN | USD | MXN | EUR ]
setup: int             # 0..1_000_000
monthlyBase: int       # 0..1_000_000
includedActiveStudents: int  # 1..100_000
extraPerActiveStudent: int   # 0..100_000
setupIsOneTime: bool
implementation:
  purpose: string      # 1..200
  includes: list       # 1..20 items, cada uno 1..200
neverPromise: list     # 1..20 items, cada uno 1..200
```

### `commercial_policy`

```yaml
defaultChannel: enum[ WhatsApp | WhatsApp+SMS | WhatsApp+Email ]
goal: string                    # 1..800
automationFirst: string         # 1..800
autoClose: string               # 1..800
humanHandoff: string            # 1..800
futureInterest: string          # 1..800
noResponse: string              # 1..800
disqualification: string        # 1..800
evidenceRule: string            # 1..800
```

### `priorities`

```yaml
primary: list    # 1..8 items, cada uno 1..200
secondary: list  # 0..8 items, cada uno 1..200
tertiary: list   # 0..8 items, cada uno 1..200
```

### `writer`

Cada `next_action` tiene su instrucción (1..1500 chars). Las 7
obligatorias (las option keys del resolver):

```yaml
writer:
  ask_more_questions: string
  show_operations_demo: string
  show_online_enrollment_demo: string
  present_price: string
  schedule_call: string
  schedule_follow_up: string
  disqualify: string
```

### `jev_questions`

Mapa `key → question`. Cada question:

```yaml
type: enum[ choice | noul | score ]
instructions: string       # 1..2000
enabled: bool             # default true
criteria:
  # type=choice: criterios como mapa {key: descripcion}
  # type=noul: { true: desc, false: desc }
  # type=score: lista de descripciones (orden = severidad)
```

### Clases de preguntas Jev

Las keys se dividen en tres clases con distinto nivel de
inmutabilidad. El Zod aplica las reglas en una pasada
`superRefine` al final.

#### `engine-required` (2 preguntas, 🔒)

Contrato duro del resolver. Su ausencia invalida el turno.

| key | type | option keys (cuando `choice`) |
|---|---|---|
| `next_action` | `choice` | `['ask_more_questions', 'show_operations_demo', 'show_online_enrollment_demo', 'present_price', 'schedule_call', 'schedule_follow_up', 'disqualify']` |
| `needs_human_call` | `noul` | — |

Reglas:

- `key` y `type` **inmutables**.
- `enabled = true` obligatorio. `enabled = false` →
  `fail('engine_required_disabled', key)`.
- No se pueden eliminar.
- `next_action.criteria` debe contener **exactamente** las 7
  option keys de arriba (ninguna extra, ninguna faltante). Las
  descripciones son editables.
- `needs_human_call.criteria` debe tener exactamente
  `{ true: ..., false: ... }`. Las descripciones son editables.

#### `known signals` (6 preguntas V1, 📊)

Señales comerciales que el motor reconoce. Si la respuesta llega,
se usa; si no, fallback documentado.

| key | type | option keys (cuando `choice`) | fallback si ausente |
|---|---|---|---|
| `real_operational_need` | `noul` | — | resolver no usa la señal |
| `product_fit` | `score` | — | sin efecto en plan |
| `motivation_to_change` | `score` | — | sin efecto en plan |
| `purchase_intent` | `score` | — | sin efecto en plan |
| `buying_timing` | `choice` | `['now', 'soon', 'future_season', 'unknown', 'no_current_plan']` | resolver trata como `"unknown"`; writer omite línea |
| `main_value_proposition` | `choice` | las 5 del V1 (`control_operativo`, `alumnos_apoderados`, `planes_ciclos`, `pagos_saldos`, `siguiente_ciclo`) | writer continúa sin ángulo |

Reglas:

- `key`, `type` y (cuando `choice`) option keys **inmutables**.
- `enabled = false` válido: el motor las omite del payload a Jev.
- `buying_timing.criteria` y `main_value_proposition.criteria`
  deben contener **exactamente** sus option keys V1
  respectivas. Descripciones editables.
- Las otras 4 (`noul` / `score`) no tienen option keys; solo las
  descripciones/instructions son editables.

#### `analytical/custom` (libres, ➕)

Preguntas creadas por el usuario. El motor **no** las consume
para decidir; las guarda en `decision.signals[key]` para
auditoría.

- `key` libre validado `^[a-z_]+$`, ≤ 60 chars.
- `type` libre: `choice` / `noul` / `score`.
- Creadas, desactivadas, renombradas y eliminadas libremente.
- Su presencia/ausencia no afecta al resolver ni al writer.

### `prohibitions`

```yaml
neverPromise: list       # 0..20 items, cada uno 1..200
prohibitedClaims: list   # 0..20 items, cada uno 1..200
```

`neverPromise` viene del bloque `offer`; el editor lo mantiene en
sync visualmente (no se duplica en BD, pero el wire format lo
replica para que el writer lo reciba).

### `handoff`

```yaml
auto: string?           # 0..500
auto_close: string?
human: string?
wait: string?
stop: string?
```

### `urgency_rules`

Texto libre (0..1000 chars). Default `null`.

## Invariantes

- El documento entero pasa por Zod antes de cualquier INSERT.
- Las clases protegidas (`engine-required`, `known signals` con
  option keys) **no pueden cambiar `key`, `type`, ni option
  keys**. Tests cubren el intento.
- El borrador es único por playbook (índice parcial UNIQUE).
- La publicada es única por playbook (índice parcial UNIQUE).
- `version_number` único por `playbook_id`.
- **Sin cache en V1**: el runtime lee BD en cada turno.
  Publish/rollback toma efecto en el siguiente turno.

## Migración de schema

Cuando el `schema_version` cambie (e.g. a `1.1` o `2.0`):

1. Se registra un migrador en
   `src/lib/sales/playbook/migrators/`.
2. El loader lo aplica al cargar versiones con `schema_version`
   antiguo.
3. Si no hay migrador, el loader rechaza con error legible; el
   caller puede crear un nuevo draft con el schema actual.

## Wire format

Igual al documento entero. No se transforma para envío. El cliente
(UI) lo recibe con claves snake_case (consistente con
`VENDE_VELOZ_PRODUCT`).

## Forma mínima válida (ejemplo)

Este ejemplo es **inválido** a propósito: le faltan las 6 preguntas
`known signals` y las 2 `engine-required`. Se incluye solo para
ilustrar la forma del documento; el editor no permite publicar sin
el set completo.