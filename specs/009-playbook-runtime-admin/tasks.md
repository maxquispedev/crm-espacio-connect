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

- [x] **T921** — `VENDE_VELOZ_OFFER`: `setup 497 → 0`, `monthlyBase 197 → 247`.
  `**/src/server/sales/vende-veloz.ts**`
  **Evidencia**: `setup: 0`, `monthlyBase: 247`, `includedActiveStudents: 50`,
  `extraPerActiveStudent: 1`. `implementation.purpose` dice "incluida y sin costo de
  implementación"; `includes` suma primer mes adelantado, sin permanencia y dominio
  `.com` del primer año (con el caso "si ya tiene uno, se conecta el existente");
  `neverPromise` suma que la renovación del dominio no está incluida ni encabeza el
  pitch. El bloque `VENDE_VELOZ_PRODUCT.implementation.price/kind` y
  `subscription.price` quedaron en `lockstep` con el doc (§5) porque el freeze test los
  compara con igualdad exacta. Asercionado en
  `tests/unit/sales-questions-freeze.test.ts` (2 casos nuevos).

- [x] **T922** — `VENDE_VELOZ_PLAYBOOK_V1`: oferta, `implementation.includes`,
  `neverPromise` (renovación de dominio aparte, no líder), `commercial_policy.goal`
  (aprendizaje, no margen), `writer.present_price`, `handoff`, `urgency_rules` y
  las `instructions` de las preguntas. **Los `criteria` de `jev_questions`
  quedan intactos** (los ata el freeze test a la fixture).
  `**/src/lib/sales/playbook/v1.ts**`
  **Evidencia**: números de oferta sincronizados; `goal` reescrito a objetivo de
  aprendizaje de la primera cohorte ("no maximizar margen ni forzar el cierre
  autónomo"); `present_price` con S/247, 50 incluidos, +S/1 desde el 51, primer mes
  adelantado, sin permanencia, dominio solo cuando aplica, **prohibiendo mencionar la
  renovación** y prohibiendo briefings de contrato; `handoff` escala ante avance
  comercial genuino o petición explícita y no exige cierre autónomo; `urgency_rules`
  prohibe urgencia artificial; `priorities`/`prohibitions` alineados a filtrar tráfico.
  En `jev_questions` se cambió **solo `instructions`** (5 de 8 preguntas:
  `real_operational_need`, `purchase_intent`, `next_action`, `needs_human_call`,
  `main_value_proposition`) para expresar: filtrar tráfico, intención comercial por
  encima del tamaño, UNA sola pregunta y nunca encuesta, handoff ante avance genuino.
  `src/server/sales/questions.ts` **NO se tocó**: sigue hash-frozen (`fe3e075…` verde)
  y no hizo falta actualizar fixture ni doc §7.

  **Drift preexistente corregido (decisión de este corte)**: los `criteria` de
  `main_value_proposition` y `real_operational_need` en `v1.ts` **ya divergían** de la
  fixture: el freeze test solo pineaba los `criteria` de las 3 preguntas `score`, y los
  de `choice`/`noul` no se comparaban contra nada. Como el corte 2 exige que los
  `criteria` sean idénticos a `tests/fixtures/jev-questions-v2.json`, se alinearon al
  texto canónico (el mismo de `questions.ts` y del doc §7). La fixture y
  `questions.ts` no se tocaron, así que el sha1 del blob upstream sigue verde. El
  criterio aplicado sigue siendo: solo `instructions` cambia por decisión comercial.

- [x] **T923** — Rama mínima en `offerBlock` para que `setup === 0` no produzca
  "Implementación: S/0 una sola vez" (DV-7). Con test.
  `**/src/server/sales/writer.ts**`, `**/tests/unit/sales-writer.test.ts**`
  **Evidencia**: `offerBlock` declara `const setup: number = offer.setup` y hace
  `setup === 0 ? "- Implementación asistida incluida, sin costo de setup." : ...`.
  El widening a `number` evita la comparación sobre el tipo literal. Test nuevo
  *"con setup 0 nunca renderiza 'S/0'"* que asserta `not.toMatch(/S\/0/)`,
  `not.toMatch(/una sola vez/)` y que S/247/+S/1 siguen presentes.
  **Hallazgo adicional en el mismo commit**: el default interno de
  `defaultNextActionInstruction("present_price")` también hardcodeaba
  "implementación S/497; S/197/mes…". Era el mismo bug de precio falso y se corrigió
  con el mismo corte (no era opcional: la ruta del writer sin override es la que corre
  hoy en producción).

- [x] **T924** — Tests que demuestran: ConfigV1 parsea, el bootstrap refleja
  `S/247` / `0` / 50 / `+S/1`, writer y política correctos, contratos Jev
  válidos, y **fallback y Published pueden representar la misma estrategia**.
  `**/tests/unit/**`
  **Evidencia**: nuevo `tests/unit/playbook-commercial-baseline.test.ts`
  (**18 casos, verdes**) con 4 describe: (1) `ConfigV1` parsea sin errores
  (`parseConfigV1`, `ConfigV1Schema.parse` y round-trip JSON); (2) el bootstrap refleja
  la oferta, el objetivo de aprendizaje, `present_price` sin 497/197, y
  handoff/urgency; (3) contratos Jev: `criteria` idénticos a la fixture **en las 8
  preguntas**, tipos protegidos intactos, option keys exactas y `instructions` nuevas;
  (4) fallback vs Published: mismos números, mismo `offerBlock` renderizado **sin
  "S/0"** por los dos caminos. Los precios de la cohorte anterior no aparecen en
  fallback, producto ni bootstrap.

- [x] **T925** — Regresión que verifica que
  `SALES_PLAYBOOK_RUNTIME_ENABLED` **sigue en `false`**.
  `**/tests/unit/sales-launch-hardcoded.test.ts**`
  **Evidencia**: nuevo describe *"freeze de producción — el corte 2 NO enciende el
  runtime"* que importa el flag desde `@/server/sales/build-state` y asserta
  `false`, más un caso que ata el baseline al flag apagado. La constante en
  `build-state.ts:37` **no se modificó**.

- [x] **T926** — Actualizar en lockstep: `sales-questions-freeze.test.ts`
  (`497`/`197`), `docs/SALES_ORCHESTRATOR.md` (bloque de oferta, lista de
  precios, §5/§6 si cambian). **NO tocar** las cadenas de PII de
  `lab-case-from-conversation.test.ts`.
  **Evidencia**: `sales-questions-freeze.test.ts` → `setup 0` / `monthlyBase 247` +
  caso nuevo de política (implementación incluida, renovación aparte, sin 497/197);
  `sales-writer.test.ts` → título y aserciones a S/247/+S/1;
  `docs/SALES_ORCHESTRATOR.md` → §5 `implementation.price`/`kind`/`includes`/
  `does_not_include` y `subscription.price`, y la lista de precios legendada (§5, que
  el freeze test no lee pero es el bloque humano). §6 (política del fallback) **no
  cambió**: el objetivo de aprendizaje vive en `v1.ts`, que es la Published.
  `tests/unit/lab-case-from-conversation.test.ts` **intacto** (verificado con grep: sus
  `S/497`/`S/197` siguen ahí, son PII anonimizada de prueba).
  **Pendiente reportado, no tocado**: `src/server/sales/follow-ups/follow-up-writer.ts:106`
  sigue nombrando `S/497 / S/197` en la instrucción que prohíbe introducir precio. Está
  en zona prohibida para este corte ("no tocar follow-ups"); queda para un corte propio
  y está anotado en `docs/CURRENT_STATE.md`.

- [x] **T927** — Dejar **documentado el paso operativo**: crear/actualizar y
  **publicar** desde la UI una versión con este baseline **antes** de ejecutar el
  corte 3.
  `**/docs/playbook.md**`, `**/docs/CURRENT_STATE.md**`
  **Evidencia**: `docs/playbook.md` tiene la sección **"⚠️ Antes de encender el
  runtime: publica el baseline comercial"** con los 4 pasos concretos (revisar el
  bloque de oferta con 0/247/50/+S/1, publicar con comentario, y solo después encender)
  y la aclaración de que sin publicada el motor cae al fallback documentado.
  `docs/CURRENT_STATE.md` abre con el checkpoint del corte 2 y repite el paso como
  requisito previo al corte 3.
  Commit: `feat(playbook): sincronizar baseline comercial Vende Veloz`

**Gates del corte 2**: `pnpm typecheck` verde · `pnpm lint` verde (0 errores, 3
warnings preexistentes) · `pnpm build` verde · **867/867 tests en 91 archivos** verdes.
E2E no reejecutado: el corte no cambia comportamiento observable porque el motor
sigue apagado, y las 3 iteraciones de gate no hicieron falta.

## Corte 3 — Runtime publicado en producción

**Objetivo**: que las conversaciones reales consuman la versión **Published**
de su organización, sin redeploy. **Este es el interruptor de producción.**

- [x] **T931** — Reactivar `SALES_PLAYBOOK_RUNTIME_ENABLED` en
  `src/server/sales/build-state.ts`. Sin flags nuevos, sin reescribir el motor.
  **Evidencia**: la constante pasa a `true` con el bloque de comentario que
  documenta la reversibilidad (volver a `false` devuelve el producto, la
  política, las preguntas, la oferta y el writer a los defaults). No se creó
  ningún flag nuevo, ni se añadió dependencia, ni se tocó sender/webhook/CAPI/
  follow-ups. Sigue siendo una línea y es el único interruptor.

- [x] **T932** — Verificar (y solo adaptar si fuera imprescindible) la cadena
  real: loader publicado → `product`/`policy`/`offer`/`writer`/`questions` en el
  pipeline. Sender, webhook, CAPI y follow-ups **no se tocan**.
  `**/src/server/sales/**`
  **Evidencia (revisión de código previa, obligatoria)**: se auditó toda la
  cadena que toca el flag. El loader **no tiene cache** (ni TTL, ni
  memoización, ni estado a nivel de módulo), `getDraftConfigForOrg` solo se
  llama desde el Lab, `getConfigByVersionId` es org-scoped, y el guard T306
  mantiene el override en `is_test`. **Todo eso se confirmó sin cambios.**
  `offer`, `writer` y `jev_questions` ya llegaban bien al pipeline: no se tocaron.
  **Sí hubo que adaptar `product` y `commercial_policy` (imprescindible)**, porque
  el spread shallow que usaban era incorrecto en dos sentidos y habría
  corrompido turnos reales al encender:
  1. `ConfigV1.commercial_policy` es **camelCase** y el state de Jev es
     **snake_case**: el spread solo solapaba `goal` y `disqualification`, así que
     **6 de las 9 claves publicadas se perdían en silencio**.
  2. `ConfigV1.product` no declara `implementation`/`subscription`, así que el
     spread **filtraba los bloques hardcodeados de Vende Veloz** hacia
     organizaciones con playbook de otro negocio.
  Se sustituyó por un mapeo **explícito** (`toStateProduct` / `toStatePolicy`) en
  `build-state.ts`, sin tocar el motor ni los contratos. `VendeVelozProduct` es un
  tipo literal de `as const`, así que el return usa doble cast deliberado
  (documentado en el código).

- [x] **T933** — Invertir la regresión de congelamiento:
  `sales-launch-hardcoded.test.ts` pasa a afirmar que el loader **sí** se invoca
  en producción y que la versión **sí** se audita. Reescribir, no borrar.
  **Evidencia**: el describe pasó de *"freeze de producción — el corte 2 NO
  enciende el runtime"* a *"runtime publicado en producción — el corte 3 ENCIENDE
  el runtime"*, con la aserción del flag invertida y el baseline atado como
  **fallback** (ya no como única fuente). El caso central
  *"Published V1 y publicación posterior no cambian defaults"* se **reescribió**
  (no se borró) para afirmar lo contrario: el loader se invoca una vez por turno
  con la org de la conversación, `product`/`commercial_policy`/`offer`/
  `writer`/`questions` vienen del playbook, y `lastJevPlaybookVersionId`,
  `lastJevPlaybookSchemaVersion` y las tres claves de `last_jev_decision`
  registran la versión usada. Se añadió un caso nuevo de degradación (Published
  ausente **y** Published inválida → fallback sin crash y sin inventar versión).
  También se corrigieron las fixtures de `lab-pipeline-real.test.ts`, que usaban
  `config: {}` (el loader real siempre devuelve un `ConfigV1` validado).
  `**/tests/**`

---

- [ ] **T934** — Evidencia A–H (`spec.md` §4) en el arnés E2E. **QUEDA ABIERTO:
  NO se declara cumplido.** La sección 017 está **escrita** (`scripts/e2e-selftest.mjs`:
  A–H con inbound sintético real contra el webhook y lectura directa de BD para la
  auditoría, porque el DTO de `/api/contacts/:id` descarta los campos de versión a
  propósito) y **ejecutada en vivo** contra la app real y PostgreSQL real.
  Resultado: **21 checks verdes, 12 en rojo.**

  **Sí quedó demostrado en vivo** (org real, app real, BD real):
  - draft → guardar → **publicar**: la fila `status='published'` de la org cambia de
    V2 a V3 sin redeploy ni reinicio (A y C a nivel de fuente de verdad);
  - **B**: guardar un draft con otro precio **no cambia** la Published en BD;
  - **D**: el **rollback** deja como `published` exactamente la versión restaurada
    (comprobado leyendo la fila), sin redeploy;
  - **F (parcial)**: la org B **no ve** la Published de la org A por API;
  - **G**: cero jobs de follow-up en conversaciones sandbox;
  - la **restauración** deja la Published como estaba al empezar.

  **NO quedó demostrado**: todo lo que exige que el **turno conversacional real**
  produzca respuesta y lead. Los 12 checks rojos son `el turno real respondió` /
  `auditoría = null`. El inbound **sí llega al webhook** (`POST /api/webhooks/wa/...
  200` repetido en el log de la app) y el Sales Orchestrator **sí** queda encendido,
  pero en esta organización de prueba el turno no cerró con un outbound observable ni
  con un lead auditable dentro de la ventana de espera del arnés. Sin ese turno no hay
  forma honesta de afirmar A (el precio en la respuesta), la parte de C/D a nivel de
  turno, ni H (columnas de auditoría en un lead real). **No se maquilla el resultado.**
  Diagnóstico pendiente: por qué el pipeline no cierra el turno en esta org de prueba
  (sospecha: opt-in del orquestador y/o perfil de agente no efectivos en una org creada
  por API, que no siembra `agent_profile`).

  **E** tampoco se pudo ejercitar en vivo: no hay vía de API que deje una Published
  rota (el guardarraíl de publicación lo impide, a propósito). La degradación por
  Published **inválida** sí está en verde por unit tests
  (`sales-launch-hardcoded.test.ts`: `PlaybookInvalidConfigError` → fallback a los
  defaults, sin crash y sin inventar versión auditada).

  **Cobertura equivalente a nivel de pipeline** (unit, con builder + orquestador +
  resolver REALES y el loader mockeado solo en la frontera de BD): la regresión
  invertida de T933 demuestra que el loader **se invoca** en producción, que la
  Published alimenta `product`/`policy`/`offer`/`writer`/`questions`, y que
  `lastJevPlaybookVersionId`, `lastJevPlaybookSchemaVersion` y las tres claves de
  `last_jev_decision` registran la versión usada; y que ausente/inválida degradan.
  Eso cubre la **cadena**, no el **turno por WhatsApp**.

  Para cerrar T934: lograr que el turno conversacional real cierre en la org de prueba
  y reejecutar la 017 hasta dejarla verde.

- [x] **T935** — Gates completos + E2E comercial. Actualizar `CURRENT_STATE.md`,
  `playbook.md` y `SALES_ORCHESTRATOR.md` con el estado real.
  Commit: `feat(playbook): activar runtime publicado en producción`
  **Evidencia**: `pnpm typecheck` verde · `pnpm lint` verde (0 errores, 3 warnings
  preexistentes) · `pnpm build` verde · **868/868 tests en 91 archivos** verdes.
  E2E: la sección 017 se ejecutó en vivo contra la app real y **PostgreSQL 16 real**
  (Postgres efímero en `:55439`, migraciones aplicadas, mocks wa/ai encendidos, app en
  `localhost:3021` con un `.env.e2e` ignorado por git). Resultado **21/33**, con el
  desglose honesto en T934. Docs actualizados con el estado real: runtime encendido,
  qué significa ahora publicar, auditoría y degradación.

## Dependencias

```
T900 (bootstrap)  →  T911..T916  →  T921..T927  →  T931..T935
```

- El corte 1 no depende de nada del 2 ni del 3: es UI pura.
- El corte 2 **no** habilita nada: su regresión de freeze es explícita.
- El corte 3 exige que, antes de encender, exista una **Published** con el
  baseline del corte 2 (paso documentado en `T927`).

## Criterio de "feature lista"

- [x] Los tres cortes cerrados con un commit cada uno y árbol limpio.
- [x] `pnpm typecheck && pnpm lint && pnpm build && pnpm test` verde (868/868).
- [ ] **Evidencia E2E de A–H.** Sin ella, la feature **NO** se declara lista.
  **Corte 3: PENDIENTE.** Publicar/rollback sin redeploy, aislamiento de draft y
  aislamiento de org por API quedaron verdes en vivo; falta que el turno
  conversacional real cierre para poder afirmar A, C/D a nivel de turno y H.
  Ver T934. La feature **no** se declara lista todavía.

## NO HACER

- Reconstruir la 008: sin tablas, stores, loaders, endpoints ni versionado nuevos.
- Un segundo sistema de configuración o un segundo modelo durable para las
  preguntas Jev.
- Un segundo Laboratorio o un duplicado del runner del Lab.
- Ampliar `ConfigV1Schema` sin una necesidad ejecutable, documentada y con tests.
- Tocar `questions.ts` o sus `criteria` sin un motivo fuerte y explícito.
- Tocar sender, webhook, CAPI o el motor de follow-ups.
- Añadir Monaco/CodeMirror o cualquier dependencia de runtime.
- Cambiar option keys contractuales de Jev V2.
