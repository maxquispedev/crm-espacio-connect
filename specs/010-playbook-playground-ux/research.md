# Research — Feature 010 Playbook Playground UX

Evidencia leída del código real (mandan código y tests sobre documentación).
Fecha: 2026-10-03 · Base: `950a8c3 feat(playbook): activar runtime publicado en producción`.

---

## 1. Corte 1 — El bug y las piezas de ruido (confirmado)

### 1.1 El bug de Publicar

`src/components/agent/playbook/playbook-draft-editor.tsx`:

| Línea | Botón | `disabled` actual | ¿Correcto? |
|---|---|---|---|
| 127 | Validar | `busy \|\| anySyntaxError` | sí |
| 139 | Guardar | `busy \|\| anySyntaxError \|\| !dirty` | sí |
| 146 | Descartar | `busy \|\| !dirty` | sí |
| **150** | **Publicar** | **`busy \|\| !dirty`** | **NO — invertido** |
| 156 | Eliminar draft | `busy \|\| !canDelete` | sí |

`anySyntaxError = !state.valid || !jevState.valid` (línea 77) ya está
disponible en el scope, así que el arreglo de Publicar también puede cubrir el
JSON inválido sin estado nuevo. Publicar además **no** consulta
`anySyntaxError` hoy, lo que deja abierto el caso "JSON inválido pero
persistido": la fila 3 de la tabla del spec.

Por qué es peligroso y no solo invertido: `POST /api/playbook/publish` publica
el **draft persistido**, no el texto local. Con el botón habilitado en
`dirty=true`, el admin puede pulsar "Publicar" creyendo que publica lo que
está escribiendo, cuando en realidad publica la versión anterior de su draft y
su trabajo sigue sin guardar.

**Arreglo**: `disabled={busy || dirty || anySyntaxError}` + `title` con "Guarda
los cambios antes de publicar" cuando `dirty`. Sin autosave.

### 1.2 Ruido a eliminar, con su ubicación exacta

`src/components/agent/playbook/playbook-client.tsx`:

- **258-264**: card de "Cargando playbook…".
- **268-304**: estado vacío (no hay playbook ni publicada) con copy
  administrativo y botón "Crear draft".
- **309-343**: barra superior con `<h3>Sales Playbook</h3>`, `Refetch`,
  `Ver historial` y `Crear draft`. ← la segunda cabecera "Sales Playbook" que
  el dueño pidió eliminar (la pestaña ya se llama `Comercial / Jev`,
  `agent-client.tsx:19`).
- **346**: `<VersionState published draft />` — tarjeta grande de estado y
  versionado.
- **349-364**: CTA gigante "Abrir el Laboratorio" con párrafo explicativo.
- **373-388**: `PlaybookPublishedCard` (precio en la tarjeta de la publicada) o
  el mensaje de "no hay ninguna versión publicada".
- **394-468**: `DraftEditorPane` con los **dos editores JSON apilados**
  (`playbook-draft-editor.tsx` renderiza `state` y luego `jevEditor` uno
  debajo del otro) y la barra de acciones con 5 botones + párrafo explicativo
  (líneas 167-172).
- **470-477**: `PlaybookVersionsList` inline (`showHistory` toggle).

Elementos que **se conservan** porque son equipo, no decoración:
`JsonEditor` (textarea monoespaciado, `FormatButton`, error de parseo con
línea/columna), `Modal` (ya usado para publicar y rollbackear),
`NoticeBanner`, los callbacks `onValidate`/`onSave`/`onPublish`/`onDiscard`/
`onDelete`, y `PlaybookVersionsList` (que pasa a modal/drawer).

### 1.3 La línea de guardarraíles ya existe como concepto

`playbook-draft-editor.tsx:167-172` explica hoy que "Publicar exige comentario y
lo valida el backend otra vez". La autoridad real es
`assertJevProtectedKeys` en el servidor (`/api/playbook/draft` y
`/api/playbook/publish`), más `ConfigV1Schema`. La línea de C1-3 describe lo que
el servidor protege; no sustituye ni duplica esa autoridad.

### 1.4 Estado local de los dos editores y los tabs

Los dos editores ya son documentos independientes en estado React
(`state` y `jevState`), y el documento completo se **reassembla** al guardar
(`playbook-client.tsx:411-414`: "Documento COMPLETO reassemblado"). Por eso
montar y desmontar un editor al cambiar de tab **no pierde estado**: el estado
vive en el padre, no en el subárbol del editor. La proyección de UI que
construyó 009 (`Config` ↔ `Preguntas Jev`) sigue siendo válida; lo que cambia en
Corte 1 es que ambos no estén visibles a la vez.

### 1.5 Historial en modal

`PlaybookVersionsList` ya recibe `versions`, `publishedId` y `onRollback` y se
renderiza dentro de un `Card`. En C1-5 cabe dentro de un `Modal` sin cambiar
props ni APIs. Nota: el `Modal` existente usa `max-w-lg`
(`src/components/ui/modal.tsx`); si el historial queda estrecho, se permite un
`className` de ancho o un panel, pero **no** se modifica el `Modal` compartido
por el resto de la app.

---

## 2. Corte 2 — Arquitectura: la decisión más importante de esta feature

### 2.1 `POST /api/lab/runs` NO sirve para una prueba ad-hoc

`src/app/api/lab/runs/route.ts` acepta **solo** `{ playbook_mode: "published" |
"draft" | "both" }`. Corre la cohorte fija de `personas` del servidor y responde
`202 Accepted` (fire-and-forget). **No acepta transcripción ni `crm_state`**, y
sus resultados se persisten en `agent_run` / `agent_test_case`, no se devuelven
en la respuesta.

Conclusión: **no usar `/api/lab/runs` para la prueba rápida**. Reutilizarlo
exigiría falsear el contrato (mandar personas sintéticas), que es exactamente lo
que el dueño descartó.

### 2.2 `runSalesOrchestratorTurn` exige filas reales de BD y no devuelve nada

`src/server/sales/orchestrator.ts:66`:

```ts
export async function runSalesOrchestratorTurn(
  input: { organizationId: string; conversationId: string; conversation: Conversation },
  opts: RunSalesOrchestratorTurnOptions = {}
): Promise<void>
```

- Requiere `conversationId` y `conversation` reales, y por dentro
  `buildJevSalesState` necesita `contactId` y un `lead` + `pipeline_stage`; si no
  hay lead, hace `return` temprano (`orchestrator.ts:83-84`).
- **Devuelve `Promise<void>`**: no se puede leer de ahí la decisión ni el texto.

Esto descarta por sí solo cualquier diseño que quiera "solo llamar al
orquestador y que me devuelva la respuesta".

### 2.3 Pero el orquestador persiste todo lo que la preview necesita

`orchestrator.ts:138-155` — el snapshot durable que se escribe en
`lead.lastJevDecision`:

```ts
const snapshotBase = {
  snapshot: jev.snapshot,
  decision: jev.decision,     // ← decisión COMPLETA de Jev
  plan: { lane: plan.lane, nextAction: plan.nextAction, shouldHandoff: plan.shouldHandoff },
  requestId: jev.requestId ?? null,
  model: jev.model ?? null,
  playbook_version_id: playbook?.config ? playbookVersionId(playbook) : null,
  playbook_schema_version: playbook?.schema_version ?? null,
  playbook_version_number: playbook?.version_number ?? null,
};
```

El texto del writer queda en los mensajes `direction: "out"` de la conversación
sandbox. Por eso **ejecutar el turno real y leer la BD antes de limpiar** sí
puede devolver decisión + plan + writer. El `lab-pipeline-real.test.ts` ya
afirma que el turno sandbox produce mensajes `out` reales.

### 2.4 El seam mínimo: el scaffolding de `runConversation`

`src/server/lab/runner.ts:396-503`, `runConversation` (privada) es exactamente:

1. **`:411-419`** contacto sandbox (`archivedAt` ya puesto, `waIdentity` sintética);
2. **`:421-434`** lead en el primer stage abierto (`findFirstOpenStage` +
   `createLeadInStage`, con `reason: "lab_sandbox"`) — solo si `cohort ===
   "sales"`;
3. **`:436-444`** conversación con `isTest: true, aiEnabled: true`;
4. **`:445-...`** bucle por línea del guion: insertar `direction: "in"` → actualizar
   `lastInboundAt` → recargar conversación → `runSalesOrchestratorTurn(...)` con
   `playbookOverride` cuando hay draft;
5. leer mensajes y `readActualOutcome`.

Los pasos **1-3 (`runner.ts:410-444`) son el andamiaje reutilizable**, y el paso 4 es el turno real.
Ese andamiaje es el "secreto" que hace que el sandbox del Laboratorio no toque
WhatsApp.

### 2.5 Decisión: **Diseño A — orquestador real, andamiaje extraído**

Se extrae 1-3 a un helper compartido (p. ej.
`src/server/lab/sandbox-case.ts`) y **ambos** consumidores lo usan:

- `runConversation` (Laboratorio) — comportamiento idéntico, sigue siendo el
  mismo pipeline;
- el nuevo `POST /api/lab/preview` (Prueba rápida).

El preview crea el caso sandbox, corre un turno por línea pegada con
`runSalesOrchestratorTurn` (con `playbookOverride` solo en modo Draft), lee
`lead.lastJevDecision` + mensajes `out`, limpia en `finally` y devuelve el
contrato de C2-1.

**Por qué A y no una composición DB-free** (evaluado y descartado):

| | Diseño A (orquestador real) | Composición DB-free |
|---|---|---|
| Reutiliza el pipeline del Lab | Sí, la **misma función** | No, recompone las piezas |
| Guards T306/T308 y `deliverReply` sandbox | Se disparan solos | Hay que replicarlos |
| Estado de Jev | El real (`buildJevSalesState`) | A mano (≈40 campos) |
| Filas en BD | Sí, sandbox, limpiadas en `finally` | Ninguna |
| Anti-paralelo | Estructural | Depende de la disciplina |
| Stage abierto requerido | Sí (igual que el Lab) | No |

La objeción real de A es que necesita un stage abierto en la org (el mismo
requisito que ya tiene el Laboratorio) y que escribe y borra filas sandbox. Se
aceptan: son el precio de reutilizar el pipeline en vez de duplicarlo, y el
dueño autorizó explícitamente "extraer/reutiliza la mínima función del runner
actual".

> `toStateProduct` y `toStatePolicy` (`build-state.ts`) son **privadas a módulo**.
> Un diseño DB-free tendría además que exportarlas o replicarlas: más superficie
> de cambio en el módulo que más riesgo tiene.

### 2.6 Resultado esperado del endpoint

`runSalesOrchestratorTurn` devuelve `void`, así que la decisión se lee del
snapshot. `readActualOutcome` (Lab) solo proyecta 3 escalares; la preview
necesita el snapshot completo. La solución: el helper compartido devuelve el
snapshot crudo y **cada consumidor proyecta lo que necesita**. El Laboratorio
conserva sus 3 escalares (no cambia su contrato ni sus tests) y la preview
proyecta decisión + plan + writer.

---

## 3. Entrada: por qué no se acepta `crm_state` pegado

El State del turno lo construye `buildJevSalesState` **desde la conversación en
BD** (`build-state.ts`, con degradación a `CRM_STATE_V2` cuando no hay lead). El
orquestador no acepta un State por parámetro. Por lo tanto, en el camino del
orquestador el `crm_state` es **derivado**, no input: la conversación sandbox
sembrada con el guion pegado produce el State.

Esto resuelve C2-3 a favor del modo conversación: no se fabrican 40 campos, se
pega la conversación y el State sale del builder real. Documentar esta
consecuencia es parte del spec para que no se lea como una funcionalidad
faltante: es consecuencia de reutilizar el pipeline en vez de duplicarlo.

## 4. Precedente de seguridad del Laboratorio (lo que ya está garantizado)

Los guards que hacen que este camino sea seguro ya existen y **se reutilizan**;
la feature no reimplementa ninguno:

- **T306** (`orchestrator.ts:77-80`): un `playbookOverride` fuera de `is_test`
  lanza `playbook_override_forbidden_in_production`. El preview solo puede pasar
  override en Draft y solo con conversaciones `isTest: true`.
- **T308** (`orchestrator.ts:138-155`): el snapshot guarda qué versión de
  playbook influyó, así que la preview puede afirmar qué versión corrió.
- **`deliverReply` en sandbox** (`delivery.ts:24-27`): con `isTest: true`
  persiste el mensaje saliente del sandbox y `return true` **antes** de llegar a
  `sendText` (`:29-34`). El comentario del repo lo dice: *«JAMÁS toca la API
  (FR-031)»*. Es el mismo mecanismo que usa el Laboratorio.
- **Follow-ups** (`orchestrator.ts:212-220`): `scheduleNextFollowUp` solo se
  llama dentro de `if (!isTest)`, así que en sandbox no queda ningún
  `sales_follow_up_job`.
- **Tenant scope** (`src/lib/db/tenant.ts`): `scoped()` en cada select/insert/
  update, incluida la resolución de la versión de playbook vía
  `getConfigByVersionId(organizationId, versionId)` — la org siempre sale de la
  sesión, nunca del body.

**Prerrequisito operativo**: la org necesita al menos un `pipeline_stage` con
`is_open=true` (si no, el turno hace `return` temprano y no habría lead). Es el
mismo requisito que el Laboratorio, y el error debe ser explícito, no un
resultado vacío.
