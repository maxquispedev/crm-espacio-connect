# Implementation Plan: 007 — Meta CAPI para leads Click-to-WhatsApp

**Branch**: `007-meta-capi` | **Date**: 2026-09-29 | **Spec**: [spec.md](./spec.md)
**Upstream de referencia**: `kevinrivm/vocero-crm` · commits
`0a154ea2711ad5350e20451c573a7863b926cfed` y
`75124422bba2298bb21cf3e712cae16b31f01ce2` (specs/016, docs/atribucion-capi.md).
**Adaptación selectiva**, no port ciego: el fork tiene Jev (Sales Orchestrator)
que hoy escribe `lead.stageId` por su propio camino.

**Carril declarado**: **ciclo completo** (Principio VI) — toca el modelo de
datos (dos tablas nuevas + una reutilizada de 006) y publica un contrato
(`/api/settings/capi/*`).

## Summary

Tres piezas, en este orden estricto:

1. **Capturar** está hecho por 006 (`ad_attribution` con `ctwa_clid`); 007 lo
   consume, no lo repite.
2. **Reportar** `QualifiedLead` y `Purchase` desde la **única puerta** que
   mueve leads de etapa, con dedup en base y best-effort absoluto. Esa puerta
   **no existe todavía** — el Corte A la crea sin CAPI y sin cambio
   observable.
3. **Pantalla** para conectar el dataset, elegir qué etapa del tenant es
   "calificada" y ver qué se le reportó a Meta.

Lo que sube es el mecanismo, no la operación de nadie: la etapa calificada la
elige cada negocio, la venta cuelga del `kind = "won"` que ya existe en
`pipelineStage`, y quedan fuera el backfill, el espejo `InitiateCheckout` y
los dashboards de 019.

## Technical Context

**Language/Version**: TypeScript estricto (`strict` + `noUncheckedIndexedAccess`), Node 22.

**Primary Dependencies**: **ninguna nueva**. Salida por el `graphRequest` ya
presente en `src/lib/meta/client.ts`, cifrado por `lib/crypto`, validación
con Zod — todo reutilizado.

**Storage**: PostgreSQL + Drizzle. Tablas nuevas en una migración aditiva
(`drizzle/00XX_meta_capi.sql`), aplicada al arrancar el contenedor como el
resto del repo. Reutiliza `ad_attribution` de 006.

**Testing**: Vitest para lo puro (payload, catálogo, centavos→unidades,
bandera, traducción de filas de actividad) + `pnpm test:e2e` extendido
(`scripts/e2e-selftest.mjs`) corrido en **las dos** configuraciones. El
mock de Graph aprende `POST {dataset}/events`.

**Target Platform**: el mismo monolito self-hosted; sin procesos ni servicios
nuevos.

**Performance Goals**: la emisión agrega una llamada HTTP a Meta al movimiento
de etapa que dispara, con el timeout del cliente Graph existente, **fuera**
de la transacción. Ningún otro camino se toca.

**Constraints**: `organization_id` vía `scoped()`; secretos cifrados y solo
`last4` hacia afuera; `is_test` sin efectos externos; bandera apagada ⇒
404 en toda la superficie, sin captura extra y con el prompt del agente
intacto. **Una sola puerta runtime** para cambios de etapa antes de
enganchar CAPI.

**Scale/Scope**: dos eventos por lead como máximo, uno por cambio de etapa
relevante. La actividad es un panel de 25–50 filas.

## Auditaría previa de `lead.stageId` (específico del fork)

Antes del Corte A se enumeran los callsites runtime — todos deben pasar por
la puerta única antes de Corte B:

| Archivo | Línea | Tipo de actor | Patrón actual |
|---|---|---|---|
| `app/api/pipeline/leads/[id]/route.ts` | 39 | humano (drag/drop) | `UPDATE lead SET stageId = $1, position = $2, updatedAt = now()` |
| `app/api/pipeline/stages/[id]/route.ts` | 76, 105, 110 | humano (eliminar/mover etapa) | bulk `UPDATE lead SET stageId = $moveTo WHERE stageId = $id` |
| `app/api/bot/reset/route.ts` | 79 | `system` | set al primer stage del tenant |
| `server/ai/pipeline.ts` | 231 | `agent` (IA inline) | `set({ stageId, updatedAt, lastActivityAt })` |
| `server/sales/orchestrator.ts` | 153 | `agent` (Jev/Sales Orchestrator) | `patch.stageId = nextStageId` antes del update |
| `server/inbox/lead-activity.ts` | 78 | `system` | primer stage del tenant al crear lead por inbound |
| `server/seed/demo.ts` | 236 | seed | demo, **fuera de scope** del gateway |

El Corte A migra los **6 callsites runtime** a un único helper
`moveLeadStage(input)`, conservando `updatedAt`/`lastActivityAt`/`position` y
los hechos/lanes de Jev sin cambio observable.

## Project Structure (post-cortes)

```
specs/007-meta-capi/
├── spec.md · plan.md · tasks.md
├── quickstart.md             (Corte C — self-test con mocks)
└── contracts/
    ├── settings-capi.md      (Corte B — endpoints internos)
    └── evento-meta.md        (Corte B — payload + acuse)

src/
├── lib/
│   ├── db/schema.ts                    # + conversion_event, capi_settings
│   ├── db/ids.ts                       # + cev_, ccs_ prefijos
│   ├── env.ts                          # + ATRIBUCION (documentada)
│   └── meta/capi.ts                    # NUEVO — payload, catálogo, acuse
├── server/
│   ├── leads/
│   │   └── stage-gateway.ts            # NUEVO (Corte A) — única puerta
│   ├── attribution/
│   │   ├── flag.ts                     # NUEVO — la bandera
│   │   ├── settings.ts                 # NUEVO — settings cifrados
│   │   └── conversions.ts              # NUEVO — emisión + actividad
│   ├── inbox/{webhook,ingest}.ts       # (006 ya entrega el referral)
│   ├── sales/orchestrator.ts           # migrado al gateway (Corte A)
│   ├── ai/pipeline.ts                  # migrado al gateway (Corte A)
│   ├── inbox/lead-activity.ts          # migrado al gateway (Corte A)
│   ├── seed/demo.ts                    # sin cambios (seed)
│   └── tenants/scope.ts                # sin cambios (scoped())
├── app/
│   ├── api/settings/capi/{route,events/route}.ts   # NUEVO (Corte B)
│   └── (app)/settings/
│       ├── layout.tsx                  # + pestaña "Anuncios" condicionada
│       └── ads/page.tsx                # NUEVO (Corte C)
├── components/settings/{settings-nav,ads-client}.tsx   # NUEVO (Corte C)
└── app/api/dev/wa-mock/**              # + {dataset}/events (Corte B)

drizzle/00XX_meta_capi.sql
docs/atribucion-capi.md                 # guía del dueño (Corte C)
tests/unit/{capi-payload,capi-flag,conversions,stage-gateway}.test.ts
tests/e2e/us-meta-capi.md + scripts/e2e-selftest.mjs
```

## Fases

**Fase 0 — Research** ✅ upstream 016 leído y adaptado al fork; auditoría
de callsites de `lead.stageId` hecha en este plan.

**Fase 1 — Diseño** ✅ este `plan.md` (puerta única, schema, contratos,
cortes A/B/C).

**Fase 2 — Tareas** → `tasks.md`, agrupadas por corte en orden
estrictamente secuencial.

**Fase 3 — Implementación y verificación por corte** — cada corte cierra
con gate técnico + self-test de su alcance antes de pasar al siguiente.

## Constitución Check

| Principio | Cumplimiento |
|---|---|
| **I. Seguridad** | Token CAPI cifrado AES-256-GCM con `lib/crypto`; hacia el cliente solo `last4` y estado; nunca a logs. El `ctwa_clid` es un identificador de clic, no un dato personal — hacia Meta **no viaja** teléfono, nombre ni texto. |
| **II. Soberanía** | ✅ Es **la misma Meta Graph API** del canal ya permitido. Traje completo de conector opcional: apagado por defecto, aislado en `lib/meta/capi.ts` con contrato público, degradación definida (su fallo jamás bloquea), credenciales del negocio cifradas, CI apagado/encendido. Cero dependencias de runtime nuevas. |
| **III. Multi-tenancy** | `organization_id NOT NULL` en tablas nuevas; todo acceso por `scoped()`; configuración única por organización. |
| **IV. Idempotencia** | Dedup **es** un `UNIQUE (organization_id, conversation_id, event_name)` con `ON CONFLICT DO NOTHING`. Migración re-ejecutable. |
| **V. Calidad verificable** | Gate técnico + unit de piezas puras + arnés E2E en **las dos** configuraciones, incluido el camino infeliz (Meta rechazando, token vencido, sin `ctwa_clid`, `is_test`, sin etapa calificada configurada). |
| **VI. Specs antes de código** | Carril ciclo completo declarado; spec, plan, tasks preceden al código. |
| **VII. Trazabilidad** | Decisiones no obvias documentadas en el spec (etapa configurable, sin valor falso, sin espejo de `InitiateCheckout` de fábrica). |
| **VIII. Foco vertical** | Dos eventos, una pantalla, cero dashboards. No es una suite de analítica. |
| **IX. Verificación en vivo** | `quickstart.md` define el self-test contra la app viva con mocks; nada se declara Hecho sin ese loop en verde en **las dos configuraciones**. |

**Guardrail del Laboratorio**: una conversación `is_test = true` jamás emite
un evento CAPI — aserción antes de salir, hermana de la del sender y la de
los conectores de agenda.

**Resultado del gate**: PASA sin violaciones. No requiere enmienda
constitucional — no entra ningún proveedor nuevo (es la misma Meta Graph
del canal WhatsApp ya permitido).

## Complexity Tracking

Ninguna violación que rastrear. La complejidad agregada —una llamada de red
colgada del movimiento de etapa, más el refactor de 6 callsites a un
gateway— se acota con reglas duras:

- Una sola puerta runtime para `lead.stageId` antes de tocar Meta.
- Emisión fuera de transacción, envuelta en `try/catch`, con su desenlace
  escrito en una fila consultable.
- Acuse válido: `events_received >= 1`.
- Flag apagada = superficie inexistente; cero impacto cuando no se usa.

## Decisiones de diseño específicas del fork

1. **Etapa calificada configurable**, no hardcodeada a "Interesado". El
   selector lista las `pipelineStage` con `kind = "open"` del tenant. Sin
   selección, el reporte de `QualifiedLead` queda en `skipped` con motivo.
2. **`Purchase` sin valor inventado**. Si el lead no tiene monto válido en
   el modelo actual, se envía sin `value`/`currency` — jamás `0`. Esta
   regla protege la optimización por valor de Meta.
3. **Token reusado del WhatsApp business**. Si la conexión ya existe, no
   se pide token nuevo. Pegar token específico es opcional, cifrado con la
   misma capa. Esto evita pedir al dueño una credencial que ya autorizó.
4. **`event_name` y `event_time` se derivan del lado servidor**, no del
   cliente, para evitar drift entre lo que ve el dueño y lo que Meta
   recibe.
5. **El gateway del Corte A no conoce CAPI**. Recibe un `actor`
   opcional (`human`/`agent`/`bot`/`system`) que hoy no se usa más que
   para auditoría, pero deja la puerta abierta a reportes futuros sin
   re-arquitectura.
6. **Cero Marketing API**. Campañas, creativos y audiencias no entran en
   este spec.
7. **Cero espejo de `InitiateCheckout`**. La receta queda documentada en
   `docs/atribucion-capi.md` para que cada fork la agregue si quiere —
   es una decisión de negocio, no una verdad del CRM.

## Riesgos y mitigaciones (resumen)

- Sales Orchestrator saltándose CAPI → **Corte A cierra el bypass**.
- Doble webhook duplicando evento → `UNIQUE` + `ON CONFLICT DO NOTHING`.
- Valor falso envenenando optimización → nunca `0` inventado.
- Meta devolviendo 200 con evento tirado → único acuse válido:
  `events_received >= 1`.
- `QualifiedLead` en campaña de **ventas** → documentado en
  `docs/atribucion-capi.md` con la receta de `InitiateCheckout`.

## Definición de Hecho por corte

- **Corte A**: gate técnico en verde; 6 callsites migrados; tests del
  gateway verdes; cero cambio observable; working tree limpio; un commit.
- **Corte B**: gate técnico en verde; migración aplicada; unit de piezas
  puras verdes; arnés E2E extendido y verde con `ATRIBUCION=on`; token
  reusado y/o específico cifrado; working tree limpio; un commit.
- **Corte C**: gate técnico en verde; UI Ajustes → Anuncios funcional;
  arnés E2E verde en **las dos configuraciones** (con y sin bandera);
  `docs/atribucion-capi.md` escrito; working tree limpio; un commit final
  de cierre.

La feature 007 no se declara Hecha hasta que los tres cortes estén verdes.
