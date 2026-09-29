<!--
SYNC IMPACT REPORT
==================
Versión: draft (no amendment of constitution required).
Este spec NO modifica la constitución ni plantillas dependientes.
NO reabre el spec 003 cerrado (paridad de inbox): amplía la UX del composer
existente sin tocar el sender, el endpoint ni el webhook.
-->

# Feature Specification: UX de mensajería del inbox — cola de adjuntos, drag & drop, paste (004-inbox-messaging-ux)

**Feature Branch**: `feat/004-inbox-messaging-ux`
**Created**: 2026-09-29
**Status**: Draft
**Input**: descripción del dueño — acercar la experiencia diaria de envío de adjuntos del inbox a WhatsApp Web sin reescribir el sender ni introducir arquitectura nueva.

---

## Resumen

Mejorar la experiencia del composer de adjuntos del inbox sin tocar el sender, el endpoint, el webhook ni el esquema de datos. La feature se entrega como una nueva **cola de adjuntos client-side** que:

1. Acepta archivos de **tres formas**: arrastrar y soltar sobre el área de conversación, pegar desde portapapeles (Ctrl/Cmd+V), y selección múltiple con el `<input type="file" multiple>` existente.
2. Muestra una **cola visual** con preview individual por tipo (imagen ampliable, video/audio reproducibles en navegador, tarjeta para documento) encima del textarea, estilo WhatsApp Web.
3. Permite **eliminar o reintentar** cada adjunto individualmente antes y después del envío.
4. Envía los adjuntos **secuencialmente** reutilizando `POST /api/conversations/:id/messages/media` y `sendMediaMessage` — **un fallo individual no aborta la cola**.
5. Maneja el caso real de **video entre 16 MB y 100 MB**: WhatsApp Cloud API lo rechaza como video pero lo acepta como documento. El cliente detecta esto, lo re-taggea como `application/octet-stream` (manteniendo el nombre original) y muestra un aviso explícito "Se enviará como documento".
6. **Respeta íntegramente** los límites existentes: imagen 5 MB, audio/video 16 MB, documento 100 MB. El servidor sigue siendo la fuente de verdad de la validación.

## Contexto y motivación

El composer actual (`src/components/inbox/composer.tsx`) envía **un único adjunto por vez**:

- `<input type="file">` sin `multiple`.
- Estado local de **un solo** `File` (`useState<File | null>`).
- Sin drag & drop ni paste.
- Sin preview de video/audio local (la preview actual es solo `<img>` si el MIME empieza por `image/`).
- Sin estado por adjunto, sin retry, sin anti-doble-envío.

El sender (`src/server/inbox/send.ts → sendMediaMessage`) y el endpoint (`/api/conversations/:id/messages/media`) ya manejan bien **un** adjunto: validación previa (FR-007/008), persistencia durable en disco, upload a Graph, send y persistencia del mensaje saliente — incluso degradando con `failed` visible si Graph falla después de dejar el asset en disco.

Lo que falta es la **capa de UX** que pide el dueño: arrastrar 3 archivos y que el operador vea una cola, vea el progreso, y vea qué pasó con cada uno. Esa capa es 100% estado local del cliente; no toca el backend.

## User Scenarios & Testing

### User Story 1 — Cola visual con preview por tipo (Priority: P1)

Como operador, al adjuntar varios archivos veo una mini-cola encima del textarea con preview individual por tipo: miniatura ampliable para imágenes, reproductor local para video/audio compatible, tarjeta con nombre y tamaño para documentos. Puedo eliminar cualquier adjunto antes de enviar, y al enviar todos se procesan secuencialmente.

**Why this priority**: Es el corazón del pedido del dueño — la cola visible. Sin esto la feature no entrega valor.

**Independent Test**: Seleccionar 3 archivos (jpeg, mp4 corto, pdf de 5 MB) en el picker; verificar que aparecen 3 tarjetas con su preview correcto; eliminar uno y verificar que los otros 2 permanecen; enviar y verificar 3 mensajes salientes en el hilo.

**Acceptance Scenarios**:

1. **Given** el composer abierto con la ventana de 24 h abierta, **When** selecciono 2 archivos en el picker, **Then** aparecen 2 tarjetas en la cola con su preview, nombre y tamaño; el texto del textarea queda como caption opcional.
2. **Given** la cola con 3 adjuntos, **When** elimino el del medio, **Then** la cola muestra 2 tarjetas y el archivo eliminado se descarta limpiamente (Object URL revocado).
3. **Given** la cola con 3 adjuntos, **When** pulso Enviar, **Then** los 3 mensajes se publican secuencialmente; cada tarjeta refleja su estado (pendiente → enviando → enviado).
4. **Given** una tarjeta con preview de imagen, **When** hago click sobre ella, **Then** la imagen se ve ampliada (lightbox o target=_blank) sin perder la cola.

### User Story 2 — Drag & drop y paste desde portapapeles (Priority: P1)

Como operador, puedo arrastrar archivos sobre el área de conversación y soltarlos, o pegarlos con Ctrl+V/Cmd+V. Mientras arrastro, veo un overlay claro "Suelta para adjuntar".

**Why this priority**: Acelera el flujo diario (es lo que hace WhatsApp Web) y elimina pasos.

**Independent Test**: Arrastrar un jpeg desde el explorador del sistema sobre el panel derecho; verificar overlay durante el drag y adición a la cola al soltar. Pegar una imagen con Ctrl+V sobre el textarea; verificar adición a la cola.

**Acceptance Scenarios**:

1. **Given** el inbox abierto en una conversación, **When** arrastro un archivo sobre el panel de mensajes, **Then** aparece un overlay dashed "Suelta para adjuntar" durante el arrastre.
2. **Given** el overlay visible, **When** suelto el archivo, **Then** se añade a la cola y el overlay desaparece.
3. **Given** el foco en el textarea, **When** pulso Ctrl+V con una imagen en el portapapeles, **Then** la imagen se añade a la cola y el texto pegado (si lo hay) se inserta normalmente solo si NO es una imagen.
4. **Given** el foco en el panel de detalles (no en el composer), **When** arrastro un archivo, **Then** también funciona el drop (la dropzone es el panel derecho completo, no solo el composer).
5. **Given** un drop con un tipo de archivo no soportado, **When** suelto, **Then** veo un mensaje inline "Tipo de archivo no soportado" y la cola no cambia.

### User Story 3 — Video grande enviado como documento (Priority: P2)

Como operador, si arrastro un video de, p. ej., 30 MB (entre el límite de video 16 MB y el de documento 100 MB), el sistema me avisa claramente que se enviará como documento (no como video inline) y aplica el cambio de MIME en el envío.

**Why this priority**: Caso real y frecuente (videos cortos del celular). Sin esto el operador pierde el archivo porque el servidor rechaza el video > 16 MB.

**Independent Test**: Arrastrar un mp4 de 30 MB; verificar que la tarjeta muestra el badge "Se envía como documento"; enviar y verificar que el mensaje saliente llega a Graph como `type=document`, no como `type=video`.

**Acceptance Scenarios**:

1. **Given** un video mp4 de 30 MB, **When** lo arrastro al composer, **Then** la tarjeta muestra el icono de documento y un badge "Se envía como documento (30 MB)" en lugar de reproductor de video.
2. **Given** esa misma tarjeta, **When** envío, **Then** el endpoint recibe un `File` con MIME `application/octet-stream` y el nombre original (`clip.mp4`); el servidor lo clasifica como `document` por `kindFromMime`; el mensaje sale en el hilo como `type=document`.
3. **Given** un video de 6 MB, **When** lo arrastro, **Then** la tarjeta muestra reproductor de video local (≤ 16 MB → video normal).
4. **Given** un video de 120 MB, **When** lo arrastro, **Then** la cola lo rechaza con mensaje "Excede el límite de 100 MB" (límite duro de documento) y NO lo añade.
5. **Given** un video de 30 MB enviado correctamente como documento, **When** abro el mensaje en el hilo, **Then** el preview es la tarjeta de documento con icono y nombre, no un `<video>`.

### User Story 4 — Estados por adjunto, error individual y reintento (Priority: P1)

Como operador, cada adjunto muestra su estado (pendiente / enviando / enviado / error). Si uno falla, veo el motivo que devolvió el servidor y un botón de reintento; los demás adjuntos siguen su camino.

**Why this priority**: Sin retry el operador tiene que empezar de cero con un archivo fallido; sin estados no sabe qué pasó.

**Independent Test**: Forzar un fallo en el segundo de 3 adjuntos (p. ej. tamaño > 16 MB para video normal); enviar; verificar que el primero sale `sent`, el segundo `failed` con mensaje y botón de reintento, el tercero `sent`. Pulsar reintento tras corregir el archivo y verificar que solo ese vuelve a enviarse.

**Acceptance Scenarios**:

1. **Given** la cola con 3 adjuntos, **When** envío y el segundo falla (p. ej. 413 del servidor), **Then** la tarjeta del segundo muestra borde rojo, el mensaje del servidor ("El archivo excede el límite de …") y un botón "↻ Reintentar"; los otros dos quedan `sent`.
2. **Given** una tarjeta en `failed`, **When** pulso "Reintentar", **Then** solo ese adjunto pasa a `pending → sending`; los demás no se reenvían.
3. **Given** una tarjeta en `sent`, **When** intento reintento, **Then** no hay botón de reintento (estado terminal de éxito).
4. **Given** la ventana de 24 h cerrada mientras envío la cola, **When** llega el turno del tercer adjunto, **Then** ese tercero falla con `window_closed` (mismo `SendError` que el texto); los dos primeros mantienen su estado.

### User Story 5 — Anti doble-envío y limpieza de Object URLs (Priority: P1)

Como operador, hago doble click rápido en "Enviar" y la cola no se duplica. La UI no me deja disparar un envío mientras hay adjuntos `pending`/`sending`. Al desmontar el composer o cambiar de conversación, las dev tools del navegador muestran 0 Object URLs del tipo `blob:` creados por el composer.

**Why this priority**: Bug frecuente en UI de chat; memory leak visible.

**Independent Test**: Doble click rápido en Enviar con cola de 2 adjuntos; verificar que el primer adjunto se envía exactamente 1 vez y el segundo 1 vez. Cerrar la conversación y volver a abrirla; en devtools, 0 Object URLs vivos del composer anterior.

**Acceptance Scenarios**:

1. **Given** cola de 2 adjuntos, **When** hago doble click en Enviar, **Then** se procesa la cola 1 vez (2 mensajes al backend), no 2 veces (4 mensajes).
2. **Given** envío en curso, **When** el botón se vuelve a pulsar (ratón, teclado o programático), **Then** el handler corta antes de iniciar otro loop.
3. **Given** una tarjeta con preview, **When** la elimino, **Then** su Object URL se revoca (`URL.revokeObjectURL`).
4. **Given** el composer montado, **When** se desmonta (cambio de conversación o navegación), **Then** todas las Object URLs activas se revocan en el cleanup de `useEffect`.

### User Story 6 — Accesibilidad y responsive (Priority: P2)

Como usuario de teclado, puedo tabular por la cola, eliminar y enviar. Un lector de pantalla anuncia el estado de cada tarjeta al cambiar. En móvil la cola es utilizable: scroll horizontal, touch targets ≥ 44px, sin texto cortado.

**Why this priority**: Cumplimiento de la constitución (accesibilidad básica) y uso en tablet/celular del operador.

**Independent Test**: Con teclado, tabular al composer, abrir picker, eliminar un adjunto, enviar. Reducir el viewport a 375 px y verificar que la cola permite scroll horizontal y los botones X/Retry son tocables.

**Acceptance Scenarios**:

1. **Given** el foco en el composer, **When** tabulo, **Then** paso por el botón de adjuntar, el textarea y el botón Enviar sin trampas; las tarjetas son accesibles por Tab.
2. **Given** una tarjeta en `failed`, **When** un lector de pantalla la inspecciona, **Then** anuncia "Adjuntar imagen, foto.jpg, 1.2 MB, error: el archivo excede el límite, botón Reintentar".
3. **Given** viewport 375 px, **When** la cola tiene 4 adjuntos, **Then** se ve scroll horizontal; cada tarjeta es ≥ 100 px de ancho y los botones X/Retry ≥ 44×44 px.

### Edge Cases

- **Drag con tipo no soportado** (p. ej. `.exe` con MIME no estándar): rechazado con mensaje inline, cola intacta.
- **Drop con archivos Y texto** (un drop "normal" del sistema que mezcla un archivo con texto): solo los archivos se añaden a la cola; el texto no se inserta en el textarea.
- **Paste de texto + imagen** simultáneamente: el texto va al textarea; la imagen va a la cola. No se pierde nada.
- **Recepción de un nuevo mensaje (SSE) mientras envío la cola**: el SSE `message.new` se renderiza en el hilo como cualquier otro; no interfiere con la cola.
- **Cambio de conversación con cola activa**: la cola se descarta y todas sus Object URLs se revocan; el caption se descarta. El operador debe re-queuear si vuelve a esa conversación (decisión: estado local no se persiste por conversación — es ephemeral por diseño).
- **Conversación `is_test` (sandbox del Laboratorio)**: cualquier adjunto añadido a la cola sigue el mismo camino: el endpoint devuelve 403 `sandbox_violation` y cada adjunto queda `failed` con ese mensaje. La cola no toca disco ni Graph. Cobertura ya existente en `tests/unit/send-sandbox.test.ts` y `tests/unit/media-send.test.ts`.

## Requirements

### Functional Requirements

- **FR-1**: el composer mantiene un estado local `attachments: PendingAttachment[]` (array, no un único File). Cada elemento lleva `{ id, file, previewUrl?, kind, effectiveMime, willSendAsDocument, status, error }`.
- **FR-2**: el `<input type="file">` cambia a `multiple`. Mantiene el `accept` por defecto (cualquier tipo).
- **FR-3**: el área del composer (y, opcionalmente, el `MessageThread` contenedor) acepta `onDragOver` / `onDrop` con `e.preventDefault()`. Mientras `dragOver`, se muestra un overlay absolute con borde dashed "Suelta para adjuntar archivos".
- **FR-4**: el composer escucha `onPaste` (en el textarea y/o en el wrapper); inspecciona `e.clipboardData.items`, añade los de `kind === "file"`. Si hay también texto, se inserta en el textarea.
- **FR-5**: previews por `kind`:
  - `image` → `<img>` con `URL.createObjectURL(file)` (mismo patrón actual).
  - `video` → `<video controls preload="metadata">` con el Object URL.
  - `audio` → `<audio controls preload="metadata">` con el Object URL.
  - `document` → tarjeta con icono + nombre truncado + tamaño formateado (`formatBytes` ya existe en `helpers.ts`).
- **FR-6**: si `file.type` empieza por `video/` y `file.size > 16 MB` y `≤ 100 MB`, el adjunto entra a la cola con `kind="document"`, `effectiveMime="application/octet-stream"`, `willSendAsDocument=true` y un badge "Se envía como documento (NN MB)" en lugar del reproductor. El `file.name` se preserva.
- **FR-7**: el botón Enviar recorre la cola secuencialmente (`for await`) y para cada adjunto llama a `POST /api/conversations/:id/messages/media` con `FormData` (`file`, opcionalmente `caption`). El servidor sigue siendo la fuente de verdad de la validación.
- **FR-8**: caption (texto del textarea) se aplica **solo al primer adjunto** enviado (alineado con WhatsApp Web: cada media lleva su caption; al enviar varios sin caption por media, el texto del textarea actúa como caption del primero y se descarta para los siguientes). El servidor ya descarta caption para `kind === "audio"` (ver `sendMediaMessage`).
- **FR-9**: el bucle de envío continúa tras un fallo individual: el adjunto fallido queda con `status="failed"` y `error=<mensaje del servidor>`; el siguiente adjunto se intenta igualmente.
- **FR-10**: cada adjunto `failed` muestra un botón "↻ Reintentar" que vuelve a ponerlo en `pending`; el próximo ciclo de Enviar lo procesa.
- **FR-11**: el botón Enviar está deshabilitado si la cola está vacía y el texto está vacío, **o** si hay algún adjunto en `pending`/`sending`. Un `useRef` adicional blinda contra clicks programáticos concurrentes.
- **FR-12**: cada `URL.createObjectURL` se empareja con un `URL.revokeObjectURL` en: remove manual del adjunto, transición a `sent` (tras éxito), y `useEffect` cleanup al desmontar el componente.
- **FR-13**: accesibilidad — dropzone con `role="region"` y `aria-label`; cada tarjeta con `role="listitem"` y `aria-label` dinámico (tipo + nombre + tamaño + estado + acción disponible); botones de eliminar/reintentar con `aria-label` específico; `aria-live="polite"` en el contenedor de la cola para anunciar cambios de estado.
- **FR-14**: responsive — la cola es una fila horizontal con `overflow-x-auto`; cada tarjeta `min-w-[100px] max-w-[140px]`; botones X y Retry `min-h-[44px] min-w-[44px]`.
- **FR-15**: pre-validación cliente (soft, no reemplaza al servidor): si el archivo excede 100 MB o su MIME no pasa `kindFromMime`, se muestra un toast inline y NO se añade a la cola.

### Non-Functional Requirements / Invariantes

- **NF-1**: NO se reescribe `sendMediaMessage`, NO se crea un endpoint batch, NO se modifica el contrato del endpoint `/api/conversations/:id/messages/media` salvo el MIME que el cliente elige enviar (ya soportado por `MEDIA_LIMITS.document.mimes` = `^[\w.-]+\/[\w.+-]+$`).
- **NF-2**: el sandbox del Laboratorio sigue siendo infranqueable (FR-031, ya cubierto en `tests/unit/send-sandbox.test.ts` y `tests/unit/media-send.test.ts`). Las conversaciones `is_test` devuelven 403 `sandbox_violation` antes de cualquier llamada a Graph o disco.
- **NF-3**: tenant isolation intacto: el endpoint sigue exigiendo `organization_id`; la cola es estado puramente local.
- **NF-4**: ventana de 24 h intacta: el `prepareSend` compartido se ejecuta para cada adjunto. Si la ventana se cierra a mitad del envío, los adjuntos restantes fallan con `window_closed` como un adjunto normal; los ya enviados conservan su estado `sent`.
- **NF-5**: idempotencia de webhooks intacta (no tocamos `webhook.ts`, `media.ts` salvo lectura).
- **NF-6**: `MEDIA_DIR`, persistencia y volúmenes intactos.
- **NF-7**: constitución II — sin S3/R2, sin email, sin Stripe, sin nuevos servicios externos. Sin nuevas dependencias npm.

### Key Entities (sin cambios de schema)

- **`PendingAttachment`** (estado local cliente, no persistido): cola ephemeral de adjuntos en el composer.
- **`media_asset`** (existente): cada adjunto enviado se persiste aquí como hasta ahora; la cola no introduce campos nuevos.
- **`message`** (existente): cada adjunto enviado produce un `message` saliente como hasta ahora.

## Success Criteria

- **SC-1**: un operador arrastra 3 archivos (jpeg 1 MB, mp4 30 MB, pdf 5 MB) sobre el panel de conversación; ve el overlay durante el arrastre, suelta, ve 3 tarjetas (la del mp4 con badge "Se envía como documento"), y al enviar los 3 mensajes aparecen en el hilo en orden.
- **SC-2**: en un envío de 3 adjuntos, si el segundo falla por exceder el límite del servidor (caso simulado: `validateOutgoing` lanza `too_large` para el segundo), el primero queda `sent`, el segundo `failed` con el mensaje exacto del servidor y botón Reintentar, el tercero `sent`. La conversación posterior muestra exactamente 2 mensajes salientes y el operador ve el motivo del fallo.
- **SC-3**: doble click rápido en "Enviar" con cola de 2 archivos → solo se envía el primero una vez, luego el segundo una vez (verificable contando mensajes en el hilo y requests al endpoint).
- **SC-4**: al cambiar de conversación, las dev tools del navegador muestran 0 Object URLs vivos (`blob:`) creados por el composer anterior.
- **SC-5**: con teclado, tabular al composer, abrir picker, eliminar un adjunto, enviar — todo sin ratón. Un lector de pantalla anuncia el estado de cada tarjeta al cambiar.
- **SC-6**: un video de 6 MB sigue siendo aceptado como video (≤ 16 MB) — el límite de video NO se relaja en servidor.
- **SC-7**: una conversación `is_test` devuelve 403 `sandbox_violation` al enviar cualquier adjunto; ningún asset se crea en disco; ningún `graphRequest` se invoca.
- **SC-8**: en viewport 375 px, la cola de 4 adjuntos permite scroll horizontal y los botones X/Retry son tocables (≥ 44×44 px).

## Assumptions

- El operador usa un navegador moderno (Chrome/Firefox/Safari reciente) con soporte para `DataTransfer.files`, `clipboardData.items` y `URL.createObjectURL`.
- El uso principal es desktop; el responsive cubre tablet y revisión ocasional desde celular, no es objetivo primario de UX.
- "Video como documento" se aplica **solo** a videos entre 16 MB y 100 MB (no a audios ni imágenes grandes — esos siguen su categoría nativa).
- El endpoint `/api/conversations/:id/messages/media` sigue aceptando un único `file` por request; el cliente itera. No se introduce un endpoint multi-file.

## Fuera de alcance explícito

- Grabación de notas de voz desde el navegador (`MediaRecorder`, `getUserMedia`).
- Transcodificación de audio o video (ffmpeg u otro).
- Thumbnails generados server-side.
- Cambiar `MEDIA_DIR`, persistencia o volúmenes.
- S3 / R2 / almacenamiento externo.
- Nuevas dependencias npm (la feature se entrega con React + DOM APIs estándar).
- Reescribir el sender, el endpoint, el webhook, `media.ts`.
- Modificar Sales Orchestrator, follow-ups, WHMCS.
- Cola persistente entre conversaciones o entre sesiones (la cola es ephemeral por diseño).
- Editor de imágenes / cropping antes de enviar.

## Verificación (Definition of Done)

1. `pnpm typecheck && pnpm lint && pnpm build && pnpm test` verdes.
2. Tests unit nuevos en `tests/unit/` para la lógica de cola (`classifyForQueue`, máquina de estados, cleanup de Object URLs, anti-doble-envío).
3. Sección **009 — UX de mensajería** añadida a `scripts/e2e-selftest.mjs` ejercitando el contrato que asume la cola (3 adjuntos secuenciales, uno falla, los otros pasan; video >16 MB como documento con MIME ajustado; caption solo en el primero). Esta sección valida que el **backend** soporta la cola — la UI se valida con Playwright manual.
4. `tests/e2e/009-inbox-messaging-ux.md` con los pasos visuales de Playwright (drag, paste, retry, cleanup).
5. Self-test E2E ejecutado en `localhost` con `WA_MOCK_ENABLED=true`, `MEDIA_DIR` local y PostgreSQL fresco. Reglas duras del PrincipIO IX: solo destinatarios de allowlist, sin ráfaga, volumen mínimo.
6. Manual: con la app viva, arrastrar 3 archivos reales, verificar visual.

## References

- `AGENTS.md` — orden de lectura obligatorio y Definition of Done.
- `.specify/memory/constitution.md` — principios no negociables (especialmente II, IV, V, IX).
- `docs/CURRENT_STATE.md` §4 — base WhatsApp madura; regla "no reescribir webhook/inbox/sender salvo bug real o spec nuevo".
- `specs/003-paridad-inbox-whatsapp/spec.md` — base cerrada que esta feature amplía.
- `src/components/inbox/composer.tsx` — composer actual.
- `src/server/inbox/send.ts` — `sendMediaMessage` y `SendError`.
- `src/server/whatsapp/media.ts` — `MEDIA_LIMITS`, `validateOutgoing`, `kindFromMime`.
- `src/app/api/conversations/[id]/messages/media/route.ts` — endpoint que se reutiliza.
- `tests/unit/media-send.test.ts`, `tests/unit/send-sandbox.test.ts` — cobertura existente que sigue aplicando.
- `tests/e2e/008-paridad-inbox.md` — patrón de guion a seguir para `tests/e2e/009-...md`.