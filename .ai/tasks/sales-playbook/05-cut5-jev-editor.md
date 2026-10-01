# CUT 5 — Sales Playbook: editor Jev avanzado

Lee obligatoriamente, en este orden:

- AGENTS.md
- `.specify/memory/constitution.md`
- `docs/CURRENT_STATE.md`
- `specs/008-sales-playbook/spec.md`
- `specs/008-sales-playbook/plan.md`
- `specs/008-sales-playbook/tasks.md`
- `specs/008-sales-playbook/contracts/playbook-config.md`
- `src/server/sales/questions.ts` (referencia de la V1 Jev)
- `src/lib/sales/playbook/schema.ts` (creado en Corte 1)
- `src/lib/sales/playbook/v1.ts`
- `src/components/agent/playbook/playbook-draft-editor.tsx` (Corte 4)
- `src/app/api/playbook/draft/route.ts` (PUT del Corte 2)

Objetivo único:

implementar T501–T507 del Corte 5. Editor Jev con guardarraíles
duras. Las 8 preguntas estructurales tienen `key` y `type` no
editables. Las analíticas son flexibles.

Tareas concretas:

1. **T501** — `components/agent/playbook/jev-questions-editor.tsx`.
   - Lista de preguntas del `draft.jev_questions`.
   - Cada pregunta muestra: key (con candado si estructural),
     type (con candado si estructural), enabled (toggle),
     order (flechas arriba/abajo), botón editar, botón duplicar,
     botón eliminar (solo si analítica).
   - Indicador visual "Estructural 🔒" para las 8 fijas en V1.

2. **T502** — Editor inline por pregunta.
   - `choice`: criterios como tabla editable (key, descripción).
   - `noul`: dos campos (true / false).
   - `score`: lista de criterios como bullets editables.
   - `instructions`: textarea.
   - Toggle `enabled`.

3. **T503** — Crear pregunta nueva.
   - Modal con selector de tipo (`choice` / `noul` / `score`), key
     validada `^[a-z_]+$`, instructions iniciales.
   - La key no puede colisionar con una existente. Devolver 422 si
     colisiona (validar cliente antes de enviar).
   - Se guarda como **analítica**: el motor no la consume, solo la
     persiste. Marcar con badge "Analítica".

4. **T504** — Duplicar pregunta existente.
   - Solo permitido si NO es estructural.
   - Crear copia con key sufijo `_copy`. Si `_copy` ya existe, sugerir
     `_copy_2`, etc.

5. **T505** — Validación server-side.
   - En `PUT /api/playbook/draft`, antes de mergear y validar con
     `ConfigV1Schema`, ejecutar un check adicional:
     - Para cada clave en `PROTECTED_JEV_KEYS = ['next_action',
       'needs_human_call']`:
       - Si `current.jev_questions[key].type !== next.jev_questions[key].type`
         → 422 `protected_type`.
       - Si la key se intenta eliminar → 422 `protected_key`.
   - Implementar como un helper `assertJevProtectedKeys(current,
     next)` que devuelve `null` o `{ ok: false, code, path }`.

6. **T506** — UX de candado.
   - En la UI, las protegidas muestran un candado junto al `type` y
     tooltip: "Esta pregunta es parte del contrato del motor. Su
     type no puede cambiar."
   - El `type` no se renderiza como selector editable para protegidas.

7. **T507** — Tests:
   - `tests/unit/playbook-jev-guards.test.ts`:
     - PUT con `next_action.type = "noul"` → 422 protected_type.
     - PUT sin `next_action` → 422 protected_key.
     - PUT con nueva pregunta analítica (`foo_bar` `noul`) → 200.
     - PUT que desactiva `product_fit` (no protegida) → 200.
   - E2E: cambiar criterio de `next_action`, crear pregunta
     analítica, intentar cambiar type de `next_action` (UI no
     permite; el test directo por API devuelve 422).

Restricciones:

- **NO** añadir lanes nuevas.
- **NO** permitir que las protegidas cambien key o type.
- **NO** permitir que el editor Jev sea un constructor de flujos.

Verificación:

- `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en
  verde.
- Tests de guardarraíles verdes.
- E2E Playwright verde: editar criterio de `next_action`,
  desactivar `product_fit`, crear pregunta analítica.

Cierre:

- `tasks.md`: T501–T507 marcados.
- Working tree limpio.
- Un commit:
  `feat(playbook): editor Jev con guardarraíles`

NO empieces Corte 6.