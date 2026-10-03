# CUT 1 — Editor técnico JSON

## Lee obligatoriamente, en este orden

- `AGENTS.md`
- `.specify/memory/constitution.md`
- `docs/CURRENT_STATE.md`
- `specs/009-playbook-runtime-admin/spec.md`
- `specs/009-playbook-runtime-admin/plan.md`
- `specs/009-playbook-runtime-admin/tasks.md`
- `specs/009-playbook-runtime-admin/contracts/playbook-ui.md`
- `specs/009-playbook-runtime-admin/research.md` (DV-2, DV-3, DV-4, DV-5, DV-12)
- `docs/playbook.md` (guía del dueño que vas a actualizar)

## Antes de escribir código, inspecciona la realidad

```bash
ls -la src/components/agent/playbook/
grep -n "export function" src/components/agent/playbook/*.tsx
grep -n "playbook" src/components/agent/agent-client.tsx
cat src/app/api/playbook/validate/route.ts
cat src/app/api/playbook/draft/route.ts
```

- [x] Usa el **revisor de código** sobre la UI actual de playbook: qué componente
  hace qué, qué se reutiliza tal cual y qué queda muerto tras la sustitución.
- [x] Confirma qué usa `playbook-client.tsx` de `fields.tsx` **antes** de podar.
- [x] Verifica el contrato real de `POST /api/playbook/validate` (cuerpo y forma
  de `details[]`) en el código, no de memoria.

## Objetivo único

Sustituir la UI por formularios de la pestaña Sales Playbook por **dos editores
JSON técnicos**, dentro de Agente. **NO actives el runtime productivo.**

> La regla histórica *"NO JSON crudo"* queda **SUPERSEDED** para esta pestaña.
> Deja constancia del cambio en `tasks.md` para que no se lea después como
> regresión.

Debe quedar así:

```
COMERCIAL / JEV

1. Configuración comercial JSON   → product, offer, commercial_policy,
                                    priorities, writer, prohibitions,
                                    handoff, urgency_rules
2. Preguntas Jev JSON              → jev_questions
3. Estado / versionado             → published, draft, schema_version,
                                    version_number, crear draft, validar,
                                    guardar, publicar, historial, rollback
```

## Tareas

1. **T911 — Editor de Configuración comercial JSON.**
   - Reemplaza el contenido de `playbook-draft-editor.tsx` por un
     `textarea` monoespaciado que muestre el `ConfigV1` **sin** `jev_questions`,
     proyectado con `JSON.stringify(obj, 2)`.
   - Estado inicial formateado; `spellCheck={false}`; altura generosa.
   - **Botón "Formatear JSON"**: `JSON.parse` → `JSON.stringify(…, 2)`.
     Deshabilitado si no parsea. Nunca escribe un documento que no haya parseado.
   - **Errores de parseo con línea y columna**: `JSON.parse` de V8 incluye
     `position` en el mensaje; conviértela a línea/columna contando los `\n`
     anteriores. Si el mensaje no trae posición, muestra el error crudo **sin
     inventar** línea.

2. **T912 — Editor de Preguntas Jev JSON.**
   - Reemplaza `jev-questions-editor.tsx` por un `textarea` con el objeto
     `jev_questions` completo.
   - **Conserva la legibilidad de los guardarraíles**, aunque ya no se editen
     visualmente: leyenda o badges de `engine-required` 🔒 / known signal 📊 /
     analytical-custom ➕, tomando la clasificación de
     `src/lib/sales/playbook/constants.ts`.
   - Las option keys protegidas y los tipos protegidos **siguen bloqueados por
     el servidor**. No reimplementes esa validación en el cliente.
   - `analytical`/`custom` libres dentro del JSON, según el contrato vigente.

3. **T913 — Integrar en `playbook-client.tsx`.**
   - Reassembly al guardar: `{ ...configEdit, jev_questions: jevEdit }` y
     `PUT /api/playbook/draft` con el documento **completo**, igual que hoy.
   - **Botón "Validar"** → `POST /api/playbook/validate` con el documento
     reassemblado. Muestra los `details[]` con su `path` literal junto al editor.
     Throttle razonable.
   - Reutiliza las acciones que ya existen: crear draft, guardar, publicar (con
     nota obligatoria), historial, rollback, eliminar draft.
   - Muestra **versión publicada, versión draft, `schema_version`,
     `version_number`**, fechas y notas.
   - **CTA claro hacia `/lab`** para probar Published vs Draft. El Laboratorio
     ya existe: **no** construyas otro ni dupliques su runner. Si añades un
     resumen de la última prueba, **léelo** del Lab y mantenlo simple.
   - Ajusta la etiqueta de la pestaña en `agent-client.tsx` a **Comercial / Jev**
     sin tocar las otras dos (`Comportamiento`, `Conocimiento`).

4. **T914 — Podar lo muerto, con prudencia.**
   - Identifica con `grep` qué exports de `fields.tsx` quedan **sin ninguna
     referencia** tras la sustitución (`TextField`, `NumberField`,
     `SelectField`, `SwitchField`, `StringListEditor`, `FieldRow`,
     `TextAreaField` son candidatos; `BlockSection` y `Modal` probablemente se
     siguen usando).
   - Borra **solo** lo verificado sin referencias.
   - `tsc` no avisa de exports no usados: el `grep` es la prueba.
   - Ante la duda, **déjalo sin uso** y anótalo en `tasks.md`. Código muerto es
     mejor que un borrado que rompe el build.

5. **T915 — E2E del ciclo y de los caminos infelices.**
   - Extiende `scripts/e2e-selftest.mjs` con una sección que cubra, vía HTTP
     real contra la app: crear draft → validar → guardar → publicar → historial
     → rollback → eliminar draft.
   - **Caminos infelices obligatorios**:
     - JSON sintácticamente inválido → mensaje con línea/columna, sin crash.
     - JSON válido pero con Zod inválido (p. ej. `monthlyBase` como string) →
       `422` con su `path`.
     - Guardarraíl violado (p. ej. editar una option key protegida) → `422`
       con motivo claro.
   - Actualiza o extiende el guion guiado en `tests/e2e/`.
   - Deja la organización de pruebas como la encontraste.

6. **T916 — Docs.**
   - `docs/playbook.md`: el dueño ahora edita JSON. Actualiza el procedimiento
     paso a paso y explica los dos documentos, el botón Formatear, los errores
     con `path`, y el CTA al Laboratorio.
   - `docs/CURRENT_STATE.md`: refleja que la UI de playbook es JSON técnico.

## Restricciones

- **NO** actives `SALES_PLAYBOOK_RUNTIME_ENABLED`. Este corte no toca producción.
- **NO** añadas Monaco, CodeMirror ni ninguna dependencia. Cero cambios en
  `package.json`.
- **NO** cambies `ConfigV1Schema`, `constants.ts`, las rutas de API, el loader, el
  schema de base de datos ni el Laboratorio.
- **NO** implementes validación Zod en el cliente: el servidor es la autoridad.
- **NO** toques sender, webhook, CAPI ni follow-ups.
- **NO** cambies las option keys contractuales de Jev.
- No rompas responsive; desktop-first está bien, móvil debe apilar.

## Gates

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Máximo **2 iteraciones autónomas** de corrección si un gate falla por código. Si
tras dos sigue rojo, para, deja el árbol como está y explica qué falla y por qué.

## Cierre

- [x] Marca `T911`..`T916` en `specs/009-playbook-runtime-admin/tasks.md` con
      **evidencia real** (qué cambiaste, qué test lo cubre, qué E2E lo observó).
      Nada de status sin evidencia.
- [x] Actualiza `docs/CURRENT_STATE.md` y `docs/playbook.md`.
- [x] **Un solo commit**:
      `feat(playbook): simplificar editor técnico JSON`
- [x] Working tree limpio.

**STOP después de este corte. NO empieces el corte 2.**

Si el runner te relanza por un fallo previo, **no resetees nada**: termina
**este mismo** corte, corre los gates, deja **un** commit y árbol limpio.
