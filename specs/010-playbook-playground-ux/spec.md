# Feature 010 — Playbook Playground UX

> **Estado**: bootstrap documental. Cero código productivo tocado.
> **Predecesora**: `specs/009-playbook-runtime-admin/` (runtime publicado activo).
> **Cortes**: 2. El runner vive en `scripts/ai/run-playbook-playground-ux.sh`.

## 1. Por qué existe esta feature

`Comercial / Jev` ya tiene todo lo que hace falta por debajo: editor JSON
técnico, draft/publicado, versionado, validación server-side, publicación con
comentario, rollback, historial y runtime publicado en producción (009). Lo que
falta es la **operación** de arriba.

Hoy la pantalla pide leer un producto, no operarlo. Conviven a la vez un estado
de versionado, un CTA al Laboratorio, una tarjeta de la versión publicada con el
precio, prioridades en pills, conteos de preguntas, badges de guardarraíles, dos
editores JSON apilados, historial inline y varias explicaciones. Para un
administrador técnico eso es ruido entre él y el ciclo
**pegar → validar → guardar → publicar → probar**.

Y hay un **bug confirmado en producción** que hace el ciclo inseguro, no solo
incómodo:

```tsx
// src/components/agent/playbook/playbook-draft-editor.tsx:150
<Button onClick={onPublish} disabled={busy || !dirty}>
```

`disabled={!dirty}` está invertido: **Publicar se habilita justo cuando hay
cambios sin guardar** y se deshabilita en el estado en que corresponde
publicar. Y `POST /api/playbook/publish` publica el **draft persistido en BD**,
no el texto local: pulsar ahí no publica lo que el admin está viendo, y además
permite entrar en un estado donde el admin cree estar publicando su trabajo
mientras el borrador sigue sin guardar. Publicar un estado `dirty` es siempre
peligroso y nunca debe ser posible.

## 2. Objetivo

Que `Comercial / Jev` se comporte como un playground técnico, no como un
formulario: **PEGAR / EDITAR → VALIDAR → GUARDAR → PUBLICAR → PROBAR**, con la
prueba embebida en la misma pantalla y sin construir un segundo motor comercial.

1. **Corte 1** — Corregir la regla Guardar/Publicar y limpiar la pantalla para
   que el ciclo sea evidente, sin tocar backend, versionado ni runtime.
2. **Corte 2** — Añadir **Prueba rápida** embebida que ejecute **un caso
   ad-hoc** por el **mismo pipeline sandbox** que ya usa el Laboratorio, y
   devuelva decisión de Jev + plan + texto del writer.

Fuera de alcance: la lógica comercial, pricing, contratos Jev y el runtime
Published. No se reescribe lo que ya funciona; se quita el ruido y se cierra el
ciclo.

## 3. Alcance

### 3.1 Corte 1 — Simplificar Comercial / Jev + fix de Publicar

Sin cambios de backend, schema, contrato de API ni modelo de versionado.

**C1-1 · Regla contractual Guardar/Publicar** (el bug de
`playbook-draft-editor.tsx:150`).

| Estado | Validar | Guardar | Descartar | Publicar |
|---|---|---|---|---|
| `dirty=true`, JSON parseable | habilitado | **habilitado** | habilitado | **DESHABILITADO** |
| `dirty=true`, JSON inválido | deshabilitado | deshabilitado | habilitado | deshabilitado |
| `dirty=false`, draft persistido, JSON válido | habilitado | deshabilitado | deshabilitado | **HABILITADO** |
| `dirty=false`, JSON inválido | deshabilitado | deshabilitado | deshabilitado | deshabilitado |

En `dirty=true` el botón Publicar muestra
**"Guarda los cambios antes de publicar"**. No hay autosave: corregir la
inversión no puede introducir un guardado implícito. La autoridad sobre si el
draft es publicable sigue siendo el backend (`POST /api/playbook/publish`).

**C1-2 · Cabecera compacta.** Una sola línea con `Comercial / Jev`,
`Producción: Vx`, `Editando: Vy draft` o `Sin draft`, `schema 1.0` y
`[Historial]`. Desaparecen como contenido principal: la tarjeta de "Estado y
versionado", el CTA gigante al Laboratorio, la tarjeta de la versión publicada
con el precio, las prioridades en pills, el conteo de preguntas, la
explicación larga Published vs Draft y el badge de guardarraíles. La
configuración vive en el JSON: no se duplica visualmente.

**C1-3 · Config / Preguntas Jev como tabs.** Un solo editor JSON visible a la
vez: `Config` (product, offer, commercial_policy, priorities, writer,
prohibitions, handoff, urgency_rules) y `Preguntas Jev` (`jev_questions`). Se
conservan textarea monoespaciado, `Formatear JSON`, el error de parseo con
línea/columna y los errores server-side con `path`. Los guardarraíles Jev
bajan a una línea discreta (p. ej. "🔒 next_action, needs_human_call y option
keys contractuales están protegidas"), con el backend como autoridad.

**C1-4 · Crear/editar draft más natural.** Sin draft, el botón principal es
**"Editar publicada"** (sigue llamando a `createDraft` internamente). Con draft:
`Producción: V2` / `Editando: V3 draft`. Se elimina el copy administrativo
"Crear draft desde esta versión".

**C1-5 · Historial fuera del camino principal.** Botón `Historial` que abre un
modal/drawer compacto con `Vx · estado · fecha · comentario` y `Rollback` donde
aplique. Se reutilizan las APIs actuales; no cambia el modelo de versionado.

**C1-6 · Action bar compacta** — `Validar`, `Guardar`, `Publicar`, con
`Descartar` y `Eliminar draft` como acciones secundarias. Estados obvios y sin
saturar: cambios sin guardar, guardado, JSON inválido, validación OK,
publicando.

**C1-7 · Reutilización, no reescritura.** Se reutilizan `JsonEditor`,
`Modal`, los callbacks `onValidate`/`onSave`/`onPublish`/`onDiscard`/`onDelete`,
`PlaybookVersionsList` y las APIs `/api/playbook/*`. Se borran las piezas
obsoletas, no se reconstruye el editor.

**C1-8 · Pruebas.** Fijar la tabla de C1-1 con tests que fallen hoy.

**Responsabilidad de archivos**: `src/components/agent/playbook/*` y sus tests.

### 3.2 Corte 2 — Prueba rápida embebida (sandbox)

**C2-0 · La decisión de arquitectura, sin ambigüedad.** El endpoint nuevo
**reutiliza `runSalesOrchestratorTurn`**, la misma función que invoca el
Laboratorio, mediante un helper de sandbox **extraído del runner actual**. No se
construye un segundo motor: no se duplica `runSalesOrchestratorTurn`, ni el
cliente de Jev, ni el writer, ni se manda WhatsApp real. Justificación y
evidencia en `research.md` §2 y `contracts/playground-preview-api.md`.

**C2-1 · Endpoint autenticado pequeño.** `POST /api/lab/preview` (auth con
`withAuth`, org de la sesión, nunca del body) que ejecuta **un** caso ad-hoc y
devuelve `jev` (decisión completa), `plan` (lane/next_action/stage), `writer`
(texto final) y `playbook` (versión, schema, Draft|Published). Contrato exacto en
`contracts/playground-preview-api.md`.

**C2-2 · Sandbox real, cero efectos.** `is_test=true` garantizado; WhatsApp real,
follow-ups, CAPI y efectos CRM productivos suprimidos por los guards ya
existentes del pipeline. Se ejecutan los mismos pasos:
`State → Jev → normalize → resolve-plan → writer`.

**C2-3 · Entrada sencilla.** Modo preferido: una conversación pegada,
`[{"from":"lead","text":"…"}]`, con el bloque `crm_state` avanzado **no**
soportado en el camino del orquestador: el State lo construye
`buildJevSalesState` desde la conversación sandbox (decisión documentada en
`research.md` §3). No se obligan a fabricar 40 campos: existen defaults sandbox
seguros.

**C2-4 · Selector Draft/Published.** `Prueba rápida: [ Draft ▼ ]` con opciones
Draft y Published. Sin draft, Draft deshabilitado y Published por defecto. `both`
no aplica aquí: esa función se queda en el Laboratorio.

**C2-5 · Botón Ejecutar.** Una sola ejecución por clic.

**C2-6 · Salida compacta.** Resumen humano legible (next_action, lane,
needs_human_call) + respuesta del writer + `[Ver JSON completo]` plegable con el
detalle de Jev (las señales) y Playbook (versión, schema, Draft/Published). Sin
cards enormes.

**C2-7 · Errores honestos.** Se muestran como error, nunca como respuesta
ficticia: fallo de Jev/proveedor, draft inexistente, config inválida, IA no
configurada, timeout.

**C2-8 · La prueba de Draft usa el draft PERSISTIDO.** El endpoint no recibe
JSON local del cliente: resuelve el draft guardado. Si hay cambios locales sin
guardar, la UI lo dice — "Estás probando el último draft guardado. Guarda los
cambios para probarlos." Semántica **Guardar → Probar Draft**, para que lo
probado y lo publicado sean exactamente lo mismo.

**C2-9 · `/lab` intacto como Laboratorio completo** (personas/casos, runs,
Published vs Draft, score, expected outcomes, regresiones). En `Comercial / Jev`
solo un enlace pequeño "Abrir Laboratorio completo".

**C2-10 · Las 10 demostraciones de test** de `tasks.md` §Corte 2, incluida la
prueba estructural de que el endpoint comparte el pipeline real.

**Responsabilidad de archivos**: `src/server/lab/`, `src/app/api/lab/`,
`src/server/sales/` (solo extracción, sin cambios de comportamiento) y la UI de
prueba rápida.

## 4. Regresión crítica obligatoria

- **La publicación no cambia de semántica.** `POST /api/playbook/publish` sigue
  publicando el draft persistido; la UI deja de ofrecer un estado imposible.
- **El versionado no se toca**: sin cambios en `playbook_version`, ni en el
  modelo draft/published, ni en rollback, ni en comentarios.
- **El runtime publicado sigue igual**: la feature 009 (interruptor en
  producción) no se toca. Ningún cambio de `ConfigV1Schema`, option keys,
  writer comercial, follow-ups, WhatsApp, webhook, CAPI ni DB schema.
- **El Laboratorio sigue siendo el Laboratorio**: `/lab` y
  `tests/unit/lab-pipeline-real.test.ts` siguen verdes sin cambiar de
  comportamiento.
- **Sandbox**: ninguna ruta nueva envía WhatsApp ni programa follow-ups reales.

## 5. Fuera de alcance

- Pricing, `ConfigV1Schema`, contratos Jev, option keys, loader y writer
  comercial: **NO TOCAR**.
- Sales runtime en producción, follow-ups, WhatsApp, webhook, CAPI, DB schema y
  backend del Laboratorio: **NO TOCAR** (salvo la extracción mínima de sandbox
  compartida que C2-0 exige).
- Monaco, CodeMirror o cualquier dependencia nueva: el textarea técnico actual
  es suficiente.
- Una plataforma genérica de workflows: es una herramienta interna técnica.
- Cambios de contrato en `/api/lab/runs`: se queda como está.
- Refactors oportunistas de otros módulos.

## 6. Definición de Hecho

Por corte: `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en verde, más
el **self-test de comportamiento** para lo observable. El gate técnico es el
piso, no el techo.

- **Corte 1**: los tests de la tabla C1-1 pasan y fallan contra el código
  anterior; el self-test E2E (Sección 018) recorre el ciclo con la UI real
  (editar → guardar → publicar → historial) y el camino infeliz de JSON
  inválido; no se declara E2E si no se ejecutó.
- **Corte 2**: las 10 demostraciones de `tasks.md` §Corte 2 en verde, con E2E de
  la Sección 019 y camino infeliz (draft inexistente y fallo de proveedor
  mostrado como error, nunca como respuesta).

Al final: `docs/CURRENT_STATE.md` y `docs/playbook.md` al día con cualquier
contrato observable que haya cambiado, y `tasks.md` con evidencia real.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Que "simplificar" se lea como borrar capacidad | Cada pieza eliminada se sustituye por su equivalente en la cabecera, la línea de guardarraíles o el modal de historial. Sin pérdida de acción. |
| Que un refactor del editor rompa el guardado | El servidor revalida Zod + `assertJevProtectedKeys`; los tests de C1-1 fijan los estados de la action bar. |
| Que la prueba rápida se convierta en un segundo motor | C2-0 lo prohíbe por contrato: el endpoint llama a `runSalesOrchestratorTurn` y comparte el helper de sandbox con el Laboratorio; un test lo verifica estructuralmente. |
| Que el preview ensucie la BD | Se crea y se limpia en `finally`, igual que el Laboratorio, y el tenant scope va en cada query. |
| Que la preview devuelva una respuesta ficticia ante un fallo del proveedor | C2-7: el error se muestra como error. |
| Que la preview Difiera de lo que luego se publica | C2-8: la prueba de Draft usa el draft persistido; Guardar → Probar → Publicar. |
| Que la simplificación rompa el E2E de 009 | Las Secciones 016 y 017 no se tocan; si una depende de un nodo que desaparece, se actualiza la sección, no el contrato. |
