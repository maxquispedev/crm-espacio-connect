# Contract — Sales Playbook Config

> Documento versionado que el motor consume. Schema version **1.0**.
> El loader rechaza `schema_version` desconocido.

## Principios

1. El config describe **estrategia**, no implementación. No contiene
   secretos, IDs internos ni umbrales numéricos del resolver.
2. Cada bloque tiene forma **bounded**: Zod valida tamaños. La BD nunca
   acepta un payload > 32 KB.
3. Las preguntas `next_action` y `needs_human_call` son **estructurales**:
   su `key` y `type` no cambian. Sus `criteria`/`instructions` son
   editables.
4. El `schema_version` viaja con cada versión persistida para que el
   loader pueda migrar configs antiguas sin romper.

## Forma del documento (Zod, fuente de verdad)

`src/lib/sales/playbook/schema.ts` define el Zod. Este contrato es la
especificación legible.

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
obligatorias:

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

Claves requeridas en V1:
- `real_operational_need` (noul)
- `product_fit` (score)
- `motivation_to_change` (score)
- `purchase_intent` (score)
- `buying_timing` (choice)
- `main_value_proposition` (choice)
- `next_action` (choice) — **protegida**
- `needs_human_call` (noul) — **protegida**

Claves adicionales: permitidas si siguen `^[a-z_]+$` y máx 60 chars.
Se tratan como **analíticas** (el motor las omite del state).

### `prohibitions`

```yaml
neverPromise: list       # 0..20 items, cada uno 1..200
prohibitedClaims: list   # 0..20 items, cada uno 1..200
```

`neverPromise` viene del bloque `offer`; el editor lo mantiene en sync
visualmente (no se duplica en BD, pero el wire format lo replica para
que el writer lo reciba).

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
- Las preguntas protegidas (`next_action`, `needs_human_call`) **no
  pueden cambiar `key` ni `type`**. Tests cubren el intento.
- El borrador es único por playbook (índice parcial UNIQUE).
- La publicada es única por playbook (índice parcial UNIQUE).
- `version_number` único por `playbook_id`.
- El loader invalida cache al detectar cambio de versión.

## Migración de schema

Cuando el `schema_version` cambie (e.g. a `1.1` o `2.0`):

1. Se registra un migrador en `src/lib/sales/playbook/migrators/`.
2. El loader lo aplica al cargar versiones con `schema_version` antiguo.
3. Si no hay migrador, el loader rechaza con error legible; el caller
  puede crear un nuevo draft con el schema actual.

## Wire format

Igual al documento entero. No se transforma para envío. El cliente (UI)
lo recibe con claves snake_case (consistente con `VENDE_VELOZ_PRODUCT`).

## Forma mínima válida (ejemplo)

```json
{
  "schema_version": "1.0",
  "product": {
    "name": "Acme",
    "one_liner": "Lo que hacemos",
    "who_it_is_for": ["academias"],
    "core_jobs": ["alumnos"],
    "not_the_product": [],
    "how_it_starts": "Empezamos por entender la operación."
  },
  "offer": {
    "currency": "PEN",
    "setup": 0,
    "monthlyBase": 0,
    "includedActiveStudents": 1,
    "extraPerActiveStudent": 0,
    "setupIsOneTime": true,
    "implementation": { "purpose": "adopción", "includes": ["setup"] },
    "neverPromise": ["ventas"]
  },
  "commercial_policy": {
    "defaultChannel": "WhatsApp",
    "goal": "g",
    "automationFirst": "a",
    "autoClose": "ac",
    "humanHandoff": "h",
    "futureInterest": "f",
    "noResponse": "n",
    "disqualification": "d",
    "evidenceRule": "e"
  },
  "priorities": { "primary": ["control"], "secondary": [], "tertiary": [] },
  "writer": {
    "ask_more_questions": "...",
    "show_operations_demo": "...",
    "show_online_enrollment_demo": "...",
    "present_price": "...",
    "schedule_call": "...",
    "schedule_follow_up": "...",
    "disqualify": "..."
  },
  "jev_questions": {
    "next_action": {
      "type": "choice",
      "enabled": true,
      "instructions": "...",
      "criteria": { "ask_more_questions": "...", "disqualify": "..." }
    },
    "needs_human_call": {
      "type": "noul",
      "enabled": true,
      "instructions": "...",
      "criteria": { "true": "...", "false": "..." }
    }
  },
  "prohibitions": { "neverPromise": [], "prohibitedClaims": [] },
  "handoff": {},
  "urgency_rules": null
}
```

Este ejemplo **NO es válido** porque faltan las 6 preguntas
estructurales adicionales. Se incluye solo para mostrar la forma mínima
del documento; el editor no permite publicar sin las 8 estructurales.