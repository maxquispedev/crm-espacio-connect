# Feature 009 — Playbook Runtime Admin

**Estado**: PLANIFICADA / NO IMPLEMENTADA
**Origen**: adopción de producción de la Feature 008 (Sales Playbook)
**Convierte**: `specs/008-sales-playbook/`
**Autoridad normativa**: [../../.specify/memory/constitution.md](../../.specify/memory/constitution.md)

---

## 1. Por qué existe esta feature

La Feature 008 construyó la infraestructura durable del Sales Playbook: tablas,
`ConfigV1` + Zod, draft/validate/publish/rollback, historial, loader sin cache,
Laboratorio Published vs Draft, guardarraíles Jev, tenant isolation, auditoría de
versión y fallback hardcodeado. **Todo eso ya existe y se reutiliza tal cual.**

Lo que NO existe todavía es la capa que convierte esa infraestructura en la
**configuración comercial real de producción**:

1. **La UI está obsoleta para su único usuario real.** Se construyó bajo la regla
   histórica *"NO JSON crudo"*: ocho formularios por bloques más un editor visual
   de preguntas Jev. Max no es un usuario de formularios comerciales; es un
   administrador técnico que quiere pegar un JSON, validarlo y publicarlo. Hoy
   cambiar un precio exige pelear con una grilla de campos.
2. **El baseline comercial del código está desactualizado.** `VENDE_VELOZ_OFFER` y
   `VENDE_VELOZ_PLAYBOOK_V1` codifican la oferta anterior (setup `497`, mensual
   `197`). La decisión vigente de la primera cohorte es `0` + `S/247/mes`.
3. **El runtime productivo está congelado.** `SALES_PLAYBOOK_RUNTIME_ENABLED =
   false` en `src/server/sales/build-state.ts` obliga a que las conversaciones
   reales usen siempre `VENDE_VELOZ_*`. Publicar una versión no cambia nada en
   producción: sigue haciendo falta un redeploy.

El resultado observable undesired, en palabras del dueño: *"cambiar pricing,
oferta, política, writer o preguntas Jev exige redeploy"*.

## 2. Objetivo

Que la estrategia comercial de Vende Veloz 365 sea **datos editables y
publicables desde la UI, sin redeploy**, con tres cortes obligatorios y
separados:

| Corte | Entrega | Apaga/enciende producción |
|---|---|---|
| **1** | Editor técnico JSON (Config + Preguntas Jev) en Agente | No toca producción |
| **2** | Baseline comercial vigente en fallback y bootstrap | **Mantiene runtime APAGADO** |
| **3** | Runtime consume la versión Published | **enciende producción** |

La fuente de verdad comercial es Cerebro Max. Este repo guarda **solo el contrato
técnico y el fallback**: no se replica aquí la memoria comercial completa.

## 3. Alcance

### 3.1 Corte 1 — Editor técnico JSON

La pestaña de playbook en Agente pasa de formularios a dos editores JSON
monoespaciados:

1. **Configuración comercial JSON** — `product`, `offer`, `commercial_policy`,
   `priorities`, `writer`, `prohibitions`, `handoff`, `urgency_rules`.
2. **Preguntas Jev JSON** — `jev_questions`, con la clasificación de guardarraíles
   preservada.

Debe permanecer igual: comportamiento, base de conocimiento, draft/publish/
rollback/historial, validaciones server-side, guardarraíles Jev, Laboratorio.

**Se elimina una regla histórica**: *"NO JSON crudo"* queda **SUPERSEDED** para la
pestaña Commercial/Jev. La razón: la UI por formularios nunca fue usada para su
propósito real; el usuario objetivo edita configuración técnica.

Requisitos de experiencia:

- `textarea` monoespaciado con `JSON.stringify(…, 2)` formateado.
- Botón **Formatear JSON** (`JSON.parse` → re-serializar; deshabilitado si no parsea).
- Errores de parseo con **línea y columna** calculadas desde el `position` que
  entrega `JSON.parse`.
- Errores de Zod y de guardarraíles con su **`path`**, tal como los devuelve
  `POST /api/playbook/validate`.
- Botón **Validar** que siempre llama al endpoint: el cliente no puede saltarse la
  validación backend.
- Desktop-first (lo administra Max), sin romper responsive.
- Acceso/CTA claro al **Laboratorio** para probar Published vs Draft. **No se
  construye otro laboratorio**: se reutiliza el existente. Si mostrar un resumen
  de la última prueba resulta sencillo y seguro, puede añadirse; no es
  obligatorio y no puede duplicar el runner del Lab.

**No se permite** introducir Monaco, CodeMirror ni cualquier editor pesado como
dependencia nueva. Un `textarea` bien resuelto es la decisión.

El split Config / Preguntas Jev es una **proyección de UI**, no un segundo modelo
durable: se reassembla el mismo `ConfigV1` y se persiste igual que hoy.

### 3.2 Corte 2 — Baseline comercial vigente

Sincronizar, **sin encender el runtime**, el fallback técnico y el bootstrap:

| Concepto | Antes (código) | Objetivo |
|---|---|---|
| `setup` | `497` | `0` (sin fee obligatorio) |
| `monthlyBase` | `197` | `247` |
| `includedActiveStudents` | `50` | `50` (sin cambio) |
| `extraPerActiveStudent` | `1` | `1` (sin cambio) |

Además debe quedar reflejado en `product`, `commercial_policy`, `offer`, `writer`
y `handoff`:
implementación asistida incluida, primer mes por adelantado, sin permanencia
obligatoria, dominio `.com` del primer año incluido cuando el cliente lo necesita,
conexión de dominio existente si ya tiene uno, renovación desde el segundo año
cobrada aparte y **no líder en el pitch**, y objetivo de aprendizaje
(compra/adopción/uso/retención) en vez de maximización de margen.

Estrategia Jev V1: filtro comercial inteligente — respuesta básica, contexto
mínimo (no encuesta), interpretación de fit/intención/timing, follow-ups
elegibles, y handoff a humano ante avance comercial genuino o solicitud explícita.
No se exige cierre autónomo end-to-end en esta fase.

Restricción dura: **`SALES_PLAYBOOK_RUNTIME_ENABLED` sigue en `false`** durante
todo el corte, y los tests lo verifican.

**No ampliar el schema** porque el baseline tenga frases nuevas. El schema actual
representa adequately estos conceptos en `offer.implementation`,
`offer.neverPromise`, `commercial_policy.goal` y `writer.present_price`. Solo se
toca el schema si aparece una necesidad **ejecutable**, documentada y cubierta por
tests.

### 3.3 Corte 3 — Runtime publicado en producción

Reactivar la arquitectura que la 008 ya construyó y congeló, sin reescribirla:

- Una conversación real de una organización con Sales Orchestrator carga el
  playbook **Published de SU organización**.
- **Sin cache**: publish y rollback surten efecto en el siguiente turno.
- **Tenant-safe**: dos organizaciones nunca se cruzan.
- El **draft nunca** afecta producción.
- El Laboratorio conserva su override solo en `is_test`.
- Sin Published, o Published inválida: degradación segura al baseline
  hardcodeado, warning observable y **conversación no tumba**.
- **Auditoría**: `lead.last_jev_playbook_version_id`,
  `last_jev_playbook_schema_version` y el `playbook_version` dentro de
  `last_jev_decision` registran la versión realmente usada.
- Sender, webhook, CAPI y follow-up engine **no se tocan** salvo adaptación
  estrictamente necesaria.
- Rollback se refleja sin redeploy en el siguiente turno.

El corte es **aislado y reversible**: una constante.

## 4. Regresión crítica obligatoria (Corte 3)

Debe existir evidencia observable de **A** a **H**:

| # | Escenario | Resultado exigido |
|---|---|---|
| A | Published con precio `S/247` | el turno real usa `S/247` |
| B | se crea draft y se cambia precio/writer | producción **sigue** usando la Published anterior |
| C | se publica el draft | el **siguiente** turno usa la config nueva **sin redeploy** |
| D | rollback | el siguiente turno usa la versión restaurada **sin redeploy** |
| E | Published ausente o inválida | fallback seguro, sin crash |
| F | dos organizaciones | jamás se cruzan playbooks |
| G | `is_test` / Lab | mantiene semántica existente y no genera efectos reales |
| H | auditoría | lead/decision registra exactamente la versión usada |

Sin esa evidencia, la feature **no** se declara lista.

## 5. Fuera de alcance

- Reconstruir Feature 008, sus tablas, stores, loaders, APIs o versionado.
- Un segundo sistema de configuración, una segunda tabla de config o un segundo
  modelo durable para las preguntas Jev.
- Un segundo Laboratorio o un duplicado del runner del Lab.
- Cambiar sender, webhook, CAPI, follow-up engine o el pipeline del agente.
- Servicios externos, dependencias de runtime nuevas, Monaco/CodeMirror.
- Cambiar las option keys contractuales de Jev V2.
- Replicar en el repo la memoria comercial de Cerebro.

## 6. Definición de Hecho

- `pnpm typecheck && pnpm lint && pnpm build && pnpm test` verde.
- Los tres cortes cerrados, cada uno con **un único commit** y árbol limpio.
- Corte 1: ciclo completo en la UI nueva (crear draft → editar JSON → validar →
  guardar → publicar → historial → rollback) verificado con E2E; los caminos
  infelices (JSON inválido, Zod inválido, guardarraíl violado) degradan con
  mensaje claro y sin crash.
- Corte 2: tests demuestran que el baseline nuevo parsea, que el fallback y una
  Published pueden representar **la misma estrategia** sin romperse, y que el
  runtime sigue apagado.
- Corte 3: evidencia E2E de A–H, incluido el hot-switch y el rollback sin redeploy.
- `docs/CURRENT_STATE.md` y los docs de dominio reflejando el estado real.
- **No** declarar lista la feature sin evidencia E2E de A–H.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Encender producción con un baseline equivocado | El corte 2 mantiene el runtime apagado y sus tests lo verifican; el corte 3 exige Published válida antes de encender el interruptor |
| Published inválida tumba conversaciones | La degradación a fallback ya existe en `build-state.ts`; el corte 3 la verifica (escenario E) |
| El editor JSON permite romper el contrato | El cliente no valida por su cuenta: `POST /api/playbook/validate` es la única autoridad |
| Borrar la UI antigua rompe algo no visible | Se borra solo lo que queda sin referencias, verificado con grep + typecheck + E2E |
| Regresión del contrato congelado de Jev | `sales-questions-freeze.test.ts` ata `questions.ts`, la fixture y `docs/SALES_ORCHESTRATOR.md` §7; ver `plan.md` §5 |
