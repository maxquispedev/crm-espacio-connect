<!--
SYNC IMPACT REPORT
==================
Versión: draft (no amendment of constitution required).
Este spec NO modifica la constitución ni las plantillas.
NO reabre ningún spec cerrado. NO toca el schema. NO crea endpoints nuevos.
Reutiliza PATCH /api/contacts/:id, que ya valida name (trim 1–120 chars) y
aplica tenant scope (src/app/api/contacts/[id]/route.ts + src/server/contacts.ts).
-->

# Feature Specification: Edición rápida del nombre del lead desde el panel del inbox (005-quick-lead-name)

**Feature Branch**: `feat/005-quick-lead-name`
**Created**: 2026-09-29
**Status**: Draft
**Input**: descripción del dueño — el operador debe poder identificar/registrar el nombre de un lead en 2–3 segundos desde el panel lateral derecho del inbox, sin modal, sin navegar a /contacts, sin recargar la página.

---

## Resumen

El contacto de WhatsApp ya existe en BD con un `name` que puede ser:
- el `profile.name` que Meta envió en el webhook, o
- el teléfono formateado (cuando llegó solo `from`), o
- el prefijo `bsuid:<id>` (003 — sin teléfono).

Hoy ese `name` se muestra pero no se puede editar rápido: hay que ir a `/contacts`
o al pipeline. Esto rompe el ritmo del operador cuando un lead nuevo se identifica
en medio de la conversación.

La feature añade **edición inline del `contact.name`** en la sección superior del
`ContactPanel` (panel lateral derecho del inbox). Una sola acción, sin modal,
sin recargar, con feedback inmediato en los tres sitios que muestran el nombre:
panel lateral, header de la conversación activa, lista izquierda.

> **NO** es un editor de lead completo. NO edita teléfono, email, empresa, tags,
> notas, etapa, lane ni score. Es estrictamente un rename inline del `contact.name`
> usando el endpoint ya existente.

---

## Contexto y motivación

### Lo que ya existe (verificado)

- `PATCH /api/contacts/:id` en `src/app/api/contacts/[id]/route.ts`:
  - Schema: `name: z.string().trim().min(1).max(120).optional()`
  - Update con `scoped(schema.contact.organizationId, session.organizationId, ...)`
  - Devuelve `{ contact: serializeContact(updated[0]) }`
- `serializeContact` en `src/server/contacts.ts` ya expone `name` para el cliente.
- `ConversationDto.contact` (`src/lib/types.ts:45`) tiene `{ id, name, phone }` —
  es lo que consume la UI.
- `ConversationList` (líneas 232-233) y el header de la conversación en
  `inbox-client.tsx` (línea 187) leen `c.contact.name`.
- `ContactPanel` muestra `conversation.contact.name` en un `<p>` estático
  (líneas 164-166 de `src/components/inbox/contact-panel.tsx`).

### Por qué hace falta

- Lead nuevo llega con `name = "52155…"` o `name = "bsuid:1234"`. El operador
  necesita bautizarlo en cuanto el humano se identifique ("Soy Juan") sin perder
  el contexto de la conversación.
- Hoy la única vía de rename real es la página `/contacts/[id]/edit`, fuera
  del flujo del inbox.

### Por qué NO un modal / nueva página / form completo

- Modal rompe el ritmo del operador: cambia el foco y exige click extra.
- Página `/contacts/[id]` saca al operador de la conversación que está atendiendo.
- Form completo (con campos de lead) no entra en este spec — el dueño lo acotó
  explícitamente a "solo `contact.name`".

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Edición inline del nombre en el panel (Priority: P1)

Como operador que conversa con un lead por WhatsApp, puedo corregir o registrar
el nombre del contacto en ~2–3 segundos desde el panel lateral derecho del
inbox, sin abrir un modal ni cambiar de página.

**Why this priority**: Es el corazón de la feature. Sin esto el operador sigue
salido del inbox para renombrar.

**Independent Test**: Abrir el inbox con una conversación seleccionada; en el
panel lateral, click en el icono lápiz junto al nombre; el nombre se convierte
en un input con el texto seleccionado; escribir un nombre nuevo; pulsar Enter;
verificar que el panel, el header del hilo y la lista izquierda muestran el
nuevo nombre.

**Acceptance Scenarios**:

1. **Given** el panel lateral abierto con un contacto con nombre "Juan Pérez",
   **When** hago click en el icono lápiz junto al nombre, **Then** el `<p>` se
   sustituye por un `<input>` con autofocus, el texto "Juan Pérez" seleccionado
   y un botón pequeño de confirmar (check) y otro de cancelar (X).
2. **Given** el input abierto, **When** escribo "Juan P. García" y pulso Enter,
   **Then** se dispara PATCH `/api/contacts/:id` con `{ name: "Juan P. García" }`
   y, tras 200, se sale de modo edición mostrando "Juan P. García".
3. **Given** el input abierto, **When** pulso Escape, **Then** se cancela la
   edición y se restaura el nombre anterior sin llamar a la API.
4. **Given** el input abierto, **When** borro todo el texto y pulso Enter, **Then**
   no se llama a la API, se muestra un error inline "El nombre no puede estar
   vacío" y se mantiene el modo edición con el texto vacío.
5. **Given** el input abierto y en vuelo de guardado, **When** pulso Enter dos
   veces o click en el check dos veces, **Then** solo se ejecuta UN PATCH
   (el segundo se ignora mientras `saving=true`).
6. **Given** el input abierto, **When** la API devuelve 4xx/5xx, **Then** se
   muestra el mensaje de error del servidor (o un fallback legible), se
   conserva el texto en el input y se mantiene el modo edición.

---

### User Story 2 — Sincronización inmediata en los tres lugares (Priority: P1)

Como operador, tras guardar un nombre nuevo, lo veo al instante en:
(a) el panel lateral derecho, (b) el header de la conversación activa arriba,
(c) la fila correspondiente en la lista izquierda — sin recargar la página y
sin esperar a SSE.

**Why this priority**: Es lo que cierra el bucle de UX. Si el header o la lista
muestran el nombre viejo, el operador desconfía de que se guardó.

**Independent Test**: Renombrar como en US1; verificar que las tres superficies
muestran el nuevo nombre sin un `window.location.reload()` y sin un round-trip
de `GET /api/conversations`.

**Acceptance Scenarios**:

1. **Given** la edición guardada con éxito, **When** miro el panel lateral,
   **Then** el `<p>` muestra el nuevo nombre (sin icono de loading ni spinner
   residual).
2. **Given** la edición guardada con éxito, **When** miro el header de la
   conversación activa, **Then** el nombre arriba del hilo refleja el nuevo
   valor.
3. **Given** la edición guardada con éxito, **When** miro la lista izquierda,
   **Then** la fila de esa conversación muestra el nuevo nombre y, si el
   filtro/búsqueda estaba activo por nombre, el resultado se mantiene
   coherente.
4. **Given** un evento SSE entrante que actualiza la conversación después del
   rename (p. ej. `onConversationUpdated` o `onMessageNew`), **When** el SSE
   dispara `refetchConversations()`, **Then** el nombre se reconcilia con el
   servidor sin pisar la edición local en curso (defensivo: la edición solo
   se sobrescribe vía refetch si NO está en modo edición).

---

## Functional Requirements *(mandatory)*

- **FR-1** El panel lateral `ContactPanel` muestra, junto al `<p>` con
  `conversation.contact.name`, un icono pequeño de lápiz (`Pencil` de lucide)
  visible siempre, alineado a la derecha del nombre.
- **FR-2** Al activar el icono (o el propio nombre si se decide así), el `<p>`
  se sustituye por un `<input type="text">` controlado con autofocus + `select()`
  programático sobre el contenido.
- **FR-3** El input muestra un valor inicial igual al `conversation.contact.name`
  actual (puede ser teléfono formateado o `bsuid:…`).
- **FR-4** Enter sin Shift dispara el guardado. Escape cancela y restaura el
  valor anterior. Click fuera (blur) cancela (decisión conservadora — ver
  `plan.md` §Decisiones).
- **FR-5** Botón pequeño de check al lado del input también guarda (atajo
  visual). Botón pequeño de X cancela.
- **FR-6** Trim antes de enviar. Si el resultado es vacío, NO se llama a la
  API; se muestra un error inline y se mantiene el modo edición.
- **FR-7** Durante `saving=true`: el input queda deshabilitado, los botones
  deshabilitados y un segundo Enter / click se ignora.
- **FR-8** Si la API devuelve error (4xx/5xx), se muestra el mensaje del
  servidor (`error.message`) o un fallback legible, se conserva el draft del
  input y se mantiene el modo edición con `saving=false`.
- **FR-9** Si la API devuelve 200, se sale de modo edición con el valor
  retornado por el servidor como nuevo valor mostrado (SoT del cliente).
- **FR-10** Tras 200, `ContactPanel` invoca una prop callback
  `onContactUpdated({ id, name })`. `InboxClient` aplica ese patch al array
  `conversations` in-place, sin refetch.
- **FR-11** Tras 200, `ContactPanel` también invoca su `refetchLive()` interno
  para que etapas/sales/notas (no afectadas por el rename, pero leen del
  mismo GET) sigan consistentes — esto es opcional y se hace una vez.
- **FR-12** Al cambiar de conversación (el operador selecciona otra fila), el
  estado local de edición se descarta limpiamente. Se logra con
  `key={selected.contact.id}` en `<ContactPanel>` (forza re-mount).
- **FR-13** El endpoint consumido es **exclusivamente** `PATCH /api/contacts/:id`
  con body `{ name }`. No se crea endpoint paralelo. No se modifica el schema.
- **FR-14** No se introducen modales, páginas nuevas, rutas nuevas, ni stores
  globales.

## Non-Functional Requirements *(mandatory)*

- **NFR-1** El operador completa el rename en 2–3 segundos (latencia objetivo
  del flujo UI, no SLO medible: se verifica manualmente).
- **NFR-2** Sin `window.location.reload()`. Sin navegación SPA a otra ruta.
- **NFR-3** Sin recargar la página entera, sin recargar la lista con
  `refetchConversations()` (la sincronización se hace con un patch in-place
  del array — ver FR-10).
- **NFR-4** Mantener `strict` + `noUncheckedIndexedAccess` de TS. Cero `any`.
- **NFR-5** Tenant-safe: la llamada al endpoint PATCH ya aplica `scoped()`;
  este spec no añade otra capa de seguridad.
- **NFR-6** Sin nuevas dependencias npm. Sin nuevos servicios externos.

## Success Criteria *(mandatory)*

- **SC-1** Gate técnico verde: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
- **SC-2** Test unit de la helper pura `applyContactNamePatch(conversations, { id, name })`:
  reemplaza el `name` del contacto cuyo `id` coincida, deja el resto intacto,
  retorna array nuevo. ≥6 casos (id inexistente, múltiples matches, inmutabilidad,
  no muta conversation si el match es parcial, etc.).
- **SC-3** Self-test E2E `tests/e2e/010-quick-lead-name.md` guionado y agregado
  al `scripts/e2e-selftest.mjs` (o como sección manual si la superficie no
  admite automatización barata).
- **SC-4** Verificación manual con Playwright del camino feliz y del camino
  infeliz (red caída, validación servidor 400, blur mientras se edita, doble
  Enter).
- **SC-5** No regresión del spec 004 cerrado (composer, cola de adjuntos,
  drag&drop).

## Fuera de alcance *(recordatorio)*

- Edición de phone, email, empresa, tags, notas, etapa, lane, score.
- Creación manual de contactos.
- Modal de edición.
- Nueva ruta `/contacts/:id/edit` (ya existe y se mantiene).
- Cambios en pipeline, Sales Orchestrator, follow-ups, sender, webhook, schema.
- Backend paralelo o endpoint nuevo.
- Historial de cambios / auditoría de renames.

## Verification *(cómo se cierra "Hecho")*

1. Gates técnicos (SC-1).
2. Test unit de la helper pura (SC-2).
3. Self-test E2E con mocks + guion Playwright manual (SC-3, SC-4).
4. Verificar manualmente que tras guardar:
   - el panel lateral, el header de la conversación activa y la lista
     izquierda muestran el nuevo nombre sin recargar;
   - cambiar de conversación descarta el modo edición;
   - un blur mientras se edita descarta el draft sin llamar a la API;
   - un Enter dos veces durante `saving=true` solo dispara UN PATCH.
5. Verificar no-regresión del spec 004: cola de adjuntos, drag&drop,
   `canSubmit`/`decideSubmitMode`, focus del textarea.
6. Cerrar el ciclo SDD: marcar `tasks.md`, actualizar `docs/CURRENT_STATE.md`
   con el cierre de spec 005 y abrir el siguiente checkpoint.

---

## Constitution Check *(preview — detallado en plan.md)*

| Principio | Aplicación | Estado |
|---|---|---|
| **I — Seguridad** | PATCH ya cifra en tránsito por la sesión Better Auth; este spec no toca secretos. | ✅ |
| **II — Soberanía** | Sin nuevas dependencias; sin servicios externos; reutiliza endpoint existente. | ✅ |
| **III — Multi-tenancy** | El endpoint ya aplica `scoped()`; este spec no añade otro camino de DB. | ✅ |
| **IV — Idempotencia** | PATCH name es idempotente (mismo body → mismo estado). | ✅ |
| **V — Calidad verificable** | Helper pura testeable + E2E + manual Playwright. | ✅ |
| **VI — Specs antes de código** | Este spec es el PR actual. | ✅ |
| **VII — Trazabilidad** | Decisiones explícitas en `plan.md` §Decisiones. | ✅ |
| **VIII — Foco vertical** | Es el inbox, su panel de contacto. | ✅ |
| **IX — Verificación en vivo** | Self-test E2E + camino infeliz + Playwright manual. | ✅ |