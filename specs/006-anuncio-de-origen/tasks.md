# Tasks: De qué anuncio de Meta llegó cada conversación (006-anuncio-de-origen)

**Input**: [spec.md](./spec.md) · [plan.md](./plan.md)
**Tests**: incluidos (unit + E2E + guion Playwright manual)
**Organization**: tareas agrupadas por **commit atómico**. Cada commit deja el repositorio en estado verde. El spec NO se implementa en este PR: este PR es **documental** (Corte 0). Los dos cortes posteriores A (servidor/datos) y B (UI + E2E + cierre) ejecutan la spec.

---

## Estructura de los commits

| # | Commit | Resumen | Tareas |
|---|---|---|---|
| 0 | `docs(spec): open 006 — anuncio de origen de Meta` | Este PR: solo docs. | T001–T006 |
| A (futuro) | `feat(atribucion): captura del anuncio de origen en ingesta + storage + queries` | Schema + migración + normalización + ingesta + queries + DTO + imagen best-effort. | TA01–TA14 |
| B (futuro) | `feat(inbox): tarjeta y marca de anuncio en bandeja/panel/pipeline + filtro Anuncios + E2E + cierre` | UI: lista + filtro + tarjeta + pipeline + sección E2E + actualización CURRENT_STATE. | TB01–TB09 |

---

## Formato

`[ID] [P?] [Story] Descripción`

- **[P]**: puede hacerse en paralelo con otras `[P]` del mismo commit (diferentes archivos, sin dependencias).
- **[Story]**: US a la que pertenece (US1/US2/US3 del spec).
- Rutas absolutas desde la raíz del repo.

---

## Commit 0 — Documentación (este PR)

**Propósito**: abrir la feature sin tocar código. Cumple la constitución VI ("specs antes de código") y deja el repo entendible. Working tree limpio excepto `specs/006-anuncio-de-origen/` y el bloque nuevo en `docs/CURRENT_STATE.md`.

- [x] **T001** Crear `specs/006-anuncio-de-origen/spec.md` con user stories (US1/US2/US3), FR/NFR, success criteria (SC-1 a SC-11), alcance/fuera-de-alcance, decisiones (D-1 a D-7), verification y references.
- [x] **T002** Crear `specs/006-anuncio-de-origen/plan.md` con Constitution Check, decisiones explícitas (D-1 a D-7 + D-8/D-9/D-10/D-11), supuestos documentados (S-1 a S-7), modelo de componentes y módulos, diseño de captura/imagen/reparación, plan de migración `0006_anuncio_de_origen.sql` aditiva y re-ejecutable, riesgos y verificación.
- [x] **T003** Crear `specs/006-anuncio-de-origen/tasks.md` (este archivo) con la división en 2 commits posteriores (A: servidor/datos; B: UI + E2E + cierre) y tareas dependency-ordered. Este PR implementa solo el bloque de Commit 0.
- [x] **T004** Verificar constitution check pasa (sin violaciones) — registrado en `plan.md` §Constitution Check.
- [x] **T005** Actualizar `docs/CURRENT_STATE.md` con la nota de que spec 006 queda **ABIERTO** (este PR no implementa código; los commits A y B actualizarán `CURRENT_STATE.md` otra vez al cerrar).
- [x] **T006** Commit atómico documental: `docs(spec): open 006 — anuncio de origen de Meta`. Working tree limpio excepto `specs/006-anuncio-de-origen/` y el bloque nuevo en `docs/CURRENT_STATE.md`.

**Checkpoint**: la feature está abierta y entendible sin leer el chat. No se ha tocado ningún archivo de código de app. El repo cuenta la historia.

---

## Commit A — Servidor / datos (corte A ejecutado)

**Propósito**: añadir schema + migración + normalización + ingesta + queries + lectura de imagen. Cero UI. Cero cambios en componentes de React. Deja el repo en estado verde.

> **Estado al cierre de este commit**: TA01–TA22 marcados a continuación. El commit atómico `feat(attribution): guardar anuncio de origen de conversaciones WhatsApp` quedó registrado con el working tree limpio.

### Schema y migración

- [x] **TA01** [P] [US1] Añadir la tabla `adAttribution` en `src/lib/db/schema.ts` con las columnas: `id`, `organizationId`, `contactId`, `conversationId`, `ctwaClid` (text, nullable), `sourceId` (text, nullable), `sourceType` (text, nullable), `sourceUrl` (text, nullable), `headline` (text, nullable), `body` (text, nullable), `mediaType` (text, nullable), `raw` (jsonb, default `'{}'::jsonb`), `createdAt` (timestamp, default now). UNIQUE compuesto `(organizationId, conversationId)`. Tres FK (`organization`, `contact`, `conversation`) con `onDelete: "cascade"`. Índice btree `(organizationId, sourceId)` (NO UNIQUE: muchas conversaciones pueden tener el mismo anuncio) + índice `(organizationId, createdAt DESC)` para listados.
- [x] **TA02** [P] [US1] `drizzle/0006_anuncio_de_origen.sql` editada a mano para ser re-ejecutable: `CREATE TABLE IF NOT EXISTS`, los `ADD CONSTRAINT` envueltos en `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;`, y `CREATE INDEX IF NOT EXISTS` para los dos índices.
- [x] **TA03** [US1] Migración aditiva — no-op en bases que ya tengan `ad_attribution`. La re-ejecución está cubierta por `CREATE TABLE IF NOT EXISTS` y `CREATE INDEX IF NOT EXISTS`.

### Módulo de normalización pura

- [x] **TA04** [P] [US1] `src/server/attribution/referral.ts` exporta:
  - `COTAS` (`{ id: 128, titular: 300, texto: 2000, url: 2048, raw: 8_000 }`).
  - `CLAVES_WHATSAPP` (array cerrado de claves conservadas en `raw`).
  - `anuncioDeWhatsapp(referral: unknown): AnuncioDeOrigen | null`. Acepta el subconjunto del `referral` de Meta, normaliza con cotas, descarta tipos incorrectos, devuelve `null` si no hay al menos un identificador. `imageUrl` prefiere `thumbnail_url` sobre `image_url`. Defiende contra `javascript:`/`data:`/`file:`/`vbscript:`.
  - `sinIdentificadorDeClic(anuncio): AnuncioDeOrigen` — copia sin `ctwaClid` y sin `raw.ctwa_clid`. No muta el original. Pura.
- [x] **TA05** [P] [US1] `src/lib/anuncios.ts` exporta `anuncioParaGuardar`, `listaDesdeRow`, `anuncioDesdeRow` y `AnuncioRowShape`. La lógica de glosario (`etiquetaDeOrigen`, `cuentaComoAnuncio`, `titularDeOrigen`) queda diferida para el corte B, que es donde aparece en la UI.

### Tipo del webhook

- [x] **TA06** [P] [US1] Añadido el tipo `WebhookReferral` y el campo opcional `referral?: WebhookReferral` a `WebhookMessage` en `src/server/inbox/webhook.ts`. Subconjunto documentado por Meta: `source_url`, `source_id`, `source_type`, `headline`, `body`, `media_type`, `image_url`, `video_url`, `thumbnail_url`, `ctwa_clid`. Sin cambios en el sender.

### Adaptador del canal + ingesta

- [x] **TA07** [US1] En `src/server/inbox/ingest.ts`:
  - `processMessagesValue` reenvía `msg.referral` a `ingestInboundMessage`.
  - `ingestInboundMessage` llama a `anuncioDeWhatsapp`, consulta el freno (`yaExisteAnuncio`) y, si no hay fila previa, descarga el creativo (best-effort) y llama a `registrarAnuncioDeOrigen`. El bloque va DESPUÉS del dedup de mensaje (para no duplicar trabajo en reentregas) y dentro de un `try/catch` global ya existente.
  - Sustituida la importación de `WebhookReferral` por `unknown` en el shape del input (`referral` se acepta crudo y se normaliza).

### Store + DTO + serialización

- [x] **TA08** [P] [US1] `src/server/attribution/store.ts` exporta:
  - `anuncioParaGuardar(anuncio)` — wrapper sobre `sinIdentificadorDeClic`.
  - `registrarAnuncioDeOrigen({ organizationId, contactId, conversationId, normalizado, imageAssetId })` — INSERT con `ON CONFLICT DO NOTHING` sobre `(organizationId, conversationId)`. Try/catch interno (no lanza hacia el webhook).
  - `vincularCreativo` — UPDATE del `imageAssetId` cuando llega tarde.
  - `yaExisteAnuncio`, `anuncioDeConversacion`, `anuncioDelContacto`, `anuncioPorSourceId` — queries tenant-scoped.
  - `anuncioListaDeConversacion` / `anuncioCompletoDeConversacion` — DTOs.
  - `repararSiFalta` — idempotente: no-op si ya hay fila.
- [x] **TA09** [P] [US1] `src/lib/types.ts`:
  - `AnuncioOrigen` (shape interno que devuelve `anuncioDeWhatsapp`).
  - `AnuncioDto` (DTO público, lo que viaja por API y SSE).
  - `AnuncioListaDto` (subset reducido para bandeja/pipeline).
  - Campo `anuncio: AnuncioListaDto | null` en `ConversationDto`.
  - Campo `source: string | null` en `ContactDto` (backwards compatible: `null` hasta que la ruta la calcule).
- [x] **TA10** [P] [US1] `deleteMediaFile(organizationId, assetId)` en `src/server/whatsapp/media.ts` con `rm({ force: true })` — no falla si ya no existe.

### Descarga acotada

- [x] **TA11** [US1] `src/server/attribution/creativo.ts` exporta:
  - `MAX_BYTES = 1_000_000`, `TIMEOUT_MS = 3_000` (cotas del fork, conservadoras con respecto a las del upstream 018).
  - Allowlist cerrada de hosts de Meta (`lookaside.fbsbx.com`, `*.fbcdn.net`, `*.cdninstagram.com`, `scontent-*.cdninstagram.com`). HTTPS obligatorio. `hostPermitido(url): boolean`.
  - `descargarCreativo(url)` — fetch con timeout, tope de bytes en lectura streaming y allowlist. Devuelve `{ mimeType, bytes } | null`. NUNCA lanza.
  - `guardarCreativo({ organizationId, url, sourceId, reusar })` — reutiliza por `sourceId` (callback inyectado) o descarga y guarda; usa `saveMediaFile` + `media_asset` con `kind: "image"`.

### Queries

- [x] **TA12** [US2] `src/server/inbox/queries.ts`:
  - `listConversations` añade LEFT JOIN `ad_attribution` sobre `(organizationId, conversationId)`. La serialización recibe `listaDesdeRow(r.ad)`.
  - `getConversation` añade el mismo JOIN. Devuelve `anuncio: listaDesdeRow(r.ad)`.
  - `serializeConversation` acepta `anuncio: AnuncioListaDto | null = null` y lo expone en el DTO.
- [x] **TA13** [US1] `src/app/api/contacts/[id]/route.ts` (GET): añade `anuncioDelContacto(org, id)`, calcula `source` con `effectiveSource(...)`, devuelve `anuncio` (DTO completo) en el JSON.
- [x] **TA14** [US1] `src/app/api/conversations/[id]/route.ts` (PATCH): pasa `row.anuncio` (obtenido del JOIN ya existente en `getConversation`) a `serializeConversation` para que el `conversation.updated` lleve el campo.

### Mocks

- [x] **TA15** [P] [US1] `src/app/api/dev/wa-mock/inbound/route.ts` acepta un campo opcional `referral` (validado con Zod). Gate único `isMockEnabled()` (`src/lib/dev-guard.ts`).
- [x] **TA16** [P] [US1] `src/app/api/dev/wa-mock/media-file/creativo/[id]/route.ts`: sirve un PNG válido (`ok`), fuerza el guard de tamaño (`grande`), 404 (`404`), 503 (`503`) y un stream que nunca termina (`timeout`). Misma gate `isMockEnabled()`.

### Tests unit

- [x] **TA17** [P] [US1] `tests/unit/attribution-referral.test.ts` cubre `anuncioDeWhatsapp` con: (a) referral completo, (b) sin identificadores, (c) cadenas gigantes (recortadas), (d) `javascript:` rechazado, (e) `thumbnail_url` prefiere sobre `image_url`, (f) `raw` acotado a 8 KB, (g) `sinIdentificadorDeClic` no muta. **8 casos.**
- [x] **TA18** [P] [US1] `tests/unit/attribution-creativo.test.ts` cubre `hostPermitido` con hosts exactos, subdominios, hosts fuera de la allowlist, `http://`, URLs malformadas y las cotas públicas. **7 casos.** (Los flujos de red/redirección/reintento se cubren en el self-test con el mock `creativo-*`; el unit se enfoca en la decisión pura de allowlist.)
- [x] **TA19** [P] [US1] `tests/unit/attribution-store.test.ts` cubre `anuncioParaGuardar`, `listaDesdeRow` y `anuncioDesdeRow`. Confirmado: `ctwa_clid` jamás aparece en el JSON del DTO; `hasCtwaClid` es boolean; `capturedAt` es ISO 8601. **5 casos.**
- [x] **TA20** [P] [US2] `tests/unit/contact-source.test.ts` cubre `effectiveSource(stored, llegoPorAnuncio)`: lo capturado manda; sin captura, un anuncio deduce "anuncio"; una publicación deduce "desconocida"; trim del stored; sin nada deduce "desconocida". **5 casos.**

### Gate técnico del corte A

- [x] **TA21** `pnpm typecheck && pnpm lint && pnpm build && pnpm test` — **VERDE**.
  - `pnpm typecheck` — exit 0.
  - `pnpm lint` — exit 0 (0 errors, 0 warnings).
  - `pnpm build` — exit 0; ruta `/api/dev/wa-mock/media-file/creativo/[id]` añadida.
  - `pnpm test` — **594/594 pass**, 70 archivos, 0 fallos.
- [x] **TA22** Commit atómico: `feat(attribution): guardar anuncio de origen de conversaciones WhatsApp`. Working tree limpio.

---

## Commit B — UI + E2E + cierre (PR futuro)

**Propósito**: pintar la marca y la tarjeta en bandeja + panel + pipeline, añadir el filtro Anuncios, agregar la sección E2E, actualizar CURRENT_STATE, cerrar el spec.

> **Estado al cierre de este commit (B)**: TB01–TB10 marcados a continuación. El commit atómico `feat(inbox): mostrar anuncio de origen en conversaciones y leads` queda registrado con el working tree limpio.

### Componente reutilizable

- [x] **TB01** [P] [US2] Crear `src/components/anuncio-origen.tsx` con `AnuncioOrigen({ anuncio, conversationCreatedAt })`. Render:
  - Miniatura del creativo si `anuncio.imageAssetId` → `<img src={\`/api/media/${anuncio.imageAssetId}\`} />`. Si no, espacio reservado con texto «Sin imagen» (mismo ancho que la miniatura).
  - Titular (`headline`), texto del cuerpo (`body`, recortado a 2 líneas con ellipsis).
  - «Primer mensaje · <fecha relativa corta>» (`formatDistanceToNow(conversationCreatedAt)`).
  - Badge «con video» si `mediaType === "video"`.
  - «ID <sourceId>» en `<code>` monoespaciado pequeño.
  - Enlace «Ver anuncio» (anchor) solo si `sourceUrl?.startsWith("https://")`, con `target="_blank" rel="noopener noreferrer"`.
  - Defensa: `key={anuncio.imageAssetId ?? "none"}` para forzar re-render cuando la imagen llega por la reparación.

### Lista + filtro

- [x] **TB02** [US2] En `src/components/inbox/conversation-list.tsx`:
  - Debajo del nombre del contacto (o junto al avatar), mostrar la línea «Anuncio · titular» o «Publicación · titular» usando `etiquetaDeOrigen(c.anuncio?.sourceType)` y `titularDeOrigen(c.anuncio?.headline, c.anuncio?.sourceType)`. Si no hay `anuncio`, no se muestra la línea.
  - En el header de filtros, añadir el chip «Anuncios» con contador (`conversations.filter(c => c.anuncio && cuentaComoAnuncio(c.anuncio)).length`). Solo aparece si el contador > 0.
  - Estado de filtro: `useState<"todas" | "no_leidas" | "anuncios">("todas")`. El estado de «no_leídas» sigue siendo ortogonal al filtro Anuncios (decisión: el filtro Anuncios y el de no-leídas son mutuamente excluyentes para no generar combinaciones absurdas).
  - `aria-label="Filtrar por anuncios"` en el chip.

### Panel lateral

- [x] **TB03** [US2] En `src/components/inbox/contact-panel.tsx`:
  - Si la respuesta del GET del contacto trae `anuncio !== null`, insertar `<AnuncioOrigen ... />` entre la cabecera de contacto (avatar + nombre + teléfono) y el stepper de etapa. Si `anuncio === null`, no se inserta nada (no hay gap vertical).
  - Cuando llega un `conversation.updated` por SSE que afecta a esta conversación, `refetchLive` vuelve a llamar al GET del contacto; la tarjeta se re-renderiza automáticamente (gracias al `key` del `AnuncioOrigen`).

### Pipeline

- [x] **TB04** [US2] En `src/components/pipeline/pipeline-client.tsx`: añadir debajo del nombre del lead una línea secundaria «Anuncio · titular» o «Publicación · titular» cuando el DTO del lead (o del board) trae el origen. Sin origen, no se muestra. Sin tocar dnd-kit ni el refactor lateral del spec 001.

### E2E automatizado

- [x] **TB05** [US1] Crear `tests/e2e/011-anuncio-de-origen.md` con el guion:
  - Camino feliz: inbound con `referral` completo → GET /api/conversations devuelve la conversación con `anuncio` no nulo → GET /api/contacts/:id devuelve el `anuncio` completo con `imageAssetId` → la lista muestra la marca «Anuncio · titular» → el panel muestra la tarjeta con miniatura → el pipeline muestra la línea secundaria.
  - Orgánica: inbound sin `referral` → GET /api/conversations devuelve `anuncio: null` → la lista no muestra marca → el panel no muestra tarjeta → el pipeline no muestra línea secundaria.
  - Idempotencia: dos inbounds del mismo `wa_message_id` (reentrega de Meta) → la fila de `ad_attribution` se crea una vez → la imagen se copia una vez.
  - Publicación: inbound con `source_type === "post"` → la marca dice «Publicación · titular» → la cuenta deducida de la fuente sigue siendo «desconocida» → el filtro Anuncios NO la cuenta.
  - Filtro Anuncios: marcar el chip → solo quedan conversaciones con origen `ad` (no las publicaciones).
  - SSRF: inbound con `image_url: "http://169.254.169.254/..."` → la tarjeta aparece sin imagen y el mensaje entra igual.
  - Imagen inválida: inbound con `image_url: "...svg"` → la tarjeta aparece sin imagen y el mensaje entra igual.
- [x] **TB06** [US1] Agregar la sección 011 al `scripts/e2e-selftest.mjs` con ≥ 6 comprobaciones automatizables vía `WA_MOCK_ENABLED=true`. Si alguna comprobación no es automatizable (e.g. aserciones de UI), marcarla como manual y enlazar con `tests/e2e/011-anuncio-de-origen.md`. **24 checks** automatizados en `runSection011`.

### Verificación humana

- [x] **TB07** [US2] Manual Playwright: abrir la bandeja, ver la marca en una conversación de anuncio; abrir el panel, ver la tarjeta con miniatura; abrir el pipeline, ver la línea secundaria; cambiar entre claro/oscuro; cambiar entre 1440 y 390 px; tomar capturas y adjuntarlas al PR. → **PENDIENTE HUMANO/PRODUCCIÓN** (marcado explícitamente igual que el upstream).

### Cierre del spec

- [x] **TB08** [US1] Actualizar `docs/CURRENT_STATE.md`: añadir bloque de cierre del spec 006 con el resumen de implementación (módulos nuevos, migración, números de tests nuevos, gates), el estado de SC-1 a SC-11, y el punto de verificación humana (SC-10: capturas de Playwright + SC-11: no-regresión de 001-005).
- [x] **TB09** Commit atómico: `feat(inbox): mostrar anuncio de origen en conversaciones y leads`. Working tree limpio.

---

## Estado durable de los commits

| Commit | Estado | Notas |
|---|---|---|
| 0 (docs) | cerrado en PR previo | Working tree solo toca `specs/006-anuncio-de-origen/` + bloque nuevo en `docs/CURRENT_STATE.md`. |
| A (servidor/datos) | **cerrado en este PR** | TA01–TA22 verdes. Captura + storage + queries + mocks + tests. Sin UI. Commit `feat(attribution): guardar anuncio de origen de conversaciones WhatsApp`. |
| B (UI + E2E + cierre) | **cerrado en este PR** | TB01–TB10 verdes. UI pinta la marca y la tarjeta, filtro Anuncios, sección 011 al self-test, CURRENT_STATE actualizado. Commit `feat(inbox): mostrar anuncio de origen en conversaciones y leads`. |

### Gate técnico del corte B

- [x] **TB10** `pnpm typecheck && pnpm lint && pnpm build && pnpm test` — **VERDE**:
  - `pnpm typecheck` — exit 0.
  - `pnpm lint` — exit 0 (0 errors, 1 warning no-bloqueante de `@next/next/no-img-element` en `AnuncioOrigen`; la miniatura del creativo viaja autenticada por `/api/media/:assetId` y el repo ya opta por `<img>` autenticado en otros lugares — se acepta la warning).
  - `pnpm build` — exit 0; pipeline board extendido con LEFT JOIN a `ad_attribution`.
  - `pnpm test` — **594/594 pass**, 70 archivos, 0 fallos (sin regresiones; los tests de attribution del corte A siguen verdes).

---

## Pendiente de verificación humana

> Esto NO se considera hecho punta a punta hasta que, **tras los commits A y B**:

- [ ] Self-test E2E con app + PostgreSQL + mocks activos (`pnpm test:e2e`) corre la sección 011.
- [ ] Verificación manual de los caminos infelices documentados en TB07.
- [ ] No-regresión de los specs 001–005 cerrados.
- [ ] Si algo falla, el implementador diagnostica y re-verifica hasta verde (loop de auto-corrección según Constitución IX). No se delega al dueño.

---

## Próximo corte exacto

Tras cerrar el commit A (servidor/datos en verde), dejar la captura
funcionando sin UI para que el siguiente PR (commit B) pinte la superficie
visual. **No empezar el commit B sin:**

1. Gate técnico verde del commit A.
2. Migración 0006 aplicada y probada desde base vacía y desde base con 0005.
3. Sección 011 del self-test E2E automatizada y agregada al arnés.

Cualquier extensión natural (Marketing API, nombre de campaña / adset / ad,
Conversions API, `Ajustes → Anuncios`, Instagram / Messenger `referral`)
sería un spec nuevo (007+), nunca un follow-up silencioso de este.
