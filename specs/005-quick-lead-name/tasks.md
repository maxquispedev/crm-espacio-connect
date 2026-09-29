# Tasks: Edición rápida del nombre del lead desde el panel del inbox (005-quick-lead-name)

**Input**: [spec.md](./spec.md) · [plan.md](./plan.md)
**Tests**: incluidos (unit + E2E + guion Playwright manual)
**Organization**: tareas agrupadas por **commit atómico**. Cada commit deja el repositorio en estado verde.

## Estructura de los commits

| # | Commit | Resumen | Tareas |
|---|---|---|---|
| 0 | `docs(spec): open 005 — quick lead name (rename inline)` | Este PR: solo docs. | T001–T005 |
| 1 | `feat(inbox): edición inline de contact.name en el panel lateral + sync de UI` | Helper pura + microcomponente + wiring + key re-mount + tests + sección E2E. Único commit de implementación. | T101–T108 |

---

## Formato

`[ID] [P?] [Story] Descripción`

- **[P]**: puede hacerse en paralelo con otras `[P]` del mismo commit (diferentes archivos, sin dependencias).
- **[Story]**: US a la que pertenece (US1/US2 del spec).
- Rutas absolutas desde la raíz del repo.

---

## Commit 0 — Documentación (este PR)

**Propósito**: abrir la feature sin tocar código. Cumple la constitución VI ("specs antes de código") y deja el repo entendible.

- [x] **T001** Crear `specs/005-quick-lead-name/spec.md` con user stories, FR/NFR, success criteria, scope/fuera-de-scope y verification.
- [x] **T002** Crear `specs/005-quick-lead-name/plan.md` con Constitution Check, decisiones explícitas (D-1 a D-6), modelo de componente, helper pura, riesgos y verificación.
- [x] **T003** Crear `specs/005-quick-lead-name/tasks.md` (este archivo) con la división en 2 commits atómicos y tareas dependency-ordered.
- [x] **T004** Verificar constitution check pasa (sin violaciones) — registrado en `plan.md` §Constitution Check.
- [x] **T005** Actualizar `docs/CURRENT_STATE.md` con la nota de que spec 005 queda ABIERTO (este PR no implementa código; el commit de implementación actualizará `CURRENT_STATE.md` otra vez al cerrar).
- [x] **T006** Commit atómico documental: `docs(spec): open 005 — quick lead name (rename inline)`. Working tree limpio excepto `specs/005-quick-lead-name/` y el bloque nuevo en `docs/CURRENT_STATE.md`.

**Checkpoint**: la feature está abierta y entendible sin leer el chat. No se ha tocado ningún archivo de código de app. El repo cuenta la historia.

---

## Commit 1 — Implementación (un solo corte funcional)

**Propósito**: entregar la edición inline + sync de UI + tests + guion E2E, en un solo corte atómico verificable. NO reabre módulos cerrados.

### Helper pura + tests primero

- [x] **T101** [P] [US2] Crear `src/components/inbox/conversation-patch.ts` exportando `applyContactNamePatch(conversations: readonly ConversationDto[], update: { id: string; name: string }): ConversationDto[]`. Inmutable; retorna array nuevo; si no hay match retorna el array original sin cambios; solo reemplaza `contact.name` cuando `contact.id === update.id`. Comentario corto explicando el contrato y por qué existe (testeable sin React; decisión D-1).
- [x] **T102** [P] [US2] Crear `tests/unit/conversation-patch.test.ts` cubriendo: (a) id existente reemplaza `name`, (b) id inexistente devuelve el mismo array sin cambios (referencia), (c) múltiples conversaciones todas reemplazadas cuando mismo id, (d) inmutabilidad del array y de los objetos de conversación, (e) `name` idéntico al actual sigue devolviendo array nuevo (misma lógica, distinta referencia), (f) preserva el resto de campos de la conversación (`stageName`, `aiEnabled`, `handoffAt`, `unreadCount`, `preview`, `lastMessageAt`, `windowOpen`). ≥6 casos.

### Microcomponente de edición inline

- [x] **T103** [US1] En `src/components/inbox/contact-panel.tsx`, añadir un componente local `ContactNameEditor({ contactId, name, onSaved })` que encapsula: estado `{ mode: "view" | "edit", draft, saving, error }`; render del `<p>{name}</p>` + icono `Pencil` en modo view; render del `<input>` autofocus + select() + botones check/X en modo edit. Comportamiento: click lápiz → `mode="edit"`, `draft=name`; Enter → `submit()`; Escape → `mode="view"`, descarta draft; blur → cancela (decisión D-3); check/X explícitos también. Trim antes de validar; si vacío → error inline "El nombre no puede estar vacío" sin llamar a la API. `submit()` hace `fetch("/api/contacts/:id", { method: "PATCH", body: { name } })`, lee `data.contact.name` del 200, llama `onSaved({ id, name })` y sale de modo edición. En fallo: muestra error y mantiene draft + mode.
- [x] **T104** [US1] En `src/components/inbox/contact-panel.tsx`, reemplazar el bloque `<p>{conversation.contact.name}</p>` (líneas ~164-166) por `<ContactNameEditor contactId={conversation.contact.id} name={conversation.contact.name} onSaved={onContactUpdatedFromPanel} />`. La prop nueva `onContactUpdatedFromPanel` se construye en el componente padre (`ContactPanel`) y propaga el `{ id, name }` hacia arriba vía la nueva prop pública `onContactUpdated` (T106). Mantener el `<p>` de `formatPhone(conversation.contact.phone)` intacto.

### Wiring en `inbox-client.tsx`

- [x] **T105** [US2] En `src/components/inbox/inbox-client.tsx`, añadir un `useCallback` `onContactUpdated` que aplique `applyContactNamePatch` al array de conversaciones:
  ```ts
  const onContactUpdated = useCallback(({ id, name }: { id: string; name: string }) => {
    setConversations((prev) => applyContactNamePatch(prev ?? [], { id, name }));
  }, []);
  ```
  Pasar la prop al `ContactPanel` en el JSX.
- [x] **T106** [US2] En el JSX, añadir `key={selected.contact.id}` al wrapper `<div className="h-full w-[320px]">` que contiene `ContactPanel` (líneas ~236-244). Forza re-mount al cambiar de conversación y descarta el estado local de edición (decisión D-2).

### Sincronización con SSE (defensa)

- [x] **T107** [US2] En `src/components/inbox/contact-panel.tsx`, en `refreshLive` (líneas ~88-104), NO pisar el nombre del contacto cuando `ContactNameEditor` está en modo edición. Refactor mínimo: el `name` que muestra el editor viene de `conversation.contact.name` (prop); pero el `draft` interno del editor NO se sincroniza con la prop mientras `mode === "edit"`. Eso ya es el comportamiento natural de un `useState` no controlado por prop; basta documentar el invariante con un comentario corto. Si un rename concurrente llega por SSE y entra por `refetchConversations` (en el padre), el padre aplica `applyContactNamePatch` que sí cambia la prop `name` del editor — pero el draft local queda intacto. Esto es aceptable porque el rename por SSE gana al guardar y al cancelar.

### Verificación

- [x] **T108** [P] Crear `tests/e2e/010-quick-lead-name.md` con el guion E2E: pasos numerados del camino feliz (click lápiz → input abre con select → escribir nombre → Enter → tres superficies actualizadas) y los caminos infelices (vacío post-trim → no PATCH + error; API 400 → mensaje del servidor + modo edición; doble Enter durante saving → un solo PATCH; blur → cancela; cambiar de conversación → modo edición descartado; SSE entrante durante edición → draft preservado). Adjuntar al `scripts/e2e-selftest.mjs` como sección automatizable si el `wa-mock` ya soporta el PATCH con mocks activos; si no, dejarlo como guion Playwright manual explícito (mismo patrón que `tests/e2e/008-paridad-inbox.md`).

### Cierre del spec

- [x] **T109** Ejecutar `pnpm typecheck && pnpm lint && pnpm build && pnpm test` y dejar verdes. Documentar resultado en `tasks.md` (estado de los gates y número de tests post-commit).
- [x] **T110** Actualizar `docs/CURRENT_STATE.md`: sección de **specs formales actuales** debe listar `specs/005-quick-lead-name/`. Sección **estado del spec 005** debe describir el corte implementado (helper pura, microcomponente inline, key re-mount, sync via patch in-place), número de tests nuevos y pendientes de verificación (E2E / manual Playwright si la sección 010 no se pudo automatizar en este entorno).
- [x] **T111** Commit atómico: `feat(inbox): edición inline de contact.name en el panel lateral + sync de UI`. Working tree limpio excepto los archivos de este commit.

---

## Estado durable de los commits

| Commit | Estado | Notas |
|---|---|---|
| 0 (docs) | cerrado (`35f0cd2`) | Working tree solo tocó `specs/005-quick-lead-name/` + bloque nuevo en `docs/CURRENT_STATE.md`. |
| 1 (impl) | cerrado (este commit) | Helper + microcomponente + wiring + key + tests + E2E + cierre. |

### Resultado del gate técnico (T109)

Ejecutado 2026-09-29 con `pnpm` 11.5.0 en este entorno.

| Gate | Estado |
|---|---|
| `pnpm typecheck` | verde |
| `pnpm lint` | verde |
| `pnpm build` | verde |
| `pnpm test` | verde — **569 tests** (560 heredados del spec 004 + 9 nuevos en `tests/unit/conversation-patch.test.ts`) |

## Pendiente de verificación humana

> Esto NO se considera hecho punta a punta hasta que:

- [ ] Self-test E2E con app + PostgreSQL + mocks activos (`pnpm test:e2e`) corre la sección 010 (o, si 010 no es automatizable, se ejecuta Playwright manual contra la app local).
- [ ] Verificación manual de los caminos infelices documentados en T108.
- [ ] No-regresión del spec 004 (composer + cola de adjuntos + drag&drop verdes).
- [ ] Si algo falla, el implementador diagnostica y re-verifica hasta verde (loop de auto-corrección según Constitución IX). No se delega al dueño.

---

## Próximo corte exacto

Tras commit 1 verificado en vivo: dejar la feature abierta a feedback del operador
(real o, en su defecto, del dueño que opera la instalación interna). No empezar
otra feature sin:

1. Ejecutar y dejar verde la sección 010 del self-test E2E.
2. Registrar el resultado en `docs/CURRENT_STATE.md`.
3. Confirmar con el dueño que el rename inline cubre la necesidad operativa.

Cualquier extensión natural (edit phone, edit email, etc.) sería un spec nuevo
(006+), nunca un follow-up silencioso de este.