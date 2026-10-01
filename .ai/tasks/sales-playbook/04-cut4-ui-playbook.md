# CUT 4 — Sales Playbook: UI editor

Lee obligatoriamente, en este orden:

- AGENTS.md
- `.specify/memory/constitution.md`
- `docs/CURRENT_STATE.md`
- `specs/008-sales-playbook/spec.md`
- `specs/008-sales-playbook/plan.md`
- `specs/008-sales-playbook/tasks.md`
- `specs/008-sales-playbook/contracts/playbook-api.md`
- `specs/008-sales-playbook/contracts/playbook-config.md`
- `src/components/agent/agent-client.tsx` (a modificar)
- `src/components/ui/*` (componentes disponibles)
- `src/components/use-events.ts` (hook de SSE)
- `src/app/api/playbook/*` (creados en Corte 2)
- `tests/e2e/us-sales-playbook.md` (a crear / extender)
- `scripts/e2e-selftest.mjs` (referencia de sección a extender)

Objetivo único:

implementar T401–T407 del Corte 4. Editor por bloques en
`agent-client.tsx`. NO es JSON crudo. Bloques funcionales:
Producto, Oferta, Política, Prioridades, Writer, Prohibiciones,
Handoff, Urgencia. Acciones: Crear draft / Guardar / Validar /
Publicar / Rollback.

Tareas concretas:

1. **T401** — Refactor `agent-client.tsx`.
   - Mantener los cards existentes (`SalesOrchestratorCard`,
     `SalesFollowUpsCard`, `ProfileSection`, `KbSection`).
   - Agregar navegación tipo tabs: `Comportamiento`,
     `Conocimiento`, `Sales Playbook`.
   - `Sales Playbook` es el nuevo tab, que monta `<PlaybookClient />`.
   - Mantener el switch "Encendido/Apagado" del agente en el
     header (no se mueve).
   - **NO** reescribir los componentes existentes; agregar.

2. **T402** — `src/components/agent/playbook/playbook-client.tsx`.
   - Container con `useState` para `playbook`, `published`,
     `draft`, `versions`, `error`, `saving`, `busy`.
   - `useEffect` inicial: `GET /api/playbook`. Si
     `playbook === null` y `published === null`:
     - mostrar mensaje claro: "El bootstrap multi-org siembra la
       V1 al boot del sistema. Si no aparece, contacta al
       administrador.";
     - permitir igualmente crear un draft manualmente (operación
       administrativa) — **NO** sembrar bajo demanda desde esta
       UI.
   - Botón "Crear draft" → `POST /api/playbook/draft`. Refetch.
   - Botón "Refetch" manual.

4. **T403** — `playbook-published-card.tsx`.
   - Renderiza la versión publicada.
   - Muestra: `version_number`, `schema_version`, `published_at`,
     `notes`.
   - Mini-resumen del contenido: nombre del producto, lista de
     prioridades primarias, pricing
     (S/{setup} + S/{monthlyBase}/mes hasta {N} activos).
   - Badge por clase de pregunta Jev:
     - 🔒 `engine-required` (2 preguntas);
     - 📊 `known signal` (6 preguntas);
     - ➕ `analytical/custom` (libres).
   - Botón "Crear draft desde esta versión" (deshabilitado si ya
     hay draft).
   - Botón "Ver historial" → muestra `versions-list`.

5. **T404** — `playbook-draft-editor.tsx`.
   - Cada bloque funcional es un componente local con su
     formulario.
   - **Producto**: nombre, one_liner, who_it_is_for (lista
     editable), core_jobs (lista editable), not_the_product
     (lista), how_it_starts.
   - **Oferta**: currency (select), setup, monthlyBase,
     includedActiveStudents, extraPerActiveStudent,
     setupIsOneTime (switch), implementation.purpose,
     implementation.includes (lista), neverPromise (lista).
   - **Política**: defaultChannel (select), goal, automationFirst,
     autoClose, humanHandoff, futureInterest, noResponse,
     disqualification, evidenceRule (cada uno textarea).
   - **Prioridades**: tres listas (primary, secondary, tertiary)
     con drag-and-drop simple o flechas; límite 8 items.
   - **Writer**: 7 textareas (una por `next_action`).
   - **Prohibiciones**: lista `prohibitedClaims` (neverPromise
     está duplicado en offer; mostrarlo también como
     referencia).
   - **Handoff**: 5 textareas (auto, auto_close, human, wait,
     stop).
   - **Urgencia**: textarea.
   - **Las preguntas Jev NO se editan aquí** (eso es Corte 5).
     Esta vista muestra solo un resumen: número total de
     preguntas y badge por clase.
   - Validación cliente: al cambiar un campo, llamar a
     `POST /api/playbook/validate` con el documento entero
     (throttle 300ms). Mostrar errores en rojo debajo del campo.
   - Botón "Guardar cambios" → `PUT /api/playbook/draft`.
     Refetch.
   - Botón "Descartar cambios" → refetch sin guardar.

6. **T405** — `playbook-versions-list.tsx`.
   - Tabla con `version_number`, `status`, `created_at`,
     `published_at`, `archived_at`, `notes`.
   - Click en una fila → modal o expand con detalle.
   - Si la fila es `archived` y NO es la actual `published`,
     mostrar botón "Rollback a esta versión".

7. **T406** — Acciones:
   - `Publicar`: botón en el draft editor. Modal de confirmación
     con campo `notes` (obligatorio). POST `/api/playbook/publish`.
     Refetch.
   - `Rollback`: modal con campo `notes`. POST
     `/api/playbook/rollback`. Refetch.
   - `Eliminar draft`: solo permitido si la publicada sigue
     activa. DELETE `/api/playbook/draft` (endpoint a agregar en
     este corte; detalle en `contracts/playbook-api.md`).
     Refetch.

8. **T407** — E2E:
   - `tests/e2e/us-sales-playbook.md` (guiado).
   - Extender `scripts/e2e-selftest.mjs` con sección 012:
     - GET `/api/playbook` → 200 con V1.
     - POST `/api/playbook/draft` → 201.
     - PUT `/api/playbook/draft` con cambio en
       `writer.present_price` → 200.
     - POST `/api/playbook/publish` → 200.
     - GET `/api/playbook/versions` → incluye la nueva.
     - POST `/api/playbook/rollback` con V1 → 200.
     - GET `/api/playbook` con sesión cross-org → no leak.

Restricciones:

- **NO** JSON crudo en la UI.
- **NO** editor visual de workflows.
- **NO** añadir un constructor de campañas.
- **NO** editor Jev en este corte (es Corte 5).
- Reusar `Card`, `Button`, `Input`, `Textarea`, `Badge`, `Label`
  ya presentes en `components/ui/`.
- Mobile-friendly (los forms se apilan).

Verificación:

- `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en
  verde.
- E2E Playwright verde contra `pnpm dev` con mocks.
- Visual: abrir `/agent`, tab "Sales Playbook", editar un campo,
  guardar, publicar, ver historial.

Cierre:

- `tasks.md`: T401–T407 marcados.
- Working tree limpio.
- Un commit:
  `feat(playbook): UI editor por bloques`

NO empieces Corte 5.