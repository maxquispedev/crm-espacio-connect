# Quickstart — Self-test del Sales Playbook (con mocks)

> Validación manual reproducible con la app viva y los mocks
> activos.

## Pre-requisitos

- App levantada (`pnpm dev` o compose).
- Mocks activos: `WA_MOCK_ENABLED=true`,
  `META_GRAPH_BASE_URL` apunta a `/api/dev/wa-mock`,
  `OPENROUTER_BASE_URL` apunta a `/api/dev/ai-mock`,
  `TYPESAFE_JEV_ENDPOINT` apunta a `/api/dev/jev-mock`.
- DB con la migración `0008_sales_playbook` aplicada.

## 1. Bootstrap multi-org al boot

El sistema enumera explícitamente:

```
SELECT organization_id FROM agent_profile
WHERE sales_orchestrator_enabled = true;
```

Para cada `orgId` resultante, llama a
`bootstrapOrgIfNeeded(orgId)`:

- Si la org ya tiene playbook → skip.
- Si no → crea `sp_*` + `spv_001` con la V1 "Academia Bajo
  Control" como `published`.

Idempotencia: re-ejecutable sin duplicar. Tests unitarios cubren 2
orgs enabled, 1 enabled + 1 disabled, segunda ejecución sin
duplicados, cero cruce cross-tenant.

**Esperado tras el boot**:

```
GET /api/playbook          → 200 con V1 (organizaciones enabled)
GET /api/playbook (org X)  → 404 si org X tiene orchestrator OFF
```

## 2. Crear draft

```
POST /api/playbook/draft
{ "notes": "Cambio de copy en present_price" }
```

**Esperado**: 201 con `draft` que es copia de la publicada actual.

## 3. Validar cambio

```
POST /api/playbook/validate
{
  "writer": { "present_price": "Nuevo texto..." },
  ... (resto del config completo, igual al publicado, salvo writer.present_price)
}
```

**Esperado**: 200 con `{ ok: true }`.

## 4. Intentar romper el contrato Jev

```
POST /api/playbook/validate
{
  ...,
  "jev_questions": {
    ...,
    "next_action": {
      "type": "choice",
      "enabled": true,
      "instructions": "...",
      "criteria": {
        "ask_more_questions": "...",
        "show_operations_demo": "...",
        "show_online_enrollment_demo": "...",
        "present_price": "...",
        "schedule_call": "...",
        "schedule_follow_up": "...",
        "disqualify": "...",
        "extra_option": "..."  // <-- no permitida
      }
    },
    "needs_human_call": {
      "type": "noul",
      "enabled": false,  // <-- no permitido
      ...
    }
  }
}
```

**Esperado**: 422 con `code: 'choice_keys_mismatch'` y/o
`code: 'engine_required_disabled'`.

## 5. Guardar draft

```
PUT /api/playbook/draft
{ "writer": { "present_price": "Nuevo texto..." } }
```

**Esperado**: 200 con el draft actualizado.

## 6. Publicar

```
POST /api/playbook/publish
{ "notes": "Copy de present_price ajustado" }
```

**Esperado**: 200 con `published` (la nueva) y `archived` (la V1
anterior). El siguiente turno del orquestador ya consume la nueva.

## 7. Rollback

```
POST /api/playbook/rollback
{
  "version_id": "spv_001",
  "notes": "V1 mejor, volvemos"
}
```

**Esperado**: 200 con la versión `spv_001` republicada como
`published` y la actual pasando a `archived`. El siguiente turno
ya consume la V1.

## 8. Verificar runtime (contrato dinámico)

Con un inbound sintético (y la V1 publicada cargada):

```
POST /api/dev/wa-mock/inbound
{ "from": "521000000099", "text": "Hola, me interesa", "ad_attribution": null }
```

Esperado:

- El agente redacta usando el **contenido del playbook**.
- El log del system prompt del writer cita el `product.name`
  publicado.
- `lead.last_jev_decision.playbook_version_id` apunta a la
  publicada actual.
- `lead.last_jev_playbook_version_id` y
  `lead.last_jev_playbook_schema_version` están poblados.

## 9. Desactivar una `known signal` y verificar fallback

```
PUT /api/playbook/draft
{
  "jev_questions": {
    ...,
    "buying_timing": { "type": "choice", "enabled": false, ... },
    ...,
    "next_action": {...},
    "needs_human_call": {...}
  }
}
POST /api/playbook/publish
{ "notes": "Sin buying_timing" }
```

Esperado en el siguiente inbound:

- El payload a Jev **NO** incluye `buying_timing`.
- La respuesta de Jev no contiene `buying_timing`.
- `decision.buyingTiming === null`.
- El writer omite la línea de timing; el resolver trata como
  `"unknown"` (no branching `future_season`).

## 10. Override de Playbook en Laboratorio (Draft sin publicar)

```
POST /api/lab/runs
{ "playbook_mode": "draft" }
```

Esperado:

- El runner pasa `playbookOverride` al orquestador.
- El orquestador exige `is_test=true` (la conversación sandbox lo
  es); acepta el override.
- El payload a Jev usa las `jev_questions` del draft.
- Resultado persistido con `playbook_version_id` del draft.
- **Cero** filas en `sales_follow_up_job` por esa corrida
  (follow-ups suprimidos en `is_test`).
- **Cero** llamadas a `graphRequest` (WhatsApp real bloqueado).
- **Cero** eventos CAPI.

## 11. Comparar Published vs Draft

```
POST /api/lab/runs
{ "playbook_mode": "both" }
```

Esperado:

- Dos corridas en paralelo (una con publicada, otra con draft).
- Cada caso persistido con su `playbook_version_id`.
- UI muestra diff lado a lado.
- Expected outcomes humanos (`expected_next_action`,
  `expected_lane`, `expected_handoff`) se comparan con ✅/❌.

## 12. Caminos infelices cubiertos

- Draft duplicado → 409.
- PUT con payload inválido → 422 con `details[]`.
- Quitar `next_action` del payload → 422 con
  `code: 'engine_required_missing'`.
- Cambiar `type` de `next_action` → 422.
- Renombrar option key de `next_action` → 422 con
  `code: 'choice_keys_mismatch'`.
- Desactivar `next_action` o `needs_human_call` → 422 con
  `code: 'engine_required_disabled'`.
- Override de Playbook sobre conversación `is_test=false` →
  `throw('playbook_override_forbidden_in_production')`.
- Rollback a versión inexistente → 404.
- Cross-tenant: GET `/api/playbook` con sesión de otra org → no
  leak.

## 13. Cleanup

```
# Apagar orquestador y follow-ups
PUT /api/agent/profile
{ "salesOrchestratorEnabled": false, "salesFollowUpsEnabled": false }
```

El playbook queda persistido y disponible para cuando se vuelva a
encender.