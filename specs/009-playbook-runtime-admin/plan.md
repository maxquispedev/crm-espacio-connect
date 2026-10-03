# Plan — Feature 009 Playbook Runtime Admin

> Estado: PLANIFICADA / NO IMPLEMENTADA.
> Documento técnico (**cómo**). El **qué** está en [spec.md](./spec.md).
> Todas las referencias de este plan se verificaron contra el código real del
> repo en el commit base `eb8f3e8`. **Código y tests mandan sobre docs viejos.**

---

## 1. Qué resuelve ya la Feature 008 (NO reconstruir)

Todo el backend durable existe. Esta feature **no lo toca**:

| Necesidad | Resuelto por | Ubicación real |
|---|---|---|
| Modelo durable versionado | `sales_playbook` + `sales_playbook_version` | `src/lib/db/schema.ts`, `src/lib/sales/playbook/store.ts` |
| Contrato validado | `ConfigV1Schema` + `superRefine` con guardarraíles Jev | `src/lib/sales/playbook/schema.ts` |
| Llaves protegidas | `engine-required` / known signals / option keys / types | `src/lib/sales/playbook/constants.ts` |
| draft / validate / publish / rollback / versiones | 7 rutas bajo `/api/playbook` | `src/app/api/playbook/*` |
| Lectura tenant-safe **sin cache** | `getPublishedConfigForOrg`, `getDraftConfigForOrg`, `getConfigByVersionId` | `src/lib/sales/playbook/loader.ts` |
| Bootstrap multi-org determinista e idempotente | siembra V1 publicada | `src/lib/sales/playbook/bootstrap.ts` |
| Override de draft **solo** en `is_test` | lanza `playbook_override_forbidden_in_production` | `src/server/sales/orchestrator.ts:78` |
| Degradación a fallback + warning | `console.warn` una vez por org y proceso | `src/server/sales/build-state.ts` |
| Fallback hardcodeado | `VENDE_VELOZ_*`, `JEV_SALES_QUESTIONS_V2` | `src/server/sales/vende-veloz.ts`, `src/server/sales/questions.ts` |
| Laboratorio Published vs Draft | runner con override solo sandbox | `src/server/lab/runner.ts`, `src/app/(app)/lab/page.tsx` |
| Auditoría de versión | `lastJevPlaybookVersionId`, `lastJevPlaybookSchemaVersion`, `playbook_version` en `lastJevDecision` | `src/server/sales/build-state.ts` |
| Regresión de aislamiento | dos tenants en el arnés | `scripts/e2e-selftest.mjs` §013 |

**Decisión D1**: esta feature no añade tablas, columnas, stores, loaders ni
endpoints nuevos. La única excepción posible, y solo si aparece una necesidad
ejecutable, está en `plan.md` §4.

## 2. El interruptor de producción

La arquitectura runtime **ya es configurable y ya fue congelada**. El único punto
de decisión es una constante:

```
src/server/sales/build-state.ts:37
  export const SALES_PLAYBOOK_RUNTIME_ENABLED = false;
```

y su único consumidor:

```
const usePlaybook = SALES_PLAYBOOK_RUNTIME_ENABLED || isTest;
```

**Decisión D2 (Corte 3)**: reactivar esa arquitectura. **No** reescribirla, **no**
añadir feature flags nuevos, **no** tocar el sender, el webhook, CAPI ni el motor
de follow-ups. Reversible en una línea.

## 3. Corte 1 — el split Config / Preguntas Jev sin segundo modelo durable

### 3.1 El problema

`ConfigV1` tiene nueve claves de primer nivel:

```
product · offer · commercial_policy · priorities · writer
prohibitions · handoff · urgency_rules · jev_questions
```

La UI debe presentar **dos** documentos JSON. La pregunta de diseño es cómo hacer
eso sin crear un segundo modelo persistente.

### 3.2 La respuesta: proyección de UI

El modelo durable es **uno**: una fila de `sales_playbook_version` con un
`ConfigV1` completo. El split es exclusivamente una **vista del cliente**:

1. Al cargar, el cliente toma el `ConfigV1` del draft.
2. El editor **Config** muestra `{...cfg}` sin `jev_questions`.
3. El editor **Preguntas Jev** muestra `{...cfg.jev_questions}`.
4. Al guardar, se reassembla `{ ...configEdit, jev_questions: jevEdit }` y se hace
   `PUT /api/playbook/draft` **exactamente igual que hoy**, con el documento
   entero.

**Decisión D3**: no hay columna `config_json_text`, ni tabla de preguntas, ni
endpoint de validación separado. El reassembly es un shallow spread de dos
objetos que el cliente ya tiene en memoria. Cero migraciones.

**Decisión D4 (validación)**: el cliente **no** implementa Zod. `ConfigV1Schema`
vive en `src/lib/sales/playbook/` y es código de servidor. El botón Validar hace
`POST /api/playbook/validate` con el documento reassemblado, y los `details[]`
con su `path` se pintan junto al editor. Reutiliza el endpoint tal cual.

### 3.3 Errores de parseo con línea y columna

`JSON.parse` en V8 incluye la posición del fallo en el mensaje
(`... in JSON at position 1234`). Convertir `position` a línea/columna es aritmética
sobre el propio texto: sin dependencia, sin librería. Si el mensaje no trae
posición, se muestra el error crudo sin inventar línea.

### 3.4 Qué queda obsoleto

| Archivo | Realidad | Acción propuesta |
|---|---|---|
| `playbook-draft-editor.tsx` (~26 KB) | 8 formularios por bloques; solo el admin técnico lo usaría | **Sustituir** por el editor JSON de Config |
| `jev-questions-editor.tsx` (~31 KB) | editor visual con 🔒/📊/➕ | **Sustituir** por el editor JSON de Preguntas Jev; la clasificación se conserva como leyenda/lectura, no como edición |
| `fields.tsx` (~12 KB) | `TextField`, `NumberField`, `SelectField`, `SwitchField`, `StringListEditor`, `FieldRow`, `TextAreaField` quedan sin uso; `BlockSection` y `Modal` siguen usándose | **Podar** solo los exports sin referencia tras la sustitución |
| `playbook-client.tsx` | container: ya orquesta draft/publish/rollback/versions | **Reusar**, no reescribir |
| `playbook-published-card.tsx`, `playbook-versions-list.tsx`, `summary.ts`, `types.ts` | siguen siendo válidos | **Reusar** |
| `agent-client.tsx:206` | `tab === "playbook" ? <PlaybookClient /> : null` | **Reusar**; solo cambia la etiqueta de la pestaña |

**Decisión D5**: borrar código muerto es correcto, pero **solo lo que quede
literalmente sin referencias** (verificado con grep + `pnpm typecheck` +
`pnpm lint`; los exports no usados no los detecta el compilador, así que el grep
es la prueba). Si un componente resulta dudoso, se deja sin uso: código muerto
es mejor que un borrado que rompa el build. La decisión final la toma el agente
del corte 1 mirando el estado real, y la registra en `tasks.md`.

**Decisión D6 (dependencia)**: no se añade Monaco, CodeMirror ni ninguna otra.
`AGENTS.md` lo prohíbe explícitamente y la Constitución veta dependencias nuevas de
runtime. Un `textarea` monoespaciado con `spellCheck={false}` resuelve el caso.

### 3.5 Laboratorio: CTA, no segundo laboratorio

`/lab` ya existe con su runner (`src/server/lab/runner.ts`) y su cliente
(`src/components/lab/lab-client.tsx`). El corte 1 añade un enlace/CTA claro desde
la pestaña Commercial/Jev hacia `/lab`. Mostrar un resumen de la última prueba es
opcional: si se hace, **se lee** del Lab; no se replica su runner ni su lógica de
casos.

## 4. Corte 2 — baseline comercial: qué se toca y qué no

### 4.1 Dónde vive el baseline

| Constante | Archivo | Papel |
|---|---|---|
| `VENDE_VELOZ_OFFER` | `src/server/sales/vende-veloz.ts` | fallback del writer y del pipeline |
| `VENDE_VELOZ_PRODUCT`, `VENDE_VELOZ_COMMERCIAL_POLICY` | `src/server/sales/vende-veloz.ts` | fallback |
| `VENDE_VELOZ_PLAYBOOK_V1` | `src/lib/sales/playbook/v1.ts` | baseline **publicado** por el bootstrap multi-org |
| `JEV_SALES_QUESTIONS_V2` | `src/server/sales/questions.ts` | contrato congelado upstream |

### 4.2 Acoplamiento que obliga a hacer el cambio en lockstep

`sales-questions-freeze.test.ts` ata tres representaciones y compara igualdad
exacta:

| Constante | Debe coincidir con |
|---|---|
| `JEV_SALES_QUESTIONS_V2` | `tests/fixtures/jev-questions-v2.json` **y** el sha1 del blob upstream `fe3e075…` |
| `VENDE_VELOZ_PRODUCT` | `docs/SALES_ORCHESTRATOR.md` §5 |
| `VENDE_VELOZ_COMMERCIAL_POLICY` | `docs/SALES_ORCHESTRATOR.md` §6 |
| `VENDE_VELOZ_OFFER` | aserciones explícitas `setup === 497`, `monthlyBase === 197` |
| `VENDE_VELOZ_PLAYBOOK_V1.jev_questions[*].criteria` | los cinco criterios canónicos de la fixture |

**Decisión D7 (la más importante del corte 2)**: la estrategia de filtrado de Jev
V1 se expresa en el **playbook bootstrap** (`v1.ts`: `commercial_policy`,
`writer`, `handoff`, `urgency_rules` y las `instructions` de las preguntas), **no**
tocando `questions.ts`. Motivos:

1. `questions.ts` está **hash-frozen** contra un blob upstream validado. Cambiar
   sus textos rompe la red de regresión que garantiza que las claves contractuales
   no se degradan.
2. La 008 dejó `questions.ts` como `DEFAULTS_ONLY` justamente para que la
   estrategia viva en el playbook, que es por-org y editable.
3. El dueño fue explícito: *"NO cambiar option keys contractuales"* y *"mantener
   acciones contractuales existentes salvo necesidad técnica demostrada"*.

Por tanto los `criteria` de `v1.ts` deben seguir siendo **idénticos** a la
fixture (el freeze test lo asserta), y lo que cambia es el texto de
`instructions`. Si el agente del corte 2 necesita tocar `questions.ts`,
debe documentar el motivo en `tasks.md` y actualizar fixture + doc §7 en el mismo
commit; si no lo necesita, no lo toca.

### 4.3 El schema NO se amplía

`spec.md` §3.2 lo prohíbe salvo necesidad ejecutable. Inspección del schema real:

| Concepto comercial | Dónde se representa hoy |
|---|---|
| sin fee de implementación | `offer.setup = 0` |
| implementación asistida incluida | `offer.implementation.purpose` + `includes` |
| primer mes pagado por adelantado | `offer.implementation.includes` y `writer.present_price` |
| sin permanencia obligatoria | `offer.implementation.includes` y `writer.present_price` |
| dominio primer año incluido cuando aplica | `offer.implementation.includes` |
| renovación desde el 2º año aparte, no líder | `offer.neverPromise` |
| objetivo de aprendizaje, no margen | `commercial_policy.goal` |
| handoff por avance genuino o petición | `handoff` |

**Decisión D8**: no hay cambio de schema. Los conceptos caben en los campos
existentes, que son texto libre validado por longitud y no enumeraciones.

### 4.4 Un hueco ejecutable real (el único que sí se toca)

`src/server/sales/writer.ts:211` renderiza incondicionalmente:

```ts
`- Implementación: S/${offer.setup} una sola vez.`,
```

Con `setup: 0` eso produce literalmente **"Implementación: S/0 una sola vez"** en
el prompt del writer, es decir, un precio falso enviado a un lead. No es un
cambio de schema: es una rama mínima en `offerBlock` que omite la línea de setup
cuando vale `0` y declara la implementación como incluida, **cubierta por un test**
en `tests/unit/sales-writer.test.ts`.

Esta es la clase de necesidad ejecutable que justifica tocar código: se puede
observar en la salida, no es cosmética, y el test lo prueba.

### 4.5 Otros acoplamientos en tests y docs

Además del freeze test, hay que actualizar en el mismo commit:

- `tests/unit/sales-questions-freeze.test.ts` (aserciones `497`/`197`).
- `tests/unit/sales-writer.test.ts` (nombre del caso: *"inyecta la oferta
  S/497 + S/197 + S/1"*).
- `docs/SALES_ORCHESTRATOR.md` §3/§4 (el bloque de oferta y la lista de precios
  legendadas) y §5/§6 si cambian producto o política.
- `docs/playbook.md` si el procedimiento del dueño cambia.

`tests/unit/lab-case-from-conversation.test.ts` usa `S/497`/`S/197` como
**cadenas de PII anonimizada de prueba**, no como contrato comercial: no debe
tocarse por el cambio de precio.

## 5. Corte 3 — pruebas del hot-switch

### 5.1 Regresión existente que hay que invertir

`tests/unit/sales-launch-hardcoded.test.ts` **afirma hoy el congelamiento**:

- que el loader publicado **no** se invoca en producción;
- que `lastJevPlaybookVersionId` queda `null`.

Ese test es el freeze, y por diseño **debe cambiar** en el corte 3: pasa a
afirmar lo contrario (el loader se invoca, la versión se audita). El agente del
corte 3 debe reescribir esas aserciones, no borrarlas, y dejar claro en el nombre
del test que ahora cubre el runtime publicado.

### 5.2 Cómo se prueba el hot-switch sin redeploy

El loader no tiene cache (`loader.ts`, sin `cache()` ni memoización), y
`usePlaybook` se resuelve por turno. Por tanto el ciclo
**publicar → siguiente turno** es observable sin tocar el proceso. El arnés
`scripts/e2e-selftest.mjs` ya sabe hacerlo: las secciones 013/014 publican y
rollbackean y luego leen las nuevas outbound. El corte 3 añade una sección que
encadena, sobre una conversación real de la org de pruebas:

1. Published con `S/247` → turno → outbound con `S/247`.
2. Draft con otro precio/writer → turno → outbound **sigue** con el viejo.
3. Publicar → turno → outbound con el nuevo, sin reiniciar nada.
4. Rollback → turno → outbound con el restaurado.
5. Published inválida o ausente → turno → outbound con el fallback, sin crash.
6. Segunda organización → turno → outbound con **su** playbook, nunca el ajeno.

Los escenarios A–H de `spec.md` §4 son la lista de aceptación. **Todos** deben
quedar con evidencia; si el entorno no permite levantar el stack completo, se
documenta exactamente qué queda sin verificar — no se declara la feature lista.

## 6. Constitution Check

| Principio | Cómo se respeta |
|---|---|
| **I — Seguridad** | Sin secretos nuevos. El editor no expone tokens; las validaciones siguen siendo server-side |
| **II — Soberanía** | Cero servicios externos y **cero dependencias de runtime nuevas**. Editar JSON con `textarea` mantiene la prohibición de Monaco/CodeMirror |
| **III — Multi-tenancy** | Toda lectura sigue por `scoped()`/`organizationId` del loader. Escenario F lo prueba |
| **IV — Idempotencia** | Bootstrap y migraciones siguen siendo re-ejecutables; publish/rollback conservan la semántica monótona de la 008 |
| **Sandbox del Laboratorio** | El override sigue restringido a `is_test`; el sender real nunca se toca en el corte 3 |

## 7. Riesgos técnicos y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| El editor JSON se usa para meter una config inválida | `POST /api/playbook/validate` es la única autoridad; publicar sigue exigiendo validación server-side |
| Un borrado accidental rompe la UI de Agente | Solo se borra lo verificado sin referencias; `pnpm build` + E2E de la pestaña es la prueba |
| Encender producción sin baseline coherente | El corte 2 deja el runtime apagado y lo testea; el corte 3 exige Published válida y el corte 2 deja documentado el paso de publicar antes |
| Published corrupta tumba el turno | La degradación a fallback ya existe en `build-state.ts`; el corte 3 la verifica con el escenario E |
| Derrota silenciosa del hot-switch | Escenario C y D son la evidencia obligatoria de que no hay cache |
| Tensión con el contrato congelado de Jev | D7: la estrategia vive en el playbook, no en `questions.ts`; el freeze test queda intacto |

## 8. Definition of Done técnica

`pnpm typecheck && pnpm lint && pnpm build && pnpm test` verde, un commit por
corte, árbol limpio, `docs/CURRENT_STATE.md` y `docs/playbook.md` al día, y
evidencia E2E de A–H antes de declarar la feature lista.
