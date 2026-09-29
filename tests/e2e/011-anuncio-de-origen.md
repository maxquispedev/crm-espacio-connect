# E2E 011 — Anuncio de origen (CTWA) visible en bandeja, panel y pipeline

Guion de comportamiento (Constitución IX) para `specs/006-anuncio-de-origen/`.

Cubre la pieza visible de la spec 018 upstream: la bandeja muestra
«Anuncio · titular» / «Publicación · titular», el panel lateral muestra la
tarjeta del creativo, el pipeline muestra la línea secundaria, y el filtro
Anuncios deja solo los `source_type === "ad"`.

No cubre la captura (esa vive en el corte A y sus unit tests en
`tests/unit/attribution-*.test.ts`).

## Superficie y mocks

- `WA_MOCK_ENABLED=true` activa el inbound sintético en `/api/dev/wa-mock/inbound`,
  que acepta `referral` desde la CUT A (TA15). Con mocks apagados, este guion
  se reduce a "pendiente humano".
- `META_GRAPH_BASE_URL` → `wa-mock` sirve las URLs de los creativos; el mock
  `creativo-ok` devuelve un PNG válido.
- **No** se necesita `OPENROUTER_BASE_URL` (la pieza UI no toca el agente).
- El gate técnico es el de siempre: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
- La parte automatizada vive en `scripts/e2e-selftest.mjs` sección 011
  (`runSection011()`), que adiciona 18+ checks al self-test existente sin
  reescribir su infraestructura.

## Caminos cubiertos por el self-test (`scripts/e2e-selftest.mjs` sección 011)

| # | Camino | Aserción |
|---|---|---|
| 1 | Orgánica (sin `referral`) | La conversación existe y `anuncio === null` en `/api/conversations` |
| 2 | CTWA `ad` (con `referral`) | La conversación trae `anuncio.sourceType === "ad"`, `sourceId`, `headline` |
| 3 | DTO completo | `GET /api/contacts/:id` devuelve `anuncio.sourceType/sourceId/headline` y `hasCtwaClid === true` |
| 4 | `ctwaClid` no filtrado | El valor del `ctwa_clid` NO aparece en ninguna respuesta JSON |
| 5 | Pipeline board | El lead del kanban lleva `anuncio.sourceType === "ad"` |
| 6 | Reentrega | Mismo `wa_message_id` reentregado → la fila NO se duplica; primer anuncio gana |
| 7 | Publicación | `source_type=post` → `anuncio.sourceType === "post"` y `source === "desconocida"` (no cuenta como anuncio) |
| 8 | Imagen inválida | `image_url` fuera de allowlist (`http://169.254.169.254/...`) → `imageAssetId === null`, el inbound ENTRA igual, el anuncio queda guardado |
| 9 | Filtro Anuncios (cliente) | La convención `sourceType === "ad"` deja 2 conversaciones (no las publicaciones) |
| 10 | Tenant isolation | Una segunda organización no ve ninguna de las conversaciones/anuncios de la primera |

## Caminos visuales manuales (TB07 — Playwright)

> **PENDIENTE HUMANO/PRODUCCIÓN** — la verificación visual con clic CTWA real
> en producción queda marcada como tal. No bloquea el commit.

Estos pasos se ejecutan manualmente con la app levantada
(`pnpm dev` + BD + mocks activos):

1. Abrir `/inbox` y confirmar que la conversación de anuncio lleva el chip
   «Anuncio · Curso intensivo de cocina 2026» debajo del nombre.
2. Verificar que el chip «Anuncios» aparece en el header de filtros con su
   contador.
3. Pulsar el chip Anuncios → solo queda la conversación de CTWA; la orgánica
   y la publicación orgánica desaparecen.
4. Volver a «Todas» y abrir la conversación de CTWA.
5. En el panel lateral, debajo del header del contacto, ver la tarjeta con:
   miniatura del creativo, titular, body, «Primer mensaje · hace X», badge
   «con video» (si aplica), `ID <sourceId>`, enlace «Ver anuncio».
6. Verificar que el panel NO muestra el valor del `ctwa_clid` (solo un
   puntito verde con «clic CTWA atribuido» cuando `hasCtwaClid === true`).
7. Abrir `/pipeline` y verificar que la tarjeta del lead lleva una línea
   secundaria «Anuncio · Curso intensivo de cocina 2026».
8. Cambiar entre tema claro y oscuro — los chips y la tarjeta mantienen
   contraste.
9. Cambiar entre 1440 px y 390 px — el chip y la miniatura no rompen el
   layout (truncado con ellipsis en mobile).
10. Probar conversación con `media_type=video` → aparece badge «con video».

## Caminos infelices documentados

- **SSRF**: `image_url: "http://169.254.169.254/..."` → el guard de allowlist
  bloquea la descarga, `imageAssetId` queda `null`, el placeholder "Sin
  imagen" se pinta, el inbound entra igual.
- **SVG malicioso**: `image_url: "...svg"` → no está en `{image/jpeg,
  image/png, image/webp, image/gif}` → misma degradación.
- **Imagen grande**: > 1 MB en el fork (300 KB en upstream) → la lectura
  streaming corta el flujo, sin asset, sin romper el inbound.
- **Timeout del creativo**: el endpoint mock devuelve un stream que nunca
  termina → 5 s de timeout, sin asset, sin romper el inbound.
- **URL no https**: si Meta mandase `source_url: "http://..."` el panel
  filtra el anchor (defensa UI); el valor crudo sigue en BD.

## Verificación humana pendiente (producción)

- Clic CTWA real desde un anuncio en producción (no desde el wa-mock) →
  validar que la imagen llega, que la miniatura caduca al cabo de días
  (parámetro `oe=` del CDN), que el JSON de Meta trae exactamente los
  campos documentados en `WebhookReferral`.
- Captura de pantalla de la bandeja con un anuncio real, archivada como
  evidencia visual.
- Carga de varios leads del mismo `source_id` → la imagen se reutiliza y no
  se duplica en el volumen.

Estos puntos no son automatizables con el self-test local y se marcan
explícitamente como pendientes, igual que el upstream.
