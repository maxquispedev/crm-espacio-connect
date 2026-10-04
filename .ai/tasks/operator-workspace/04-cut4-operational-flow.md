# Corte 4 — Flujo operativo / UX integrada

Objetivo único del corte 4 del spec `013-operator-workspace`. Commit previsto:
`feat(inbox): integrar flujo operativo de atención`.

## Reconstruir contexto — obligatorio antes de modificar

Sesión NUEVA e independiente de `mcode exec`, desde la raíz del repo. No dependas del
chat, de otra sesión ni de resume. Un corte = un objetivo = un commit.

1. Lee **completo**: `AGENTS.md`, `.specify/memory/constitution.md`,
   `docs/CURRENT_STATE.md` y `CLAUDE.md`.
2. Lee `specs/013-operator-workspace/spec.md` → `plan.md` → `tasks.md` →
   `quickstart.md`. El spec manda; `spec.md` §3 es el ciclo que hay que hacer
   operable.
3. **Depende de los cortes 1–3 cerrados.** Confirma con `git log` los tres commits de
   013 y lee la evidencia acumulada en su `tasks.md`. Si falta algo, **STOP** con
   diagnóstico.
4. Lee lo que dejaron: `attention.ts`, el DTO con `attention`, la Bandeja con "Por
   atender", la Agenda y sus endpoints, y sus tests.
5. Superficies de UI: `src/components/app-nav.tsx` (NAV + badge de no leídas + SSE),
   `src/app/(app)/layout.tsx`, `src/components/inbox/{inbox-client,conversation-list,
   contact-panel,message-thread}.tsx`, `src/components/pipeline/pipeline-client.tsx`,
   `src/components/ui/*`, `src/lib/utils.ts` (`cn`), `src/components/use-events.ts`.
   Copia **"Reactivar IA"** de `contact-panel.tsx` como patrón de acción existente.
6. Comprueba `git status --short` limpio, guarda el HEAD inicial y revisa `git log`.
   Nunca `reset`/`checkout`/`clean`/`stash`/`rebase`.

Código y tests reales > documentos históricos. Reevalúa el Constitution Check. Ante
ambigüedad bloqueante, para y reporta.

## Trabajo autorizado y límites

Que una persona pueda operar el CRM **sin pensar en estados técnicos**:

- **Naming y acciones** (`spec.md` FR-4.1/4.2): "Atención humana", "Marcar atendido /
  Esperando respuesta", "Recordarme", "Reactivar IA". Revisa **todo** el copy visible
  del área: no debe quedar `handoffAt`, lanes, jobs, `followUpReason`,
  `automationLane`, `nextFollowUpAt` ni timestamps crudos en texto de interfaz.
- **Nav** (`app-nav.tsx`): añadir **Agenda** junto a Bandeja/Pipeline, y el conteo de
  pendientes/vencidos donde corresponda, con la misma reactividad SSE que el badge
  actual de no leídas. El estado humano/IA es visible en lista, hilo y Agenda **con la
  misma semántica**.
- **Acciones coherentes** en la conversación: marcar atendido / esperando respuesta
  (→ `waiting_client`), "Recordarme" (→ `deferred`) y "Reactivar IA" (→ limpiar). Con
  estado visible y con el mismo significado en todas partes.
- La Bandeja debe responder visualmente a las dos preguntas de `spec.md` FR-4.3: ¿qué
  tengo que hacer ahora? y ¿qué tengo comprometido para después?
- **Opcional y solo si aporta claridad** (FR-4.5): mostrar en la Agenda los
  seguimientos **automáticos** existentes como información **read-only** con 👤 Humano /
  🤖 Automático, leyendo solo datos ya persistidos. Si hacerlo exige replicar la lógica
  de cadencias o tocar el motor, **no lo hagas**: es un no-objetivo explícito.

**Prohibido**:

- Cambiar contratos: DTOs, endpoints, la lógica de atención de 013 o el motor de
  follow-ups (`src/server/sales/follow-ups/**`). Esto es flujo y copy, no lógica.
- Enviar WhatsApp, programar plantillas, o crear un dashboard nuevo.
- Reimplementar el worker, las cadencias o los estados de los seguimientos automáticos.
- Etapas operativas en el pipeline, dependencias de UI nuevas, o refactors ajenos.
- Romper la reactividad SSE: la UI nueva debe seguir actualizándose por evento, no por
  recarga manual.

## Tests obligatorios

- Coherencia de estado en las tres superficies: la misma conversación muestra el
  mismo estado en lista, hilo/panel y Agenda.
- Acciones: "Marcar atendido" saca de "Por atender"; "Recordarme" mueve a Agenda;
  "Reactivar IA" limpia el estado humano. Cada una con su test de integración en el
  componente o en el endpoint que llama.
- El copy no expone internals: un test (o una revisión explícita registrada) sobre los
  textos renderizados.
- Conteo del nav y de "Por atender" consistentes, incluidos los casos de vencimiento.
- Regresión de los filtros de la Bandeja del corte 2.
- Si añades la vista read-only de automáticos: verifica que es solo lectura (ningún
  endpoint de escritura al store de follow-ups desde esa vista).

## Gates y evidencia obligatorios

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

UI observable: ejecuta el self-test E2E con app + PostgreSQL + mocks y **UI real
(Playwright)**: recorrer el flujo completo como lo haría una persona — ver "Por
atender", abrir una conversación, comprobar que **abrir no la saca**, responder,
comprobar que sale de la cola, programar un recordatorio, verlo en Agenda, reactivar
IA, y el camino infeliz (sin sesión, org ajena, error de la Agenda visible sin dejar
la UI rota). Itera diagnóstico/fix/verificación dentro del corte. Si el entorno no lo
permite, registra comando, causa exacta y **PENDIENTE** en `tasks.md` y
`CURRENT_STATE`; puedes commitear con gates técnicos verdes, pero **no** marcar E2E
cumplido ni declarar READY.

Nunca uses `is_test` contra WhatsApp real ni contactes destinatarios productivos.

## Cierre de esta sesión

1. `specs/013-operator-workspace/tasks.md` SOLO con el estado real de este corte.
2. `docs/CURRENT_STATE.md` con objetivo, cambios, decisiones, evidencia, archivos clave
   y siguiente paso exacto.
3. Docs de dominio solo si cambió un contrato (no debería).
4. `git diff`, `git diff --check` y `git diff --cached`; staging de ficheros concretos.
5. **EXACTAMENTE UN commit atómico** con implementación + tests + docs. Sin `amend`,
   `merge`, `rebase`, `push` ni deploy.
6. Verifica HEAD distinto, un solo commit desde el HEAD inicial y árbol limpio.
   Reporta hash, gates y estado E2E honesto.
