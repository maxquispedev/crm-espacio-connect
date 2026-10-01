# CUT 5 — Sales Playbook: editor Jev (tres clases)

Lee obligatoriamente, en este orden:

- AGENTS.md
- `.specify/memory/constitution.md`
- `docs/CURRENT_STATE.md`
- `specs/008-sales-playbook/spec.md`
- `specs/008-sales-playbook/plan.md`
- `specs/008-sales-playbook/tasks.md`
- `specs/008-sales-playbook/contracts/playbook-config.md`
- `src/server/sales/questions.ts` (option keys V1 de las choice)
- `src/lib/sales/playbook/schema.ts` (creado en Corte 1; ya tiene
  las guardarraíles de option keys)
- `src/lib/sales/playbook/v1.ts` (contenido V1)
- `src/components/agent/playbook/playbook-draft-editor.tsx`
  (Corte 4)
- `src/app/api/playbook/draft/route.ts` (PUT del Corte 2)
- `src/server/sales/normalize.ts` (qué exige el normalizer
  refactorizado, Corte 3)
- `src/server/sales/decision.ts` (`SalesDecision` nullable, Corte
  3)

Objetivo único:

implementar T501–T507 del Corte 5. Editor Jev con **tres clases**
de preguntas bien diferenciadas:

| Clase | Cantidad V1 | Inmutabilidad |
|---|---|---|
| `engine-required` 🔒 | 2 (`next_action`, `needs_human_call`) | key, type, enabled, deleted fijos. Option keys (en `choice`) fijos. Descriptions editables. |
| `known signal` 📊 | 6 (`real_operational_need`, `product_fit`, `motivation_to_change`, `purchase_intent`, `buying_timing`, `main_value_proposition`) | key, type fijos. Option keys (en `choice`: `buying_timing`, `main_value_proposition`) fijos. Desactivables con fallback. |
| `analytical/custom` ➕ | libres | todas editables |

Tareas concretas:

1. **T501** — `components/agent/playbook/jev-questions-editor.tsx`.
   - Lista de preguntas del `draft.jev_questions`.
   - Cada pregunta muestra: key (con candado si `engine-required`
     o `known signal`), type (con candado si `engine-required` o
     `known signal`), enabled (toggle — deshabilitado en
     `engine-required`), order (flechas arriba/abajo), botón
     editar, botón duplicar (no `engine-required`), botón
     eliminar (solo `analytical/custom`).
   - Indicadores visuales por clase:
     - `engine-required`: candado 🔒 grande + tooltip "Contrato
       duro del resolver".
     - `known signal`: 📊 + tooltip "Señal comercial;
       desactivable con fallback".
     - `analytical/custom`: ➕ + tooltip "Pregunta libre, no
       afecta al motor".

2. **T502** — Editor inline por pregunta.
   - `choice`: criterios como tabla editable (key, descripción).
     En `engine-required` y `known signal` choice, las keys de
     la tabla vienen **precargadas con el set V1** y NO se
     pueden añadir ni eliminar keys nuevas (solo editar
     descripciones).
   - `noul`: dos campos (true / false).
   - `score`: lista de criterios como bullets editables.
   - `instructions`: textarea (siempre editable).
   - Toggle `enabled` (deshabilitado en `engine-required`).

3. **T503** — Crear pregunta nueva.
   - Modal con selector de tipo (`choice` / `noul` / `score`),
     key validada `^[a-z_]+$`, instructions iniciales.
   - La key no puede colisionar con una existente. Devolver 422
     si colisiona (validar cliente antes de enviar).
   - Se guarda como **`analytical/custom`**: el motor no la
     consume, solo la persiste. Marcar con badge ➕.
   - El servidor (PUT) debe rechazar creación con key que
     coincida con una `engine-required` o `known signal` (es
     reasignar una clase, no crear nueva).

4. **T504** — Duplicar pregunta existente.
   - Solo permitido si NO es `engine-required`.
   - Para `known signal`, la copia se guarda como
     `analytical/custom` (no se pueden duplicar las
     contractuales).
   - Crear copia con key sufijo `_copy`. Si `_copy` ya existe,
     sugerir `_copy_2`, etc.

5. **T505** — Validación server-side (revisión +
     `assertJevProtectedKeys`).
   - El Zod del Corte 1 (`superRefine`) ya rechaza:
     - `engine-required` faltantes;
     - `engine-required` con `enabled = false`;
     - `engine-required` con `type` incorrecto;
     - option keys fuera del set V1 en `next_action`,
       `buying_timing`, `main_value_proposition`;
     - keys mal formadas (`^[a-z_]+$`, ≤ 60 chars).
   - **Adicional** en el PUT del Corte 2 (verificar T208 ya
     probado): rechazar intento de cambiar `type` o `key` de
     `engine-required`/`known signal` (Zod ya lo hace al exigir
     presencia; documentar el comportamiento esperado en los
     tests).

6. **T506** — UX de candado.
   - En la UI, las `engine-required` y `known signal` choice
     muestran candado junto a key/type.
   - Tooltip:
     - `engine-required`: "Esta pregunta es parte del contrato
       del motor. Su key, type y option keys no pueden
       cambiar."
     - `known signal`: "Señal comercial reconocida por el motor.
       Key, type y option keys fijos. Puedes desactivar y editar
       descripciones."
   - El `type` no se renderiza como selector editable para
     `engine-required` ni `known signal`.

7. **T507** — Tests:
   - `tests/unit/playbook-jev-guards.test.ts` (complementa el de
     Corte 1):
     - PUT con `next_action.type = "noul"` → 422
       `engine_required_type_mismatch`.
     - PUT sin `next_action` → 422 `engine_required_missing`.
     - PUT con `next_action.enabled = false` → 422
       `engine_required_disabled`.
     - PUT con nueva pregunta analítica (`foo_bar` `noul`) →
       200.
     - PUT que desactiva `product_fit` (no protegida, `known
       signal` desactivable) → 200.
     - PUT con `buying_timing.criteria` que renombra una option
       key → 422 `choice_keys_mismatch`.
     - PUT con `main_value_proposition.criteria` que añade una
       key fuera del set V1 → 422 `choice_keys_mismatch`.
     - PUT con `real_operational_need.type = "score"` (cambio de
       type de `known signal`) → 422.
     - PUT que crea nueva pregunta con key `next_action` (ya
       existe como `engine-required`) → 422.
   - E2E: cambiar criterio de `next_action`, desactivar
     `product_fit`, crear pregunta analítica, intentar cambiar
     type de `next_action` (UI no permite; el test directo por
     API devuelve 422).

Restricciones:

- **NO** añadir lanes nuevas.
- **NO** permitir que `engine-required` ni `known signal`
  cambien key o type.
- **NO** permitir duplicar `engine-required`.
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