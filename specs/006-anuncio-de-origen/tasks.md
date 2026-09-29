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

## Commit A — Servidor / datos (PR futuro)

**Propósito**: añadir schema + migración + normalización + ingesta + queries + lectura de imagen. Cero UI. Cero cambios en componentes de React. Deja el repo en estado verde.

> **Este commit NO se ejecuta en este PR.** Se documenta aquí como contrato para que el siguiente PR (corte A) lo siga sin reabrir el spec.

### Schema y migración

- [ ] **TA01** [P] [US1] Añadir la tabla `adAttribution` en `src/lib/db/schema.ts` con las columnas: `id`, `organizationId`, `contactId`, `conversationId`, `ctwaClid` (text, nullable), `sourceId` (text, nullable), `sourceType` (text, nullable), `sourceUrl` (text, nullable), `headline` (text, nullable), `body` (text, nullable), `mediaType` (text, nullable), `raw` (jsonb, default `'{}'::jsonb`), `createdAt` (timestamp, default now). UNIQUE compuesto `(organizationId, conversationId)`. Tres FK (`organization`, `contact`, `conversation`) con `onDelete: "cascade"`. Índice btree `(organizationId, sourceId)` (NO UNIQUE: muchas conversaciones pueden tener el mismo anuncio) + índice `(organizationId, createdAt DESC)` para listados.
- [ ] **TA02** [P] [US1] `pnpm db:generate` para producir `drizzle/0006_anuncio_de_origen.sql`, y editarla a mano para que sea re-ejecutable: `CREATE TABLE IF NOT EXISTS`, los `ADD CONSTRAINT` envueltos en `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;`, y `CREATE INDEX IF NOT EXISTS` para los dos índices.
- [ ] **TA03** [US1] Probar la migración desde base vacía (`docker compose down -v && pnpm db:migrate`) y desde base con `0005` aplicada (crear dos conversaciones previas, aplicar `0006`, confirmar que coexisten sin tocar nada). Confirmar que una segunda ejecución de la migración es no-op.

### Módulo de normalización pura

- [ ] **TA04** [P] [US1] Crear `src/server/attribution/referral.ts` exportando:
  - `COTAS` (`{ id: 128, titular: 300, texto: 2000, url: 2048, raw: 8_000 }`).
  - `CLAVES_WHATSAPP` (array cerrado de claves conservadas en `raw`).
  - `anuncioDeWhatsapp(referral: unknown): AnuncioDeOrigen | null`. Acepta el subconjunto del `referral` de Meta, normaliza con cotas, descarta tipos incorrectos, devuelve `null` si no hay al menos un identificador. `imageUrl` prefiere `thumbnail_url` sobre `image_url`. Sin tipos de entrada que no sean los documentados por Meta.
  - `sinIdentificadorDeClic(anuncio): AnuncioDeOrigen` — copia sin `ctwaClid` y sin `raw.ctwa_clid`. No muta el original. Pura.
- [ ] **TA05** [P] [US1] Crear `src/lib/anuncios.ts` exportando `etiquetaDeOrigen(sourceType)`, `cuentaComoAnuncio(anuncio)`, `titularDeOrigen(headline, sourceType)`. Sin BD, sin React.

### Tipo del webhook

- [ ] **TA06** [P] [US1] Añadir el tipo `WebhookReferral` y el campo opcional `referral?: WebhookReferral` a `WebhookMessage` en `src/server/inbox/webhook.ts`. Subconjunto documentado por Meta: `source_url`, `source_id`, `source_type`, `headline`, `body`, `media_type`, `image_url`, `video_url`, `thumbnail_url`, `ctwa_clid`. Sin cambios en el sender.

### Adaptador del canal + ingesta

- [ ] **TA07** [US1] En `src/server/inbox/ingest.ts`:
  - En `processMessagesValue`, reemplazar el pase directo de `msg.referral` por la llamada a `anuncioDeWhatsapp(msg.referral)` y pasar el resultado como `anuncio: AnuncioDeOrigen | null` a `ingestInboundMessage`.
  - En `ingestInboundMessage`, sustituir el bloque `recordAttribution` (no existe aún en este repo) por una llamada a `registrarAnuncioDeOrigen` dentro de un `try/catch`. Si el input trae `anuncio` no nulo, registrar **antes** del dedup del mensaje (mismo lugar lógico donde el upstream 018 lo hace).
  - Sustituir la importación de `WebhookReferral` por el tipo `AnuncioDeOrigen` en el shape del input.

### Store + DTO + serialización

- [ ] **TA08** [P] [US1] Crear `src/server/attribution/store.ts` exportando:
  - `anuncioParaGuardar(anuncio, atribuye = false)` — wrapper sobre `sinIdentificadorDeClic`. Por defecto `false` (equivale a ATRIBUCION apagada en el estado actual).
  - `registrarAnuncioDeOrigen({ organizationId, contactId, conversationId, anuncio })` — INSERT con `ON CONFLICT DO NOTHING` sobre `(organizationId, conversationId)`. Try/catch interno. Si la fila es nueva y trae `sourceId + imageUrl`, lanza `guardarCreativo` sin esperar (void).
  - `getAttributionForConversation(org, conversationId)` — SELECT de la fila. Helper interno.
  - `anuncioDelContacto(org, contactId)` — primera fila por `createdAt ASC, id ASC`.
  - `crearFreno(ventanaMs, maxClaves)` — función pura: `intentar(clave, ahora) → boolean` con mapa interno que purga claves vencidas.
  - `repararImagenSiFalta(org, contactId)` — background con freno. Lee URL del `raw`.
  - `serializarAnuncio(fila, atribuye)` — DTO `AnuncioDto`. `ctwaClid` jamás sale: solo `hasCtwaClid: boolean`. `sourceUrl` solo si `https://`.
- [ ] **TA09** [P] [US1] Añadir a `src/lib/types.ts`:
  - `AnuncioOrigen` (shape interno que devuelve `anuncioDeWhatsapp`).
  - `AnuncioDto` (DTO público, lo que viaja por API y SSE).
  - Campo `anuncio: { headline: string | null; sourceId: string | null; sourceType: string | null } | null` en `ConversationDto`.
- [ ] **TA10** [P] [US1] Añadir `deleteMediaFile(organizationId, assetId)` en `src/server/whatsapp/media.ts` con `rm({ force: true })` (no falla si ya no existe).

### Descarga acotada

- [ ] **TA11** [US1] Crear `src/server/attribution/creativo.ts` exportando:
  - `CREATIVO_MAX_BYTES = 300_000`, `TIEMPO_MS = 5_000`, `MAX_REDIRECCIONES = 3`, `REINTENTO_MS = 1_500`.
  - `DOMINIOS_DE_META` (allowlist cerrada).
  - `urlDeCreativoPermitida(raw, origenMock?)` — pura.
  - `descargarCreativo(url)` — fetch con `redirect: "manual"`, revalida cada salto, devuelve `Descarga`.
  - `descargarConReintento(url, esperaMs)` — un reintento ante fallo transitorio.
  - `imagenExistente(org, sourceId)` — SELECT del `media_asset` ya guardado para ese `(org, source_id)`.
  - `asignarImagen(org, sourceId, assetId)` — UPDATE de todas las filas sin imagen.
  - `descargaEnCurso(org, sourceId)` y `enCurso: Set<string>` (concurrencia in-process).
  - `guardarCreativo({ organizationId, conversationId, sourceId, imageUrl })` — reutiliza existente o descarga y guarda; publica `conversation.updated` al terminar.

### Queries

- [ ] **TA12** [US2] En `src/server/inbox/queries.ts`:
  - Definir `anuncioDeLaConversacion` (AND sobre `eq(adAttribution.organizationId, conversation.organizationId)` y `eq(adAttribution.conversationId, conversation.id)`).
  - Definir `anuncioDeLista` (`{ id, headline, sourceId, sourceType }`).
  - Definir `aAnuncioDeLista(fila)` — convierte la fila del JOIN en `{ headline, sourceId, sourceType } | null` (sin id).
  - En `listConversations`: añadir `anuncio: anuncioDeLista` al `.select()` y un `.leftJoin(schema.adAttribution, anuncioDeLaConversacion)` antes del `where`. Pasar `aAnuncioDeLista(r.anuncio)` a `serializeConversation` como quinto argumento.
  - En `getConversation`: mismo JOIN y misma serialización. El `LEFT JOIN` no multiplica filas porque el UNIQUE INDEX sobre `(organizationId, conversationId)` garantiza a lo más una fila por renglón.
  - En `serializeConversation`: añadir el parámetro `anuncio: ConversationDto["anuncio"] = null` y devolverlo en el DTO.
- [ ] **TA13** [US1] En `src/app/api/contacts/[id]/route.ts` (GET): añadir `anuncioDelContacto(org, id)` al Promise.all del GET actual; añadir `repararImagenSiFalta(org, id)` en background si `anuncio && !anuncio.imageAssetId`. Devolver el `anuncio` en el JSON de respuesta. En PATCH: incluir el `anuncio` en la respuesta para que el panel abierto se refresque.
- [ ] **TA14** [US1] En `src/app/api/conversations/[id]/route.ts` (PATCH): pasar el `anuncio` (obtenido del JOIN ya existente en `getConversation`) a `serializeConversation` para que el `conversation.updated` lleve el campo. Sin cambios en el bus.

### Mocks

- [ ] **TA15** [P] [US1] En `src/app/api/dev/wa-mock/inbound/route.ts`: aceptar un campo opcional `referral` por mensaje con el shape `WebhookReferral` validado con Zod. Permite forzar cada caso (con/sin `ctwa_clid`, `source_type: "ad" | "post"`, `media_type: "video"`, etc.). Gate único `isMockEnabled()` (`src/lib/dev-guard.ts`).
- [ ] **TA16** [P] [US1] En `src/app/api/dev/wa-mock/media-file/[id]/route.ts`: servir PNG reales para ids `creativo-*` y provocar los caminos a rechazar: `creativo-grande` (>300 KB), `creativo-svg` (image/svg+xml), `creativo-redirect-externo` (302 a `example.com`), `creativo-lento` (responde tras el timeout), `creativo-503` (status 503), `creativo-404` (status 404). Con `isMockEnabled()`, el origen de `META_GRAPH_BASE_URL` queda en la allowlist del `creativo.ts`.

### Tests unit

- [ ] **TA17** [P] [US1] Crear `tests/unit/referral.test.ts` cubriendo `anuncioDeWhatsapp` con: (a) referral completo, (b) sin identificadores, (c) tipos equivocados, (d) cadenas gigantes (recortadas), (e) `javascript:` / data URI rechazados, (f) `sinIdentificadorDeClic` no muta el original, (g) `imageUrl` prefiere `thumbnail_url` sobre `image_url`, (h) `raw` acotado a 8 KB. ≥ 8 casos.
- [ ] **TA18** [P] [US1] Crear `tests/unit/creativo.test.ts` cubriendo `urlDeCreativoPermitida` con todos los hosts de Meta (true), http sin TLS, usuario/contraseña, puerto != 443, redirección a host no permitido (false). `descargarCreativo` con imagen OK, redirección fuera de Meta (ni se pide), redirección dentro de Meta, 3+ redirecciones (corta), 5xx / 429 (transitorio), 404 (permanente), timeout (transitorio), SVG (>300 KB). `descargarConReintento` reintenta una vez transitorios y no reintenta permanentes. ≥ 12 casos.
- [ ] **TA19** [P] [US1] Crear `tests/unit/store.test.ts` cubriendo `crearFreno`: como mucho un intento por clave en la ventana; claves distintas no esperan entre sí; claves vencidas se purgan. `serializarAnuncio`: `ctwa_clid` jamás aparece en el JSON; `hasCtwaClid` depende de la bandera y de la fila; `sourceUrl` solo si `https://`. `cuentaComoAnuncio` y `etiquetaDeOrigen`. ≥ 7 casos.
- [ ] **TA20** [P] [US2] Crear `tests/unit/contact-source.test.ts` cubriendo `effectiveSource(stored, llegoPorAnuncio)`: lo capturado manda; sin captura, un anuncio deduce "anuncio"; una publicación deduce "desconocida". ≥ 3 casos.

### Gate técnico del corte A

- [ ] **TA21** Ejecutar `pnpm typecheck && pnpm lint && pnpm build && pnpm test` y dejar verdes. Documentar resultado en `tasks.md`.
- [ ] **TA22** Commit atómico: `feat(atribucion): captura del anuncio de origen en ingesta + storage + queries`. Working tree limpio excepto los archivos de este commit.

---

## Commit B — UI + E2E + cierre (PR futuro)

**Propósito**: pintar la marca y la tarjeta en bandeja + panel + pipeline, añadir el filtro Anuncios, agregar la sección E2E, actualizar CURRENT_STATE, cerrar el spec.

> **Este commit NO se ejecuta en este PR.** Se documenta aquí como contrato para que el siguiente PR (corte B) lo siga.

### Componente reutilizable

- [ ] **TB01** [P] [US2] Crear `src/components/anuncio-origen.tsx` con `AnuncioOrigen({ anuncio, conversationCreatedAt })`. Render:
  - Miniatura del creativo si `anuncio.imageAssetId` → `<img src={\`/api/media/${anuncio.imageAssetId}\`} />`. Si no, espacio reservado con texto «Sin imagen» (mismo ancho que la miniatura).
  - Titular (`headline`), texto del cuerpo (`body`, recortado a 2 líneas con ellipsis).
  - «Primer mensaje · <fecha relativa corta>» (`formatDistanceToNow(conversationCreatedAt)`).
  - Badge «con video» si `mediaType === "video"`.
  - «ID <sourceId>» en `<code>` monoespaciado pequeño.
  - Enlace «Ver anuncio» (anchor) solo si `sourceUrl?.startsWith("https://")`, con `target="_blank" rel="noopener noreferrer"`.
  - Defensa: `key={anuncio.imageAssetId ?? "none"}` para forzar re-render cuando la imagen llega por la reparación.

### Lista + filtro

- [ ] **TB02** [US2] En `src/components/inbox/conversation-list.tsx`:
  - Debajo del nombre del contacto (o junto al avatar), mostrar la línea «Anuncio · titular» o «Publicación · titular» usando `etiquetaDeOrigen(c.anuncio?.sourceType)` y `titularDeOrigen(c.anuncio?.headline, c.anuncio?.sourceType)`. Si no hay `anuncio`, no se muestra la línea.
  - En el header de filtros, añadir el chip «Anuncios» con contador (`conversations.filter(c => c.anuncio && cuentaComoAnuncio(c.anuncio)).length`). Solo aparece si el contador > 0.
  - Estado de filtro: `useState<"todas" | "no_leidas" | "anuncios">("todas")`. El estado de «no_leídas» sigue siendo ortogonal al filtro Anuncios (decisión: el filtro Anuncios y el de no-leídas son mutuamente excluyentes para no generar combinaciones absurdas).
  - `aria-label="Filtrar por anuncios"` en el chip.

### Panel lateral

- [ ] **TB03** [US2] En `src/components/inbox/contact-panel.tsx`:
  - Si la respuesta del GET del contacto trae `anuncio !== null`, insertar `<AnuncioOrigen ... />` entre la cabecera de contacto (avatar + nombre + teléfono) y el stepper de etapa. Si `anuncio === null`, no se inserta nada (no hay gap vertical).
  - Cuando llega un `conversation.updated` por SSE que afecta a esta conversación, `refetchLive` vuelve a llamar al GET del contacto; la tarjeta se re-renderiza automáticamente (gracias al `key` del `AnuncioOrigen`).

### Pipeline

- [ ] **TB04** [US2] En `src/components/pipeline/pipeline-client.tsx`: añadir debajo del nombre del lead una línea secundaria «Anuncio · titular» o «Publicación · titular» cuando el DTO del lead (o del board) trae el origen. Sin origen, no se muestra. Sin tocar dnd-kit ni el refactor lateral del spec 001.

### E2E automatizado

- [ ] **TB05** [US1] Crear `tests/e2e/011-anuncio-de-origen.md` con el guion:
  - Camino feliz: inbound con `referral` completo → GET /api/conversations devuelve la conversación con `anuncio` no nulo → GET /api/contacts/:id devuelve el `anuncio` completo con `imageAssetId` → la lista muestra la marca «Anuncio · titular» → el panel muestra la tarjeta con miniatura → el pipeline muestra la línea secundaria.
  - Orgánica: inbound sin `referral` → GET /api/conversations devuelve `anuncio: null` → la lista no muestra marca → el panel no muestra tarjeta → el pipeline no muestra línea secundaria.
  - Idempotencia: dos inbounds del mismo `wa_message_id` (reentrega de Meta) → la fila de `ad_attribution` se crea una vez → la imagen se copia una vez.
  - Publicación: inbound con `source_type === "post"` → la marca dice «Publicación · titular» → la cuenta deducida de la fuente sigue siendo «desconocida» → el filtro Anuncios NO la cuenta.
  - Filtro Anuncios: marcar el chip → solo quedan conversaciones con origen `ad` (no las publicaciones).
  - SSRF: inbound con `image_url: "http://169.254.169.254/..."` → la tarjeta aparece sin imagen y el mensaje entra igual.
  - Imagen inválida: inbound con `image_url: "...svg"` → la tarjeta aparece sin imagen y el mensaje entra igual.
- [ ] **TB06** [US1] Agregar la sección 011 al `scripts/e2e-selftest.mjs` con ≥ 6 comprobaciones automatizables vía `WA_MOCK_ENABLED=true`. Si alguna comprobación no es automatizable (e.g. aserciones de UI), marcarla como manual y enlazar con `tests/e2e/011-anuncio-de-origen.md`.

### Verificación humana

- [ ] **TB07** [US2] Manual Playwright: abrir la bandeja, ver la marca en una conversación de anuncio; abrir el panel, ver la tarjeta con miniatura; abrir el pipeline, ver la línea secundaria; cambiar entre claro/oscuro; cambiar entre 1440 y 390 px; tomar capturas y adjuntarlas al PR.

### Cierre del spec

- [ ] **TB08** [US1] Actualizar `docs/CURRENT_STATE.md`: añadir bloque de cierre del spec 006 con el resumen de implementación (módulos nuevos, migración, números de tests nuevos, gates), el estado de SC-1 a SC-11, y el punto de verificación humana (SC-10: capturas de Playwright + SC-11: no-regresión de 001-005).
- [ ] **TB09** Commit atómico: `feat(inbox): tarjeta y marca de anuncio en bandeja/panel/pipeline + filtro Anuncios + E2E + cierre`. Working tree limpio excepto los archivos de este commit.

---

## Estado durable de los commits

| Commit | Estado | Notas |
|---|---|---|
| 0 (docs) | cerrado en este PR | Working tree solo toca `specs/006-anuncio-de-origen/` + bloque nuevo en `docs/CURRENT_STATE.md`. |
| A (servidor/datos) | pendiente | Próximo PR: TA01–TA22. Implementa captura + storage + queries. Sin UI. |
| B (UI + E2E + cierre) | pendiente | PR tras A: TB01–TB09. Pinta la marca y la tarjeta, añade el filtro, cierra el spec. |

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
