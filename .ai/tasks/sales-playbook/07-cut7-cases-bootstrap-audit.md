# CUT 7 — Sales Playbook: casos reales + auditoría + cierre

Lee obligatoriamente, en este orden:

- AGENTS.md
- `.specify/memory/constitution.md`
- `docs/CURRENT_STATE.md`
- `specs/008-sales-playbook/spec.md`
- `specs/008-sales-playbook/plan.md`
- `specs/008-sales-playbook/tasks.md`
- `specs/008-sales-playbook/contracts/playbook-api.md`
- `src/components/inbox/conversation-patch.ts` (referencia de helper puro)
- `src/components/inbox/contact-panel.tsx` (UI del panel lateral)
- `src/server/inbox/identity.ts` (cómo se identifica al contacto)
- `src/server/lab/runner.ts` (Corte 6)
- `src/lib/sales/playbook/bootstrap.ts` (Corte 1)
- `src/server/sales/vende-veloz.ts` (DEFAULTS_ONLY)

Objetivo único:

implementar T701–T708 del Corte 7. "Guardar conversación como caso"
con PII minimizada. Decisión documentada sobre el fallback. E2E
final. Docs. Cierre.

Tareas concretas:

1. **T701** — UI "Guardar conversación como caso".
   - Botón en el panel lateral de la conversación
     (`contact-panel.tsx` o donde viva el botón de acciones).
   - Confirmación: "¿Guardar esta conversación como caso de
     evaluación? No se incluirá número de teléfono, email ni
     identificador de contacto."
   - Al confirmar: POST a un nuevo endpoint
     `POST /api/lab/cases/from-conversation` con `{ conversation_id }`.

2. **T702** — Endpoint server-side.
   - `app/api/lab/cases/from-conversation/route.ts`.
   - Solo permitido si la conversación es del tenant de la sesión.
   - Solo permitido si Sales Orchestrator está activo (no tiene sentido
     guardar como caso sin Sales Orchestrator).
   - Server-side:
     1. Leer la conversación con `scoped()`. Si no existe → 404.
     2. Leer mensajes en orden cronológico.
     3. **PII minimizada**: el caso persistido contiene:
        - `transcript: [{ role: 'cliente' | 'agente', text: string }]`
          (solo texto; nunca adjuntos binarios, nunca URLs, nunca
          `mediaAssetId`).
        - `playbook_version_id` (la que esté publicada al guardar).
        - `playbook_schema_version`.
        - `lead_id` (nullable).
        - `expected_next_action` (editable después; default null).
        - `expected_lane` (editable; default null).
        - `expected_handoff` (editable; default null).
        - **NO** contiene: `phone`, `email`, `wa_identity`,
          `ctwa_clid`, `source_id`, `source_url`,
          `meta_credentials.token*`, ni IDs internos que permitan
          reconstruir el contacto.
     4. Persistir en una nueva tabla `lab_case` (o reusar
        `agent_test_case` con `is_from_conversation = true`).
     5. Devolver 201 con `{ case_id }`.
   - El usuario edita después los expected outcomes en la UI del
     laboratorio.

3. **T703** — Confirmar bootstrap al boot.
   - `instrumentation.ts`: después de inicializar la DB, llamar a
     `bootstrapOrgIfNeeded` para cada `organization.id` que tenga
     `salesOrchestratorEnabled = true`. Best-effort, no bloquea.
   - Agregar log explícito:
     - "Playbook V1 sembrada para org X" si created.
     - "Playbook V1 ya existente para org X" si no created.
     - "Org X no tiene Sales Orchestrator; sin playbook" si
       `salesOrchestratorEnabled = false`.
   - **Decisión documentada**: el fallback a `VENDE_VELOZ_*` y
     `JEV_SALES_QUESTIONS_V2` **se mantiene** como `DEFAULTS_ONLY`.
     El runtime prefiere la publicada siempre. Los tests siguen
     funcionando porque importan los defaults directamente. NO se
     borra el hardcode.

4. **T704** — `docs/playbook.md`.
   - Guía del dueño:
     - Qué es el playbook y por qué existe.
     - Cómo crear un draft.
     - Cómo publicar (qué pasa con la versión anterior).
     - Cómo hacer rollback.
     - Cómo funciona el fallback (visible solo si no hay publicada).
     - Qué hace el editor Jev (qué puede y qué no).
     - Cómo correr el laboratorio comercial (Published vs Draft).
     - Cómo guardar una conversación como caso.
     - Cómo migrar desde el hardcode antiguo (no requiere acción; el
       runtime cambia automáticamente cuando publicas la V1).
     - Riesgos conocidos.

5. **T705** — E2E final (`scripts/e2e-selftest.mjs` sección 013).
   - Flujo completo en las dos configuraciones:
       a. **Configuración A — publicada cargada**:
          - GET `/api/playbook` → 200 con V1.
          - POST inbound sintético → `lead.last_jev_playbook_version_id`
            poblado.
          - System prompt del writer cita `product.name` de la V1.
          - `lead.last_jev_decision` JSONB tiene `playbook_version_id`.
       b. **Configuración B — fallback forzado**:
          - Borrar la publicada en test.
          - POST inbound → `last_jev_playbook_version_id = null`.
          - System prompt del writer cita `VENDE_VELOZ_PRODUCT.name`.
          - Warning en logs (una vez por proceso).
       c. **Cross-tenant**: GET `/api/playbook` con sesión de otra
          org → no leak.

6. **T706** — `docs/CURRENT_STATE.md`.
   - Sección de specs formales: 008 cerrado.
   - Historia técnica con fechas de cierre de cada corte.
   - Decisiones:
     - `VENDE_VELOZ_*` y `JEV_SALES_QUESTIONS_V2` ahora son
       `DEFAULTS_ONLY`.
     - El runtime prefiere published; el fallback es explícito.
     - 1 playbook por org en V1; multi-playbook reservado.
   - Riesgos conocidos.

7. **T707** — Verificación global:
   - `bash -n scripts/ai/run-sales-playbook.sh` verde.
   - `pnpm typecheck && pnpm lint && pnpm build && pnpm test` verde.
   - `pnpm test:e2e` (lo que el entorno permita; documentar
     pendiente si no es posible).

8. **T708** — Cierre.
   - Working tree limpio.
   - Un commit:
     `feat(playbook): cerrar feature 008 — playbook durable V1 publicado`
   - Mensaje del commit con resumen de los 7 cortes.

Restricciones:

- **NO** introducir dependencias nuevas.
- **NO** tocar lo que ya está cerrado.
- **NO** romper la compatibilidad de los snapshots
  `last_jev_decision` históricos.
- **NO** filtrar PII en el caso persistido.

Verificación final:

- Todo lo anterior.
- `docs/CURRENT_STATE.md` actualizado.
- `docs/playbook.md` escrito.
- Working tree limpio.
- Commit de cierre.

NO hay siguiente corte. La feature 008 está cerrada al terminar este
corte.