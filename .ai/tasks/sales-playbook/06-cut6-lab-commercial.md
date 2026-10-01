# CUT 6 — Sales Playbook: laboratorio comercial (Published vs Draft, sin efectos residuales)

Lee obligatoriamente, en este orden:

- AGENTS.md
- `.specify/memory/constitution.md`
- `docs/CURRENT_STATE.md`
- `specs/008-sales-playbook/spec.md`
- `specs/008-sales-playbook/plan.md`
- `specs/008-sales-playbook/tasks.md`
- `specs/008-sales-playbook/contracts/playbook-api.md`
- `src/server/lab/runner.ts` (a modificar)
- `src/server/lab/personas.ts` (extender)
- `src/server/lab/judge.ts` (referencia; sigue como heurística)
- `src/components/lab/lab-client.tsx` (extender)
- `src/app/api/lab/runs/route.ts`
- `src/app/api/lab/runs/[id]/route.ts`
- `src/server/sales/orchestrator.ts` (override guard del Corte 3)
- `src/server/ai/delivery.ts` (sender de WhatsApp en `is_test`)
- tests existentes del lab (`tests/unit/lab-sandbox.test.ts`,
  `judge.test.ts`)

Objetivo único:

implementar T601–T608 del Corte 6. Ejecutar el pipeline REAL
(orchestrator + Jev + resolver + writer) sobre conversaciones
sandbox con override de Playbook (solo porque `is_test=true`).
Persistir `playbook_version_id` por caso. Soportar expected
outcomes humanos. Comparar Published vs Draft. Garantizar **cero
efectos residuales**: cero WhatsApp real, cero follow-ups
pendientes, cero CAPI.

Tareas concretas:

1. **T601** — `src/server/lab/personas.ts`.
   - Mantener las 6 ferreteras con prefijo `legacy_*` (no se
     eliminan; siguen funcionando para legacy runs).
   - Agregar 6 personas V1 comerciales:
     - `v1_academia_natacion_consultora`
     - `v1_academia_presupuesto_libre`
     - `v1_academia_insatisfecha_otro_sistema`
     - `v1_academia_temporada_alta_futuro`
     - `v1_academia_multiples_sedes_decisores`
     - `v1_academia_fuera_contexto_internet`
   - Cada una con `script: string[]` realista para academias
     deportivas.

2. **T602** — `src/server/lab/runner.ts`.
   - En lugar de `runAgentTurn(convId)` (legacy), usar
     `runSalesOrchestratorTurn(conv, { playbookOverride? })`
     cuando el modo lo indique.
   - **Nuevo**: cada `agent_test_case` debe persistir
     `playbook_version_id` (columna nueva; migración aditiva
     0008b) y `playbook_schema_version`.
   - En el runner, antes de crear el caso:
     1. Cargar el `playbook_version_id` según el modo
        (`published`, `draft`, `archived:N`).
     2. Cargar el config por `getConfigByVersionId(orgId,
        versionId)` (del Corte 3).
     3. Pasarlo a `runSalesOrchestratorTurn` como
        `playbookOverride`. El orquestador verificará
        `is_test=true` (las conversaciones sandbox lo son).
   - El modo legacy (sin Sales Orchestrator) sigue funcionando
     con las personas legacy y `playbook_version_id = null`.

3. **T603** — Migración 0008b.
   - `ALTER TABLE agent_test_case ADD COLUMN
     playbook_version_id text NULL`,
     `playbook_schema_version text NULL`,
     `expected_next_action text NULL`,
     `expected_lane text NULL`,
     `expected_handoff boolean NULL`.
   - Editada a mano con `ADD COLUMN IF NOT EXISTS` (Postgres
     9.6+).
   - Re-ejecutable.

4. **T604** — Expected outcomes.
   - La UI permite setear `expected_next_action`,
     `expected_lane`, `expected_handoff` por caso (modo manual;
     no se autocompleta).
   - En el reporte, mostrar ✅ cuando coinciden, ❌ cuando
     difieren, "—" cuando no hay expected.

5. **T605** — Comparación Published vs Draft.
   - `POST /api/lab/runs` con `{ "playbook_mode": "draft" }`
     ejecuta la corrida usando el draft activo (en lugar de la
     publicada).
   - `playbook_mode: "published"` (default) usa la publicada.
   - `playbook_mode: "archived:VERSION_ID"` usa la versión
     archivada solicitada.
   - `playbook_mode: "both"` ejecuta dos corridas en paralelo:
     una contra published y otra contra draft. Persistir ambas.
   - El override llega al orquestador por
     `runSalesOrchestratorTurn` (T306 del Corte 3) y se
     valida con `is_test === true`.

6. **T606** — UI del Laboratorio.
   - Selector de modo (Published / Draft / Archived:N / Both).
   - Si hay expected outcomes, mostrar ✅/❌ por campo
     esperado.
   - Diff side-by-side para `both`: cada caso muestra dos cards
     (uno por versión), con tilde verde/rojo donde difieren
     los outcomes esperados.
   - Mantener compatibilidad con las personas legacy (sin
     Sales Orchestrator).

7. **T607** — Tests del runner:
   - `tests/unit/lab-pipeline-real.test.ts`:
     - sandbox no toca WhatsApp real (spy sobre `graphRequest` /
     `metaSend`);
     - persiste `playbook_version_id` y `playbook_schema_version`
       por caso;
     - override rechazado si `is_test=false` (cubierto por
       `tests/unit/playbook-override-guard.test.ts` del Corte
       3; verificar que el runner no rompe esa garantía);
     - cero filas en `sales_follow_up_job` tras corrida
       `is_test=true` (cubierto por
       `playbook-lab-suppress-followups.test.ts` del Corte 3);
     - respeta fallback si no hay publicada
     (`playbook_version_id = null`);
     - personas legacy siguen funcionando;
     - `playbook_mode: "both"` ejecuta dos corridas con
       `playbook_version_id` distintos.

8. **T608** — E2E:
   - Lanzar corrida Published → 200 con casos V1.
   - Lanzar corrida Draft → 200 con casos V1.
   - Verificar que ambos persisten versión distinta.
   - Con expected set, ver tilde correcto.
   - Verificar en BD que NO hay filas en `sales_follow_up_job`
     para la conversación sandbox.
   - Verificar que `GET /api/dev/wa-mock/outbox` está vacío.

Restricciones:

- **NO** eliminar las personas legacy.
- **NO** romper `tests/unit/judge.test.ts` ni
  `lab-sandbox.test.ts`.
- **NO** hacer llamadas reales a WhatsApp/Jev/CAPI.
- **NO** introducir dependencias nuevas.
- **NO** override de Playbook sobre conversaciones reales (el
  orquestador lanza si llega override con `is_test=false`).
- **NO** dejar jobs sandbox activos al final de la corrida
  (el orquestador ya suprime scheduling; verificar en tests).

Verificación:

- `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en
  verde.
- E2E Playwright verde.
- Self-test manual con `pnpm dev` + mocks:
  - `POST /api/lab/runs` → 200 con casos V1.
  - `playbook_version_id` poblado.
  - Sin WhatsApp real (`/api/dev/wa-mock/outbox` sigue vacío).
  - Sin filas en `sales_follow_up_job` por la conversación
    sandbox.

Cierre:

- `tasks.md`: T601–T608 marcados.
- Working tree limpio.
- Un commit:
  `feat(lab): laboratorio comercial con Published vs Draft`

NO empieces Corte 7.