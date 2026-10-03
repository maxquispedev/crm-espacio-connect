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

- [ ] **T911** — Sustituir `playbook-draft-editor.tsx` por el editor de
  **Configuración comercial JSON** (textarea monoespaciado, 2 namespaces,
  botón Formatear, errores de parseo con línea/columna).
  `**/src/components/agent/playbook/**`
- [ ] **T912** — Sustituir `jev-questions-editor.tsx` por el editor de
  **Preguntas Jev JSON**, conservando la legibilidad de las clases de guardarraíl
  (`engine-required` / known signal / analytical-custom).
  `**/src/components/agent/playbook/**`
- [ ] **T913** — Integrar el ciclo completo en `playbook-client.tsx`: crear
  draft, validar (`POST /api/playbook/validate`), guardar, publicar, historial,
  rollback; mostrar versión publicada, draft, `schema_version` y
  `version_number`; CTA al Laboratorio.
  `**/src/components/agent/playbook/playbook-client.tsx**`
- [ ] **T914** — Podar los componentes de formulario que queden **sin ninguna
  referencia** (verificado con grep + typecheck + lint). Nada de borrados
  heroicos: lo dudoso se deja sin uso y se documenta.
  `**/src/components/agent/playbook/fields.tsx**`
- [ ] **T915** — E2E del ciclo en la UI nueva, incluidos los caminos infelices
  (JSON inválido, Zod inválido, guardarraíl violado): mensaje claro, sin crash.
  `**/scripts/e2e-selftest.mjs**`, `**/tests/e2e/**`
- [ ] **T916** — Actualizar `docs/playbook.md` (el dueño ahora edita JSON) y
  `docs/CURRENT_STATE.md`.
  Commit: `feat(playbook): simplificar editor técnico JSON`

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
