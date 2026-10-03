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
- [x] **Corte 1 cerrado** (evidencia real al final de su sección).
- [ ] **Corte 2 sin empezar** (sigue pendiente).

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

- [ ] Crear el helper de sandbox (p. ej. `src/server/lab/sandbox-case.ts`) a
      partir de `runner.ts:410-444`: contacto archivado + lead en el primer
      stage abierto + conversación `isTest: true`.
- [ ] **Mover, no reescribir.** `runConversation` debe seguir haciendo lo
      mismo, ahora vía el helper.
- [ ] `tests/unit/lab-pipeline-real.test.ts` **verde sin cambios**. Si hay que
      tocarlo, es que el movimiento cambió comportamiento: parar y revisar.
- [ ] El helper devuelve el snapshot crudo; cada consumidor proyecta lo suyo
      (el Lab sigue con sus 3 escalares).

### 2.2 Endpoint de preview

- [ ] `POST /api/lab/preview` con `withAuth`; `organizationId` de la sesión,
      nunca del body.
- [ ] Zod en el borde: `mode` (`draft`|`published`, default `published`) y
      `conversation` (1..20 × `{ from: "lead", text }`), con tope de longitud.
- [ ] Resolver la versión con la función de loader del Lab, scopeada por org.
- [ ] Crear caso sandbox → un turno por línea con
      `runSalesOrchestratorTurn` (con `playbookOverride` **solo** en Draft) →
      leer `lead.lastJevDecision` + mensajes `out` → **leer antes** del cleanup
      → `finally` de limpieza.
- [ ] Respuesta: `jev` (decisión completa) + `plan` (lane, next_action,
      should_handoff, stage) + `writer.text` + `playbook` (versión, schema,
      Draft|Published) + `turns`.
- [ ] Mover el `break` por handoff: copia el comportamiento del Lab, no lo
      inventes.

### 2.3 Errores honestos

- [ ] `draft_not_found` (409) sin fallback silencioso a published.
- [ ] `published_not_found`, `no_open_stage`, `no_decision`,
      `no_writer_output`, `ai_not_configured`, `jev_failed` (timeout/5xx/formato).
- [ ] **Un fallo del proveedor nunca se convierte en respuesta ficticia.**
- [ ] `detail` saneado, sin secretos.

### 2.4 UI de la prueba rápida

- [ ] Columna derecha en desktop; debajo del editor en pantalla estrecha.
- [ ] Entrada: `textarea` monoespaciado con la conversación pegada. Default
      con una conversación de ejemplo, para no arrancar en blanco.
- [ ] Selector `Probar: [ Draft ▼ ]` con Draft/Published. Sin draft → Draft
      deshabilitado y Published por defecto.
- [ ] Botón `Ejecutar`: una sola ejecución por clic.
- [ ] Salida compacta: resumen humano (`next_action`, `lane`, `human`) +
      `Respuesta` + `[Ver JSON completo]` plegable. Sin cards enormes.
- [ ] Con `dirty`: aviso **"Estás probando el último draft guardado. Guarda los
      cambios para probarlos."**
- [ ] Enlace pequeño "Abrir Laboratorio completo" → `/lab`.

### 2.5 El endpoint no acepta JSON local

- [ ] El body **no** admite el documento del playbook. La versión probada se
      resuelve en BD. Esto es lo que hace imposible "probé algo que no
      publiqué".

### 2.6 Las 10 demostraciones (tests)

- [ ] 1. `published` usa la publicada de la org.
- [ ] 2. `draft` usa el draft de la org.
- [ ] 3. Org A nunca lee draft/published de org B.
- [ ] 4. `is_test`/sandbox: cero llamadas al remitente real.
- [ ] 5. Cero follow-ups productivos.
- [ ] 6. Devuelve `jev`, `plan` y `writer.text` con contenido real.
- [ ] 7. Fallo del proveedor → error, no respuesta.
- [ ] 8. Draft inexistente → `draft_not_found` explícito.
- [ ] 9. Cambio local sin guardar **no** se usa.
- [ ] 10. **Estructural**: preview y `runConversation` importan el mismo
        helper, y el preview invoca `runSalesOrchestratorTurn`.

### 2.7 Verificación del corte

- [ ] `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
- [ ] E2E: **Sección 019** (preview Published y Draft, aislamiento de org,
      cero efectos, y los caminos infelices).
- [ ] Si se ejecuta: `pnpm test:e2e` con `WA_MOCK_ENABLED=true`. Si no:
      dejarlo escrito aquí, sin declararlo.
- [ ] `/lab` sigue funcionando como Laboratorio completo.
- [ ] `docs/playbook.md` (sección de la Prueba rápida) y `docs/CURRENT_STATE.md`.
- [ ] Commit único + árbol limpio.

## Dependencias

- **Corte 1 → Corte 2**: la prueba rápida vive en la pantalla que simplifica
  el corte 1. El orden es fijo.
- Ambos dependen de 009 en producción (runtime publicado). Ninguno lo altera.
- El corte 2 depende de que el andamiaje del Lab siga siendo extraíble: por
  eso 2.1 va **antes** que 2.2.

## Criterio de "feature lista"

- [ ] Los dos cortes con su gate en verde y su commit.
- [ ] La regla Publicar/`dirty` fijada por tests que fallaban antes.
- [ ] La Prueba rápida devuelve decisión + plan + writer, en sandbox, con las 10
      demostraciones verdes.
- [ ] `/lab` y el runtime publicado sin cambios de comportamiento.
- [ ] `tasks.md` con evidencia real (comandos y resultados), sin afirmaciones
      sin ejecutar.

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
