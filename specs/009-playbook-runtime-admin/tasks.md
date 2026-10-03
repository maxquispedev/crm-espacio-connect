# Tasks — 009 Playbook Runtime Admin

> Estado durable de la feature. **FEATURE 009 = PLANIFICADA / NO IMPLEMENTADA.**
> Este commit es **solo bootstrap documental**: spec, plan, research, contrato de
> UI, tasks de corte y runner. **Cero código productivo modificado.**

## Convenciones

- `T9xx` = id de tarea. `CUT-n → T9n1..T9nm`.
- `**/**` = archivo creado o modificado; entre corchetes el alcance.
- Las dependencias bloquean: si `T932` depende de `T931`, ejecutar en orden.
- Cada corte cierra con **un único commit** y working tree limpio.
- **Ningún status que aparente avance sin evidencia.** PENDIENTE significa
  PENDIENTE.

---

## Estado del bootstrap (este commit)

- [x] **T900** — Bootstrap documental de la feature 009:
  - `specs/009-playbook-runtime-admin/spec.md`
  - `specs/009-playbook-runtime-admin/plan.md`
  - `specs/009-playbook-runtime-admin/research.md`
  - `specs/009-playbook-runtime-admin/contracts/playbook-ui.md`
  - `specs/009-playbook-runtime-admin/tasks.md` (este archivo)
  - `.ai/tasks/playbook-runtime-admin/` (overview + 3 cortes)
  - `scripts/ai/run-playbook-runtime-admin.sh`
  Commit único: `docs(ai): bootstrap playbook runtime admin SDD`.
  **Cero código productivo. Runtime intacto.**

- [x] **T901** — Verificación de que `009` estaba libre y de la realidad del
  código base antes de escribir el spec:
  `specs/` contenía `001`..`008`; no existe `009`. Se leyeron `AGENTS.md`,
  constitución, `CURRENT_STATE.md`, `sdd-workflow.md`, los artefactos completos
  de la 008, `SALES_ORCHESTRATOR.md`, `playbook.md`, y el código real de
  `src/lib/sales/playbook/*`, `src/app/api/playbook/*`,
  `src/components/agent/playbook/*`, `src/components/agent/agent-client.tsx`,
  `src/server/sales/*`, `src/components/lab/*`, `src/server/lab/*` y los tests
  relacionados. Hallazgos registrados en `research.md` (DV-1..DV-12) y `plan.md`.

---

## Corte 1 — Editor técnico JSON

**Objetivo**: sustituir la UI por formularios por dos editores JSON técnicos,
sin tocar comportamiento, conocimiento, infraestructura durable, validación
backend, guardarraíles, versionado ni Laboratorio. **No activa producción.**

- [x] **T911** — Sustituir `playbook-draft-editor.tsx` por el editor de
  **Configuración comercial JSON** (textarea monoespaciado, 2 namespaces,
  botón Formatear, errores de parseo con línea/columna).
  `**/src/components/agent/playbook/**`
  - **Hecho**: `playbook-draft-editor.tsx` pasó de 8 formularios a un
    `JsonEditor` sobre el `ConfigV1` sin `jev_questions`
    (`CONFIG_EDITABLE_KEYS`), con barra de acciones (Validar / Guardar /
    Descartar / Publicar / Eliminar draft) y `dirty` por contenido.
  - Primitivas nuevas en `**/json-editor.tsx**`: `parseJsonDocument` (nunca
    lanza, devuelve el error con línea/columna desde el `position` de V8,
    leyendo también la forma moderna `(line X column Y)`), `formatJsonDocument`
    y `useJsonDocState`. `FormatButton` se deshabilita si no parsea y
    `format()` **no escribe nunca** un documento que no haya parseado.
  - **Evidencia**: `tests/unit/playbook-json-editor.test.ts` (11 tests) fija el
    contrato de línea/columna, el formateo a 2 espacios y el round-trip.
    El test verifica que la posición calculada **señala el mismo carácter que
    señala V8**, en vez de fijar un número.

- [x] **T912** — Sustituir `jev-questions-editor.tsx` por el editor de
  **Preguntas Jev JSON**, conservando la legibilidad de las clases de guardarraíl
  (`engine-required` / known signal / analytical-custom).
  `**/src/components/agent/playbook/**`
  - **Hecho**: `jev-questions-editor.tsx` (966 → ~200 líneas) es un `JsonEditor`
    del objeto `jev_questions` completo, con la **leyenda de guardarraíles**
    (🔒 / 📊 / ➕ + etiqueta + lista de claves por clase + tooltip) construida
    desde `constants.ts` (`classifyJevQuestion`, `JEV_QUESTION_CLASS_*`). La
    leyenda sobrevive aunque el JSON no parsee: cae al último objeto válido.
  - **No se reimplementó ninguna validación**: los candados siguen siendo
    exclusivamente del servidor (`ConfigV1Schema` + `assertJevProtectedKeys`).
    La UI solo **explica** por qué el servidor va a rechazar algo.

- [x] **T913** — Integrar el ciclo completo en `playbook-client.tsx`: crear
  draft, validar (`POST /api/playbook/validate`), guardar, publicar, historial,
  rollback; mostrar versión publicada, draft, `schema_version` y
  `version_number`; CTA al Laboratorio.
  `**/src/components/agent/playbook/playbook-client.tsx**`
  - **Hecho**: proyección (`projectConfig` quita `jev_questions`) y reassembly
    (`{ ...configEdit, jev_questions: jevEdit }`) en `DraftEditorPane`; el `PUT`
    manda el **documento completo**, igual que antes. Botón **Validar** con
    throttle de 800 ms que siempre llama al endpoint; `details[]` se reparten
    con `issuesForConfig` / `issuesForJev` para que cada error salga junto a su
    editor con su `path` literal. Se reutilizan crear draft, guardar, publicar
    (nota obligatoria), historial, rollback y eliminar draft.
  - **Estado/versionado**: tarjeta nueva con versión publicada, draft,
    `schema_version`, `version_number`, fechas y notas (`formatDateTime`).
  - **CTA al Laboratorio**: enlace a `/lab` sobre los editores. **No** se
    construyó un segundo laboratorio ni se duplicó su runner; `Button` de este
    repo no soporta `asChild`, así que el CTA es un `Link` con las clases del
    botón outline.
  - **Corrección de un defecto heredado**: el editor anterior perdía el
    comentario del draft (el textarea escribía `notes` pero `handleSave` solo
    mandaba `config`) y un fallo de red de la validación inyectaba un issue
    falso que **bloqueaba Publicar**. En la versión nueva los fallos de red son
    un aviso, no un `details[]` inventado, así que no pueden bloquear nada.
  - **Asimetría que había que respetar (hallazgo del corte, con test):** el
    documento **debe llevar `schema_version` para `validate`** y **no debe
    llevarlo para el `PUT`**. `ConfigV1Schema` declara
    `schema_version: z.literal("1.0")` **obligatorio**, así que
    `POST /api/playbook/validate` rechaza un body sin él; y
    `PUT /api/playbook/draft` usa un cuerpo `.strict()` de los nueve bloques
    que lo rechazaría si fuera. La UI lo resuelve reinyectando
    `draft.schema_version` solo en la llamada a validar. Queda atado por
    `tests/unit/playbook-json-editor.test.ts` (grupo "el documento que se
    manda a cada endpoint") para que nadie lo rompa creyendo que sobra.

- [x] **T914** — Podar los componentes de formulario que queden **sin ninguna
  referencia** (verificado con grep + typecheck + lint). Nada de borrados
  heroicos: lo dudoso se deja sin uso y se documenta.
  `**/src/components/agent/playbook/fields.tsx**`
  - **Hecho**: `fields.tsx` pasó de 465 a **solo `Modal`**. Se borraron
    `FieldRow`, `TextField`, `TextAreaField`, `NumberField`, `SelectField`,
    `SwitchField`, `StringListEditor` y `BlockSection`.
  - **Prueba** (el `grep` es la prueba, `tsc` no avisa de exports sin usar):
    tras la sustitución, en `src/`, `tests/` y `scripts/`, los nueve exports
    dan **0 referencias** salvo `Modal` (7: import + 2 usos en
    `playbook-client.tsx`). Se borraron los nueve, no los siete candidatos que
    sugería el enunciado.
  - **Corrección al `plan.md` §3.4**: el plan daba `BlockSection` por
    sobreviviente. No lo sobrevivió: solo lo usaba el editor por bloques que
    este corte sustituye. **No queda nada sin uso por duda**; lo dudoso que se
    dejó fue el `type JevQuestions`, que se conserva exportado en
    `jev-questions-editor.tsx` (0 importadores, pero es parte de la superficie
    del módulo).

- [ ] **T915** — E2E del ciclo en la UI nueva, incluidos los caminos infelices
  (JSON inválido, Zod inválido, guardarraíl violado): mensaje claro, sin crash.
  `**/scripts/e2e-selftest.mjs**`, `**/tests/e2e/**`
  - **Código: HECHO y registrado.** Sección 016 (`runSection016`) agregada al
    arnés y llamada en `main()`: verifica el reassembly (9 claves, idéntico a
    la publicada), el ciclo crear draft → validar → guardar → publicar →
    historial → rollback → eliminar draft, y los **tres caminos infelices
    obligatorios**: JSON inválido → 400 `bad_json` sin crash; `monthlyBase`
    como string → 422 con `path` `offer.monthlyBase`; option key protegida de
    `next_action` alterada → 422 con `path` y nunca 5xx (también en el `PUT`:
    el candado es del servidor). `node --check scripts/e2e-selftest.mjs` verde.
  - **EJECUCIÓN EN VIVO: PENDIENTE.** Este entorno no tiene Docker, `psql` ni
    PostgreSQL, y la app no está levantada, así que `pnpm test:e2e` no puede
    correr. Conforme a la Constitución IX, esto **no** se reporta como verificado
    en vivo: queda pendiente para una sesión con stack disponible. La sección
    es API-only y no depende de selectores de DOM, que es donde cambió la UI.
  - Guion guiado: no se modificó `tests/e2e/us-sales-playbook.md` porque
    describe el comportamiento de negocio (publicar/rollback), que no cambió.
    Se dejó la organización de pruebas como estaba.

- [x] **T916** — Actualizar `docs/playbook.md` (el dueño ahora edita JSON) y
  `docs/CURRENT_STATE.md`.
  - `docs/playbook.md`: sección nueva **"Los dos documentos JSON"** con los dos
    documentos y qué contiene cada uno, el botón **Formatear JSON**, los errores
    de sintaxis con línea/columna, los errores del servidor con su `path` y el
    reparto por editor; la sección de candados Jev reescrita como **leyenda**;
    el CTA al Laboratorio documentado; referencias a la pestaña actualizadas a
    **Comercial / Jev**.
  - `docs/CURRENT_STATE.md`: checkpoint nuevo al principio con el estado real.
  Commit: `feat(playbook): simplificar editor técnico JSON`

### Constancia de cambio de regla (para que no se lea como regresión)

> **La regla histórica "NO JSON crudo" (`.ai/tasks/sales-playbook/04-cut4-ui-playbook.md`,
> línea 133) queda SUPERSEDED para la pestaña de playbook**, por decisión
> explícita del dueño en el spec 009 §3.1. Sustituir los formularios por dos
> editores JSON **es el objetivo de este corte**, no una regresión ni un
> descuido. La regla sigue vigente en el resto del producto.

## Corte 2 — Baseline comercial vigente

**Objetivo**: sincronizar fallback y bootstrap con la decisión de la primera
cohorte (`0` + `S/247`, 50 incluidos, `+S/1`) y la estrategia de filtrado de Jev
V1. **El runtime sigue APAGADO durante todo el corte.**

- [ ] **T921** — `VENDE_VELOZ_OFFER`: `setup 497 → 0`, `monthlyBase 197 → 247`.
  `**/src/server/sales/vende-veloz.ts**`
- [ ] **T922** — `VENDE_VELOZ_PLAYBOOK_V1`: oferta, `implementation.includes`,
  `neverPromise` (renovación de dominio aparte, no líder), `commercial_policy.goal`
  (aprendizaje, no margen), `writer.present_price`, `handoff`, `urgency_rules` y
  las `instructions` de las preguntas. **Los `criteria` de `jev_questions`
  quedan intactos** (los ata el freeze test a la fixture).
  `**/src/lib/sales/playbook/v1.ts**`
- [ ] **T923** — Rama mínima en `offerBlock` para que `setup === 0` no produzca
  "Implementación: S/0 una sola vez" (DV-7). Con test.
  `**/src/server/sales/writer.ts**`, `**/tests/unit/sales-writer.test.ts**`
- [ ] **T924** — Tests que demuestran: ConfigV1 parsea, el bootstrap refleja
  `S/247` / `0` / 50 / `+S/1`, writer y política correctos, contratos Jev
  válidos, y **fallback y Published pueden representar la misma estrategia**.
  `**/tests/unit/**`
- [ ] **T925** — Regresión que verifica que
  `SALES_PLAYBOOK_RUNTIME_ENABLED` **sigue en `false`**.
  `**/tests/unit/sales-launch-hardcoded.test.ts**`
- [ ] **T926** — Actualizar en lockstep: `sales-questions-freeze.test.ts`
  (`497`/`197`), `docs/SALES_ORCHESTRATOR.md` (bloque de oferta, lista de
  precios, §5/§6 si cambian). **NO tocar** las cadenas de PII de
  `lab-case-from-conversation.test.ts`.
- [ ] **T927** — Dejar **documentado el paso operativo**: crear/actualizar y
  **publicar** desde la UI una versión con este baseline **antes** de ejecutar el
  corte 3.
  `**/docs/playbook.md**`, `**/docs/CURRENT_STATE.md**`
  Commit: `feat(playbook): sincronizar baseline comercial Vende Veloz`

## Corte 3 — Runtime publicado en producción

**Objetivo**: que las conversaciones reales consuman la versión **Published**
de su organización, sin redeploy. **Este es el interruptor de producción.**

- [ ] **T931** — Reactivar `SALES_PLAYBOOK_RUNTIME_ENABLED` en
  `src/server/sales/build-state.ts`. Sin flags nuevos, sin reescribir el motor.
- [ ] **T932** — Verificar (y solo adaptar si fuera imprescindible) la cadena
  real: loader publicado → `product`/`policy`/`offer`/`writer`/`questions` en el
  pipeline. Sender, webhook, CAPI y follow-ups **no se tocan**.
  `**/src/server/sales/**`
- [ ] **T933** — Invertir la regresión de congelamiento:
  `sales-launch-hardcoded.test.ts` pasa a afirmar que el loader **sí** se invoca
  en producción y que la versión **sí** se audita. Reescribir, no borrar.
- [ ] **T934** — Evidencia A–H (`spec.md` §4) en el arnés E2E: A precio S/247,
  B draft no afecta producción, C publish sin redeploy, D rollback sin
  redeploy, E Published inválida → fallback, F dos orgs sin cruce, G `is_test`
  sin efectos reales, H auditoría de la versión usada.
  `**/scripts/e2e-selftest.mjs**`, `**/tests/**`
- [ ] **T935** — Gates completos + E2E comercial. Actualizar `CURRENT_STATE.md`,
  `playbook.md` y `SALES_ORCHESTRATOR.md` con el estado real.
  Commit: `feat(playbook): activar runtime publicado en producción`

---

## Dependencias

```
T900 (bootstrap)  →  T911..T916  →  T921..T927  →  T931..T935
```

- El corte 1 no depende de nada del 2 ni del 3: es UI pura.
- El corte 2 **no** habilita nada: su regresión de freeze es explícita.
- El corte 3 exige que, antes de encender, exista una **Published** con el
  baseline del corte 2 (paso documentado en `T927`).

## Criterio de "feature lista"

- [ ] Los tres cortes cerrados con un commit cada uno y árbol limpio.
- [ ] `pnpm typecheck && pnpm lint && pnpm build && pnpm test` verde.
- [ ] **Evidencia E2E de A–H.** Sin ella, la feature NO se declara lista.

## NO HACER

- Reconstruir la 008: sin tablas, stores, loaders, endpoints ni versionado nuevos.
- Un segundo sistema de configuración o un segundo modelo durable para las
  preguntas Jev.
- Un segundo Laboratorio o un duplicado del runner del Lab.
- Activar `SALES_PLAYBOOK_RUNTIME_ENABLED` antes del corte 3.
- Ampliar `ConfigV1Schema` sin una necesidad ejecutable, documentada y con tests.
- Tocar `questions.ts` o sus `criteria` sin un motivo fuerte y explícito.
- Tocar sender, webhook, CAPI o el motor de follow-ups.
- Añadir Monaco/CodeMirror o cualquier dependencia de runtime.
- Cambiar option keys contractuales de Jev V2.
