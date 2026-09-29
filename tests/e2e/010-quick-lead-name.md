# E2E 010 — Edición rápida del nombre del lead desde el panel del inbox

Guion de comportamiento (Constitución IX) para `specs/005-quick-lead-name/`.
La parte automatizada contra `PATCH /api/contacts/:id` con `WA_MOCK_ENABLED=true`
vive en los unit tests de `applyContactNamePatch`
(`tests/unit/conversation-patch.test.ts`) y se complementa aquí con la
verificación visual/manual del flujo UI completo.

## Superficie y mocks

- `PATCH /api/contacts/:id` ya valida `name: z.string().trim().min(1).max(120).optional()`
  y aplica `scoped()`. **No se añade endpoint, no se modifica schema.**
- El endpoint PATCH ya está cubierto por el selftest general
  (`scripts/e2e-selftest.mjs` ejercita la ruta `/api/contacts/:id` desde otras
  features: 008, 009). En esta sección 010 el grueso de la verificación es
  cliente: el endpoint PATCH solo se invoca con un body mínimo `{ name }`.
- El `wa-mock` y `ai-mock` activos (`WA_MOCK_ENABLED=true`,
  `OPENROUTER_BASE_URL` → ai-mock) son suficientes para esta feature; no se
  necesita Jev/mocks de Sales.

## US1 — Edición inline del nombre en el panel (automatizable: parcial)

| AC | Check del selftest / unit |
|---|---|
| AC-1 icono lápiz junto al nombre | unit: el árbol JSX del panel renderiza el botón con `aria-label="Editar nombre"` (manual Playwright). |
| AC-2 input autofocus + select() programático | unit: `useEffect` dispara `el.focus()` + `el.select()` al entrar en modo `"edit"`. Verificable en DOM con Playwright (`page.locator('input[aria-label="Nombre del contacto"]').evaluate(el => el === document.activeElement)`). |
| AC-3 Enter guarda vía PATCH | unit (helper) + manual: `PATCH /api/contacts/:id` con `{ name }` retorna 200 y `data.contact.name`. |
| AC-4 Escape cancela y restaura | manual: el `<p>` muestra el nombre previo sin llamada a la API. |
| AC-5 nombre vacío no llama a la API | unit (lógica del `submit()`: `if (trimmed === "")` → error inline, return temprano). Verificable con network spy en Playwright (0 PATCH). |
| AC-6 doble submit → un solo PATCH | unit: `savingRef.current` corto-circuita el segundo submit. Verificable con network spy (1 PATCH). |
| AC-7 4xx/5xx → error inline + modo edición preservado | unit + manual: `error.message` del servidor visible bajo el input. |

## US2 — Sincronización inmediata en los tres lugares (manual Playwright)

| AC | Check |
|---|---|
| AC-1 panel lateral muestra el nuevo nombre | inspección DOM tras guardar. |
| AC-2 header del hilo arriba refleja el nuevo nombre | inspección DOM. |
| AC-3 lista izquierda refleja el nuevo nombre | inspección DOM. |
| AC-4 sin `window.location.reload()` y sin `refetchConversations()` | network spy: 1 sola PATCH, 0 GET `/api/conversations` durante el rename. |
| AC-5 SSE entrante durante la edición preserva el draft | manual: abrir input, escribir un nombre distinto, simular un SSE `onMessageNew` (botón "Simular mensaje entrante" en dev), verificar que el input sigue mostrando el draft. |

## Pasos visuales (Playwright, al cerrar la feature)

> Se ejecutan contra `pnpm dev` local con mocks activos y un seed que
> contiene al menos un contacto con `name = "5215511111111"` o
> `name = "bsuid:..."` (perfil "lead recién llegado").

1. Login → Inbox → seleccionar la conversación del lead recién llegado.
2. Panel lateral derecho: el nombre aparece con icono lápiz (oculto hasta
   hover, visible con foco de teclado). Click → input autofocus con texto
   seleccionado.
3. Escribir "Juan Pérez" + Enter → la API devuelve 200, el panel muestra
   "Juan Pérez", el header del hilo también, y la fila izquierda también.
4. Volver a abrir el editor → input con "Juan Pérez" seleccionado.
5. Escape → vuelve a modo view con "Juan Pérez".
6. Abrir editor, vaciar el texto, Enter → no se llama a la API y aparece
   "El nombre no puede estar vacío" bajo el input.
7. Abrir editor, escribir "X", Enter, **y mientras `saving=true`** click
   otra vez en el check → un solo PATCH en network.
8. Abrir editor, escribir "Otro", click fuera del input → cancela y restaura
   "Juan Pérez" sin llamar a la API.
9. Abrir editor, escribir "Otro", seleccionar otra conversación en la lista
   izquierda → el modo edición se descarta (gracias a `key={selected.contact.id}`
   en `inbox-client.tsx`).
10. Abrir editor, escribir "Definitivo", mientras se mantiene el editor
    abierto, simular un `onMessageNew` (en dev) → el input sigue mostrando
    "Definitivo" (no se sobrescribe con el nombre del servidor).

## Caminos infelices documentados

- **API 4xx** (validación servidor, p. ej. nombre > 120 chars): el backend
  ya corta en `parseBody` → 400. Cliente: muestra `error.message` del
  servidor, mantiene draft y modo edición.
- **API 5xx** / red caída: el `fetch` rechaza → "Sin conexión con el
  servidor" en gris debajo del input.
- **Doble Enter durante `saving=true`**: el `savingRef` corto-circuita el
  segundo submit (sin parpadeo, sin segundo PATCH).
- **Cambiar de conversación a media edición**: `key={selected.contact.id}`
  fuerza re-mount; el `draft` y `mode` locales se pierden limpiamente.
- **SSE entrante durante la edición**: el `useState` local del draft NO
  se sincroniza con la prop `name` mientras `mode === "edit"` (ver
  comentario en `ContactNameEditor`). Al guardar/cancelar, el próximo
  re-render aplica el nombre del servidor.

## Cobertura automatizada presente en este commit

- `tests/unit/conversation-patch.test.ts` — 9 casos de la helper pura
  `applyContactNamePatch`: reemplazo por id, id inexistente (misma
  referencia), múltiples matches (defensivo), inmutabilidad, name idéntico
  (nueva referencia), preservación del resto de campos, match parcial,
  array vacío, preservación de id/phone.
- La defensa contra doble submit y la UX de errores viven en
  `ContactNameEditor` dentro de `contact-panel.tsx` y se verifican
  visualmente con Playwright (los pasos 6-10 arriba).

## Pendiente de verificación humana

- [ ] Ejecutar Playwright manual contra `pnpm dev` local con los 10 pasos
      visuales y los caminos infelices. Si el entorno local no tiene app
      levantada ni PostgreSQL activa, este guion queda como
      **pendiente** en `docs/CURRENT_STATE.md` (igual que las secciones
      008 y 009).
- [ ] No-regresión del spec 004: composer + cola de adjuntos + drag&drop
      + `decideSubmitMode` siguen verdes con el nuevo árbol JSX del panel.
- [ ] Si Playwright descubre un fallo, el implementador diagnostica y
      re-verifica hasta verde (loop de auto-corrección según
      Constitución IX).
