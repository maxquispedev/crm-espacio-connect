# Playbook Runtime Admin — overview

> Feature **009**. Termina de adoptar la Feature 008 (Sales Playbook) como
> configuración comercial real de producción: editor JSON técnico, baseline
> comercial vigente y runtime consumiendo la versión publicada, todo **sin
> redeploy**.
>
> Este directorio es el bootstrap. **Cero código productivo modificado.**

---

## Contexto en una frase

La 008 construyó la infraestructura durable completa, pero dejó tres cosas
sin cerrar: la UI por formularios que su único usuario real no va a usar, el
baseline comercial congelado en la oferta anterior (`497` + `197`) y el runtime
apagado con `SALES_PLAYBOOK_RUNTIME_ENABLED = false`.

## Regla de oro

> **NO reconstruir la Feature 008.** Ya existen `sales_playbook`,
> `sales_playbook_version`, `ConfigV1` + Zod, draft/validate/publish/rollback,
> historial, loader sin cache, Laboratorio Published vs Draft, guardarraíles
> Jev, tenant isolation, auditoría y fallback hardcodeado.
> **NO** crear un segundo sistema de configuración, ni duplicar stores, tablas,
> loaders o APIs.

## Plan SDD

Lee obligatoriamente, en este orden:

- `specs/009-playbook-runtime-admin/spec.md` — **estado: PLANIFICADA / NO IMPLEMENTADA**
- `specs/009-playbook-runtime-admin/plan.md`
- `specs/009-playbook-runtime-admin/tasks.md`
- `specs/009-playbook-runtime-admin/research.md` (DV-1..DV-12)
- `specs/009-playbook-runtime-admin/contracts/playbook-ui.md`
- Contexto heredado: `specs/008-sales-playbook/` (spec, plan, contracts)
- `docs/SALES_ORCHESTRATOR.md` · `docs/playbook.md` · `docs/CURRENT_STATE.md`

**Código, schema y tests mandan sobre los docs.** Si un doc de la 008 contradice
el código, el código gana.

## Cortes (en orden estricto)

| # | Task file | Objetivo único | Commit esperado |
|---|---|---|---|
| 1 | `01-cut1-technical-json-editor.md` | Editor técnico JSON (Config + Preguntas Jev) en Agente. **No toca producción** | `feat(playbook): simplificar editor técnico JSON` |
| 2 | `02-cut2-baseline-commercial-v1.md` | Baseline comercial vigente (`0` + `S/247`) en fallback y bootstrap. **Runtime sigue APAGADO** | `feat(playbook): sincronizar baseline comercial Vende Veloz` |
| 3 | `03-cut3-enable-production-runtime.md` | **El interruptor**: conversaciones reales consumen la Published. Aislado y reversible | `feat(playbook): activar runtime publicado en producción` |

Cada task file ordena al agente: leer el contexto obligatorio → inspeccionar la
realidad del código → implementar **solo** su corte → tests cercanos al cambio →
gates → marcar `tasks.md` con evidencia real → **un** commit → árbol limpio →
**STOP**.

## Estado actual del repo (verificado en `eb8f3e8`)

| Hecho verificado | Dónde |
|---|---|
| El interruptor de producción es una constante en `false` | `src/server/sales/build-state.ts:37` |
| El loader publicado **no tiene cache** | `src/lib/sales/playbook/loader.ts` |
| El override de draft ya está restringido a `is_test` | `src/server/sales/orchestrator.ts:78` |
| La degradación a fallback + warning ya existe | `src/server/sales/build-state.ts` |
| La oferta en código es la anterior: `497` / `197` | `src/server/sales/vende-veloz.ts`, `src/lib/sales/playbook/v1.ts` |
| `questions.ts` está **hash-frozen** contra un blob upstream | `tests/unit/sales-questions-freeze.test.ts` |
| La UI a sustituir son dos archivos grandes de formularios | `playbook-draft-editor.tsx`, `jev-questions-editor.tsx` |
| El Laboratorio comercial ya existe y es reutilizable | `src/app/(app)/lab/`, `src/server/lab/runner.ts` |
| El arnés E2E ya sabe publicar y rollbackear | `scripts/e2e-selftest.mjs` §013/§014 |
| Un test afirma hoy el congelamiento (hay que invertirlo) | `tests/unit/sales-launch-hardcoded.test.ts` |

## Cómo ejecutar

```bash
# Desde repo root, Bash/WSL.
./scripts/ai/run-playbook-runtime-admin.sh            # desde el corte 1
START_CUT=2 ./scripts/ai/run-playbook-runtime-admin.sh  # reanudar en el 2
START_CUT=3 ./scripts/ai/run-playbook-runtime-admin.sh  # reanudar en el 3
```

Variables configurables:

- `START_CUT=n` (1..3) — reanuda desde el corte N.
- `CUT_TIMEOUT` (default `60m`).
- `CUT_PERMISSION` (default `full`).
- `HEARTBEAT_SECONDS` (default `25`).

Logs por corte en `.ai/logs/playbook-runtime-admin/`.

El runner es **fail-fast**: se detiene si `mcode` sale distinto de cero, si el
árbol queda sucio, o si no aparece commit nuevo. Cada corte usa una sesión
**nueva** de `mcode exec` (sin `--continue`).

## Recuperación ante fallo (importante)

Si `mcode` falla **a mitad** de un corte, el trabajo parcial **NO se descarta**:

1. **NO** `git reset`.
2. **NO** descartar cambios.
3. **NO** `git checkout -- .` ni `git stash`.
4. Inspeccionar `git status` y `git log --oneline -5`.
5. Lanzar una sesión **NUEVA** de `mcode` para terminar **ESE MISMO** corte
   (copiar el contenido del task file correspondiente).
6. Verificar los gates.
7. Generar **su único commit**.
8. Dejar el árbol limpio.
9. Reanudar el runner con `START_CUT=N+1`.

Descartar cambios perdería horas de trabajo válido. El runner detecta el árbol
sucio y se detiene: eso es una **protección**, no un fallo del corte.

## NO HACER

- Tocar sender, webhook, inbox, CAPI, stage-gateway o el motor de follow-ups
  salvo adaptación estrictamente necesaria.
- Añadir dependencias de runtime. **Nada de Monaco/CodeMirror**: un `textarea`
  monoespaciado bien resuelto es la decisión.
- Crear servicios externos, colas, Redis, S3.
- Reconstruir la 008 ni duplicar stores, tablas, loaders o APIs.
- Construir un segundo Laboratorio o duplicar su runner.
- Validar el JSON en el cliente en vez de en el servidor.
- Ampliar `ConfigV1Schema` sin una necesidad **ejecutable**, documentada y con tests.
- Activar `SALES_PLAYBOOK_RUNTIME_ENABLED` antes del corte 3.
- Cambiar option keys contractuales de Jev V2.
- Tocar `src/server/sales/questions.ts` o los `criteria` de las preguntas sin un
  motivo fuerte y explícito.
- Copiar al repo la memoria comercial de Cerebro: aquí va solo el contrato
  técnico y el fallback.
- `git push`, ramas innecesarias, o cualquier operación destructiva.

## Done criteria global

La feature 009 **no** se declara Hecha hasta que:

1. Los tres cortes estén verdes, con un commit cada uno y árbol limpio.
2. `pnpm typecheck && pnpm lint && pnpm build && pnpm test` pase.
3. Exista **evidencia E2E de los escenarios A–H** de `spec.md` §4, incluido el
   hot-switch y el rollback **sin redeploy**.
4. `docs/CURRENT_STATE.md`, `docs/playbook.md` y `docs/SALES_ORCHESTRATOR.md`
   reflejen el estado real.

**Sin evidencia E2E no se dice READY.**
