# Corte 2 — Bandeja "Por atender"

Objetivo único del corte 2 del spec `013-operator-workspace`. Commit previsto:
`feat(inbox): añadir cola por atender`.

## Reconstruir contexto — obligatorio antes de modificar

Sesión NUEVA e independiente de `mcode exec`, desde la raíz del repo. No dependas del
chat, de otra sesión ni de resume. Un corte = un objetivo = un commit.

1. Lee **completo**: `AGENTS.md`, `.specify/memory/constitution.md`,
   `docs/CURRENT_STATE.md` y `CLAUDE.md`.
2. Lee `specs/013-operator-workspace/spec.md` → `plan.md` → `tasks.md` →
   `quickstart.md`. El spec manda.
3. **Depende del corte 1 cerrado.** Confirma con `git log` que existe el commit
   `feat(inbox): persistir atención y recordatorios humanos` y que la tabla
   `conversation_attention` y `src/server/inbox/attention.ts` existen con la API de
   `plan.md` §3.4. Si faltan, **STOP** con diagnóstico: no implementes el corte 1.
4. Lee lo que corte 1 dejó: `specs/013-operator-workspace/tasks.md` (evidencia) y el
   código de `attention.ts`, el LEFT JOIN/serialización de la lista y los tests nuevos.
5. Superficies a leer: `src/server/inbox/queries.ts` (`listConversations`,
   `serializeConversation`, patrón del `LEFT JOIN` scropeado de `adAttribution`),
   `src/lib/types.ts` (`ConversationDto`), `src/app/api/conversations/route.ts`,
   `src/components/inbox/conversation-list.tsx` (filtros actuales, línea del
   `useState<"all" | "unread" | "ads">`), `inbox-client.tsx`, `contact-panel.tsx`,
   `src/components/use-events.ts` y `src/server/events/bus.ts`.
6. Comprueba `git status --short` limpio, guarda el HEAD inicial y revisa `git log`.
   Si tu corte ya tiene commit, **STOP** sin duplicar. Nunca `reset`/`checkout`/`clean`/
   `stash`/`rebase`.

Código y tests reales > documentos históricos. Reevalúa el Constitution Check. Ante
ambigüedad bloqueante, para y reporta; no inventes negocio ni amplíes alcance.

## Trabajo autorizado y límites

Convierte la Bandeja en una **cola de trabajo real**:

- `ConversationDto` suma el campo aditivo `attention` de `plan.md` §4.1
  (`state`, `dueAt`, `note`, `needsAttentionNow` derivado). Aditivo y opcional: no
  rompe consumidores existentes.
- `listConversations` resuelve la atención con un **LEFT JOIN ya scropeado a la
  organización** (patrón `adAttribution`, esa misma función). Un solo `SELECT`; sin
  N+1. `serializeConversation` mantiene su forma con un parámetro extra.
- `needsAttentionNow` se calcula en **un único lugar** (store o helper puro) como
  `pending OR (deferred AND due_at <= now())`. Nadie más lo recalcula a mano.
- Chip **"Por atender (N)"** como primera opción de la fila de filtros, con el conteo
  calculado de la **misma** definición que el listado (conteo y lista no pueden
  discrepar).
- El filtro es **cliente**, igual que `all/unread/ads` hoy. **No** crees un endpoint
  nuevo para esto: sería sobrearquitectura y rompería la reactividad SSE.

Reglas de `spec.md` §2 y FR-2.x: "Por atender" es una cola de acción humana **ahora**.
**No** se define por `unreadCount` ni por la etapa del pipeline. Incluye handoff recién
creado, inbound nuevo durante HUMAN y recordatorio vencido. Excluye recordatorios
todavía futuros y atención ya resuelta/esperando al cliente.

**Prohibido**:

- Cambiar la definición de `Todas`, `No leídas`, `Anuncios` o el filtro de etapa: se
  **conservan** (FR-2.6).
- Endpoints nuevos, cambiar contratos existentes, o tocar el motor de follow-ups
  (`src/server/sales/follow-ups/**`), `automationLane` o el handoff.
- Introducir etapas operativas en el pipeline, plantillas WhatsApp, una tabla o estado
  nuevo de atención, o dependencias externas.
- Empezar la Agenda o el flujo operativo (cortes 3 y 4).
- Refactors oportunistas ajenos a este corte.

## Tests obligatorios

- Derivación de `needsAttentionNow`: los 3 estados y el vencimiento.
- Inclusión: handoff nuevo, inbound durante HUMAN, recordatorio vencido.
- Exclusión: recordatorio futuro, `waiting_client`, sin estado, `is_test`.
- Conteo del chip == longitud de la lista en todos los casos anteriores.
- `Todas` / `No leídas` / `Anuncios` / filtro de etapa con el comportamiento previo
  intacto.
- `unreadCount` **no** influye en "Por atender": una conversación atendida con
  no leídas no entra; una vencida con cero no leídas sí entra.
- Aislamiento tenant A/B en la lista y en el conteo.

## Gates y evidencia obligatorios

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Este corte **sí** tiene UI observable: ejecuta el self-test E2E con app + PostgreSQL +
mocks, con **UI real (Playwright)**, camino feliz e infeliz (sin sesión, org ajena,
conversación no encontrada). Itera diagnóstico/fix/verificación dentro del corte. Si el
entorno no permite ejecutarlo, registra comando, causa exacta, verificaciones reales y
**PENDIENTE** en `tasks.md` y `CURRENT_STATE`; puedes commitear con gates técnicos
verdes, pero **no** marcar la verificación E2E como cumplida ni declarar READY.

Nunca uses `is_test` contra WhatsApp real ni contactes destinatarios productivos.
Si un gate falla de forma no resoluble, conserva los cambios y **DETENTE con fallo
explícito**, sin commitear como si estuviera cerrado.

## Cierre de esta sesión

1. `specs/013-operator-workspace/tasks.md` SOLO con el estado real de este corte.
2. `docs/CURRENT_STATE.md` con objetivo, cambios, decisiones, evidencia, archivos clave
   y siguiente paso exacto.
3. Docs de dominio solo si cambió un contrato (no debería: el motor de follow-ups está
   intacto).
4. `git diff`, `git diff --check` y `git diff --cached`; staging de ficheros concretos.
5. **EXACTAMENTE UN commit atómico** con implementación + tests + docs. Sin `amend`,
   `merge`, `rebase`, `push` ni deploy.
6. Verifica HEAD distinto, un solo commit desde el HEAD inicial y árbol limpio.
   Reporta hash, gates y estado E2E honesto.
