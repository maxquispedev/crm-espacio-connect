# Tasks: UX de mensajería del inbox — cola de adjuntos (004-inbox-messaging-ux)

**Input**: [spec.md](./spec.md) · [plan.md](./plan.md)
**Tests**: incluidos (unit + E2E + guion Playwright manual)
**Organization**: tareas agrupadas por **commit atómico**. Cada commit deja el repositorio en estado verde.

## Estructura de los 3 cortes (commits) de implementación

| # | Commit | Resumen | Tareas |
|---|---|---|---|
| 0 | `docs(spec): open 004 — UX de mensajería del inbox` | Este PR: solo docs. | T001–T005 |
| 1 | `feat(inbox): cola de adjuntos + helpers + previews` | Helpers + componentes presentacionales + tests unit. El composer sigue funcionando como antes. | T101–T112 |
| 2 | `feat(inbox): composer cola con drag&drop, paste, submit, retry, a11y, e2e` | Composer reescrito (rama adjuntos) + drag&drop + paste + submit secuencial + retry + E2E + guion Playwright. | T201–T222 |

> **No hay commit 3 de código** — los 3 commits pedistes son **docs + 2 commits de código**. La razón: el spec es lo bastante acotado para caber en dos cortes limpios (uno de scaffolding + uno de integración completa), evitando un commit "puente" con el composer a medio migrar.

---

## Formato

`[ID] [P?] [Story] Descripción`

- **[P]**: puede hacerse en paralelo con otras `[P]` del mismo commit (diferentes archivos, sin dependencias).
- **[Story]**: US a la que pertenece (US1–US6 del spec).
- Rutas absolutas desde la raíz del repo.

---

## Commit 0 — Documentación (este PR)

**Propósito**: abrir la feature sin tocar código. Cumple la constitución VI ("specs antes de código") y deja el repo entendible.

- [x] **T001** Crear `specs/004-inbox-messaging-ux/spec.md` con user stories, FR/NF, success criteria, scope/fuera-de-scope y verificación.
- [x] **T002** Crear `specs/004-inbox-messaging-ux/plan.md` con Constitution Check, modelo de cola, helpers, diseño de componentes, decisiones explícitas.
- [x] **T003** Crear `specs/004-inbox-messaging-ux/tasks.md` (este archivo) con la división en 3 commits atómicos y tareas dependency-ordered.
- [x] **T004** Verificar constitution check pasa (sin violaciones) — registrado en `plan.md` §Constitution Check.
- [x] **T005** Commit atómico documental: `docs(spec): open 004 — UX de mensajería del inbox`. Working tree limpio excepto `specs/004-inbox-messaging-ux/`.

**Checkpoint**: la feature está abierta y entendible sin leer el chat. No se ha tocado ningún archivo de código.

---

## Commit 1 — Cola de adjuntos + helpers + previews

**Propósito**: introducir el modelo de cola, los helpers puros y los componentes presentacionales con sus tests. **El composer sigue funcionando como hasta ahora** — el wiring ocurre en el commit 2.

### Tests primero (escribir, ver fallar — aunque en este repo el flujo suele ser write-test-then-impl, los tests pueden ir junto a la impl)

- [ ] **T101** [P] [US1] Test unit `src/components/inbox/__tests__/classifyForQueue.test.ts` cubriendo: image ≤5MB, audio ≤16MB, video ≤16MB, video >16MB y ≤100MB → document con `application/octet-stream`, cualquier tipo ≤100MB → document, >100MB → null, MIME vacío → document.
- [ ] **T102** [P] [US1] Test unit `src/components/inbox/__tests__/attachment-queue.test.tsx` cubriendo el hook `useAttachmentQueue`: `addFiles` añade adjuntos válidos y reporta rechazados, `remove` revoca Object URL, `updateStatus` transita pending→sending→sent/failed, cleanup de URLs al desmontar.

### Implementación — helpers y tipos

- [ ] **T103** [P] [US1] En `src/components/inbox/helpers.ts`, añadir tipo exportado `AttachStatus`, `PendingAttachment`, y funciones `classifyForQueue(file)`, `formatAttachStatus(s)`, `humanAttachType(k)`. Constantes `VIDEO_MAX_AS_VIDEO` y `DOC_MAX`. **No** reutilizar `MEDIA_LIMITS` del servidor (mantener el límite del cliente explícito y pequeño; el servidor sigue siendo la fuente de verdad).

### Implementación — componentes presentacionales

- [ ] **T104** [P] [US1] Crear `src/components/inbox/attachment-item.tsx` (componente presentacional): recibe `{ attachment, onRemove, onRetry }`. Renderiza preview según `kind` (img / video controls / audio controls / tarjeta documento). Indicador de estado (spinner / check / AlertTriangle). Botón X (si pending) o botón Reintentar (si failed). Badge "Se envía como documento (NN MB)" cuando `willSendAsDocument`. `aria-label` dinámico.
- [ ] **T105** [P] [US1] Crear `src/components/inbox/attachment-queue.tsx`: contiene el hook `useAttachmentQueue(initial?)` con estado `attachments`, `addFiles(File[])`, `remove(id)`, `retry(id)`, `updateStatus(id, status, error?)`, `revokeIfUrl(att)`, `clearSent()`. Cleanup de URLs en `useEffect` cleanup al desmontar. Exporta también el componente `AttachmentQueueList` (presentacional, row horizontal con `role="list"` y `aria-live="polite"`).
- [ ] **T106** [P] [US6] En `attachment-item.tsx`, asegurar `min-h-[44px] min-w-[44px]` en X y Retry; `role="listitem"` + `aria-label` dinámico; `focus-visible:ring-2 focus-visible:ring-brand` en los botones.

### Verificación del commit

- [ ] **T107** Correr `pnpm typecheck && pnpm lint && pnpm build && pnpm test` — **debe quedar verde**. La introducción de los componentes nuevos no debe romper el composer actual porque aún no se usa en él.
- [ ] **T108** Verificar manualmente (devtools): importar `AttachmentItem` y `useAttachmentQueue` en una story rápida o test interactivo y renderizar 3 adjuntos (mock `File`s); los previews cargan, los estados cambian, el cleanup de URLs funciona.

**Checkpoint**: el modelo de cola existe, está testeado y es presentacionalmente correcto. El composer sigue sin usar la cola — eso ocurre en el commit 2.

---

## Commit 2 — Composer integrado: drag&drop, paste, submit, retry, a11y, E2E

**Propósito**: cablear la cola en el composer, añadir drag&drop y paste, el loop de envío, retry, anti-doble-envío, y la cobertura E2E. **Cierra todas las US del spec.**

### Implementación — composer

- [ ] **T201** [US1] Refactor de `src/components/inbox/composer.tsx`:
  - Reemplazar `useState<File \| null>` por el hook `useAttachmentQueue([])`.
  - Renderizar `<AttachmentQueueList>` encima del textarea cuando hay adjuntos.
  - El `<input type="file">` cambia a `multiple` y su `onChange` llama `addFiles(Array.from(files))`.
  - Quitar el bloque de preview único actual (líneas 235–261) — ahora lo hace `AttachmentItem`.
  - Mantener intactos: textarea, location panel, contact panel, template chips.
- [ ] **T202** [US2] En `composer.tsx`, añadir `onPaste` al `<textarea>`: lee `clipboardData.items`, extrae los de `kind === "file"`, llama `addFiles`. Si hay archivos Y texto, `preventDefault` para que el binario no se inserte como caracteres.
- [ ] **T203** [US2] En `src/components/inbox/inbox-client.tsx`, envolver el `<section>` derecho (donde están MessageThread + Composer) en un `<DropZone>` (nuevo mini-componente) que recibe `onDrop={addFiles}`. Implementar contador con `useRef` para evitar parpadeo del overlay. `role="region"` y `aria-label="Área de conversación; arrastra archivos para adjuntar"`.
- [ ] **T204** [US3] En `composer.tsx`, al construir el `File` a enviar, usar `att.effectiveMime` (que para video >16MB es `application/octet-stream`). Sin lógica nueva en el servidor.
- [ ] **T205** [US1, US4] En `composer.tsx`, implementar `submitQueue(caption: string)`:
  - `submitInFlight = useRef(false)` — cortocircuito.
  - Itera la cola con `for (const att of attachments)`.
  - Construye `FormData` con `file = new File([att.file], att.file.name, { type: att.effectiveMime })` y `caption` solo al primero que acepta.
  - `await fetch(...)`; si `!res.ok`, lanza con el mensaje del servidor.
  - Éxito → `updateStatus(att.id, "sent")` + `revokeIfUrl(att)`.
  - Fallo → `updateStatus(att.id, "failed", error.message)`; sigue con los siguientes.
  - Al final, `setSending(false)`, `onSent()`. Si todo salió bien, limpia el textarea.
  - El botón "Enviar" queda `disabled` si `sending || (queue vacío && !text.trim())`.
- [ ] **T206** [US4] El handler del botón Reintentar de `AttachmentItem` propaga `onRetry(id)` al composer, que llama `retry(id)` del hook (transita `failed → pending`); el próximo `submitQueue` lo recoge.
- [ ] **T207** [US1, US5] Verificar el cleanup: al desmontar el composer (cambio de conversación o navegación), el `useEffect` cleanup de `useAttachmentQueue` revoca todas las URLs activas.
- [ ] **T208** [US6] a11y final: la cola tiene `aria-live="polite"`; al cambiar un estado, un lector de pantalla lo anuncia; el overlay del dropzone tiene `role="status"` con texto "Suelta para adjuntar archivos" mientras `dragOver`.

### Tests unit adicionales

- [ ] **T209** [P] [US5] Test unit `src/components/inbox/__tests__/composer-anti-double.test.tsx`: simular doble click en Enviar; verificar que `fetch` se llama **una vez por adjunto**, no el doble. Usar `vi.fn()` para `fetch` y assert `mock.calls.length === attachments.length`.
- [ ] **T210** [P] [US1, US4] Test unit `src/components/inbox/__tests__/composer-submit-queue.test.tsx`: simular cola de 3 adjuntos, segundo con respuesta 413; verificar que el primero queda `sent`, el segundo `failed` con mensaje, el tercero `sent`; el caption solo aparece en el primero; el textarea se limpia al final solo si todo salió bien.

### Self-test E2E (sección 009)

- [ ] **T211** [P] [US1, US3, US4] Añadir sección 009 a `scripts/e2e-selftest.mjs` (justo después de la sección 008 existente) que ejercita el **contrato backend** que asume la cola:
  - **AC-1**: cola de 3 adjuntos (jpeg, mp4 30 MB forzado a document con mime `application/octet-stream`, pdf) enviados secuencialmente → 3 mensajes salientes en orden, todos con asset disponible.
  - **AC-2**: en una cola de 3 adjuntos, el segundo falla por exceder 16 MB como video (forzando el caso `willSendAsDocument=false` mal aplicado) → primero `sent`, segundo `failed`, tercero `sent`. Verifica que la cola continúa tras el fallo.
  - **AC-3**: el caption solo aparece en el primero de los 3 (verificable inspeccionando el body en `wa-mock/outbox`).
  - **AC-4**: video de 120 MB → 413 desde el servidor (NO se relaja el límite duro).
  - **AC-5**: conversación `is_test` con cola → todos los adjuntos fallan con `sandbox_violation`, ningún asset en disco, ningún `graphRequest`.
- [ ] **T212** [P] [US1, US2, US4, US6] Crear `tests/e2e/009-inbox-messaging-ux.md` (guion Playwright manual): pasos visuales para arrastrar 3 archivos, pegar con Ctrl+V, ver cola y overlay, eliminar uno, enviar, forzar un fallo y reintentar, verificar cleanup de Object URLs en devtools. Cita los AC de la sección 009.

### Verificación del commit

- [ ] **T213** Correr `pnpm typecheck && pnpm lint && pnpm build && pnpm test` — verde. Tests nuevos añadidos en `src/components/inbox/__tests__/`.
- [ ] **T214** Levantar app + PostgreSQL + mocks (`WA_MOCK_ENABLED=true`, `MEDIA_DIR` local). Correr `pnpm test:e2e` — sección 009 verde. Reglas duras del PrincipIO IX: destinatarios en allowlist (los mismos del spec 003), sin ráfaga (gap de ~80 ms entre envíos en `submitQueue`), volumen mínimo.
- [ ] **T215** Playwright manual siguiendo `tests/e2e/009-inbox-messaging-ux.md`. Confirmar visualmente drag, paste, retry, cleanup, responsive (375 px y 1280 px).
- [ ] **T216** Verificar que **no se rompió nada** del spec 003 cerrado: re-correr la sección 008 de `e2e-selftest.mjs` completa (incluye: echoes de coexistence, sandbox, ventana 24 h, descarga in-process de media entrante, etc.) — sigue verde.

**Checkpoint**: la feature cumple todas las US del spec. El composer es usable para enviar varios adjuntos con la experiencia de WhatsApp Web, sin tocar el sender ni el endpoint.

---

## Commit 3 (futuro, fuera de este PR)

No hay commit 3 de código. La razón está al inicio. Si durante la implementación surge necesidad de un commit puente (p. ej. el refactor de `composer.tsx` resulta ser más grande de lo previsto y conviene un commit de "wiring sin drag&drop"), se reabre aquí.

---

## Dependencias y orden de ejecución

### Fase 0 (este PR)

```
T001 → T002 → T003 → T004 → T005
```

`T001–T004` son secuenciales porque el plan depende del spec y el tasks del plan. `T005` es el commit final.

### Commit 1

```
T101 ─┐
T102 ─┼─→ T103 ─┬─→ T104 ─┐
T103 ─┘         └─→ T105 ─┼─→ T106 ─→ T107 → T108
                          (T104, T105 pueden ir en paralelo)
```

`T101` y `T102` definen los contratos esperados. `T103` los implementa. `T104` y `T105` pueden ir en paralelo (componentes distintos). `T106` es detalle de estilo. `T107` valida el gate. `T108` es sanity manual.

### Commit 2

```
T201 ─┬─→ T202 ─┬─→ T205 ─┬─→ T206 ─┬─→ T207 ─→ T208 ─→ T209 ─┬─→ T211 ─┬─→ T213 → T214 → T215 → T216
       │         │          │         │         │         │         │
T203 ──┤         │          │         │         │         │         │
T204 ──┴─────────┴──────────┴─────────┴─────────┴─→ T210 ─┘         │
                                                                  T212 ─┘
```

Notas:
- `T201`, `T203`, `T204` se pueden hacer en paralelo (distintos archivos).
- `T205` (`submitQueue`) depende de `T201` (refs del hook) y `T204` (effectiveMime).
- `T209` y `T210` son tests del composer ya integrado; pueden escribirse junto a T201–T208.
- `T211` y `T212` viven en `scripts/` y `tests/e2e/`, paralelos a la implementación.
- `T213`–`T216` son verificación al final.

---

## Estrategia de implementación

### MVP primero (Commit 0 + Commit 1)

1. Commit 0 (docs) — PR actual.
2. Commit 1 (cola + helpers + componentes presentacionales) — entrega la base testeable sin tocar el composer.
3. **STOP y validar**: el gate unit sigue verde, el composer actual sigue intacto (verificable re-corriendo el e2e-selftest).

### Entrega incremental (Commit 2)

4. Commit 2 — composer integrado + E2E.
5. Validar E2E completo + manual Playwright.

### Rollback

- Si algo en commit 2 rompe el composer actual, se puede revertir el commit completo (`git revert`) y volver al composer con un solo adjunto — el commit 1 es independiente y queda como base sin usar.

---

## Notas

- [P] = different files, no cross-dependencies.
- Cada US es independientemente completable después del commit 1; el commit 2 entrega US1–US6 juntas porque la integración es naturalmente cruzada (drag&drop + paste + cola + submit).
- Mantener commits atómicos y Conventional Commits (`docs(...)`, `feat(...)`, `test(...)`).
- Antes de cerrar el commit 2: actualizar `docs/CURRENT_STATE.md` §8 (Cobertura SDD existente) para añadir `specs/004-inbox-messaging-ux/` a la lista de specs formales y registrar el estado (Implemented con verificación E2E).
- Antes de cerrar el commit 2: actualizar `docs/CURRENT_STATE.md` §10 (próximo checkpoint) si aplica.