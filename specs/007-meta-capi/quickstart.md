# Quickstart — Spec 007 (Meta CAPI) — self-test con mocks

> Self-test de comportamiento para las dos configuraciones
> (`ATRIBUCION=on` y apagada). Conduce la app real con los mocks de Graph
> en lugar de darle el guion al humano.

## Pre-requisitos

1. PostgreSQL local (DATABASE_URL apuntando a una BD limpia).
2. App levantada con `pnpm dev` (Next.js dev server en :3000).
3. `pnpm db:migrate` aplicado (Corte B trae `drizzle/0007_meta_capi.sql`).
4. Variables de entorno mínimas en `.env`:

   ```bash
   APP_BASE_URL=http://localhost:3000
   DATABASE_URL=postgresql://...
   BETTER_AUTH_SECRET=...
   ENCRYPTION_KEY=...
   META_WEBHOOK_VERIFY_TOKEN=...
   BOT_API_KEY=...               # ≥16 caracteres
   WA_MOCK_ENABLED=true          # habilita /api/dev/wa-mock
   META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph
   ```

5. Decidir el modo:

   ```bash
   # Modo A — ATRIBUCION apagada (defecto, 404 en toda la superficie CAPI):
   # (variable ausente o ATRIBUCION="")

   # Modo B — ATRIBUCION encendida (pestaña Anuncios visible, APIs 200):
   ATRIBUCION=on
   ```

## Correr el self-test

```bash
node --env-file=.env scripts/e2e-selftest.mjs
```

El arnés ejecuta `runSection011` (006) y `runSection012` (007). Sale con
código 1 si algún check falla.

### Cobertura de la sección 012 por modo

| Modo | Caminos cubiertos |
|---|---|
| **ATRIBUCION apagado** | GET/PUT `/api/settings/capi` → 404; GET `/api/settings/capi/events` → 404; `/settings/ads` → 404; 006 sigue mostrando `anuncio` en conversaciones con CTWA; el `ctwa_clid` jamás aparece por API. |
| **ATRIBUCION=on** | Etapa de otro tenant → 422 `invalid_stage`; guardar config sin token propio (reusa WA); guardar config con token (last4 visible, ciphertext nunca); CTWA → mover a etapa calificada → fila `QualifiedLead sent` con `fbtrace_id`; repetir move → no duplica (UNIQUE); mover a `kind = "won"` → fila `Purchase sent` SIN `value` inventado; lead orgánico → `skipped` con `skipReason = "sin_ctwa_clid"`; DSET-ZERO → `failed` con motivo `events_received=0` pero el stage sí cambia; token inválido → `failed` con motivo, app no se cuelga; Jev moviendo etapa → misma puerta, mismo dedup, no duplica QualifiedLead; `ctwa_clid` jamás aparece por API. |

## Tokens del mock que fuerzan caminos específicos

El mock `wa-mock/graph/[...path]/route.ts` (dev-only) reconoce:

| Path / patrón | Efecto |
|---|---|
| `POST /{datasetId}/events` con `datasetId = "DSET-FAIL"` | Responde 400 con error GraphMethodException → fila `failed`. |
| `POST /{datasetId}/events` con `datasetId = "DSET-ZERO"` | Responde 200 con `events_received: 0` → fila `failed` con motivo `events_received=0`. |
| Cualquier otro `datasetId` | Responde 200 con `events_received: 1` + `fbtrace_id` → fila `sent`. |
| Bearer token terminado en `-invalid` | Responde 401 OAuthException → fila `failed`, app no se rompe. |

## Verificación humana pendiente

- **Clic CTWA real contra producción.** El self-test cubre todos los
  caminos verificables sin tocar Meta real (mock reconoce `ctwa_clid`,
  `wabaId`, datasets especiales, tokens inválidos). El clic real contra
  Meta queda como **PENDIENTE HUMANO/PRODUCCIÓN**, igual que el upstream
  016 y que el clic CTWA real del spec 006.

## Cómo correr el self-test en CI

```yaml
- name: Self-test CAPI (modo ATRIBUCION=on)
  env:
    ATRIBUCION: "on"
    WA_MOCK_ENABLED: "true"
    META_GRAPH_BASE_URL: "http://localhost:3000/api/dev/wa-mock/graph"
  run: node --env-file=.env scripts/e2e-selftest.mjs

- name: Self-test CAPI (modo ATRIBUCION apagado)
  env:
    # ATRIBUCION ausente
    WA_MOCK_ENABLED: "true"
    META_GRAPH_BASE_URL: "http://localhost:3000/api/dev/wa-mock/graph"
  run: node --env-file=.env scripts/e2e-selftest.mjs
```

Cada corrida ejercita **un** modo; las dos cubren el contrato completo.

## Definición de "Hecho" para Corte C

- ✅ `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en verde.
- ✅ Sección 012 del self-test verde en **las dos configuraciones**.
- ✅ `docs/atribucion-capi.md` escrito con notas del fork.
- ✅ `docs/CURRENT_STATE.md` actualizado con el cierre del 007.
- ⏳ Clic CTWA real contra Meta → **PENDIENTE HUMANO/PRODUCCIÓN**.
