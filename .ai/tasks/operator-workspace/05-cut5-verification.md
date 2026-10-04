# Corte 5 — Verificación del Operator Workspace

Objetivo único del corte 5 del spec `013-operator-workspace`. Commit previsto:
`test(inbox): verificar workspace operativo`.

**Este corte es de verificación, no de funcionalidad nueva.** Si al ejecutarlo
descubres un fallo, **diagnostica, corrige y re-verifica** dentro del mismo corte: la
corrección del fallo encontrado forma parte de este corte, con tests que lo cubran.

## Reconstruir contexto — obligatorio antes de modificar

Sesión NUEVA e independiente de `mcode exec`, desde la raíz del repo. No dependas del
chat, de otra sesión ni de resume. Un corte = un objetivo = un commit.

1. Lee **completo**: `AGENTS.md`, `.specify/memory/constitution.md`,
   `docs/CURRENT_STATE.md` y `CLAUDE.md`.
2. Lee `specs/013-operator-workspace/spec.md` → `plan.md` → `tasks.md` →
   `quickstart.md` (§4 y §5 describen el self-test). El spec manda.
3. **Depende de los cortes 1–4 cerrados.** Confirma con `git log` los cuatro commits de
   013 y lee la evidencia acumulada en su `tasks.md`, incluidos los E2E que quedaron
   pendientes. Si falta algo, **STOP** con diagnóstico.
4. Lee el arnés real: `scripts/e2e-selftest.mjs` (dispatch de secciones
   `E2E_SECTION=020/021/022` con `runSection0XX`), `scripts/e2e-follow-ups.mjs`,
   `scripts/e2e-commercial-payment.mjs`, `scripts/e2e-commercial-demos.mjs` y los
   guiones `tests/e2e/*.md`. Copia el patrón de sección aislada existente.
5. Lee los mocks del entorno de pruebas y su gate:
   `src/app/api/dev/**` (wa-mock, ai-mock, jev-mock, follow-ups/run) y
   `src/lib/dev-guard.ts` (**404 incondicional en producción**: no lo "arregles").
6. Comprueba `git status --short` limpio, guarda el HEAD inicial y revisa `git log`.
   Nunca `reset`/`checkout`/`clean`/`stash`/`rebase`.

Código y tests reales > documentos históricos. Reevalúa el Constitution Check.

## Trabajo autorizado y límites

Añade/actualiza el **E2E real con mocks** según la Constitución (IX) y cubre los casos
mínimos de `plan.md` §6 / `tasks.md`:

1. handoff → **Por atender**
2. abrir la conversación **no** equivale a resolver (sigue en la cola)
3. reply manual → estado coherente (`waiting_client`, sale de la cola)
4. recordatorio futuro → visible en **Agenda** y **fuera** de Por atender
5. inbound antes del vencimiento → **Por atender** inmediatamente
6. recordatorio vencido → **Por atender** (y sin proceso externo que lo dispare)
7. programar otro recordatorio
8. reactivar IA
9. lead a **Cliente** y a **Perdido** resuelven el estado operativo
10. aislamiento tenant con dos organizaciones
11. **ningún recordatorio humano toca Graph automáticamente** (outbox vacía, cero
    llamadas al proveedor)
12. **follow-ups automáticos existentes sin regresión**

Método:

- Nueva sección aislada en `scripts/e2e-selftest.mjs` siguiendo el patrón
  `E2E_SECTION` de 020/021/022. El nombre propuesto es `023`; si el número está
  ocupado, usa el siguiente libre y **actualiza** el quickstart de 013 y el `tasks.md`.
- Guion legible en `tests/e2e/` con los 12 casos.
- **UI real con Playwright** para todo lo que sea visible: chip "Por atender", su
  conteo, buckets de la Agenda, acciones de la conversación, estado humano/IA.
- Camino infeliz: sin sesión, org ajena, `dueAt` en el pasado, nota excesiva, fallo de
  escritura, y el camino de **cero Graph**.
- App de pruebas **aislada** + BD PostgreSQL **dedicada** migrada + todos los
  proveedores hacia mocks locales. Nunca la BD ni el proceso productivos. Cuenta
  fixture propia, no credenciales productivas.
- Si hay ejecutables, ejecuta también la suite **física** de PostgreSQL para
  constraints/FK/UNIQUE reales (patrón de
  `tests/unit/commercial-resource-postgres.test.ts`). Los dobles en memoria **no**
  sustituyen PostgreSQL: si no corre, se dice explícitamente.

**Prohibido**:

- Marcar un caso como cubierto sin haberlo **ejecutado**. El arnés debe fallar si el
  comportamiento no ocurre.
- Declarar READY punta a punta sin E2E real ejecutado.
- Tocar el motor de follow-ups, el worker, las cadencias o las plantillas para que un
  test pase.
- Enviar WhatsApp real, usar `is_test` contra Graph, o contactar destinatarios
  productivos.
- Cambiar el código productivo para acomodar el arnés en lugar de arreglar el
  comportamiento.
- "Arreglar" los guardrails de sandbox.

## Gates y evidencia obligatorios

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Y el self-test E2E con el entorno del `quickstart.md` §5, **con los 12 casos
ejecutados**. Registra por caso: **EJECUTADO** o **PENDIENTE con la causa exacta**
(falta `postgres`/`psql`/`pg_ctl`/Docker, falta Chromium, `ECONNREFUSED` de la app,
`EPERM` de sockets del sandbox...). No inventes resultados ni los copies de otros
cortes. Si un caso falla, corrígelo y re-verifica antes de cerrar el corte; si no es
resoluble, déjalo **PENDIENTE** y con el diagnóstico, nunca "verde".

## Cierre de esta sesión

1. `specs/013-operator-workspace/tasks.md`: estado real del corte 5, la **tabla de los
   12 casos** con EJECUTADO/PENDIENTE y su causa, comandos, logs y regresión.
2. `docs/CURRENT_STATE.md`: checkpoint con objetivo, cambios, evidencia por caso,
   archivos clave, pendientes (incluidos los históricos 020/021/022 y tests PG si
   siguen abiertos) y siguiente paso exacto.
3. `docs/SALES_FOLLOW_UPS.md` y `docs/SALES_ORCHESTRATOR.md` solo si la verificación
   reveló un cambio de contrato real. Señala la decisión de producto para Obsidian.
4. `node --check` de los scripts tocados y `git diff --check`.
5. `git diff`, `git diff --cached`; staging de ficheros concretos.
6. **EXACTAMENTE UN commit atómico** con arnés + guion + correcciones + tests + docs.
   Sin `amend`, `merge`, `rebase`, `push` ni deploy.
7. Verifica HEAD distinto, un solo commit desde el HEAD inicial y árbol limpio.
   Reporta hash, gates y **el estado E2E caso por caso**, honesto.
