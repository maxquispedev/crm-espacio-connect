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
| 2a | `feat(inbox): enviar cola con typed kind override + estados por adjunto + retry` | **Este commit**: bucle de envío `runQueueSend`, anti-doble-envío, retry por adjunto, confirmación explícita video→document, override tipado `kind=document` en endpoint, tests de multi-send/fallo parcial/retry/anti-doble/videos >16MB/>100MB. | T2a01–T2a14 |

> **No hay commit 3 de código** — los 3 commits pedistes son **docs + 2 commits de código**. La razón: el spec es lo bastante acotado para caber en dos cortes limpios (uno de scaffolding + uno de integración completa), evitando un commit "puente" con el composer a medio migrar. El commit 2a es un refinamiento incremental del commit 2: reescribe la rama de envío sin tocar drag&drop/paste/dropzone (ya verdes), añade el override tipado y el estado `sending`/`sent` por adjunto.

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

- [ ] **T101** [P] [US1] Tests unit de la lógica separable de `classifyForQueue` y compañía: image ≤5MB, audio ≤16MB, video ≤16MB, video >16MB y ≤100MB → document con `application/octet-stream`, cualquier tipo ≤100MB → document, >100MB → null, MIME vacío → document. **Ubicación:** `tests/unit/attachment-queue-classify.test.ts` (vitest está en entorno `node` y solo recoge `tests/unit/**/*.test.ts`, sin `.tsx`).
- [ ] **T102** [P] [US1] Tests unit del reducer puro de la cola (exportado desde `attachment-queue.tsx` como `queueReducer` para poder testearlo sin React): `addFiles` añade adjuntos válidos, deduplica por nombre+tamaño+lastModified, reporta rechazados con motivo; `remove` y `clear` devuelven lista actualizada. La lógica de Object URLs se prueba mediante un mock `URL.createObjectURL`/`revokeObjectURL` que cuenta llamadas.

### Implementación — helpers y tipos

- [ ] **T103** [P] [US1] En `src/components/inbox/helpers.ts`, añadir tipo exportado `AttachKind`, `AttachStatus`, `PendingAttachment`, y funciones `classifyForQueue(file)`, `formatAttachStatus(s)`, `humanAttachType(k)`. Constantes `VIDEO_MAX_AS_VIDEO` y `DOC_MAX`. **No** reutilizar `MEDIA_LIMITS` del servidor (mantener el límite del cliente explícito y pequeño; el servidor sigue siendo la fuente de verdad).

### Implementación — componentes presentacionales

- [ ] **T104** [P] [US1] Crear `src/components/inbox/attachment-item.tsx` (componente presentacional): recibe `{ attachment, selected, onSelect, onRemove }`. Renderiza preview según `kind` (img / video controls / audio controls / tarjeta documento). Borde resaltado cuando `selected`. Botón X siempre visible (en este corte el reintento y los estados terminales llegan con el commit 2; `aria-label` dinámico). Badge "Se envía como documento (NN MB)" cuando `willSendAsDocument`.
- [ ] **T105** [P] [US1] Crear `src/components/inbox/attachment-queue.tsx`: exporta el reducer puro `queueReducer(state, action)` (testable sin React) y el hook `useAttachmentQueue(initial?)` que envuelve el reducer más el ciclo de vida de Object URLs. API: `attachments`, `selectedId`, `addFiles(File[])`, `remove(id)`, `clear()`, `select(id)`. Cleanup de URLs en `useEffect` cleanup al desmontar. Exporta también el componente `AttachmentQueueList` (presentacional, fila horizontal con `role="list"` y `aria-live="polite"`).
- [ ] **T106** [P] [US6] En `attachment-item.tsx`, asegurar `min-h-[44px] min-w-[44px]` en X; `role="listitem"` + `aria-label` dinámico; `focus-visible:ring-2 focus-visible:ring-brand` en los botones.

### Verificación del commit

- [ ] **T107** Correr `pnpm typecheck && pnpm lint && pnpm build && pnpm test` — **debe quedar verde**. La introducción de los componentes nuevos no debe romper el composer actual porque aún no se usa en él.
- [ ] **T108** Verificar manualmente (devtools): el composer carga; seleccionar 3 archivos en el picker produce 3 tarjetas con preview; arrastrar 1 archivo sobre el composer muestra el overlay y al soltarlo se añade a la cola; pegar una imagen con Ctrl+V la añade; eliminar un adjunto revoca su Object URL; al cambiar de conversación, las URLs del composer anterior están revocadas.

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

---

## Commit 2a — Envío de la cola + validación + estados por adjunto (este commit)

**Propósito**: cablear el bucle de envío real (`runQueueSend`), el anti-doble-envío con `submitInFlight`, el manejo de error por adjunto con `failed` visible y reintento, y la confirmación explícita del re-tag video→document. Se añade un **override tipado `kind`** al endpoint existente para que el cliente pueda forzar `document` sin falsificar el MIME (typed contract: server-side `ALLOWED_KIND_OVERRIDES`).

No toca drag&drop/paste/dropzone (ya entregados en el commit 1). Mantiene intactos: sandbox, ventana 24h, tenant scope, media persistence, status/webhook, follow-ups.

### Server — contrato mínimo (typed override)

- [x] **T2a01** En `src/server/whatsapp/media.ts`: añadir `FileMediaKind` (tipo estrecho `image|video|audio|document`), `ALLOWED_KIND_OVERRIDES = {document}`, y `opts?: { kind?: FileMediaKind }` a `validateOutgoing`. Cuando el override difiere del derivado y NO está permitido, lanza `unsupported_type`.
- [x] **T2a02** En `src/server/inbox/send.ts`: añadir `kind?: FileMediaKind` al input de `sendMediaMessage`. Cuando el override es `document`: subir a Graph con `application/octet-stream` (esquiva chequeo nativo de tipo en Cloud API), persistir `mimeType='application/octet-stream'` y `kind='document'`, enviar el mensaje a Graph como `type=document` con el `filename` original preservado.
- [x] **T2a03** En `src/app/api/conversations/[id]/messages/media/route.ts`: aceptar campo opcional `kind` en el form. Si viene, validar contra `ALLOWED_KIND_OVERRIDES` (cualquier valor no permitido se ignora silenciosamente, nunca amplía los tipos nativos).

### Client — modelo de cola + estado por adjunto

- [x] **T2a04** En `src/components/inbox/helpers.ts`: añadir flag `needsVideoAsDocumentConfirm` a `PendingAttachment`. `classifyForQueue` para video >16MB y ≤100MB devuelve `willSendAsDocument=true, needsVideoAsDocumentConfirm=true` (la cola NO auto-re-taggea silenciosamente; pide confirmación). Para >100MB sigue devolviendo `null`.
- [x] **T2a05** En `src/components/inbox/attachment-queue.tsx`: añadir acciones `confirmVideoAsDocument(id)` y `retry(id)` al reducer; exponer `confirmVideoAsDocument`, `retry`, `updateStatus`, `readyToSend`, `needsVideoAsDocumentConfirmCount` en `useAttachmentQueue`. Pasar `onConfirmVideoAsDocument` y `onRetry` a `AttachmentQueueList`.

### Client — componentes

- [x] **T2a06** En `src/components/inbox/attachment-item.tsx`:
  - Banner inline de confirmación `Excede el límite de video (16 MB). ¿Enviarlo como documento? [Enviar como documento]` cuando `needsVideoAsDocumentConfirm=true`.
  - Botón `↻ Reintentar` + texto del error del servidor cuando `status='failed'`.
  - Indicadores `sending` (spinner) y `sent` (check) en la esquina del preview.
  - X oculto cuando está bloqueado (la confirmación tiene su propio botón) y cuando está `sent`.
  - ARIA: `aria-label` dinámico con estado (`pendiente | enviando | enviado | con error`).
- [x] **T2a07** En `src/components/inbox/attachment-queue.tsx`: `AttachmentQueueList` reenvía `onConfirmVideoAsDocument` y `onRetry` por adjunto.

### Client — composer: bucle de envío

- [x] **T2a08** En `src/components/inbox/composer.tsx`:
  - `apiSend` defensivo contra `fetch` que lanza por red caída (devuelve string, no propaga).
  - `submitQueue` envuelve `runQueueSend` con `submitInFlight` (useRef) como anti-doble-envío (capa lógica, independiente del `disabled` del botón).
  - Caption del textarea se aplica SOLO al primer adjunto intentado (vía `runQueueSend`).
  - Si TODO salió bien (sin errores y sin adjuntos bloqueados), limpia el textarea; si no, conserva el caption para reintentos manuales.
  - Envía el campo `kind=document` cuando el adjunto tiene `willSendAsDocument=true`.
  - Botón Enviar deshabilitado si hay adjuntos bloqueados sin adjuntos listos para enviar.
  - Línea de aviso debajo de la cola cuando hay adjuntos bloqueados por confirmación.

### Client — `runQueueSend` (función pura testeable)

- [x] **T2a09** En `src/components/inbox/attachment-queue.tsx`: exportar `runQueueSend({attachments, sendOne, onStatus, caption})` puro, sin React. Garantiza:
  - iteración secuencial `for await`;
  - `caption` solo al primero;
  - omite `needsVideoAsDocumentConfirm=true` (skipped);
  - omite `status='sent'` (ya terminal) y `status='sending'` (defensivo);
  - un fallo no aborta el bucle (cada `sendOne` se evalúa independientemente).

### Tests nuevos

- [x] **T2a10** Actualizar `tests/unit/attachment-queue-classify.test.ts` con el flag `needsVideoAsDocumentConfirm` (13 tests).
- [x] **T2a11** Añadir a `tests/unit/attachment-queue-reducer.test.ts`: tests de `confirmVideoAsDocument` y `retry` (3 tests).
- [x] **T2a12** Añadir `tests/unit/attachment-queue-run.test.ts`: tests de `runQueueSend` cubriendo multi-send secuencial, fallo parcial, retry, caption solo al primero, bloqueo video→document, no duplicar `sent`, no re-entrada en `sending`, anti-doble-envío con patrón guard (8 tests).
- [x] **T2a13** Añadir `tests/unit/send-media-kind-override.test.ts`: tests del override tipado en `sendMediaMessage` (4 tests: video 30MB como document, pdf normal intacto, >100MB rejected, kind no permitido rejected).
- [x] **T2a14** Añadir a `tests/unit/media-send.test.ts`: tests de `validateOutgoing` con override (6 tests).

### Verificación del commit

- [x] **T2a15** `pnpm typecheck && pnpm lint && pnpm build && pnpm test` — verde. 488 tests pasan (28 nuevos).

### Self-test E2E (sección 009)

- [x] **T211** [P] [US1, US3, US4] Añadir sección 009 a `scripts/e2e-selftest.mjs` (justo después de la sección 008 existente) que ejercita el **contrato backend** que asume la cola:
  - **AC-1**: cola de 3 adjuntos (jpeg, mp4 30 MB forzado a document con mime `application/octet-stream`, pdf) enviados secuencialmente → 3 mensajes salientes en orden, todos con asset disponible.
  - **AC-2**: en una cola de 3 adjuntos, el segundo falla por exceder 16 MB como video (forzando el caso `willSendAsDocument=false` mal aplicado) → primero `sent`, segundo `failed`, tercero `sent`. Verifica que la cola continúa tras el fallo.
  - **AC-3**: el caption solo aparece en el primero de los 3 (verificable inspeccionando el body en `wa-mock/outbox`).
  - **AC-4**: video de 120 MB → 413 desde el servidor (NO se relaja el límite duro).
  - **AC-5**: conversación `is_test` con cola → todos los adjuntos fallan con `sandbox_violation`. **Cubierto por tests/unit/send-sandbox.test.ts + media-send.test.ts**; no en selftest porque no hay endpoint dev para setear `is_test` sin disparar el lab (fuera de scope 004).
- [x] **T212** [P] [US1, US2, US4, US6] Crear `tests/e2e/009-inbox-messaging-ux.md` (guion Playwright manual): pasos visuales para arrastrar 3 archivos, pegar con Ctrl+V, ver cola y overlay, eliminar uno, enviar, forzar un fallo y reintentar, verificar cleanup de Object URLs en devtools. Cita los AC de la sección 009.

### Verificación del commit

- [x] **T213** Correr `pnpm typecheck && pnpm lint && pnpm build && pnpm test` — verde. Tests nuevos añadidos en `src/components/inbox/__tests__/`.
- [ ] **T214** Levantar app + PostgreSQL + mocks (`WA_MOCK_ENABLED=true`, `MEDIA_DIR` local). Correr `pnpm test:e2e` — sección 009 verde. **PENDIENTE en este entorno** (sin app local ni BD PostgreSQL activa; gates unitarios verdes no equivalen a E2E punta a punta — Constitución IX).
- [ ] **T215** Playwright manual siguiendo `tests/e2e/009-inbox-messaging-ux.md`. Confirmar visualmente drag, paste, retry, cleanup, responsive (375 px y 1280 px). **PENDIENTE en este entorno** (idem T214).
- [ ] **T216** Verificar que **no se rompió nada** del spec 003 cerrado: re-correr la sección 008 de `e2e-selftest.mjs` completa (incluye: echoes de coexistence, sandbox, ventana 24 h, descarga in-process de media entrante, etc.) — sigue verde. **PENDIENTE en este entorno** (idem T214).

**Checkpoint**: la feature cumple todas las US del spec en código y tests unit. **E2E live pendiente** — el entorno actual no tiene app + mocks + BD levantados; este handoff debe correr `pnpm test:e2e` localmente antes de declarar READY punta a punta.

---

## Commit 2b — UX polish del composer y la cola (este commit, post-cierre)

**Propósito**: corte final de pulido de UX sin agregar capacidades nuevas.
Mejoras sobre la base cerrada en commits 0/1/2/2a para acercar la experiencia
diaria al nivel WhatsApp Web **manteniendo la identidad visual Atlas**.

- [x] **T2b01** [US6] Tarjeta horizontal compacta (160×112 px) con preview 88× a
  la izquierda e info + acciones a la derecha; mejor jerarquía visual.
- [x] **T2b02** [US1] Header de la cola con conteo inline ("3 adjuntos · 12 MB ·
  1/3 enviados") y `CheckCircle2` cuando todo está enviado.
- [x] **T2b03** [US5] Acción nueva `clearSent` para limpiar solo los `sent`
  preservando `pending`/`failed`. Botón "Limpiar enviados" visible cuando
  aplica.
- [x] **T2b04** [US4] Resumen `summarize(attachments)` puro y testeable:
  `total`, `sent`, `failed`, `pending`, `sending`, `blocked`. Label
  `progressLabel` para mostrar inline (3 variantes: pendiente / en curso /
  completo / con-error).
- [x] **T2b05** [US6] Navegación por teclado entre tarjetas: ←/→ cambia
  selección; Delete/Backspace elimina el adjunto (no en `sent`).
  Botones chevron visibles al hover/focus con área cliqueable ≥ 44 px.
- [x] **T2b06** [US2] Drop overlay con `UploadCloud` y conteo animado
  (`dragFilesHint`) + transición `animate-in fade-in zoom-in-95`.
- [x] **T2b07** [US4] Indicadores de estado mejorados: spinner con label
  "Enviando", check con label "Enviado" (no solo icono). Texto más
  explícito reduce ambigüedad del operador.
- [x] **T2b08** [US6] Toolbar buttons con `h-11 w-11` (≥ 44×44 px touch).
  Send button también 44×44. Foco del textarea se restaura al enviar.
- [x] **T2b09** [US1] Esc con textarea vacío y cola pendiente: limpia
  toda la cola (Object URLs revocadas). Con texto: no toca la cola.
- [x] **T2b10** [US1] Auto-focus del textarea tras `addFiles` (cuando
  el operador añade un archivo, el foco salta al textarea para que
  escriba el caption sin tab extra).
- [x] **T2b11** [US6] `aria-current="true"` en la tarjeta seleccionada;
  posición "1 de 3" en el aria-label para mejor lectura de pantalla.
- [x] **T2b12** Tests añadidos a `tests/unit/attachment-queue-reducer.test.ts`:
  `clearSent` (4 tests), `summarize` (3 tests), `progressLabel` (5 tests).
  Total tests del spec 004 ahora: 500.
- [x] **T2b13** `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
  verdes tras el corte 2b.

### Corte 2c — fix de comportamiento antes de E2E

Corte de corrección de comportamiento YA especificado. NO agrega
capacidades nuevas. Cubre cuatro ajustes detectados tras revisar la
implementación del corte 2b.

- [x] **T2c01** [US1, US4] `src/components/inbox/helpers.ts` — añadir
  `IMAGE_MAX = 5 MB` y `AUDIO_MAX = 16 MB` (espejo de `MEDIA_LIMITS.*`).
  `classifyForQueue` rechaza `image/*` y `audio/*` por encima del límite
  en cliente (mensaje claro vía `rejectionReason`), sin esperar al POST.
  Documentos siguen con `DOC_MAX = 100 MB`. El backend sigue siendo SoT.
- [x] **T2c02** [US1] `PendingAttachment` añade `captionOwner: boolean`
  y `captionConsumed: boolean`. `addFiles` fija `captionOwner=true` en
  el primer adjunto aceptable solo si la cola no tiene ya propietario
  (durable). Reducer añade acción `markCaptionConsumed` (idempotente,
  defensivo si el id no es `captionOwner`).
- [x] **T2c03** [US1, US4] `runQueueSend` deja de usar un contador local
  `captionConsumed`. Ahora decide a partir de
  `att.captionOwner && !att.captionConsumed` y, tras éxito del
  captionOwner, invoca `onCaptionConsumed(id)` para que la cola persista
  el flag. Retries posteriores respetan el estado durable (caption NO se
  re-envía con otros adjuntos; retry del propio captionOwner que falló
  SÍ conserva el caption).
- [x] **T2c04** [US1, US4] `src/components/inbox/attachment-queue.tsx` —
  nueva función pura `shouldAutoClearQueue(result, attempted)` (sin React,
  testeable). Decide true solo cuando: `failed===0 && sent>0 && !stillBlocked`.
  Hook expone `markCaptionConsumed` y la usa el composer vía
  `onCaptionConsumed` del `runQueueSend`.
- [x] **T2c05** [US4, US6] `composer.tsx` — `submitQueue` usa
  `shouldAutoClearQueue`. Si todo salió bien: llama `q.clearSent()`
  (revoca Object URLs de los sent y los quita), `setText("")`, devuelve
  foco al textarea. Ya NO requiere pulsar "Limpiar enviados" en el happy
  path (ese botón queda para estados parciales). Si hay adjuntos aún
  sin confirmar (video>16MB) o pendientes, NO se toca el textarea.
- [x] **T2c06** [US6] `composer.tsx` — `canSubmit` ya no se habilita por
  `panel !== null && !hasQueue`. Abrir el panel de location/contact sin
  texto ni adjuntos NO enciende el botón principal del textarea (que no
  ejecuta `submitLocation`/`submitContact`); esos paneles tienen su
  propio botón de envío.
- [x] **T2c07** [US1, US4] `composer.tsx` — `onlyBlocked` deja de
  considerar adjuntos con `status=sent` como bloqueantes. Solo se
  considera `onlyBlocked` cuando hay adjuntos `pending`/`failed` Y todos
  están bloqueados por `needsVideoAsDocumentConfirm`. Tras el cleanup
  automático, un texto nuevo puede enviarse sin residuos `sent`.
- [x] **T2c08** [US1] Tests añadidos en
  `tests/unit/attachment-queue-classify.test.ts`:
  - image > 5 MB rechazada en cliente
  - audio > 16 MB rechazado en cliente
  - video 16 MB < size <= 100 MB SIGUE ofreciéndose como document
  - document > 100 MB rechazado
  - fronteras inclusivas (5 MB exacto, 16 MB exacto)
  - las constantes cliente coinciden con `MEDIA_LIMITS` (guard).
- [x] **T2c09** [US4] Tests añadidos en
  `tests/unit/attachment-queue-run.test.ts`:
  - caption durable: primer enviado con caption + segundo failed + retry
    del segundo → caption NO repetido (segundo recibe null, consumed
    sigue siendo A).
  - caption durable: captionOwner FAILED → retry mantiene el caption.
  - runQueueSend respeta `captionConsumed=true` (defensivo).
  - `shouldAutoClearQueue`: true cuando todo sent sin bloqueos; false si
    hay failed / bloqueos / `sent===0`.
  - Composición: cola completa enviada → cleanup + texto inmediato
    habilitado (canSubmit=true con cola vacía y texto nuevo).
  - Regresión: adjuntos con `status=sent` NO bloquean el envío de texto
    nuevo (el `onlyBlocked` nuevo excluye sent).
- [x] **T2c10** [US1, US4] Tests añadidos en
  `tests/unit/attachment-queue-reducer.test.ts`:
  - `markCaptionConsumed` marca SOLO el captionOwner target.
  - `markCaptionConsumed` es no-op si el id no es captionOwner.
  - `markCaptionConsumed` es idempotente (doble aplicación no rompe).
  - `markCaptionConsumed` sobre id inexistente no lanza.
  - Tras `clearSent` la cola queda vacía y puede aceptar texto nuevo
    (canSubmit=true con texto no vacío).
- [x] **T2c11** [US1] Test existente
  `caption se aplica al primer adjunto intentado; los siguientes
  reciben null` actualizado para reflejar el nuevo contrato: ahora
  requiere `captionOwner: true` en el primer adjunto (la decisión ya no
  es por orden de iteración sino por el flag durable). Añadido test
  paralelo `caption nunca se aplica si nadie es captionOwner`.
- [x] **T2c12** `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
  verdes tras el corte 2c. Total tests: 522.

### Corte 2d — fix de comportamiento después del commit 0e7148c (regresiones detectadas)

Tres regresiones concretas detectadas al revisar el código desplegado.
NO agrega capacidades nuevas. NO toca backend de WhatsApp, límites,
video-as-document, transcodificación, voice recorder, storage/historial,
webhook ni Sales/WHMCS. Solo refina la lógica cliente del composer
y de la cola para alinearla con la rama de tests ya escrita en el corte
2c.

- [x] **T2d01** [US4] `composer.submit()` rama de decisión:
  - Regresión: `submit()` usaba `attachments.some(a => !a.needsVideoAsDocumentConfirm)`
    para detectar "hay adjuntos listos" antes de entrar a `submitQueue()`.
    Esto consideraba un attachment `status="sent"` como listo.
  - Caso: queda un `sent` residual en la cola → `readyToSend.length === 0` →
    el operador escribe texto → `canSubmit=true` → pulsa Enter →
    `submit()` entraba a `submitQueue()` (que retornaba porque
    `readyToSend` estaba vacío) → el texto NO se enviaba.
  - Fix: nueva helper pura `decideSubmitMode(attachments, text): "queue"|"text"|"noop"`
    en `attachment-queue.tsx`. `submit()` consulta `decideSubmitMode` y
    enruta a `submitQueue()` (queue), `onSend(value)` (text) o retorna
    (noop). El filtro interno es `!needsVideoAsDocumentConfirm &&
    (status==="pending" || status==="failed")` — mismo que
    `readyToSend`, así el botón y la rama de submit nunca se contradicen.
  - Sent residual ahora va correctamente a `"text"`.
- [x] **T2d02** [US4] Cleanup del happy path:
  - Regresión: `submitQueue()` capturaba `const q = queueRef.current`
    antes de `runQueueSend`. Después llamaba `q.clearSent()`. El callback
    `clearSent` (que filtra por `status === "sent"`) capturó el estado
    anterior al envío, donde los attachments todavía estaban `pending`;
    su loop de `URL.revokeObjectURL` no revocaba nada aunque el reducer
    luego eliminase los sent → Object URLs huérfanas.
  - Fix: en el happy path (`shouldAutoClearQueue === true`) `submitQueue`
    llama `q.clear()` en lugar de `q.clearSent()`. `clear()` revoca TODAS
    las previews del closure (no solo sent), garantizando cero URLs
    huérfanas. Como bonus, los callbacks `clear`/`clearSent`/`remove`
    del hook ahora leen de `attachmentsRef.current` (deps=[]) para que
    sean estables y robustos frente a capturas obsoletas en escenarios
    async. Nueva helper pura `revokeAllPreviews(attachments): number`
    encapsula la semántica "revocar sin filtrar por status", testeable.
- [x] **T2d03** [US4] Transferencia de `captionOwner` al eliminar el owner:
  - Regresión: si la cola era `[A (captionOwner, !captionConsumed), B, C]`
    y el operador eliminaba A antes de enviar, B quedaba sin
    `captionOwner` y el caption se perdía.
  - Fix: la acción `remove` del reducer (vía helper exportada
    `applyRemoveWithCaptionTransfer`) ahora:
    1. Si el eliminado NO era captionOwner, o su caption YA se había
       consumido (`captionConsumed=true`), lo quita sin transferir.
    2. Si era captionOwner con caption aún NO consumido, lo quita y
       transfiere `captionOwner=true` al primer adjunto restante sin
       `captionOwner` (manteniendo `captionConsumed=false`).
    3. Si no queda ningún candidato (cola de un solo elemento), lo
       quita sin transferir.
  - Coherencia con `runQueueSend`: tras la transferencia, el caption
    viaja con el nuevo owner exactamente una vez.
- [x] **T2d04** Tests añadidos en `tests/unit/attachment-queue-run.test.ts`:
  - `decideSubmitMode` × 10 casos (cola vacía, sent residual,
    bloqueado por video→document, mezcla bloqueado+listo, solo
    sending, consistencia con `canSubmit`).
  - `runQueueSend` × integración con `applyRemoveWithCaptionTransfer`
    × 2 casos (caption viaja exactamente una vez con el nuevo
    owner; eliminar owner consumido NO reasigna y el retry del
    siguiente NO viaja caption).
- [x] **T2d05** Tests añadidos en `tests/unit/attachment-queue-reducer.test.ts`:
  - `applyRemoveWithCaptionTransfer` × 8 casos (owner no consumido
    transfiere, owner consumido no transfiere, eliminar no-owner no
    afecta, cola de 1, id inexistente no-op, selectedId cleanup,
    preservación de orden/flags, delegación coherente con `queueReducer`).
  - `revokeAllPreviews` × 4 casos (revoca todos sin filtrar status,
    ignora sin previewUrl, lista vacía, regresión "filtro por status
    dejaría huérfanas").
- [x] **T2d06** `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
  verdes tras el corte 2d. Total tests: 546 (522 + 24 nuevos).

### Corte 2e — últimos 3 edge cases del cliente (este commit)

Tres regresiones finas detectadas al releer el código tras el corte 2d.
NO agrega capacidades nuevas. NO toca backend, WhatsApp sender,
límites, video-as-document backend, storage, historial,
transcodificación, voice recording, Sales/WHMCS. Solo refina la
lógica cliente del composer y la cola.

#### Fix 1 — `decideSubmitMode` desactiva envío de texto cuando todo está bloqueado

- [x] **T2e01** [US4] `decideSubmitMode` extendido:
  - Regla nueva: si existe al menos un attachment pending/failed pero
    TODOS están bloqueados por `needsVideoAsDocumentConfirm`, el modo
    es `"noop"` (no se envía ni cola ni texto).
  - Antes del fix: `decideSubmitMode([blocked], text)` devolvía `"text"`.
    El botón Enviar estaba visualmente deshabilitado (`canSubmit=false`
    con `onlyBlocked=true`) pero Enter llamaba `submit()` directamente,
    que seguía la rama "text" y enviaba el textarea sin que el operador
    hubiera confirmado o quitado el adjunto bloqueado.
  - Sent residual NO entra en esta regla: si solo quedan sent, no hay
    pending/failed pendientes y la rama es `"text"` (corte 2d intacto).
  - Unificación botón ↔ Enter: ambos consultan exactamente el mismo
    filtro (`readyToSend.length > 0 || (text && !onlyBlocked)`), así
    que ya no pueden contradecirse.

#### Fix 2 — `applyRemoveWithCaptionTransfer` salta `sent`/`sending`

- [x] **T2e02** [US4] `applyRemoveWithCaptionTransfer` refinado:
  - Candidato válido para heredar `captionOwner`: status `pending` o
    `failed`, NO captionOwner, y con `captionConsumed=false` (lo que
    se infiere del hecho de que se transfiere).
  - `needsVideoAsDocumentConfirm=true` NO excluye al candidato: el
    adjunto está temporalmente bloqueado pero podrá enviarse tras la
    confirmación y debe poder recibir el caption exactamente una vez.
  - Nunca transferir a `sent` ni `sending` (son terminales, ya no
    recibirán un futuro envío).
  - Si no hay candidato (todos los restantes son sent/sending), se
    quita sin transferir — el caption queda perdido por diseño (no
    puede viajar con nadie que ya esté enviado).

#### Fix 3 — Bloquear mutaciones de la cola durante `sending=true`

- [x] **T2e03** [US1, US4] Nuevo helper puro `canMutateQueue(sending)`
  exportado desde `attachment-queue.tsx`. Punto único de consulta
  para todos los handlers que mutan la cola.
  - `composer.ingestFiles`: si `!canMutateQueue(sending)` → no-op
    (igual limpia el `<input type="file">` para que pueda
    re-seleccionarse el mismo archivo cuando termine el envío).
  - `composer.handleDragEnter`/`handleDragOver`/`handleDrop`: durante
    sending, ni siquiera muestran el overlay; el drop se consume sin
    invocar `ingestFiles`.
  - `composer.onPaste` (archivos del clipboard): durante sending, no
    se hace `preventDefault` — el navegador ignora los archivos y el
    texto del clipboard sí se pega normalmente.
  - `composer.fileRef.onChange`: durante sending, no se aceptan
    archivos del picker; se limpia el valor del input.
  - Botón Paperclip (adjuntar): `disabled={sending}`.
  - `AttachmentItem`: nueva prop `disabled` que deshabilita X (remove),
    Reintentar y Enviar como documento; además bloquea Delete/Backspace.
  - `AttachmentQueueList`: nueva prop `disabled` que deshabilita
    "Limpiar enviados" y "Limpiar todo", y se propaga a cada item.

- [x] **T2e04** Tests añadidos en `tests/unit/attachment-queue-run.test.ts`:
  - `decideSubmitMode` × 5 casos nuevos: blocked + texto → `"noop"`
    (FIX-1); sent residual + texto → `"text"` (FIX-1 confirmación);
    sent + blocked + texto → `"noop"` (FIX-1); sent + blocked + ready
    → `"queue"` (FIX-1); blocked + failed no bloqueado → `"queue"`
    (FIX-1).
  - Test de consistencia `decideSubmitMode` ↔ `canSubmit` actualizado
    para reflejar el filtro nuevo (FIX-1). Nuevo test "FIX-1
    consistencia: cola con solo bloqueado + texto → botón y Enter
    ambos deshabilitados".
  - `runQueueSend` × integración con `applyRemoveWithCaptionTransfer`
    saltando sent × 2 casos: A owner failed + B sent + C failed → C
    se vuelve owner y retry de C recibe caption exactamente una vez;
    A owner + B sent únicamente → nadie hereda captionOwner y
    runQueueSend omite B (sent).

- [x] **T2e05** Tests añadidos en `tests/unit/attachment-queue-reducer.test.ts`:
  - `applyRemoveWithCaptionTransfer` × 5 casos nuevos: A owner + B
    sent + C failed → C se vuelve owner (B se salta); A owner + B
    sent únicamente → nadie owner (FIX-2); A owner + B sending + C
    pending → C se vuelve owner (B sending se salta); blocked con
    `needsVideoAsDocumentConfirm=true` SIGUE siendo candidato válido
    para heredar captionOwner (FIX-2 confirmación); sent primero +
    pending después → la búsqueda lineal salta el sent.
  - `canMutateQueue` × 2 casos: `sending=false` → true,
    `sending=true` → false.

- [x] **T2e06** `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
  verdes tras el corte 2e. Total tests: 560 (546 + 14 nuevos).

**PENDIENTE fuera del entorno actual**:
- `pnpm test:e2e` (sección 009) en vivo con app + mocks + BD.
- Playwright visual con `tests/e2e/009-inbox-messaging-ux.md`.

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