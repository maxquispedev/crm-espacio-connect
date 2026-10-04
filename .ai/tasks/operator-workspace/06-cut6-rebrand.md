# Corte 6 — Rebrand Espacio Connect

Objetivo único del corte 6 del spec `014-espacio-connect-rebrand`. Commit previsto:
`chore(brand): consolidar Espacio Connect`.

## Reconstruir contexto — obligatorio antes de modificar

Sesión NUEVA e independiente de `mcode exec`, desde la raíz del repo. No dependas del
chat, de otra sesión ni de resume. Un corte = un objetivo = un commit.

1. Lee **completo**: `AGENTS.md`, `.specify/memory/constitution.md`,
   `docs/CURRENT_STATE.md` y `CLAUDE.md`.
2. Lee `specs/014-espacio-connect-rebrand/spec.md` → `plan.md` → `tasks.md`. El spec
   manda; `plan.md` §2 pre-clasifica las categorías de la auditoría.
3. Lee `specs/013-operator-workspace/spec.md` §5 (no objetivos) y el `tasks.md` de 013
   para saber qué está construido y qué **no** debes tocar.
4. **Depende de los cortes 1–5 de 013 cerrados.** Confirma con `git log`. Este bloque
   rediseña **sobre** el workspace operativo: si "Por atender" o la Agenda no existen,
   **STOP** con diagnóstico.
5. Lee `docs/AUDITORIA_BASE_ESPACIO_CONNECT.md` (contexto de por qué se renombra) y
   `src/lib/branding.ts` (`DEFAULT_BRANDING`, `normalizeBranding`, white-label por
   organización) + `tests/unit/branding.test.ts`.
6. Comprueba `git status --short` limpio, guarda el HEAD inicial y revisa `git log`.
   Nunca `reset`/`checkout`/`clean`/`stash`/`rebase`.

Código y tests reales > documentos históricos. Reevalúa el Constitution Check.

## Trabajo autorizado y límites

**Primero la auditoría, después los cambios:**

```bash
rg -n -i 'vocero' .
```

1. Clasifica **cada** ocurrencia con las categorías de `plan.md` §2 y **graba el
   inventario real en `specs/014-espacio-connect-rebrand/tasks.md`** (la tabla de la
   sección "Registro de la auditoría", completando las decisiones que están como
   *pendiente*). Ese inventario es evidencia de este corte.
2. Cambia la **marca visible**: `DEFAULT_BRANDING.name` y el nombre por defecto de la
   app → **Espacio Connect**; títulos y `metadata`; copy de demo; `README.md`
   vigente; `INSTALL-IA.md`; docs operativas vigentes; textos visibles de la UI. Usa
   **EV Connect** solo donde ya tenga sentido visual y quepa (badges cortos).
3. El white-label por organización **sigue funcionando**: no toques la lógica de
   `normalizeBranding` ni el aislamiento por tenant. Solo el valor por defecto y los
   textos.

**No** es un replace ciego. Estas categorías se conservan, y su razón queda escrita:

- **Migraciones** `drizzle/*.sql`: un script ya aplicado no se reescribe.
- **Specs cerrados** (`specs/001-vocero-core/**` y otros): trazabilidad histórica. El
  nombre de carpeta tampoco se renombra.
- **Constitución** `.specify/memory/constitution.md`: norma ratificada (v1.3.0) con
  procedimiento de enmienda propio. **No** la toques aquí: registra en `tasks.md` que
  el cambio de nombre requiere una enmienda formal con Sync Impact Report, aprobada
  por el responsable (`plan.md` D-2). Es una decisión de gobernanza, no de copy.
- **Identificadores técnicos** con riesgo (p. ej. `package.json` `name`, rutas de
  build, claves de env, el usuario no-root del contenedor en compose/Dockerfile): se
  cambian solo si demuestras que nada los referencia; si no, se conservan con su razón
  documentada (`plan.md` D-1).
- **Fixtures de prueba** (cuentas `@*.test`, seeds del arnés): se renombran solo si
  actualizas también el arnés; si no, se documentan como referencias no visibles.

## Tests y gates

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

- `tests/unit/branding.test.ts` debe quedar verde. Si una expectativa de **marca
  visible** cambia (por ejemplo el nombre por defecto), actualízala **de forma
  explícita y justificada** en `tasks.md`. No cambies expectativas ajenas a la marca
  para que algo pase.
- Regresión completa: nada más debe romperse. Un rename de copy no puede tocar
  contratos.
- Este corte no tiene comportamiento nuevo, así que el E2E de UI es opcional: si puedes
  levantar la app con mocks, **verifica visualmente** que el nombre aparece en la
  sidebar/header y que el branding por organización sigue funcionando. Si no puedes,
  registra el intento y la causa.

## Cierre de esta sesión

1. `specs/014-espacio-connect-rebrand/tasks.md`: marca T601–T611 con el
   **inventario real**, la decisión por categoría y las referencias inevitables con su
   razón.
2. `docs/CURRENT_STATE.md`: checkpoint con objetivo, cambios, evidencia, archivos clave
   y siguiente paso exacto.
3. Revisa que no quede copy visible diciendo Vocero: repite `rg -n -i 'vocero' .` y
   confirma que lo superviviente está justificado.
4. `git diff`, `git diff --check` y `git diff --cached`; staging de ficheros concretos.
5. **EXACTAMENTE UN commit atómico** con copy + docs + tests. Sin `amend`, `merge`,
   `rebase`, `push` ni deploy.
6. Verifica HEAD distinto, un solo commit desde el HEAD inicial y árbol limpio.
   Reporta hash, gates y el resultado de la auditoría.
