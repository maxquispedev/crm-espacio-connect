# Corte 8 — Polish y regresión final

Objetivo único del corte 8 del spec `014-espacio-connect-rebrand`. Commit previsto:
`test(ui): cerrar workspace de Espacio Connect`.

**Cierre de los dos bloques** (013 cortes 1–5 y 014 cortes 6–7). Es de **pulido y
regresión**, no de funcionalidad nueva. Los fallos que descubras se corrigen y se
re-verifican aquí, con su test.

## Reconstruir contexto — obligatorio antes de modificar

Sesión NUEVA e independiente de `mcode exec`, desde la raíz del repo. No dependas del
chat, de otra sesión ni de resume. Un corte = un objetivo = un commit.

1. Lee **completo**: `AGENTS.md`, `.specify/memory/constitution.md`,
   `docs/CURRENT_STATE.md` y `CLAUDE.md`.
2. Lee `specs/014-espacio-connect-rebrand/spec.md` → `plan.md` → `tasks.md` **y**
   `specs/013-operator-workspace/{spec,plan,tasks}.md`. Los dos bloques, completos.
3. **Depende de los cortes 1–7 cerrados.** Confirma los 7 commits con `git log`. Si
   falta algo, **STOP** con diagnóstico.
4. Lee toda la evidencia acumulada: los `tasks.md` de 013 y 014, incluidos los E2E
   pendientes históricos (020/021/022) y los 4 tests PostgreSQL opt-in. No los cierres
   por inercia: o los ejecutas, o los dejas abiertos con su causa.
5. Superficies: todas las del shell, Bandeja, Agenda, Pipeline, Contactos, Agente y
   Laboratorio; el arnés `scripts/e2e-selftest.mjs` y sus secciones; los guiones
   `tests/e2e/*.md`.
6. Comprueba `git status --short` limpio, guarda el HEAD inicial y revisa `git log`.
   Nunca `reset`/`checkout`/`clean`/`stash`/`rebase`.

Código y tests reales > documentos históricos. Reevalúa el Constitution Check.

## Trabajo autorizado y límites

- **Responsive razonable** (FR-8.1): escritorio primero, móvil usable. Verifica las
  superficies tocadas en los cortes 1–7.
- **Accesibilidad básica** (FR-8.2): foco visible, `aria`/labels en las acciones
  nuevas, contraste de los estados nuevos, navegación por teclado en "Por atender",
  Agenda, "Marcar atendido", "Recordarme" y "Reactivar IA".
- **Empty / loading / error states** (FR-8.3) en la Agenda, en "Por atender" y en
  cualquier superficie nueva. Una Agenda vacía debe explicar qué es y qué hacer, no
  mostrar un hueco.
- **Regresión** (FR-8.4) de Inbox, Pipeline, Contactos y Agente: suite unitaria y E2E
  de UI con app + PostgreSQL + mocks, camino feliz e infeliz.
- **E2E actualizado y ejecutado** (FR-8.5). Actualiza el arnés y el guion para cubrir
  el estado final de los dos bloques. Cada caso: **EJECUTADO** o **PENDIENTE con la
  causa exacta**. Nunca marcado como cubierto sin ejecutarse.
- **Docs finales** (FR-8.6): `docs/CURRENT_STATE.md`,
  `specs/013-operator-workspace/tasks.md` y
  `specs/014-espacio-connect-rebrand/tasks.md` con el estado **real** de los ocho
  cortes. Si algo quedó pendiente, queda escrito como pendiente.

**Prohibido**:

- Declarar READY punta a punta sin E2E real ejecutado.
- Marcar tareas como hechas "porque el gate pasó": el gate no es la verificación de
  comportamiento (Constitución V y IX).
- Tocar el motor de follow-ups, el worker, las cadencias o las plantillas para que un
  test pase.
- Enviar WhatsApp real, usar `is_test` contra Graph, o contactar destinatarios
  productivos.
- Cambiar el comportamiento de negocio para acomodar un test, o "arreglar" los
  guardrails de sandbox.
- Añadir dependencias de UI o de runtime.

## Gates y evidencia obligatorios

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Y el self-test E2E completo con el entorno del quickstart de 013 §5. Registra por caso
el resultado y la causa de cada PENDIENTE. Si un gate falla, diagnostica, corrige y
re-verifica. Si algo no es resoluble en esta sesión, déjalo **explícito y fail-visible**
en lugar de maquillar el resultado.

## Cierre de esta sesión

1. `specs/014-espacio-connect-rebrand/tasks.md`: marca T801–T814 con estado real.
2. `specs/013-operator-workspace/tasks.md`: estado final del bloque 013, con la tabla
   de los 12 casos E2E a **EJECUTADO/PENDIENTE** y los pendientes históricos.
3. `docs/CURRENT_STATE.md`: **checkpoint final de los dos bloques**, con objetivo,
   cambios, decisiones, evidencia (gates + E2E caso por caso), archivos clave,
   pendientes honestos y el siguiente paso exacto para una sesión futura.
4. `node --check` de los scripts tocados y `git diff --check`.
5. `git diff`, `git diff --cached`; staging de ficheros concretos.
6. **EXACTAMENTE UN commit atómico** con polish + regresión + tests + docs. Sin
   `amend`, `merge`, `rebase`, `push` ni deploy.
7. Verifica HEAD distinto, un solo commit desde el HEAD inicial y árbol limpio.
   Reporta hash, gates, E2E caso por caso y pendientes. **No** declares READY si
   algo quedó pendiente.
