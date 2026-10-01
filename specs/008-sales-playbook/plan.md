# Implementation Plan: 008 — Sales Playbook versionado

**Branch**: `008-sales-playbook` | **Date**: 2026-09-30 | **Spec**: [spec.md](./spec.md)
**Carril declarado**: **ciclo completo** (Principio VI) — toca el modelo de
datos (dos tablas nuevas), publica un contrato HTTP
(`/api/playbook/*`) y evoluciona la UI del agente.

## Summary

Siete cortes, en este orden estricto:

1. **Persistencia**: dos tablas, migración re-ejecutable, schema Zod
   versionado, bootstrap que siembra la V1 ("Academia Bajo Control") en la
   organización que ya tiene `salesOrchestratorEnabled` encendido. Sin tocar
   runtime.
2. **API de versionado**: draft / update / validate / publish / rollback /
   list con tenant isolation y validación server-side.
3. **Runtime**: `buildJevSalesState` carga la versión publicada; writer y
   follow-up writer aceptan override; agent profile (tone/instructions/
   escalation) llega al writer comercial; snapshot de versión persistido.
   Fallback explícito al hardcode mientras no exista published.
4. **UI Playbook**: editor en `agent-client.tsx`, bloques por sección,
   botones para crear draft / guardar / validar / publicar / rollback.
5. **Editor Jev avanzado**: editor de estructurales y analíticas, con
   guardarraíles.
6. **Laboratorio comercial**: pipeline real en sandbox con expected
   outcomes humanos y comparación Published vs Draft.
7. **Casos reales + bootstrap final + auditoría**: UI para guardar
   conversación como caso, decisión sobre el fallback, E2E, docs, cierre.

Lo que sube es el modelo de la estrategia; lo que no se toca es el motor.
El runtime pasa de "conocer la estrategia" a "consultar la estrategia
publicada en su versión X".

## Technical Context

**Language/Version**: TypeScript estricto (`strict` +
`noUncheckedIndexedAccess`), Node 22.

**Primary Dependencies**: **ninguna nueva**. Persistencia con Drizzle
existente, validación con Zod existente, cifrado por `lib/crypto` (no
aplica — el playbook no guarda secretos), cliente UI propio.

**Storage**: PostgreSQL + Drizzle. Migración aditiva (`drizzle/0008_*.sql`)
con el patrón `IF NOT EXISTS` + `DO $$ … EXCEPTION WHEN duplicate_object
THEN null $$` que ya usan 006 y 007.

**Testing**: Vitest para las piezas puras (Zod schema, helpers de
versión, bootstrap puro, fallback) + tests de integración que cubren
runtime con snapshot del playbook. E2E (`scripts/e2e-selftest.mjs`
extendido) en cada corte que toque UI o runtime.

**Target Platform**: el mismo monolito self-hosted. Sin procesos ni
servicios nuevos. Sin colas externas.

**Performance Goals**: la carga de la versión publicada ocurre una vez
por turno del orquestador (cache LRU opcional para v2; no es objetivo de
este spec). El config se cachea por organización en memoria del proceso
con TTL conservador; invalidación al cambiar de versión.

**Constraints**:

- `organization_id` por `scoped()` en cada acceso.
- `sales_playbook` UNIQUE por `organization_id`.
- `sales_playbook_version`: UNIQUE(`playbook_id`, `version_number`).
- Índices parciales UNIQUE: una `draft` y una `published` por `playbook_id`.
- `config_json` validado contra `schema_version` antes de cualquier INSERT.
- `next_action` y `needs_human_call`: `key` y `type` protegidos.
- No exponer el config a logs ni a endpoints de debug sin redacción.

**Scale/Scope**: en V1, 1 versión publicada + 1 draft activo + N versiones
archivadas por organización. El tamaño del config es bounded por Zod
(< 32 KB por versión razonable).

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
│       │   ├── bootstrap.ts      # NUEVO — siembra idempotente V1
│       │   └── loader.ts         # NUEVO — getPublishedForOrg con cache
│       └── (sigue intacto: vende-veloz.ts ahora se queda como DEFAULT_ONLY)
├── server/
│   ├── sales/
│   │   ├── build-state.ts        # MOD — cargar config publicado
│   │   ├── writer.ts             # MOD — aceptar override de config
│   │   ├── orchestrator.ts       # MOD — snapshot playbook_version_id
│   │   ├── follow-ups/follow-up-writer.ts # MOD — aceptar override de config
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
│   ├── page.tsx                  # MOD — lanzar corrida con config publicado
│   └── (sigue intacto)
└── server/lab/
    ├── runner.ts                 # MOD — ejecutar pipeline real (Corte 6)
    ├── judge.ts                  # sin cambios (sigue siendo el juez heurístico)
    └── personas.ts               # sigue con las 6 ferreteras; se añade V1 de commerciales

drizzle/0008_sales_playbook.sql         # migración aditiva
tests/unit/
├── playbook-schema.test.ts        # Zod
├── playbook-store.test.ts        # CRUD de versiones
├── playbook-bootstrap.test.ts    # idempotencia + creación V1
├── playbook-fallback.test.ts     # fallback cuando no hay published
└── playbook-snapshot.test.ts     # persistencia de playbook_version_id
tests/e2e/us-sales-playbook.md
```

## Fases

**Fase 0 — Research** ✅ en este `plan.md` y en `research.md`. Auditoría
de las llamadas runtime a `VENDE_VELOZ_PRODUCT` / `VENDE_VELOZ_OFFER` /
`VENDE_VELOZ_COMMERCIAL_POLICY` / `JEV_SALES_QUESTIONS_V2` hecha.

**Fase 1 — Diseño** ✅ este `plan.md`, `spec.md`, `data-model.md`.

**Fase 2 — Tareas** → `tasks.md`.

**Fase 3 — Implementación por corte** — cada corte cierra con gate
técnico + self-test de su alcance antes de pasar al siguiente.

## Callsites auditados del hardcode (Corte 3)

| Archivo | Línea(s) | Lo que se reemplazará |
|---|---|---|
| `src/server/sales/build-state.ts` | 173–174 | `state.product` / `state.commercial_policy` ← `loader.getPublishedForOrg(org)` |
| `src/server/sales/writer.ts` | 90–92, 116–117, 118–137, 150–167 | `product` / `policy` / `offer` ← override cargado por orquestador; instrucciones de writer por `next_action` ← bloque del playbook |
| `src/server/sales/follow-ups/follow-up-writer.ts` | 83–86, 109–111, 117–132, 134–148 | mismo reemplazo, con override |
| `src/server/sales/orchestrator.ts` | 11, 103 | `VENDE_VELOZ_OFFER` ← override; pasar `product`/`policy`/`offer` al writer |
| `src/server/sales/orchestrator.ts` | 138–143, 62–79 | snapshot persistido incluye `playbook_version_id` |
| `src/lib/types` (referencias a lanes/next_action) | varios | sin cambios: el motor no se toca |

Las referencias a `VENDE_VELOZ_PRODUCT` / `VENDE_VELOZ_OFFER` /
`VENDE_VELOZ_COMMERCIAL_POLICY` / `JEV_SALES_QUESTIONS_V2` siguen
existiendo como **DEFAULTS_ONLY** que el motor consume solo en el camino
de fallback. Tests cubren esa rama.

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| **I. Seguridad** | El config nunca contiene secretos; Zod rechaza payloads que se parecen a credenciales. El snapshot del playbook no se envía al cliente sin redacción (solo metadata + la sección que el editor pidió). |
| **II. Soberanía** | Cero dependencias nuevas. Persistencia misma, validación misma, UI propia. No entra proveedor externo. |
| **III. Multi-tenancy** | `organization_id NOT NULL` en ambas tablas; todo acceso por `scoped()`. UNIQUE por organización. |
| **IV. Idempotencia** | UNIQUE por (`playbook_id`, `version_number`) + UNIQUE parcial (`draft` y `published` por `playbook_id`). Migración re-ejecutable. Bootstrap idempotente (`INSERT ... ON CONFLICT DO NOTHING`). |
| **V. Calidad verificable** | Gate técnico + unit tests del Zod, del store puro, del bootstrap, del fallback + tests de integración del runtime con override + E2E (Playwright + mocks) por corte. |
| **VI. Specs antes de código** | Spec/plan/tasks preceden al código. |
| **VII. Trazabilidad** | `playbook_version_id` y `playbook_schema_version` en cada decisión Jev persistida y en cada caso del Laboratorio. Decisiones no obvias (defaults_only, fallback, guardarraíles Jev) documentadas en `spec.md` y `plan.md`. |
| **VIII. Foco vertical** | Editor por bloques, no constructor visual. Los 7 `next_action` son los del motor. No entra Zapier. |
| **IX. Verificación en vivo** | Self-test por corte (mocks). El Corte 7 corre E2E con `WA_MOCK_ENABLED=true` y `OPENROUTER_BASE_URL`/`TYPESAFE_JEV_ENDPOINT` apuntando a mocks. |

**Resultado del gate**: PASA sin violaciones. No requiere enmienda
constitucional.

## Complexity Tracking

Ninguna violación que rastrear. La complejidad agregada —un documento
versionado con editor y trazabilidad en el resolver— se acota con:

- Default congelado del motor solo como fallback documentado y testeado.
- Validación Zod en server-side antes de cualquier persistencia.
- Guardarraíles duros en el editor Jev para `next_action` y
  `needs_human_call`.
- Bootstrap idempotente sin tocar organizaciones que no usan
  `salesOrchestratorEnabled`.
- Trazabilidad por `playbook_version_id` en cada decisión persistida.

## Decisiones de diseño específicas del fork

1. **Una versión `draft` y una `published` por playbook.** Garantizado por
   índices parciales UNIQUE. La UI no tiene que negociar ese invariante.
2. **Las preguntas `next_action` y `needs_human_call` son `protected`**:
   su `key` y `type` no se pueden cambiar desde el editor. La UI no
   expone esos campos como editables. El Zod rechaza payloads que
   pretendan alterarlos.
3. **El `config` se guarda en columnas tipadas** (`product_json`,
   `policy_json`, `offer_json`, `priorities_json`, `writer_json`,
   `jev_questions_json`, `prohibitions_json`, `handoff_json`,
   `urgency_rules`) para legibilidad y para que el motor pueda leer
   columnas específicas sin deserializar todo. El snapshot a Jev sigue
   siendo un objeto único (igual que el state actual). Esto da SQL
   legible y JSON estable al proveedor.
4. **`schema_version` semver** en la fila. El loader rechaza configs con
   `schema_version` desconocido salvo que haya un migrador registrado.
   Migradores se declaran en `src/lib/sales/playbook/migrators/` y solo
   corren al cargar, no al publicar.
5. **El cache en memoria del loader** es por organización, con TTL de
   60s, invalidado en el endpoint de publish/rollback. No es LRU
   complejo: el spec no requiere más.
6. **Fallback congelado.** Mientras no exista versión publicada, el
   motor carga `VENDE_VELOZ_*` y `JEV_SALES_QUESTIONS_V2` y emite una
   warning visible (`console.warn` una vez por proceso). El fallback
   es **explícito y testeado**. El Corte 7 decide cuándo retirarlo
   (probablemente en el cierre, dejando los `*` como `DEFAULTS_ONLY`
   reusables en tests).
7. **Snapshot por versión en BD.** En lugar de una tabla de uso
   independiente, `lead` gana una columna `last_jev_playbook_version_id`
   + `last_jev_playbook_schema_version` (nullable). Más simple, sin
   nueva tabla de hechos.
8. **El Laboratorio ejecuta el pipeline real** vía `runSalesOrchestratorTurn`
   con un override de `is_test=true` y un `contactId` sintético. Lo
   mismo que ya hace hoy; el cambio es solo pasar el `playbook_version_id`
   correcto y registrar el resultado.
9. **El editor no es JSON crudo**: cada bloque funcional tiene su
   formulario. Los `criteria` de `choice` se editan como una tabla
   key/value; los de `score` como lista de bullets. La serialización
   a JSON vive en el backend.

## Anexo V1 — "Vende Veloz 365 — Academia Bajo Control"

> El bootstrap siembra exactamente este objeto como `published` de la
> organización con `salesOrchestratorEnabled=true` que ya existe.

(El contenido exacto del Anexo V1 vive en
`src/lib/sales/playbook/v1.ts` y se documenta en `data-model.md`.)

## Riesgos y mitigaciones (resumen)

- Organización activa queda sin playbook → fallback explícito + tests.
- Editor publica payload inválido → Zod server-side.
- Cambios rompen `next_action` / `needs_human_call` → guardarraíles
  duros + tests.
- Schema evoluciona y rompe drafts viejos → migradores registrados.
- Editor Jev se convierte en Zapier → solo edita instrucciones/criterios;
  no añade lanes ni efectos.

## Definición de Hecho por corte

- **Corte 1**: gate técnico + tests del Zod/store/bootstrap verdes;
  cero cambio en runtime productivo; working tree limpio; un commit.
- **Corte 2**: gate técnico + tests de endpoints verdes (tenant
  isolation, draft único, published único, rollback); working tree
  limpio; un commit.
- **Corte 3**: gate técnico + tests de integración del runtime con
  override + regresión del Sales Orchestrator verde; working tree
  limpio; un commit.
- **Corte 4**: gate técnico + E2E UI editor verde; working tree
  limpio; un commit.
- **Corte 5**: gate técnico + tests de guardarraíles Jev verdes; E2E
  UI editor Jev verde; working tree limpio; un commit.
- **Corte 6**: gate técnico + tests del runner nuevo verdes; E2E
  laboratorio comercial verde; working tree limpio; un commit.
- **Corte 7**: gate técnico + decisión documentada sobre fallback +
  E2E final en las dos configuraciones (Published / Fallback) verde +
  `docs/CURRENT_STATE.md` y `docs/playbook.md` actualizados; working
  tree limpio; un commit final.

La feature 008 no se declara Hecha hasta que los siete cortes estén
verdes.