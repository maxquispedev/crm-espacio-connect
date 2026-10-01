# Quickstart — Self-test del Sales Playbook (con mocks)

> Validación manual reproducible con la app viva y los mocks activos.

## Pre-requisitos

- App levantada (`pnpm dev` o compose).
- Mocks activos: `WA_MOCK_ENABLED=true`,
  `META_GRAPH_BASE_URL` apunta a `/api/dev/wa-mock`,
  `OPENROUTER_BASE_URL` apunta a `/api/dev/ai-mock`,
  `TYPESAFE_JEV_ENDPOINT` apunta a `/api/dev/jev-mock`.
- DB con la migración `0008_sales_playbook` aplicada.

## 1. Bootstrap automático

```
GET /api/playbook
```

Sin publicaciones previas para la organización. Si tiene
`salesOrchestratorEnabled=true`, el bootstrap al boot debería haber
creado `sp_*` y `spv_*` con la V1.

**Esperado**: 200 con `playbook`, `published` (status=published, schema_version="1.0"),
y `draft = null`.

## 2. Crear draft

```
POST /api/playbook/draft
{
  "notes": "Cambio de copy en present_price"
}
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

## 4. Guardar draft

```
PUT /api/playbook/draft
{
  "writer": { "present_price": "Nuevo texto..." }
}
```

**Esperado**: 200 con el draft actualizado.

## 5. Publicar

```
POST /api/playbook/publish
{
  "notes": "Copy de present_price ajustado"
}
```

**Esperado**: 200 con `published` (la nueva) y `archived` (la V1 anterior).

## 6. Rollback

```
POST /api/playbook/rollback
{
  "version_id": "spv_001",
  "notes": "V1 de Vende Veloz mejor, volvemos"
}
```

**Esperado**: 200 con la versión `spv_001` republicada como `published`
y la actual pasando a `archived`.

## 7. Verificar runtime

Con un inbound sintético:

```
POST /api/dev/wa-mock/inbound
{
  "from": "521000000099",
  "text": "Hola, me interesa",
  "ad_attribution": null
}
```

Esperado:

- El agente redacta usando el **contenido del playbook** (verificable
  en logs del system prompt: `Producto: ...` viene del config).
- `lead.last_jev_decision.playbook_version_id` apunta a la versión
  publicada.
- `lead.last_jev_playbook_version_id` y
  `lead.last_jev_playbook_schema_version` están poblados.

## 8. Laboratorio comercial

```
POST /api/lab/runs
{ "playbook_mode": "published" }
```

Esperado:

- Corrida con los 6 personas V1 commerciales (sustituye a las 6
  ferreteras).
- Cada caso persiste `playbook_version_id` y `playbook_schema_version`.
- Las conversaciones `is_test=true` no tocan WhatsApp real (sender
  lanza excepción si alguien intenta enviar).

## 9. Laboratorio — comparar Published vs Draft

```
POST /api/lab/runs
{ "playbook_mode": "draft" }
```

Esperado:

- Corrida con la **misma** config pero el `playbook_version_id` apunta
  al draft activo. El UI muestra diff por caso: "expected next_action"
  vs "actual next_action", con tilde verde/rojo.

## 10. Caminos infelices cubiertos

- Draft duplicado → 409.
- PUT con payload inválido → 422 con `details`.
- Quitar `next_action` del payload → 422 con `path: ["jev_questions"]`.
- Cambiar `type` de `next_action` → 422.
- Rollback a versión inexistente → 404.
- Cross-tenant: GET `/api/playbook` con sesión de otra org → la fila
  propia no aparece, no leak.

## 11. Cleanup

```
# Apagar orquestador y follow-ups
PUT /api/agent/profile
{ "salesOrchestratorEnabled": false, "salesFollowUpsEnabled": false }
```

El playbook queda persistido y disponible para cuando se vuelva a
encender.