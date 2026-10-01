# API Contract — Sales Playbook

> Endpoints internos. Auth: `withAuth(session)` →
> `session.organizationId`. Multi-tenant: cada acceso pasa por
> `scoped()`.

## GET /api/playbook

Devuelve la versión publicada (si existe) y el draft activo (si
existe) de la organización de la sesión.

**Response 200**:

```json
{
  "playbook": {
    "id": "sp_abc",
    "organization_id": "org_xyz",
    "slug": "vende-veloz-365",
    "label": "Vende Veloz 365 — Academia Bajo Control",
    "created_at": "...",
    "updated_at": "..."
  },
  "published": {
    "id": "spv_001",
    "version_number": 1,
    "schema_version": "1.0",
    "status": "published",
    "product": {...},
    "offer": {...},
    "commercial_policy": {...},
    "priorities": {...},
    "writer": {...},
    "jev_questions": {...},
    "prohibitions": {...},
    "handoff": {...},
    "urgency_rules": "...",
    "notes": "V1 sembrada por bootstrap",
    "created_at": "...",
    "published_at": "..."
  } | null,
  "draft": { /* mismo shape, status: "draft" */ } | null
}
```

**Errores**:

- 401 si no hay sesión.
- 404 si la organización no tiene playbook (el bootstrap es por
  enumeración de `agent_profile.salesOrchestratorEnabled=true` al
  boot del sistema; este endpoint no siembra bajo demanda).

## POST /api/playbook/draft

Crea un nuevo `draft` desde la versión publicada actual.

**Body**:

```json
{ "notes": "texto opcional que explica el cambio" }
```

**Response 201**:

```json
{ "draft": { /* shape completo, status: "draft" */ } }
```

**Errores**:

- 401 si no hay sesión.
- 409 `draft_already_open` si ya existe un draft activo.
- 422 `no_published_baseline` si no hay publicada.

## PUT /api/playbook/draft

Actualiza el draft activo. El server valida todo el config contra
el schema Zod actual **y** aplica las guardarraíles Jev:

- `engine-required` (`next_action`, `needs_human_call`) no se
  pueden eliminar, desactivar ni cambiar de type.
- `next_action.criteria` debe contener **exactamente** las 7
  option keys del V1.
- `needs_human_call.criteria` debe tener exactamente
  `{ true, false }`.
- `buying_timing.criteria` debe contener **exactamente** las 5
  option keys V1.
- `main_value_proposition.criteria` debe contener **exactamente**
  las 5 option keys V1.

**Body** (PUT parcial, mismos bloques que `ConfigV1`):

```json
{
  "product": {...} | null,
  "offer": {...} | null,
  "commercial_policy": {...} | null,
  "priorities": {...} | null,
  "writer": {...} | null,
  "jev_questions": {...} | null,
  "prohibitions": {...} | null,
  "handoff": {...} | null,
  "urgency_rules": "..." | null,
  "notes": "..."
}
```

Solo se aplican los bloques presentes. El server **siempre
re-valida el documento entero** después del patch.

**Response 200**: `{ draft }` con shape completo.

**Errores**:

- 401 si no hay sesión.
- 404 `no_draft` si no hay draft activo.
- 422 con detalle de validación de Zod:
  - `code: 'validation_failed'`, `details[]`.
  - `code: 'engine_required_missing'`, `key`.
  - `code: 'engine_required_type_mismatch'`, `key`.
  - `code: 'engine_required_disabled'`, `key`.
  - `code: 'choice_keys_mismatch'`, `key` (con `expected` y
    `actual`).

## POST /api/playbook/validate

Valida un payload contra el schema **sin persistir**. Útil para
el editor en tiempo real.

**Body**: documento entero `ConfigV1`.

**Response 200**: `{ ok: true }`.

**Response 422**:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "El payload no cumple el schema 1.0",
    "details": [
      { "path": ["writer", "present_price"], "message": "Required" }
    ]
  }
}
```

## POST /api/playbook/publish

Promueve el draft activo a `published`. En la misma transacción:

1. Si hay publicada actual → pasa a `archived`.
2. El draft activo pasa a `published`, `published_at` = now().

**Body**: `{ notes: string }`. `notes` requerido (≥ 3 chars).

**Response 200**:

```json
{
  "published": { /* shape */ },
  "archived": { /* shape */ } | null
}
```

**Errores**:

- 401 si no hay sesión.
- 404 `no_draft` si no hay draft activo.
- 422 `validation_failed` con detalles.
- 409 si por concurrencia otro caller ya publicó.

## POST /api/playbook/rollback

Republica una versión archivada (o cualquier versión histórica)
como `published`. El server hace **rollback** en el sentido de
"vuelve a esta versión"; no edita versiones inmutables.

**Body**: `{ version_id: string, notes: string }`.

**Response 200**:

```json
{
  "published": { /* shape de la versión republicada */ },
  "archived": { /* shape de la que estaba publicada antes */ }
}
```

**Errores**:

- 401 si no hay sesión.
- 404 `version_not_found`.
- 422 si la versión objetivo tiene `schema_version` desconocido
  para el loader (sin migrador).

## GET /api/playbook/versions

Lista todas las versiones de la organización, ordenadas por
`version_number` desc.

**Response 200**:

```json
{
  "versions": [
    {
      "id": "spv_001",
      "version_number": 1,
      "schema_version": "1.0",
      "status": "archived" | "draft" | "published",
      "notes": "...",
      "created_at": "...",
      "published_at": "..." | null,
      "archived_at": "..." | null,
      "size_bytes": 12345
    }
  ]
}
```

## GET /api/playbook/versions/[id]

Detalle completo de una versión.

**Response 200**: shape completo de la versión.

**Errores**:

- 401 si no hay sesión.
- 404 si la versión no pertenece a la organización del caller.

## Reglas transversales

- **Idempotencia**: ningún endpoint muta fuera de una transacción.
  los reintentos idempotentes (mismo body, misma versión) son
  seguros.
- **Tenant isolation**: cualquier acceso a BD pasa por `scoped()`.
  Tests cubren el intento cross-tenant.
- **Validación**: ningún payload entra a BD sin pasar por Zod +
  guardarraíles Jev.
- **Errores**: `apiError(status, code, message)` consistente con
  el resto de la API.
- **Authz**: solo `withAuth` (no hay roles extra en V1). El
  agente de IA no escribe aquí.
- **Auditoría**: el campo `notes` es obligatorio en publish y
  rollback.
- **Sin cache**: el loader lee BD en cada turno. Publish/rollback
  toma efecto en el siguiente turno.

## Forma JSON resumida del config

```ts
type ConfigV1 = {
  schema_version: "1.0";
  product: ProductV1;
  offer: OfferV1;
  commercial_policy: PolicyV1;
  priorities: PrioritiesV1;
  writer: WriterV1;
  jev_questions: Record<string, QuestionV1>;
  prohibitions: ProhibitionsV1;
  handoff?: HandoffV1;
  urgency_rules?: string | null;
};
```

Los tipos detallados viven en
`src/lib/sales/playbook/schema.ts` (Zod). El spec `data-model.md`
los describe.