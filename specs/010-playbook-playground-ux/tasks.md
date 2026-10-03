# Tasks — 010 Playbook Playground UX

> Estado durable de la feature. **Actualizar con evidencia real** al cerrar
> cada corte (no con intenciones). Este archivo manda sobre lo que se recuerda
> de la feature.
>
> Runner: `scripts/ai/run-playbook-playground-ux.sh` (2 cortes).
> Prompts por corte: `.ai/tasks/playbook-playground-ux/`.

## Convenciones

- `pnpm typecheck && pnpm lint && pnpm build && pnpm test` antes de cada commit.
- Un commit por corte. Árbol limpio entre cortes. Sin push.
- Máximo **2 iteraciones autónomas** de fix por gate. Si el gate no pasa en la
  segunda, parar y reportar bloqueo con la salida real.
- **No declarar E2E si no se ejecutó.** Si el arnés no está disponible, el corte
  queda con el gate técnico y su estado aquí lo dice.
- No tocar: pricing, `ConfigV1Schema`, option keys, contratos Jev, loader,
  writer comercial, follow-ups, WhatsApp, webhook, CAPI, DB schema, runtime
  Published.
- Código y tests mandan sobre documentación antigua.

## Estado del bootstrap (commit `docs(ai): bootstrap playbook playground UX SDD`)

- [x] Lectura obligatoria: `AGENTS.md`, Constitución, `docs/CURRENT_STATE.md`,
      `docs/sdd-workflow.md`, specs 008 y 009, `docs/playbook.md`,
      `docs/SALES_ORCHESTRATOR.md`, código real y tests.
- [x] Bug de Publicar **confirmado en código**:
      `playbook-draft-editor.tsx:150` → `disabled={busy || !dirty}`.
- [x] `POST /api/lab/runs` confirmado como **no apto** para input ad-hoc
      (solo `playbook_mode`, cohorte de personas, 202 fire-and-forget).
- [x] `runSalesOrchestratorTurn` confirmado: requiere filas reales, devuelve
      `Promise<void>`; la decisión vive en `lead.lastJevDecision`.
- [x] Decisión de arquitectura de Cut 2 tomada (Diseño A) y documentada.
- [x] Artefactos: `spec.md`, `plan.md`, `research.md`, `tasks.md`,
      `contracts/playground-ui.md`, `contracts/playground-preview-api.md`.
- [x] Runner + 3 prompts de corte.
- [x] Corte 1 cerrado (evidencia real al final de su sección).
- [x] **Corte 2 cerrado** (evidencia real al final de su sección).

## Corte 1 — Simplificar Comercial / Jev + fix de Publicar

Commit: `refactor(playbook): simplificar Comercial Jev`

### 1.1 El fix, primero y solo

- [x] `disabled={busy || dirty || anySyntaxError}` — la regla vive ahora en la
      función pura `draftActions()` (`draft-actions.ts`), que consume el
      componente; el JSX hace `disabled={!actions.publish}`.
- [x] `title`: "Guarda los cambios antes de publicar" cuando `dirty`;
      "Corrige la sintaxis JSON antes de publicar" con JSON roto; la del
      endpoint cuando no.
- [x] **Sin autosave.** Guardar solo se habilita por `dirty` explícito, y hay
      un test que lo ata.
- [x] Tests que **fallan contra el código de hoy** y pasan después (evidencia
      abajo: **19 assertions en rojo** antes del fix). Tabla de
      `contracts/playground-ui.md` §6 como casos:
  - [x] `dirty=true` → Guardar ON, Publicar OFF.
  - [x] `dirty=false` → Guardar OFF, Publicar ON.
  - [x] JSON inválido (cualquiera de los dos) → Publicar OFF, Guardar OFF,
        Validar OFF, Descartar ON.
  - [x] Con la acción en vuelo, las cinco OFF.

### 1.2 Limpieza de la pantalla principal

- [x] Cabecera compacta: `Comercial / Jev` · `Producción: Vx` ·
      `Editando: Vy draft`/`Sin draft` · `schema 1.0` · `Historial`.
- [x] Eliminada la segunda cabecera `<h3>Sales Playbook</h3>`.
- [x] Eliminado `VersionState` del camino principal (componente borrado).
- [x] CTA gigante del Laboratorio → enlace de texto "Abrir Laboratorio
      completo" al pie del editor.
- [x] `PlaybookPublishedCard` fuera del camino principal: **archivo borrado**
      (grep confirmó que nada más lo referenciaba).
- [x] Sin precio como tarjeta, sin prioridades en pills, sin conteo de
      preguntas, sin explicación larga Published vs Draft, sin badges de
      guardarraíles en el camino principal.
- [x] Copy: "Crear draft desde esta versión" → **"Editar publicada"**
      (sigue llamando a `createDraft`).
- [x] `Refetch` **se conserva** (ghost): la simplificación no puede costar
      una capacidad.

### 1.3 Tabs Config / Preguntas Jev

- [x] Un solo editor JSON visible a la vez; tabs `Config` / `Preguntas Jev`
      (`aria-selected` + un `role="tabpanel"`).
- [x] Conservados textarea monoespaciado, `Formatear JSON`, error de parseo con
      línea/columna, errores server-side con `path`.
- [x] Conservado el reassembly del documento completo al guardar
      (`reassembleDocuments`, la misma que se testea).
- [x] **Test de no pérdida de estado**:
      `tests/unit/playbook-draft-tabs.test.ts` ata que el reassembly lleva
      **los dos** documentos (cambio en Config + cambio en Preguntas Jev a la
      vez) y que ninguno se pierde aunque el otro sea el tab visible. El flujo
      completo contra la app real está en la Sección 018 del E2E.
- [x] Línea de guardarraíles discreta bajo los tabs. El backend sigue siendo
      la autoridad.
- [x] Un tab con JSON roto se marca con un punto rojo: el error puede estar en
      el tab que no se está viendo.

### 1.4 Historial fuera del camino principal

- [x] Botón `Historial` → modal con `PlaybookVersionsList` **intacto** (mismas
      props y APIs; el `Rollback` sigue exigiendo su comentario).
- [x] Reutilizado `PlaybookVersionsList` sin cambiar props.
- [x] No se toca el `Modal` compartido: se le añadió un `className`
      **opcional** y su `max-w-lg` por defecto sigue igual para el resto de la
      app; el historial pide `max-w-3xl`.

### 1.5 Action bar

- [x] `Validar` · `Guardar` · `Publicar` como primarias; `Descartar` y
      `Eliminar draft` como secundarias, separadas por un divisor.
- [x] Estados en una línea: `Cambios sin guardar` / `Guardado` / `Hay JSON que
      no parsea`; `Validando…` / `Guardando…` / `Publicando…` en los botones.
- [x] Quitado el párrafo explicativo de 3 frases; los `title` ya lo dicen.
- [x] Action bar **sticky** al fondo del área de edición.

### 1.6 Layout

- [x] Desktop-first; el editor ocupa el ancho completo y en pantalla estrecha
      queda arriba. No se crea media columna vacía.
- [x] La columna de Prueba rápida **no** se crea en este corte (llega en el 2).

### 1.7 Verificación del corte

- [x] `pnpm typecheck && pnpm lint && pnpm build && pnpm test` → **verde**
      (ver evidencia).
- [x] Unit tests de la action bar (1.1) y de no pérdida de estado (1.3).
- [x] E2E: arnés extendido con la **Sección 018** (A ciclo completo en la app
      real, B los dos documentos íntegros, C la regla Publicar-por-estado, D
      caminos infelices, E aislamiento de org) + su dispatch en `main()`.
- [ ] **`pnpm test:e2e` NO se ejecutó.** Este entorno no tiene app levantada
      (`localhost:3000` sin conexión), ni Docker, ni `psql`. La Sección 018
      parsea (`node --check`) pero **no se ha corrido**: no se declara verde.
- [x] `docs/playbook.md` y `docs/CURRENT_STATE.md` actualizados (el contrato
      observable de Publicar/`dirty` y el layout cambiaron).
- [x] Commit único + árbol limpio.

### Evidencia real (Corte 1)

Fecha: 2026-10-03 · Base: `478a924` · Commit: `refactor(playbook): simplificar Comercial Jev`

**1. El bug estaba rojo antes de tocarlo.** Con `draft-actions.ts` escrito
*deliberadamente con la regla de hoy* (`publish: !(busy || !dirty)`):

```
Tests  19 failed | 10 passed
× draftActions > dirty + JSON válido: se GUARDA, no se PUBLICA
    → expected true to be false
× PlaybookDraftEditor — los botones reales > con cambios sin guardar: Guardar ON y Publicar OFF
× PlaybookDraftEditor — los botones reales > sin cambios: Publicar ON y Guardar OFF
… (9 assertions sobre el componente renderizado)
```

Las 9 del componente son la prueba de que el test ata el **JSX real**
(`renderToStaticMarkup` sobre `PlaybookDraftEditor`), no una copia de la regla.

**2. Gate tras el fix** (orden del repo, sin saltos):

```
$ pnpm typecheck   → tsc --noEmit, sin salida
$ pnpm lint        → 0 errors, 3 warnings (los 3 preexistentes: no-img-element
                     y dos unused eslint-disable)
$ pnpm build       → exit 0
$ pnpm test        → Test Files 93 passed (93)
                     Tests     897 passed (897)
```

**29 tests nuevos** en 2 archivos:
`tests/unit/playbook-draft-editor-actions.test.ts` (18) y
`tests/unit/playbook-draft-tabs.test.ts` (11). 897 − 868 = 29.

**3. Cambio de infraestructura de tests, y por qué.** `vitest.config.ts` gana
`esbuild: { jsx: "automatic" }`. El `tsconfig.json` declara `jsx: "preserve"`
(lo transpila SWC de Next) y sin esto los tests de componente no renderizaban.
No se añadió **ninguna dependencia**: `react-dom/server` ya estaba, y el
entorno sigue siendo `node` (sin jsdom).

**4. Lo que NO se tocó**, verificado: `src/app/api/**`, `src/lib/**`,
`src/server/**`, schema de BD, `ConfigV1Schema`, option keys, contratos Jev,
loader, writer, follow-ups, WhatsApp, webhook y CAPI. `git diff --stat` del
commit: solo `src/components/agent/playbook/*`, `tests/unit/*`,
`scripts/e2e-selftest.mjs`, `docs/*` y este archivo.

**5. E2E: no ejecutado, y no se declara.** Comprobado en este entorno:

```
APP:    000 no-conn  (curl http://localhost:3000/api/health)
DOCKER: docker-unavailable
PSQL:   no-psql
```

La Sección 018 es código muerto en este entorno: sirve de arnés para cuando haya
app + BD, y por eso **no cuenta como verificación de este corte**.

**6. Simplificación sin pérdida de capacidades.** Se quitaron la segunda
cabecera, `VersionState`, la card de la publicada, el CTA del Lab y el párrafo
de tres frases. Se **conservaron** `JsonEditor`, `FormatButton`, `Modal`,
`NoticeBanner`, `PlaybookVersionsList`, los callbacks `onValidate`/`onSave`/
`onPublish`/`onDiscard`/`onDelete`, el `key={draft.id}` del editor, y `Refetch`
se maintains como botón ghost: si al simplificar una acción no tenía sitio,
se recoloca, no se elimina.

### Constancia de cambio de regla

Que Publicar pase de habilitado-con-`dirty` a deshabilitado-con-`dirty` es un
**arreglo de bug**, no una restricción nueva. La prueba: hoy el botón se
habilita exactamente cuando el admin **no** ha guardado, y el endpoint publica
el draft **persistido**. Un test que fija el comportamiento viejo no es una
constancia que preservar: es el bug. Dejar constancia aquí para que el fix no
se lea como una regresión cuando alguien lo encuentre.

## Corte 2 — Prueba rápida embebida (sandbox)

Commit: `feat(playbook): añadir prueba rápida sandbox`

### 2.0 La regla que gobierna este corte

**Nada de motores paralelos.** No se reimplementa `runSalesOrchestratorTurn`,
ni el cliente de Jev, ni el writer, ni se manda WhatsApp real. El preview
invoca la **misma** función que el Laboratorio. Diseño en
`research.md` §2.5; contrato en `contracts/playground-preview-api.md`.

### 2.1 Extraer el andamiaje compartido

- [x] Creado `src/server/lab/sandbox-case.ts` a partir de `runner.ts:410-444`:
      contacto archivado + lead en el primer stage abierto + conversación
      `isTest: true, aiEnabled: true`, más `cleanupSandboxCase`.
- [x] **Movido, no reescrito.** `runConversation` conserva su bucle, su orden y
      sus resultados; ahora crea el caso vía el helper y proyecta sus 3
      escalares desde `readSandboxSnapshot` (el helper devuelve el snapshot
      crudo; el Laboratorio y el preview proyectan distinto).
- [x] `tests/unit/lab-pipeline-real.test.ts` **verde sin cambios** (18/18). El
      archivo no se tocó; ver la evidencia abajo.
- [x] Los errores `lab_sales_open_stage_not_found` / `lab_sales_lead_not_created`
      se conservan como mensajes literales (ahora en clases tipadas), porque
      el test del Laboratorio los afirma.

### 2.2 Endpoint de preview

- [x] `POST /api/lab/preview` con `withAuth`; `organizationId` de la sesión
      (`const organizationId = session.organizationId`), nunca del body.
- [x] Zod en el borde: `mode` (`draft`|`published`, default `published`) y
      `conversation` (1..20 × `{ from: literal "lead", text 1..2000 }`).
- [x] Versión resuelta con `getDraftConfigForOrg` / `getPublishedConfigForOrg` —
      **las mismas funciones de loader que usa el Lab**, scopeadas por la org de
      la sesión.
- [x] Caso sandbox → un turno por línea con `runSalesOrchestratorTurn`
      (`playbookOverride` **solo** en Draft) → lee `lead.lastJevDecision` y los
      mensajes `out` → **`finally` de limpieza**.
- [x] Respuesta: `jev` (8 señales completas) + `plan` (lane, next_action,
      should_handoff, stage_id, stage_name) + `writer.text` + `playbook` +
      `turns`.
- [x] Corte por handoff copiado del Lab (`if (handoffAt) break`), no inventado.

### 2.3 Errores honestos

- [x] `draft_not_found` (409) sin fallback a published. `published_not_found`
      (409), `no_open_stage` (409), `no_decision` (502), `no_writer_output`
      (502), `ai_not_configured` (503), `jev_failed` (502), `invalid_body` (400).
- [x] **Un fallo del proveedor nunca se convierte en respuesta ficticia:** si el
      orquestador persiste `lastJevError` sin snapshot, se responde 502
      `jev_failed` y NO se inventan `jev`/`writer`.
- [x] `detail` saneado: seStrip tokens largos y URLs, se corta a 300 chars.

### 2.4 UI de la prueba rápida

- [x] Columna derecha en desktop (`lg:grid-cols-[minmax(0,1fr)_360px]`), debajo
      del editor en pantalla estrecha.
- [x] `textarea` monoespaciado con la conversación de ejemplo por defecto.
- [x] Selector `Probar: [ Draft ▼ ]`; sin draft → Draft `disabled` y Published
      por defecto. `both` no existe en el endpoint.
- [x] `Ejecutar`: una sola ejecución por clic (`if (running) return` + `disabled`).
- [x] Salida compacta: `dl` con `next_action`, `lane`, `needs_human_call`,
      `handoff`, versión y turnos + `Respuesta` + `[Ver JSON completo]` plegable.
- [x] Con `dirty`, el aviso **"Estás probando el último draft guardado. Guarda
      los cambios para probarlos."** (`dirty` sube del editor por callback).
- [x] Enlace "Abrir Laboratorio completo" → `/lab` (C2-9). `/lab` intacto.

### 2.5 El endpoint no acepta JSON local

- [x] El body no admite el documento del playbook; la versión se resuelve en
      BD. Hay un test que manda `config`/`version_id` extras y afirma que la
      versión ejecutada sigue siendo la persistida.

### 2.6 Las 10 demostraciones (tests)

- [x] 1. `published` usa la publicada de la org. → `lab-preview-api.test.ts`
- [x] 2. `draft` usa el draft de la org. → ídem
- [x] 3. Org A nunca lee draft/published de org B (+ 3b: el body no puede pedir
      una versión de otra org). → ídem
- [x] 4. `is_test`/sandbox: cero llamadas al remitente real. → ídem
- [x] 5. Cero follow-ups productivos. → ídem
- [x] 6. Devuelve `jev`, `plan` y `writer.text` con contenido real (+ 6b: corte
      por handoff). → ídem
- [x] 7. Fallo del proveedor → error, no respuesta (+ 7b `no_decision`, 7c
      `no_writer_output`). → ídem
- [x] 8. Draft inexistente → `draft_not_found` explícito (+ 8b
      `published_not_found`, 8c `no_open_stage`). → ídem
- [x] 9. Cambio local sin guardar **no** se usa (+ 9b Zod, 9c IA). → ídem
- [x] 10. **Estructural**: preview y `runConversation` importan el **mismo**
      helper, y el preview invoca `runSalesOrchestratorTurn`. →
      `lab-preview-structural.test.ts`

### 2.7 Verificación del corte

- [x] `pnpm typecheck && pnpm lint && pnpm build && pnpm test` → **verde**
      (ver evidencia).
- [x] E2E: arnés extendido con la **Sección 019** (A published/draft + B
      aislamiento + C cero efectos + D caminos infelices) + su dispatch en
      `main()`. Parsea con `node --check`.
- [ ] **`pnpm test:e2e` NO se ejecutó.** Este entorno no tiene app levantada
      (`localhost:3000` sin conexión), ni Docker, ni `psql`. La Sección 019
      parsea pero **no se ha corrido**: no se declara verde.
- [x] `/lab` sigue funcionando como Laboratorio completo: `/api/lab/runs`
      intacto y `lab-pipeline-real.test.ts` verde sin cambios.
- [x] `docs/playbook.md` y `docs/CURRENT_STATE.md` actualizados.
- [x] Commit único + árbol limpio.

## Dependencias

- **Corte 1 → Corte 2**: la prueba rápida vive en la pantalla que simplifica
  el corte 1. El orden es fijo.
- Ambos dependen de 009 en producción (runtime publicado). Ninguno lo altera.
- El corte 2 depende de que el andamiaje del Lab siga siendo extraíble: por
  eso 2.1 va **antes** que 2.2.

### Evidencia real (Corte 2)

Fecha: 2026-10-03 · Base: `55b043a` · Commit: `feat(playbook): añadir prueba rápida sandbox`

**1. La extracción no movió al Laboratorio (la señal que exige el plan).**
`tests/unit/lab-pipeline-real.test.ts` se ejecutó justo después de mover el
andamiaje, **sin tocar el archivo**:

```
$ pnpm vitest run tests/unit/lab-pipeline-real.test.ts
  ✓ tests/unit/lab-pipeline-real.test.ts (18 tests) 522ms
  Test Files  1 passed (1)
  Tests  18 passed (18)
```

Los 18 tests de `lab-pipeline-real.test.ts` son los originales: el archivo
figura **sin modificar** en el `git diff` de este commit.

**2. Gate completo** (orden del repo, sin saltos):

```
$ pnpm typecheck   → tsc --noEmit, sin salida
$ pnpm lint        → 0 errors, 3 warnings (los 3 preexistentes: no-img-element
                     y dos unused eslint-disable)
$ pnpm build       → ✓ Compiled successfully in 6.2s
$ pnpm test        → Test Files 96 passed (96)
                     Tests     937 passed (937)
```

**3. Los 40 tests nuevos, en 3 archivos:**

| Archivo | Tests | Qué ata |
|---|---|---|
| `tests/unit/lab-preview-api.test.ts` | 19 | demostraciones 1–9 del endpoint (BD en memoria con predicados `eq`/`and` evaluables, scope real por `organization_id`) |
| `tests/unit/lab-preview-structural.test.ts` | 7 | demostración 10: el preview y el Lab importan el **mismo** helper, el preview invoca `runSalesOrchestratorTurn`, y **ninguno** reimplementa build-state / Jev / writer / resolve-plan / sendText / Graph |
| `tests/unit/playbook-quick-preview.test.ts` | 14 | la UI real renderizada a markup (`renderToStaticMarkup`, sin jsdom): selector Draft/Published, aviso de `dirty`, parseo del guion y sus límites |

937 − 897 (corte 1) = **40**. Coincide.

**4. Las 10 demostraciones, una por una**, con dónde se prueba:

| # | Demostración | Test | Qué se afirma |
|---|---|---|---|
| 1 | `published` usa la publicada de la org | `1.` | `getPublishedConfigForOrg(ORG_A)`; la respuesta trae `version_id` de BD; y el turno va **sin** override (`{}`), para no disparar T306 |
| 2 | `draft` usa el draft de la org | `2.` | `getDraftConfigForOrg(ORG_A)`; `playbookOverride.versionId` = draft persistido |
| 3 | Org A nunca lee draft/published de org B | `3.`, `3b.` | B ejecuta `pbv_draft_b`; desde A el draft de B da **409**, no un fallback. `3b`: un `version_id` en el body se ignora y `getConfigByVersionId` **no** se llama |
| 4 | `is_test`/sandbox: cero llamadas al remitente real | `4.` | la conversación que recibe el orquestador es `isTest: true` (el interruptor de `delivery.ts:24-27`); `sendText` sin llamadas |
| 5 | Cero follow-ups productivos | `5.` | `scheduleNextFollowUp` sin llamadas; `sales_follow_up_job` vacío |
| 6 | Devuelve `jev`, `plan` y `writer.text` reales | `6.`, `6b.` | las 8 señales con `type`+valor, el plan completo, y el texto **leído** del mensaje `out`. `6b`: el guion corta en el primer handoff (`turns: 1` de 3 líneas) |
| 7 | Fallo del proveedor → error, no respuesta | `7.`, `7b.`, `7c.` | 502 `jev_failed` y **cero** `jev`/`writer` en el body; `no_decision`; `no_writer_output` |
| 8 | Draft inexistente → `draft_not_found` explícito | `8.`, `8b.`, `8c.` | 409 `draft_not_found` **y el pipeline ni corrió**; `published_not_found`; `no_open_stage` |
| 9 | Cambio local sin guardar **no** se usa | `9.`, `9b.`, `9c.` | un `config` inyectado no altera la versión ejecutada; Zod rechaza array vacío, `mode: both`, `from: "agent"` y texto >2000; `ai_not_configured` 503 sin pipeline |
| 10 | **Estructural**: no es un motor paralelo | `structural 1–7` | mismo helper en ambos ficheros; el preview llama a `runSalesOrchestratorTurn`; el runner ya **no** inserta contacto/conversación ni llama al stage-gateway (el andamiaje vive solo en el helper) |

**5. Extra: el caso no deja filas ni cuando el proveedor revienta.** `10b` y
`10c` del archivo de API: tras un `throw` del orquestador, `contact`,
`conversation`, `lead` y `message` quedan **en cero** (limpieza en `finally`) y
toda fila lleva la `organization_id` de la sesión.

**6. E2E: no ejecutado, y no se declara.** Comprobado en este entorno:

```
APP:    000 no-conn  (curl http://localhost:3000/api/health)
DOCKER: docker-unavailable
PSQL:   no-psql
```

La Sección 019 es código muerto aquí: sirve de arnés para cuando haya app + BD,
y por eso **no cuenta como verificación de este corte**. Parsea
(`node --check scripts/e2e-selftest.mjs`).

**7. Desviación consciente del contrato, y por qué.** El contrato anticipaba
`plan.stage_slug`. El schema de `pipeline_stage` **no tiene columna `slug`**
(solo `name`), así que la proyección honesta es `plan.stage_name`. Código y
schema mandan sobre el documento; no se inventó un campo.

**8. Lo que NO se tocó.** `git diff --stat` de este commit: `src/server/lab/`
(el helper nuevo + el `runner` que lo consume), `src/app/api/lab/preview/`
(nuevo), `src/components/agent/playbook/*`, `tests/unit/*`,
`scripts/e2e-selftest.mjs`, `docs/*` y este archivo. **Intactos**:
`orchestrator.ts`, `build-state.ts`, `writer.ts`, `resolve-plan.ts`, `client.ts`,
el loader, `ConfigV1Schema`, option keys, `/api/lab/runs`, la UI del
Laboratorio, follow-ups, WhatsApp, webhook, CAPI y el schema de BD. Cero
dependencias nuevas.

## Dependencias

- **Corte 1 → Corte 2**: la prueba rápida vive en la pantalla que simplifica
  el corte 1. El orden es fijo.

## Criterio de "feature lista"

- [x] Los dos cortes con su gate en verde y su commit.
- [x] La regla Publicar/`dirty` fijada por tests que fallaban antes.
- [x] La Prueba rápida devuelve decisión + plan + writer, en sandbox, con las 10
      demostraciones verdes.
- [x] `/lab` y el runtime publicado sin cambios de comportamiento.
- [x] `tasks.md` con evidencia real (comandos y resultados), sin afirmaciones
      sin ejecutar.

> **Pendiente que no se declara cerrado:** la Sección 019 del arnés E2E está
> escrita pero **no ejecutada** (este entorno no tiene app, Docker ni `psql`).
> El corte 2 queda con gate técnico verde + 937/937 tests, y el E2E como
> verificación pendiente de corrida, tal como está escrito arriba.

## NO HACER

- No tocar pricing, `ConfigV1Schema`, option keys, contratos Jev, loader ni el
  writer comercial.
- No tocar el runtime Published, follow-ups, WhatsApp, webhook, CAPI ni el
  schema de BD.
- No tocar `/api/lab/runs` ni el backend del Laboratorio (salvo la extracción
  compartida de 2.1).
- No añadir Monaco, CodeMirror ni dependencias nuevas.
- No construir una plataforma de workflows genérica.
- No hacer refactors oportunistas fuera de los dos cortes.
- No declarar E2E sin ejecutarlo.
