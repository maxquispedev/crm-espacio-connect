# Corte 7 — Rediseño práctico

Objetivo único del corte 7 del spec `014-espacio-connect-rebrand`. Commit previsto:
`refactor(ui): simplificar experiencia de Espacio Connect`.

## Reconstruir contexto — obligatorio antes de modificar

Sesión NUEVA e independiente de `mcode exec`, desde la raíz del repo. No dependas del
chat, de otra sesión ni de resume. Un corte = un objetivo = un commit.

1. Lee **completo**: `AGENTS.md`, `.specify/memory/constitution.md`,
   `docs/CURRENT_STATE.md` y `CLAUDE.md`.
2. Lee `specs/014-espacio-connect-rebrand/spec.md` → `plan.md` → `tasks.md`. El spec
   manda; `plan.md` §3 y §4 marcan el orden de trabajo.
3. **Depende del corte 6 cerrado** (y de los cortes 1–5 de 013). Confirma con `git log`.
   Si falta algo, **STOP** con diagnóstico.
4. Lee `specs/013-operator-workspace/spec.md` §3 y §4: estás redisecando **ese**
   workspace, no inventes otra semántica. El copy del corte 4 es tu punto de partida.
5. Superficies, **en este orden de prioridad** (FR-7.6):
   1. Shell/sidebar/header: `src/app/(app)/layout.tsx`, `src/components/app-nav.tsx`.
   2. Bandeja: `src/components/inbox/{inbox-client,conversation-list,message-thread,
      contact-panel}.tsx`.
   3. Tarjetas y estado operativo: las de la lista y el panel de contacto.
   4. Pipeline: `src/components/pipeline/{pipeline-client,stage-manager}.tsx`.
   5. Consistencia de labels, spacing, badges y empty states en el resto.
6. Sistema de diseño existente (reúsalo, no lo redefinas): `tailwind.config.ts`,
   `src/app/globals.css`, `src/lib/utils.ts` (`cn`), `src/components/ui/*`,
   `src/components/avatar.tsx`, `src/lib/theme.ts`, `lucide-react` y los helpers de
   `src/components/inbox/helpers.ts` (`formatTime`, `formatBytes`, `mediaLabel`,
   `formatAttachStatus`).
7. Comprueba `git status --short` limpio, guarda el HEAD inicial y revisa `git log`.
   Nunca `reset`/`checkout`/`clean`/`stash`/`rebase`.

Código y tests reales > documentos históricos. Reevalúa el Constitution Check.

## Trabajo autorizado y límites

Hacer el CRM más claro, compacto y agradable para la operación diaria. **Práctico
antes que decorativo** (FR-7.1):

- Jerarquía clara: acciones principales obvias, información secundaria visualmente
  subordinada. Que el ojo caiga primero en "qué tengo que hacer ahora".
- El resultado hace muy evidentes **Por atender**, **Agenda**, el estado humano/IA y
  el pipeline comercial (FR-7.7).
- Densidad razonable para escritorio, coherente con el **dark mode actual**.
- Reutiliza tokens, `cn` y componentes existentes. **Sin librerías UI nuevas**
  (FR-7.4, `plan.md` D-5).
- **No** degrades rendimiento: sin librerías pesadas, sin fetching que no se use, sin
  listas que re-renderizan de más.

**Prohibido**:

- **No** cambiar contratos: DTOs, endpoints, la lógica de atención de 013 o el motor de
  follow-ups. Si un cambio visual exige tocar un contrato, es otro spec (`plan.md` D-6).
- **No** meter un dashboard nuevo (FR-7.8, D-4).
- **No** inventar etapas, semánticas de negocio ni features. Esto es presentación.
- **No** reescribir la arquitectura del frontend, el router ni el sistema de estilos.
- **No** cambiar comportamiento del agente, del pipeline ni de los seguimientos
  automáticos.
- **No** dejar el redesign a medias en una pantalla: termina lo que toques.

## Tests y gates

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

- Regresión obligatoria de las superficies que toques: Inbox (incluido el corte 2),
  Pipeline, Contactos, Agente. Si un test de UI rompe por un cambio **visual**,
  ajusta el test, no des una vuelta atrás en el diseño.
- Este corte es **comportamiento observable por definición**: ejecuta el self-test E2E
  con app + PostgreSQL + mocks y **UI real (Playwright)**: comprobar que "Por atender"
  y Agenda siguen funcionando tras el rediseño, que el recorrido de la conversación no
  se rompió, y que el flujo feliz e infeliz siguen funcionando. Itera
  diagnóstico/fix/verificación dentro del corte. Si el entorno no lo permite, registra
  comando, causa exacta y **PENDIENTE** en `tasks.md` y `CURRENT_STATE`; puedes
  commitear con gates técnicos verdes, pero **no** declarar READY.

Nunca uses `is_test` contra WhatsApp real ni contactes destinatarios productivos.

## Cierre de esta sesión

1. `specs/014-espacio-connect-rebrand/tasks.md`: marca T701–T711 con el estado real,
   decisiones de diseño y evidencia.
2. `docs/CURRENT_STATE.md`: checkpoint con objetivo, cambios, evidencia, archivos clave
   y siguiente paso exacto.
3. `specs/013-operator-workspace/tasks.md`: **solo** si el rediseño cambió algo
   observable de 013; si no, déjalo intacto.
4. `git diff`, `git diff --check` y `git diff --cached`; staging de ficheros concretos.
   Revisa que no se cuele un cambio de comportamiento en el diff.
5. **EXACTAMENTE UN commit atómico** con UI + tests + docs. Sin `amend`, `merge`,
   `rebase`, `push` ni deploy.
6. Verifica HEAD distinto, un solo commit desde el HEAD inicial y árbol limpio.
   Reporta hash, gates y estado E2E honesto.
