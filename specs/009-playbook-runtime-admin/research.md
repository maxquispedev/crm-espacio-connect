# Research — Feature 009 Playbook Runtime Admin

> Decisiones a verificar (DV) y su resolución. Cada DV se resolvió **leyendo el
> código real** del repo en el commit base `eb8f3e8`, no suponiendo.
> Estado de resolución: **todas resueltas** en el bootstrap.

---

## DV-1 — ¿Dónde está realmente el interruptor de producción?

**Pregunta**: ¿hay que construir la activación del runtime, o ya existe?

**Resolución**: ya existe y es una constante.
`src/server/sales/build-state.ts:37` declara
`SALES_PLAYBOOK_RUNTIME_ENABLED = false`, y el consumidor resuelve
`usePlaybook = SALES_PLAYBOOK_RUNTIME_ENABLED || isTest`. El freeze es un
interruptor explícito puesto para el lanzamiento (commit `dbb0731` *"fix(sales):
congelar playbook configurable para lanzamiento"*).

**Consecuencia**: el corte 3 es reactivar, no construir.

---

## DV-2 — ¿La UI de playbook es realmente inservible para su usuario?

**Pregunta**: ¿se puede dejar la UI por formularios y ya está?

**Resolución**: no. `playbook-draft-editor.tsx` (~26 KB) implementa ocho
formularios por bloques y `jev-questions-editor.tsx` (~31 KB) un editor visual de
preguntas con badges 🔒/📊/➕. Ambos existen porque el corte 4 de la 008 obedeció la
regla *"NO JSON crudo"* que la 008 dejó escrita en su propio plan
(`.ai/tasks/sales-playbook/04-cut4-ui-playbook.md`, línea 133: **"NO JSON crudo
en la UI"**). Esa regla es exactamente la que el dueño **SUPERSEDE** en esta
feature.

**Consecuencia**: la sustitución es deliberada y está documentada, no es una
refactorización oportunista. Hay que dejar constancia del cambio de regla en
`tasks.md` para que nadie lo lea después como una regresión.

---

## DV-3 — ¿Cómo se parte el Config en dos documentos sin crear otro modelo?

**Pregunta**: la UI necesita Config JSON y Preguntas Jev JSON por separado.
¿Eso obliga a un segundo modelo durable?

**Resolución**: no. `ConfigV1` tiene nueve claves de primer nivel; el modelo
persistente es **una sola fila de versión** con el `ConfigV1` completo. El split es
una proyección de cliente: se quita `jev_questions` para un textarea, se guarda
aparte para el otro, y al guardar se reassembla con un shallow spread antes del
`PUT /api/playbook/draft` de siempre.

**Consecuencia**: cero migraciones, cero endpoints nuevos. Clic en
`contracts/playbook-ui.md` para el contrato exacto.

---

## DV-4 — ¿Puede el cliente validar el JSON por su cuenta?

**Pregunta**: ¿se valida en el navegador o en el servidor?

**Resolución**: en el servidor, siempre. `ConfigV1Schema` y los guardarraíles de
`constants.ts` son código de servidor bajo `@/lib/sales/playbook/`, y la
autorización de publicación vive en las rutas de `/api/playbook`. El cliente solo
hace `JSON.parse` para poder *pintar* un error de sintaxis con línea y columna
(`JSON.parse` incluye `position` en el mensaje de V8); cualquier decisión sobre
validez la emite `POST /api/playbook/validate`.

**Consecuencia**: es imposible publicar algo que el servidor no haya aceptado.
El editor no es una puerta trasera.

---

## DV-5 — ¿Basta un `textarea` o hace falta Monaco/CodeMirror?

**Pregunta**: ¿el requisito de buena UX de JSON justifica una dependencia?

**Resolución**: no. La Constitución veta dependencias de runtime nuevas
(Severanía II) y `AGENTS.md` lo prohíbe explícitamente. Todo lo pedido — texto
monoespaciado, indentación de 2, formateo bajo demanda, mensaje de error con
posición — se resuelve con `textarea` + `JSON.stringify(…, 2)`. Monaco daría
resaltado de sintaxis, que es conspicuous pero no necesario para un admin técnico
que pega un JSON generado.

**Consecuencia**: cero cambios en `package.json`.

---

## DV-6 — ¿Dónde se representa "primer mes adelantado" y "sin permanencia"?

**Pregunta**: el schema no tiene campos para esas frases. ¿Se amplía el schema?

**Resolución**: no, porque no hay campos cerrados donde meterlos: `setup`,
`monthlyBase`, `includedActiveStudents` y `extraPerActiveStudent` son números, y
las frases van en texto libre validado —`offer.implementation.purpose` (1..200),
`offer.implementation.includes` (lista), `offer.neverPromise` (lista),
`commercial_policy.goal`, `writer.present_price` (1..1500)— que es donde el writer
ya lee para redactar. `neverPromise` es además el lugar correcto para "renovación
de dominio desde el segundo año, aparte y no líder en el pitch".

**Consecuencia**: el baseline cabe entero en `ConfigV1` sin migraciones. Un
cambio de schema solo se justifica por una necesidad *ejecutable*, y hay
exactamente una: `writer.ts:211` (ver DV-7).

---

## DV-7 — ¿Hay un hueco ejecutable real al poner `setup = 0`?

**Pregunta**: ¿basta cambiar el número?

**Resolución**: no. `writer.ts:208-217` compone el bloque de oferta con

```ts
`- Implementación: S/${offer.setup} una sola vez.`,
```

incondicionalmente. Con `setup: 0` el prompt del writer dice **"Implementación:
S/0 una sola vez"**, y eso llega al lead. Es un precio falso, observable en la
salida, no un refinamiento de texto.

**Consecuencia**: el corte 2 debe añadir una rama mínima en `offerBlock` que
ombre la línea cuando `setup === 0` y declare la implementación como incluida, con
test en `tests/unit/sales-writer.test.ts`. Esto es lo que separa una decisión
técnica seria de "cambiar un número y rezar".

---

## DV-8 — ¿Dónde debe vivir la estrategia de filtrado de Jev V1?

**Pregunta**: la decisión "Jev V1 prioriza filtrar tráfico" se puede escribir en
`questions.ts` o en el bootstrap del playbook. ¿Cuál?

**Resolución**: en el **bootstrap del playbook** (`v1.ts` →
`commercial_policy`, `writer`, `handoff`, `urgency_rules`, y las `instructions`
de cada pregunta), **no** en `questions.ts`.

Tres razones verificadas en el código:

1. `questions.ts` está **hash-frozen**: `sales-questions-freeze.test.ts` comprueba
   el sha1 del blob upstream `fe3e075ca43aec8f82e5bc34eb677ae6dcf82b68` contra
   `tests/fixtures/jev-questions-v2.json`, y compara igualdad exacta con
   `JEV_SALES_QUESTIONS_V2`. Cambiar sus textos revienta esa red.
2. La 008 los rebautizó deliberadamente como `DEFAULTS_ONLY`
   (`bootstrap.ts`, bloque de decisión T703): la estrategia debe ser dato
   editable, no código.
3. El freeze test asserta que
   `VENDE_VELOZ_PLAYBOOK_V1.jev_questions[key].criteria` **iguala** los cinco
   criterios canónicos de la fixture. En `v1.ts` solo pueden cambiar los textos de
   `instructions`; los `criteria` quedan intocables.

**Consecuencia**: la estrategia comercial sí cambia, pero el contrato congelado de
claves, tipos y criterios queda intacto. Exactamente lo que pidió el dueño.

---

## DV-9 — ¿Qué se rompe al cambiar el precio?

**Pregunta**: además del freeze test, ¿qué artefactos codifican 497/197?

**Resolución**: cuatro, verificados con grep:

| Artefacto | Qué contiene | Acción en corte 2 |
|---|---|---|
| `tests/unit/sales-questions-freeze.test.ts:102-103` | `setup === 497`, `monthlyBase === 197` | **Actualizar** a `0` / `247` |
| `tests/unit/sales-writer.test.ts:57` | título del caso: *"inyecta la oferta S/497 + S/197 + S/1"* | **Actualizar** título y aserciones |
| `docs/SALES_ORCHESTRATOR.md:150,168,179,180` | bloque `implementation.price` / `subscription.price` y la lista de precios legendada | **Actualizar** |
| `tests/unit/lab-case-from-conversation.test.ts` | `S/497`/`S/197` como cadenas de **PII anonimizada** | **NO tocar** — no es contrato comercial |

**Consecuencia**: el corte 2 es un cambio en lockstep de código + test + doc, no
un edit aislado.

---

## DV-10 — ¿Cómo se demuestra que no hay cache sin desplegar?

**Pregunta**: el requisito es "publish/rollback toma efecto en el siguiente turno".
¿Qué lo demuestra?

**Resolución**: que `loader.ts` no tiene cache por construcción, más una prueba
observable. `getPublishedConfigForOrg` lee la fila publicada cada vez (sin
`cache()`, sin memoización, sin TTL), y el arnés existente ya publica y
rollbackea contra la app real. Añadir una sección que encadena publicar → turno →
rollback → turno y **observa el texto outbound** demuestra el hot-switch sin
reiniciar el proceso. El escenario E (Published inválida) cubre la otra mitad: la
degradación a `VENDE_VELOZ_*` con `console.warn` ya existe en `build-state.ts` y
solo hay que probarla.

**Consecuencia**: la evidencia de "sin redeploy" es el propio comportamiento del
arnés, no una aserción de configuración.

---

## DV-11 — ¿Qué test hay que invertir al encender el runtime?

**Pregunta**: encender producción contradice algo que hoy se asserta.

**Resolución**: sí. `tests/unit/sales-launch-hardcoded.test.ts` afirma el
congelamiento: que el loader publicado no se invoca en producción y que
`lastJevPlaybookVersionId` queda `null`. Ese test **debe reescribirse** en el corte
3 para afirmar lo contrario.

**Consecuencia**: no es "borrar el test del freeze"; es convertirlo en el test del
runtime publicado. El nombre del archivo debe seguir reflejando que cubre
hardcoded como *fallback*, no como *única fuente*.

---

## DV-12 — ¿Construimos otro Laboratorio para "ver respuestas"?

**Pregunta**: el dueño pidió acceso a probar Published/Draft desde la UI.

**Resolución**: no. El Laboratorio comercial ya existe con runner real, casos,
juez y override restringido a `is_test` (`src/server/lab/runner.ts`,
`src/app/(app)/lab/page.tsx`). Lo que falta es un **CTA** desde la pestaña
Commercial/Jev hacia `/lab`. Mostrar un resumen de la última prueba es opcional y,
de hacerse, se **lee** del Lab: duplicar el runner inflaría el alcance y abriría
una segunda superficie de efectos reales.

**Consecuencia**: el corte 1 es un enlace, no un módulo.

---

## Resumen de decisiones

| ID | Decisión | Efecto |
|---|---|---|
| D1 | Reutilizar toda la infraestructura 008 | Sin tablas, stores, loaders ni endpoints nuevos |
| D2 | El corte 3 reencende `SALES_PLAYBOOK_RUNTIME_ENABLED` | Interruptor aislado y reversible |
| D3 | Split Config/Jev como proyección de UI | Un solo modelo durable |
| D4 | La validación es siempre server-side | El editor no puede saltarse el backend |
| D5 | Podar solo lo verificado sin referencias | Nada de borrados heroicos |
| D6 | `textarea` monoespaciado, sin dependencia nueva | Constitución respetada |
| D7 | Baseline en `v1.ts`, contrato congelado intacto | `questions.ts` no se toca |
| D8 | Sin ampliación de schema; una única rama en el writer | `setup = 0` no produce "S/0" |
| D9 | CTA al Lab existente | No hay segundo laboratorio |
