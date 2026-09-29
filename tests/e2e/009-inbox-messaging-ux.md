# E2E 009 — UX de mensajería del inbox (cola de adjuntos)

Guion de comportamiento (Constitución IX). La parte automatizada vive en la
sección "009" de `scripts/e2e-selftest.mjs` (app con `WA_MOCK_ENABLED=true`,
BD fresca, `MEDIA_DIR` local); este archivo documenta el mapeo a los AC del
spec `004-inbox-messaging-ux` y los pasos visuales de Playwright.

La parte automatizada valida que el **backend** soporta el contrato que la
cola asume (mensajes secuenciales, override `kind=document`, sandbox,
caption solo en el primero). La **UI** se valida visualmente con Playwright
siguiendo la sección "Pasos visuales" más abajo.

## US1 — Cola visual con preview por tipo (automatizado en 009 + visual)

| AC | Check del selftest / Playwright |
|---|---|
| AC-1 seleccionar varios archivos → varias tarjetas con preview correcto | Playwright: abrir picker, seleccionar 3 archivos, ver 3 tarjetas con preview por tipo |
| AC-2 eliminar uno antes de enviar | Playwright: hover en tarjeta, clic en X, ver tarjeta desaparecer |
| AC-3 envío secuencial refleja estados por tarjeta | Selftest 009 AC-1: 3 mensajes salientes en orden; visual: spinner → check verde |
| AC-4 preview ampliable de imagen | Playwright: clic en tarjeta de imagen, abrir en pestaña nueva / modal |

## US2 — Drag & drop y paste desde portapapeles (visual)

| AC | Check |
|---|---|
| AC-1 drag sobre panel muestra overlay "Suelta para adjuntar" con conteo | Playwright: simular `dragenter` con un File; ver overlay con `UploadCloud` y "X archivos detectados" |
| AC-2 drop añade a la cola y desaparece overlay | Playwright: simular `drop`; ver tarjeta nueva y overlay oculto |
| AC-3 Ctrl+V con imagen en portapapeles añade a la cola | Playwright: copiar imagen, foco en textarea, pegar, ver tarjeta añadida |
| AC-4 drop también funciona en message thread | (cubierto en implementación solo sobre el composer por scope mínimo) |
| AC-5 tipo no soportado → toast inline | Playwright: drop de un `.exe`, ver mensaje "Tipo de archivo no soportado" |

## US3 — Video grande enviado como documento (automatizado en 009)

| AC | Check del selftest |
|---|---|
| AC-1 video 30 MB → tarjeta con banner "Excede 16 MB de video. ¿Enviar como documento?" | Playwright visual |
| AC-2 envío tras confirmación → `kind=document` con MIME `application/octet-stream` | Selftest 009 AC-2: outbox `type=document` con filename original |
| AC-3 video 6 MB sigue siendo video (≤16 MB) | Selftest 008 US2 (límite del servidor sin cambios) |
| AC-4 video 120 MB → 413 desde el servidor | Selftest 009 AC-4: 413 too_large |
| AC-5 el mensaje sale como `type=document`, no `type=video` | Selftest 009 AC-2: outbox `type=document` |

## US4 — Estados por adjunto, error individual y reintento (automatizado + visual)

| AC | Check |
|---|---|
| AC-1 cola de 3, segundo falla → segundo `failed` con mensaje + botón Reintentar | Selftest 009 AC-3: dos mensajes en el hilo + el 2º queda en estado de fallo con el mensaje exacto del servidor |
| AC-2 Reintentar solo reenvía ese adjunto | Playwright: clic en Reintentar, ver spinner solo en esa tarjeta |
| AC-3 `sent` no tiene botón de reintento | Playwright: tarjeta enviada sin botón Reintentar (X opcional) |
| AC-4 ventana cerrada durante envío → `window_closed` por adjunto | (cubierto por `prepareSend`; el bucle aplica el mismo error por adjunto) |

## US5 — Anti doble-envío y limpieza de Object URLs (automatizado + manual)

| AC | Check |
|---|---|
| AC-1 doble click en Enviar → exactamente N mensajes al backend | Selftest 009 AC-1: count de outbox = adjuntos, no el doble |
| AC-2 segundo click cortado por la capa lógica (`useRef`) | Selftest 009 AC-1bis (test unit `runQueueSend` cubre el patrón guard) |
| AC-3 eliminar tarjeta revoca Object URL | Playwright DevTools: tras eliminar una imagen, no queda `blob:` URL viva del composer anterior |
| AC-4 al cambiar conversación se revocan todas las URLs | Playwright DevTools: 0 `blob:` del composer anterior |

## US6 — Accesibilidad y responsive (visual)

| AC | Check |
|---|---|
| AC-1 Tab recorre adjuntar, textarea, Enviar sin trampas | Playwright keyboard: Tab → Tab → Tab → Enter envía |
| AC-2 aria-label anuncia tipo + nombre + tamaño + estado | Playwright a11y tree (axe): `aria-label` dinámico |
| AC-3 viewport 375 px: scroll horizontal y botones ≥ 44 px | Playwright mobile viewport: tarjetas mínimas de 100 px, X / Retry ≥ 44×44 |

## Pasos visuales (Playwright, al cerrar la feature)

1. **Selección por picker:** login → Inbox → conversación "Lead 009" → clic
   en 📎 → seleccionar 3 archivos (jpeg 1 MB, mp4 30 MB, pdf 5 MB).
   Verificar 3 tarjetas: imagen con miniatura, video con banner amarillo
   "Excede 16 MB de video. ¿Enviar como documento?" y botón "Enviar como
   documento", pdf con icono y nombre.
2. **Drag & drop:** arrastrar un cuarto archivo (otra imagen) sobre el
   composer. Verificar overlay con icono `UploadCloud`, texto "Suelta para
   adjuntar" y "1 archivo detectado". Soltar: aparece la 4ª tarjeta.
3. **Paste:** copiar una imagen al portapapeles (en macOS: `Cmd+C` desde
   Finder; en Linux: usar `xclip`), clic en el textarea, `Ctrl+V`. Verificar
   5ª tarjeta añadida; el texto pegado no se inserta como caracteres.
4. **Eliminar:** hover en la 3ª tarjeta → clic en X → desaparece. En
   DevTools → Memory: las Object URLs del composer no crecen.
5. **Caption:** escribir "mira estos archivos" en el textarea. Verificar que
   el placeholder cambia a "Pie del adjunto (opcional)…" y el contador de
   cola muestra "5 adjuntos · 12.4 MB".
6. **Confirmar video→documento:** clic en "Enviar como documento" en la
   tarjeta del mp4. Verificar que el banner amarillo cambia por un badge
   "Como documento" en la esquina.
7. **Enviar:** clic en Enviar. Verificar spinner en cada tarjeta en orden;
   al terminar, check verde y badge "Enviado" en cada una. Header muestra
   "5/5 enviados" con icono `CheckCircle2` verde.
8. **Foco automático:** tras el envío, el textarea está vacío y con foco
   (cursor visible). Encolar otro archivo por picker: la nueva tarjeta
   aparece al inicio.
9. **Fallo y reintento:** simular un fallo del servidor (con mocks,
   reventar el endpoint). Encolar 2 imágenes, enviar. La 1ª sale
   `sent`, la 2ª queda `failed` con borde rojo y el motivo exacto del
   servidor. Clic en "↻ Reintentar" → spinner solo en esa tarjeta →
   check verde al terminar. La otra no se reenvía.
10. **Teclado:** con Tab, recorrer el composer: 📎 → 📍 → 👤 → textarea
    → Enviar. Sin trampas. Tab sobre una tarjeta → flechas ←/→
    navegan al adjunto anterior/siguiente; Delete borra el seleccionado.
11. **Esc para limpiar:** con cola de 2 adjuntos y textarea vacío, pulsar
    Esc → la cola se vacía, las Object URLs se revocan. Con textarea con
    texto, Esc no toca la cola (sale del textarea sin efectos).
12. **Responsive (375 px):** la cola permite scroll horizontal; cada
    tarjeta ≥ 100 px de ancho; los botones X / Reintentar ≥ 44×44 px;
    el header "5 adjuntos · …" cabe sin truncar.
13. **Cambio de conversación:** seleccionar otra conversación. Verificar
    en DevTools Memory: 0 `blob:` URLs vivos del composer anterior
    (cleanup del `useEffect`).

## Cobertura automatizada existente

Esta historia se cubre también con tests unit de la cola:

- `tests/unit/attachment-queue-classify.test.ts` (13 tests) — lógica de
  clasificación cliente (image/audio/video/document, video >16 MB,
  >100 MB → null, MIME vacío, fronteras inclusivas).
- `tests/unit/attachment-queue-reducer.test.ts` — `add`, `remove`,
  `clear`, `select`, `updateStatus`, `confirmVideoAsDocument`, `retry`,
  `clearSent`, `summarize`, `progressLabel`, `filterDuplicates`.
- `tests/unit/attachment-queue-run.test.ts` (387 líneas) — bucle de envío
  `runQueueSend`: multi-send secuencial, fallo parcial, retry, caption
  solo al primero, bloqueo video→document, no duplicar `sent`, anti
  doble-envío.
- `tests/unit/send-media-kind-override.test.ts` — override tipado
  `kind=document` server-side.
- `tests/unit/media-send.test.ts` — `validateOutgoing` con override.

## En vivo (producción, reglas Constitución IX)

1. En la línea de pruebas, recibir un envío manual con 3 archivos reales
   del CRM (imagen, video 30 MB re-taggeado, pdf). Pausa ≥8 s entre
   envíos para no ráfaga. Verificar en el teléfono:
   - la imagen llega con caption solo en ella;
   - el video 30 MB llega como documento (icono PDF/Documento, no video);
   - el pdf llega como documento.
2. Enviar un archivo >16 MB como video sin re-tag (forzando el camino
   infeliz): confirmar que la Cloud API lo rechaza con un error visible
   en la tarjeta del CRM, y que el operador puede reintentar.
3. Forzar el escenario de "ventana cerrada": esperar 24 h o cambiar el
   `windowOpen` manualmente. Encolar 3 adjuntos → todos los intentos
   fallan con `window_closed` por adjunto; los `sent` (si los hubo)
   mantienen su estado.
4. Forzar `is_test` (sandbox del Laboratorio): abrir una conversación
   de prueba, encolar adjuntos, enviar. Verificar que cada adjunto
   queda `failed` con `sandbox_violation` y NO se crea `media_asset` en
   `MEDIA_DIR`.

## Pendiente

- Sección 009 de `scripts/e2e-selftest.mjs` (T211): pendiente de
  ejecutar end-to-end con app + mocks + BD locales. Mientras no se
  corra, este guion queda como contract pendiente de verificar en
  vivo.