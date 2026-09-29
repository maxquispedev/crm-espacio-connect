<!--
SYNC IMPACT REPORT
==================
Versión: draft (no amendment of constitution required).
Este spec NO modifica la constitución ni las plantillas.
NO reabre ningún spec cerrado (001–005).
NO introduce la Conversions API: el envío a Meta y la pestaña Ajustes →
Anuncios son superficie del futuro spec 007, que también definirá la bandera
ATRIBUCION como feature flag real. Aquí el `ctwa_clid` se trata como
atributo preparado: la columna es nullable, la API y la UI jamás exponen su
valor y, mientras ATRIBUCION no exista como flag cableado, el `ctwa_clid` se
trata como si la bandera estuviera APAGADA (D2-equivalente, sección §Decisiones).
NO modifica Sales Orchestrator ni Jev. NO añade Marketing API. NO hace CAPI.
NO captura nombre de campaña / adset / ad (Meta no los manda en el `referral`).
Migración ADITIVA y tenant-safe (organización NOT NULL, índice org-first).
-->

# Feature Specification: De qué anuncio de Meta llegó cada conversación (006-anuncio-de-origen)

**Feature Branch**: `feat/006-anuncio-de-origen`
**Created**: 2026-09-29
**Status**: Draft (especificada antes de escribir código).
**Input**: descripción del dueño 2026-09-29 — traer al raíz la pieza visible de la spec 018 del upstream `kevinrivm/vocero-crm` (bandeja con marca de anuncio, panel con tarjeta del creativo, filtro Anuncios, copia best-effort del thumbnail al volumen de adjuntos). Sin nada de su pila multitenant, sin nada de su CAPI, sin nada de su spec 016 previa: en este repo la tabla `ad_attribution` aún no existe y la vamos a crear en este spec.

---

## Resumen

Cuando alguien escribe por primera vez a un número de WhatsApp Business desde un
anuncio Click-to-WhatsApp (CTWA) de Meta, el webhook incluye el objeto
`messages[].referral`. Esta spec lo captura, lo guarda **una sola vez por
conversación** y lo pinta en la bandeja, el panel lateral y el pipeline.

Lo que se ve es **siempre** la misma información: titular del creativo, tipo
(anuncio o publicación), id del anuncio y, si Meta lo mandó, enlace `https`.
El identificador del clic (`ctwa_clid`) se prepara a nivel de columna y de
almacenamiento, pero **jamás** sale por API ni por UI: pertenece al futuro spec
007 (Conversions API / Ajustes → Anuncios).

> **NO** es integración con la Marketing API de Meta, ni con CAPI, ni con
> Ajustes → Anuncios. NO captura nombre de campaña / adset / ad (Meta no los
> entrega en el `referral`). NO modifica Sales Orchestrator ni Jev.

---

## Contexto y motivación

### Lo que ya existe (verificado)

- Webhook público en `src/app/api/webhooks/wa/[webhookToken]/route.ts` con
  autenticación en dos capas (verify token + opcional `x-hub-signature-256`).
- Procesador del campo `messages` en `src/server/inbox/ingest.ts`
  (`processMessagesValue` → `ingestInboundMessage`).
- Tipos del payload de Meta en `src/server/inbox/webhook.ts`. **El campo
  `referral` NO está tipado todavía**: este spec lo añade al tipo
  `WebhookMessage` como `referral?: WebhookReferral` (subconjunto de los
  campos documentados por Meta: `source_url`, `source_id`, `source_type`,
  `headline`, `body`, `media_type`, `image_url`, `video_url`, `thumbnail_url`,
  `ctwa_clid`).
- `media_asset` en `src/lib/db/schema.ts` cubre todos los kinds binarios
  (`image`/`video`/`audio`/`document`/`sticker`) + `location` + `contacts`.
  Descarga desde Graph en `src/server/whatsapp/media.ts`
  (`ensureAssetAvailable`, `saveMediaFile`); servido con sesión en
  `/api/media/[assetId]`.
- `ConversationDto` en `src/lib/types.ts` ya viaja por `GET /api/conversations`
  y por el SSE `conversation.updated`. Falta añadir el campo `anuncio`
  (aditivo).
- `ContactPanel` (`src/components/inbox/contact-panel.tsx`) muestra
  contacto + handoff + toggle IA + stepper de etapa + sección sales + notas.
  Falta una sección nueva para la tarjeta del anuncio.
- `ConversationList` (`src/components/inbox/conversation-list.tsx`) tiene
  filtro `Todas` / `No leídas` y un selector de etapa. Falta el filtro
  `Anuncios`.
- `PipelineClient` (`src/components/pipeline/pipeline-client.tsx`) muestra
  tarjeta por lead con avatar + actividad + lane hint + icono "abrir
  conversación". El origen del anuncio (cuando aplique) cabe como una línea
  secundaria sin tocar el refactor lateral de dnd-kit.
- Migración vigente `0005_wonderful_justin_hammer.sql` (la última del
  directorio). Este spec añade `0006_anuncio_de_origen.sql` ADITIVA y
  RE-EJECUTABLE (`IF NOT EXISTS` en columnas, `DO` con
  `EXCEPTION WHEN duplicate_object` para la FK, `CREATE INDEX IF NOT EXISTS`
  para el índice).

### Por qué hace falta

- Una campaña Click-to-WhatsApp manda leads al WhatsApp del negocio. Hoy el
  CRM recibe el mensaje, lo guarda y atiende, pero **no dice de qué anuncio
  llegó**: el operador no sabe si ese Juan Pérez viene de un anuncio, de
  una publicación, o de un contacto orgánico.
- Esa información ya viene gratis en el webhook (`messages[].referral`); solo
  hay que guardarla y pintarla. Sin credenciales nuevas, sin llamadas
  externas, sin permisos extra.
- El thumbnail del creativo caduca en días (parámetro `oe=` del CDN de Meta):
  hay que copiarlo al volumen local en el momento de la ingesta para que la
  tarjeta tenga imagen dos semanas después.

### Por qué NO en este spec

| Qué | Por qué no |
|---|---|
| Marketing API para nombre de campaña/adset/ad | Meta no los entrega en el `referral`; requeriría permisos adicionales del negocio y el Principio II lo prohíbe (más dependencias externas en runtime). |
| Conversions API (CAPI) y `Ajustes → Anuncios` | Spec 007. Aquí dejamos preparada la columna `ctwa_clid` y la separación lógica, pero no se envía nada a Meta ni se añade ninguna pestaña. |
| Backfill masivo de filas antiguas | No hay tabla previa: no hay filas a backfillear. |
| Script de re-descarga masiva de creativos | Una descarga por `(organization_id, source_id)`, best-effort al llegar. La reparación puntual al abrir el contacto cubre los reintentos. |
| Instagram / Messenger `referral` | Tienen otra forma (`ad_id`, `ads_context_data`). Spec aparte. |
| Sales Orchestrator / Jev | No se tocan. El origen del anuncio no es un input de la decisión comercial: es contexto de la bandeja y el panel. |
| Nombre del anuncio (campaña/adset/ad) | No los da el `referral`. La columna `source_id` ya es el identificador estable de Meta para el creativo. |

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Guardar de qué anuncio llegó (Priority: P1)

Cuando alguien escribe desde un anuncio CTWA, la conversación queda con su
anuncio de origen (titular + tipo + id), con la API y la UI mostrando el mismo
origen independientemente de lo que se haga en el futuro con CAPI / ATRIBUCION.

**Why this priority**: es el corazón de la feature. Sin captura no hay nada
que pintar en la bandeja ni en el panel.

**Independent Test**: un inbound del wa-mock con `referral` completo, leer
`GET /api/conversations` y `GET /api/contacts/:id`, comprobar el shape del
origen.

**Acceptance Scenarios**:

1. **Given** un primer mensaje con `referral` (`source_id`, `headline`, `body`,
   `source_url`, `image_url`/`thumbnail_url`, `media_type`, `source_type`,
   `ctwa_clid`), **When** se ingiere, **Then** la lista y el detalle del
   contacto traen el anuncio.
2. **Given** `source_type === "ad"`, **When** se pinta, **Then** la marca de la
   lista dice «Anuncio · titular» y la fuente del contacto (en el detalle) se
   deduce «anuncio» si no había fuente capturada a mano.
3. **Given** `source_type === "post"`, **When** se pinta, **Then** la marca de
   la lista dice «Publicación · titular» y el contacto sigue diciendo
   «desconocida» en la fuente (una publicación no es un anuncio pagado).
4. **Given** un `referral` sin `source_id`, sin `source_url`, sin `headline` y
   sin `ctwa_clid`, **When** se ingiere, **Then** no se crea fila de
   `ad_attribution` y el mensaje entra igual (el anuncio es contexto, el
   mensaje es lo que importa).
5. **Given** la misma entrega repetida por Meta (mismo `wa_message_id`) o un
   segundo mensaje de la misma conversación con otro `referral`, **When** se
   procesa, **Then** la fila original gana (`ON CONFLICT DO NOTHING` sobre
   `(organization_id, conversation_id)`) y el segundo mensaje no duplica el
   anuncio.
6. **Given** la fila existe con `ctwa_clid`, **When** se hace
   `GET /api/conversations` o `GET /api/contacts/:id`, **Then** el valor del
   `ctwa_clid` **nunca** aparece en la respuesta; el DTO expone
   `hasCtwaClid: true` y nada más.

### User Story 2 — Verlo en la bandeja, el panel y el pipeline (Priority: P1)

**Why this priority**: cerrar el bucle de UX. Si el origen se guarda pero no
se ve, no aporta nada al operador.

**Independent Test**: una conversación de anuncio y otra orgánica, abrir el
inbox, ver lista + filtro + panel; abrir el pipeline, ver la tarjeta del
lead.

**Acceptance Scenarios**:

1. **Given** una conversación de anuncio, **When** se ve la lista, **Then** su
   renglón muestra «Anuncio · titular» junto al avatar (chip o línea
   secundaria según el espacio).
2. **Given** al menos una conversación de anuncio en la bandeja, **When** se
   ve la lista, **Then** hay un filtro «Anuncios» con su contador que deja
   solo esas. Sin ninguna, el filtro no aparece.
3. **Given** esa conversación abierta, **When** se mira el panel lateral,
   **Then** hay una tarjeta con: imagen del creativo (si se pudo copiar),
   titular, texto del cuerpo, «Primer mensaje · fecha», «con video» si
   `media_type === "video"`, «ID <source_id>» y «Ver anuncio» (enlace `https`
   solo si la URL es `https://`; si no, no se muestra enlace).
4. **Given** una conversación orgánica, **When** se abre, **Then** no hay
   tarjeta de anuncio en el panel.
5. **Given** la conversación está en el kanban, **When** se ve su tarjeta,
   **Then** debajo del nombre aparece una línea secundaria «Anuncio · titular»
   (o «Publicación · titular») cuando hay origen; sin origen, esa línea no se
   muestra.

### User Story 3 — La imagen del creativo (Priority: P2)

La URL que Meta manda caduca en días. Se copia al llegar y se sirve como un
adjunto más.

**Acceptance Scenarios**:

1. **Given** un anuncio con `thumbnail_url` o `image_url` de un host de Meta,
   **When** se ingiere, **Then** la imagen queda guardada como `media_asset`
   y se sirve por `/api/media/[assetId]` con sesión (sin sesión, 401). Se
   prefiere `thumbnail_url` si está.
2. **Given** otra conversación del mismo `source_id` (mismo anuncio, persona
   distinta), **When** llega, **Then** se reutiliza la imagen ya guardada: no
   se descarga otra vez.
3. **Given** una URL fuera de los hosts permitidos, una redirección a otro
   host, un SVG, una imagen mayor de 300 KB o un fallo permanente, **When**
   se ingiere, **Then** la tarjeta aparece sin imagen y el mensaje entra igual
   (el fallo de la imagen nunca rompe la ingesta).
4. **Given** una descarga que falló una vez (tiempo, red, 5xx, 429), **When**
   se reintenta una vez, **Then** la imagen llega si el segundo intento va
   bien; si también falla, la fila queda con `image_asset_id = NULL` y la
   reparación al abrir el contacto lo vuelve a intentar (máximo una vez cada
   10 minutos por `(organization_id, source_id)`).
5. **Given** dos descargas simultáneas del mismo anuncio, **When** arrancan
   a la vez, **Then** solo se guarda un `media_asset` para ese anuncio: el
   segundo en terminar ve que ya hay fila y borra la suya.

### Edge Cases

- `referral` con cadenas gigantes o tipos equivocados: se recorta o se ignora;
  el raw guardado nunca pasa de 8 KB.
- Una fila guardada cuando ATRIBUCION vuelva a existir (futuro spec 007) y se
  apague después: la tarjeta sigue diciendo «Anuncio · titular» porque la
  marca visible no depende de la bandera; el `ctwa_clid` queda persistido si
  la fila se creó con la bandera encendida y sigue ahí después.
- Conversación del Laboratorio (`is_test = true`): jamás le llega un webhook
  real, por lo que jamás captura un anuncio. No requiere defensa adicional.

---

## Functional Requirements *(mandatory)*

- **FR-1** `WebhookMessage` (en `src/server/inbox/webhook.ts`) acepta un campo
  opcional `referral?: WebhookReferral` con el subconjunto documentado por
  Meta (`source_url`, `source_id`, `source_type`, `headline`, `body`,
  `media_type`, `image_url`, `video_url`, `thumbnail_url`, `ctwa_clid`). Sin
  campos privados del CRM.
- **FR-2** `processMessagesValue` (en `src/server/inbox/ingest.ts`) llama a
  una función pura de normalización (`anuncioDeWhatsapp`) y le pasa el
  resultado a `ingestInboundMessage` como `anuncio: AnuncioDeOrigen | null`.
  `ingestInboundMessage` NO recibe el `referral` crudo; solo el shape
  normalizado.
- **FR-3** `ingestInboundMessage` registra el anuncio **antes** del dedup del
  mensaje (`onConflictDoNothing`), dentro de un `try/catch`. Si la inserción
  falla, el mensaje entra igual: el origen es contexto, el mensaje es lo que
  importa. La fila gana con `ON CONFLICT DO NOTHING` sobre el UNIQUE
  `(organization_id, conversation_id)`.
- **FR-4** Una sola fila por conversación. Un segundo `referral` posterior
  (otro mensaje de la misma conversación) NO reemplaza el anuncio original;
  el INSERT entra en `DO NOTHING` y el `raw` no se pisa.
- **FR-5** Sin `ctwa_clid` (mientras la bandera no exista cableada en el
  entorno, equivalente a ATRIBUCION apagada): la columna se guarda `NULL` y
  el `raw` no contiene la clave `ctwa_clid`. La promesa del futuro spec 007
  (una instancia que no atribuye no acumula identificadores de clic) se
  respeta desde el primer despliegue de esta spec.
- **FR-6** El raw guardado es un `Record<string, string>` acotado por clave
  (subconjunto conocido de Meta) y por tamaño total (8 KB). Cadenas
  gigantes se truncan; tipos que no son string se descartan.
- **FR-7** La imagen del creativo se descarga de forma **best-effort, fuera
  del camino del webhook**, después de registrar el anuncio. Solo se acepta
  `https` desde hosts de Meta (allowlist cerrada:
  `fbcdn.net`/`fbsbx.com`/`facebook.com`/`cdninstagram.com`/`instagram.com` y
  sus subdominios); con los mocks habilitados se acepta además el origen de
  `META_GRAPH_BASE_URL`. Validación por salto de redirección (máx. 3), tipo
  MIME en `{image/jpeg, image/png, image/webp, image/gif}`, hasta 300 KB, 5 s
  por intento, un reintento ante fallo transitorio.
- **FR-8** La imagen se guarda como `media_asset` (kind=`image`, sin
  `wa_media_id`, `fetch_status=available`, `payload={origen:"anuncio",
  sourceId}`, `file_name=anuncio-{source_id}.{ext}`) bajo
  `MEDIA_DIR/{organization_id}/{asset_id}`. Se sirve por
  `/api/media/[assetId]` con sesión (igual que los adjuntos del 008).
- **FR-9** Si la imagen falla, abrir el contacto (`GET /api/contacts/:id`)
  dispara una reparación en segundo plano con freno: como mucho una vez cada
  10 minutos por `(organization_id, source_id)`. La fila queda con
  `image_asset_id = NULL` hasta que se copie.
- **FR-10** `GET /api/conversations` añade el campo aditivo
  `anuncio: { headline, sourceId, sourceType } | null` al `ConversationDto`.
  La query hace un `LEFT JOIN` por la llave `(organization_id, conversation_id)`
  — único por construcción — y nunca multiplica filas.
- **FR-11** `GET /api/contacts/:id` añade el campo aditivo
  `anuncio: AnuncioDto | null` con el detalle completo (sin el valor del
  `ctwa_clid`): `sourceId`, `sourceType`, `sourceUrl` (solo `https://`),
  `headline`, `body`, `mediaType`, `imageAssetId`, `hasCtwaClid`, `capturedAt`.
- **FR-12** El evento SSE `conversation.updated` lleva el `ConversationDto`
  completo (incluyendo `anuncio`). Tras copiar la imagen se publica un
  `conversation.updated` con la misma conversación para que el panel abierto
  se refresque solo.
- **FR-13** Lista: renglón con origen muestra la marca «Anuncio · titular»
  (o «Publicación · titular» si `source_type === "post"`). Sin titular, la
  marca cae a «Anuncio» o «Publicación» a secas. La marca visible **no**
  depende de la futura bandera ATRIBUCION.
- **FR-14** Lista: filtro `Anuncios` (chip junto a `Todas` / `No leídas`)
  solo aparece si hay al menos una conversación con origen `ad` o `post` en
  la bandeja. El chip muestra el contador. El selector de etapa se mantiene
  tal cual (selector a la derecha).
- **FR-15** Panel lateral: nueva sección `Origen del anuncio` (solo si hay
  fila de `ad_attribution` para esa conversación/contacto), entre la sección
  de contacto y el stepper de etapa. La tarjeta contiene: miniatura del
  creativo (si hay `imageAssetId` → `/api/media/[assetId]`; si no, espacio
  reservado con texto «Sin imagen»), titular, texto del cuerpo (recortado a 2
  líneas con ellipsis), «Primer mensaje · <fecha relativa corta>», badge
  «con video» si `media_type === "video"`, «ID <sourceId>» en monoespaciado
  pequeño, y enlace «Ver anuncio» (solo si `sourceUrl` empieza por
  `https://`).
- **FR-16** Pipeline: la tarjeta del lead añade una línea secundaria «Anuncio ·
  titular» (debajo del nombre) cuando hay origen. Sin tocar el refactor
  lateral de dnd-kit. Sin origen, esa línea no se muestra.
- **FR-17** Conversaciones orgánicas: ningún cambio observable. El renglón no
  muestra marca; el panel no muestra tarjeta; el pipeline no muestra línea
  secundaria.
- **FR-18** Sin Marketing API, sin nombre de campaña/adset/ad, sin CAPI, sin
  envío a Meta. Sin pestaña `Ajustes → Anuncios`. Esta spec NO crea ninguna
  ruta `/api/settings/capi*`, `/api/settings/anuncios*` ni equivalente.
- **FR-19** Sin cambios en Sales Orchestrator ni Jev. Sin cambios en
  follow-ups. Sin cambios en `send.ts`, `window.ts`, `agent_profile`,
  `pipeline_stage`, `agent_test_run`, `agent_test_case`.

---

## Non-Functional Requirements *(mandatory)*

- **NFR-1** Tenant-safe: `ad_attribution` lleva `organization_id NOT NULL`
  con índice org-first. Toda lectura pasa por `scoped()` o por la llave
  `(organization_id, conversation_id)` / `(organization_id, contact_id)`.
- **NFR-2** Idempotencia: `wa_message_id` UNIQUE (ya vigente) +
  `ad_attribution_org_conversation_uq` UNIQUE sobre
  `(organization_id, conversation_id)` + `ON CONFLICT DO NOTHING`. Reentregas
  y mensajes posteriores no duplican.
- **NFR-3** El fallo de captura del anuncio (BD, normalización, descarga de
  imagen) NUNCA rompe la ingesta del mensaje. La fila de mensaje sigue
  entrando, el agente sigue corriendo, el SSE sigue publicando.
- **NFR-4** La descarga de la imagen nunca bloquea el webhook: corre con
  `void Promise.resolve().then(...)` y se loguea en `[atribucion]` si falla.
- **NFR-5** Mantener `strict` + `noUncheckedIndexedAccess` de TS. Cero `any`
  en el shape nuevo. La normalización es pura y testeable sin BD.
- **NFR-6** Sin nuevas dependencias npm. Sin nuevos servicios externos. La
  única red que se toca es la lectura del thumbnail desde un host de Meta.
- **NFR-7** Migración aditiva y re-ejecutable (`ADD COLUMN IF NOT EXISTS`,
  `DO ... EXCEPTION WHEN duplicate_object` para FK, `CREATE INDEX IF NOT
  EXISTS` para índice). Verificable desde base vacía y desde base con
  migraciones previas aplicadas.
- **NFR-8** Las constantes de tamaño (300 KB, 8 KB raw, 128 id, 300 titular,
  2000 texto, 2048 URL) viven en un solo módulo (`src/server/attribution/referral.ts`)
  y se prueban en unit.
- **NFR-9** La allowlist de hosts de Meta vive en un solo módulo
  (`src/server/attribution/creativo.ts`) y se prueba en unit. Una URL que no
  cumpla jamás llega a `fetch()` (defensa contra SSRF).
- **NFR-10** El freno de reparación es una función pura con su mapa de
  claves, testeable sin BD: `crearFreno(ventanaMs, maxClaves)` con
  `intentar(clave, ahora) → boolean`.

---

## Success Criteria *(mandatory)*

- **SC-1** Gate técnico verde: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
- **SC-2** Tests unit del módulo `referral.ts` cubriendo: `anuncioDeWhatsapp`
  con referral completo, sin identificadores, con cadenas gigantes
  (recortadas), con tipos equivocados (ignorados), con `javascript:` / data URI
  (rechazados), `sinIdentificadorDeClic` (no muta el original), `imageUrl`
  prefiriendo `thumbnail_url` sobre `image_url`. ≥ 8 casos.
- **SC-3** Tests unit del módulo `creativo.ts` cubriendo:
  `urlDeCreativoPermitida` con todos los hosts de Meta (true), con http sin
  TLS, con usuario/contraseña en URL, con puerto que no es 443, con
  redirección a host no permitido, con SVG, con >300 KB, con URL inválida
  (false). `descargarCreativo` con imagen OK, redirección a host no permitido
  (ni se pide), redirección a host válido, 3+ redirecciones (corta), 5xx /
  429 (transitorio), 404 (permanente), timeout (transitorio). `descargarConReintento`
  reintenta una vez y nunca reintenta fallos permanentes. ≥ 12 casos.
- **SC-4** Tests unit de `crearFreno`: como mucho un intento por clave en la
  ventana; claves distintas no esperan entre sí; claves vencidas se purgan.
  ≥ 3 casos.
- **SC-5** Tests unit de `serializarAnuncio` y `cuentaComoAnuncio` /
  `etiquetaDeOrigen`: la marca visible no expone el valor de `ctwa_clid`; el
  enlace `sourceUrl` solo aparece si es `https://`; `source_type === "post"`
  se cuenta distinto a `ad` para el filtro Anuncios. ≥ 4 casos.
- **SC-6** Migración `0006_anuncio_de_origen.sql` aplica limpia sobre base
  vacía y sobre base con `0005` aplicada. Es re-ejecutable (segunda ejecución
  es no-op).
- **SC-7** Self-test E2E `pnpm test:e2e` con `ATRIBUCION` apagada (estado
  actual del entorno): un inbound con `referral` del wa-mock crea una fila
  en `ad_attribution`, la lista muestra «Anuncio · titular», el panel muestra
  la tarjeta con la imagen del creativo copiada por el `media-file` del
  mock, y el pipeline muestra la línea secundaria. La misma entrega repetida
  no duplica la fila ni la imagen. Conversación orgánica no muestra tarjeta.
- **SC-8** El campo `anuncio` del DTO de conversación es `null` para
  conversaciones orgánicas y no-nulo (con `headline`/`sourceId`/`sourceType`)
  para conversaciones con origen capturado.
- **SC-9** Una respuesta de `GET /api/contacts/:id` o de la lista NO contiene
  nunca la cadena `ctwa_clid` ni su valor, aunque la fila lo tenga guardado.
- **SC-10** Verificación manual con Playwright del camino feliz y del camino
  infeliz: red caída durante la descarga del creativo, URL inválida, SVG,
  >300 KB, redirección fuera de Meta, segundo mensaje posterior con otro
  `referral`, dos inbound simultáneos del mismo anuncio.
- **SC-11** No regresión de los specs 001–005 cerrados: webhook, ingest,
  ventana 24h, sandbox, composer, cola de adjuntos, edición inline de nombre.

---

## Constitution Check *(preview — detallado en plan.md)*

| Principio | Aplicación | Estado |
|---|---|---|
| **I — Seguridad** | `ctwa_clid` jamás sale por DTO. Imagen servida con sesión. Descarga solo `https` desde hosts de Meta, revalidando cada salto (SSRF defense). Cuerpo leído con tope, sin secretos en URL, sin puertos que no sean 443. | ✅ |
| **II — Soberanía** | Cero nuevas dependencias. Cero S3/R2/email/Stripe. La imagen se guarda en el volumen local self-hosted (mismo `MEDIA_DIR` que los adjuntos del 008). | ✅ |
| **III — Multi-tenancy** | `ad_attribution.organization_id NOT NULL` con índice. Toda lectura por `scoped()` o por la llave (org, conversación). La imagen bajo la organización de la fila. | ✅ |
| **IV — Idempotencia** | UNIQUE (org, conversación) + `ON CONFLICT DO NOTHING`. Migración re-ejecutable. Una descarga por `(org, source_id)`, deduplicada en memoria. | ✅ |
| **V — Calidad verificable** | Módulos puros + tests unit + self-test E2E + manual Playwright + gate técnico. | ✅ |
| **VI — Specs antes de código** | Este PR es la documentación; la implementación viene en los dos cortes siguientes. | ✅ |
| **VII — Trazabilidad** | Decisiones explícitas en `plan.md` §Decisiones (D-1 a D-6). Supuestos documentados. | ✅ |
| **VIII — Foco vertical** | Inbox + panel + pipeline. No broadcast, no scraping, no billing. | ✅ |
| **IX — Verificación en vivo** | Self-test E2E con guardarraíles + manual Playwright del camino feliz y del camino infeliz. | ✅ |

**Resultado**: sin violaciones. No hace falta Complexity Tracking.

---

## Decisiones explícitas del dueño (2026-09-29)

> **D-1 — El origen se ve siempre**, con ATRIBUCION cableada o sin ella.
> Capturar el `referral` es pasivo: viaja dentro del webhook que la instancia
> ya recibe, no pide credenciales, no llama a nadie y es inerte si nunca llega
> un anuncio. Decir de dónde llegó un cliente es parte de atenderlo.

> **D-2 — El `ctwa_clid` queda detrás del futuro flag ATRIBUCION.** Mientras
> la bandera no exista cableada en el entorno, este spec se comporta como si
> estuviera apagada: la columna `ctwa_clid` queda `NULL` y el `raw` no contiene
> la clave. Esto deja la superficie lista para que el spec 007 (CAPI) decida
> cuándo se persiste y cuándo se borra; hoy, en este spec, jamás se persiste.

> **D-3 — Solo WhatsApp por ahora.** Instagram y Messenger mandan otra forma
> de `referral` (`ad_id`, `ads_context_data`); quedan para un spec aparte con
> su propia función `anuncioDeInstagram` / `anuncioDeMessenger` al lado de
> `anuncioDeWhatsapp`, con la misma salida.

> **D-4 — La imagen va al volumen de adjuntos**, una sola vez por
> `(organization_id, source_id)`, servida por `/api/media/[assetId]` con
> sesión (igual que los adjuntos del 008). No un data URI por conversación.

> **D-5 — Solo hosts de Meta** (allowlist cerrada: `fbcdn.net`, `fbsbx.com`,
> `facebook.com`, `cdninstagram.com`, `instagram.com` y sus subdominios).
> Con los mocks habilitados, además el origen de `META_GRAPH_BASE_URL` (nunca
> en producción: `isMockEnabled` exige `NODE_ENV !== "production"`). La
> defensa SSRF es equivalente a la del upstream 018: validación por salto
> (máx. 3), tipo MIME y tamaño acotados, sin credenciales ni puertos raros.

> **D-6 — Sin Marketing API, sin nombre de campaña/adset/ad.** Meta no los
> entrega en el `referral`; exigirlos requiere la Marketing API con permisos
> del negocio y rompe el Principio II. La columna `source_id` ya es el
> identificador estable de Meta para el creativo; la UI lo muestra como
> «ID <source_id>» sin inventar nombres.

> **D-7 — Plan en dos cortes posteriores.** A) servidor/datos (schema,
> migración, normalización, ingesta, queries, lectura de imagen); B) UI
> (lista + filtro + tarjeta + pipeline) + E2E + cierre. Sin mezcla de
> alcance: cada commit deja el repo en estado verde.

---

## Fuera de alcance *(recordatorio)*

- Conversions API, envío a Meta, pestaña `Ajustes → Anuncios` → spec 007.
- Marketing API, nombre de campaña / adset / ad → no aplica (no llegan en
  el `referral`; exigirlo es otra feature, no esta).
- Instagram / Messenger `referral` → spec aparte.
- Backfill masivo de filas antiguas → no hay tabla previa.
- Script de re-descarga masiva → la reparación al abrir el contacto cubre
  el caso.
- Nombre del anuncio (humano) → solo el `source_id` que da Meta.
- Sales Orchestrator, Jev, follow-ups, sender, ventana 24h, sandbox → no se
  tocan.
- Endpoints nuevos fuera de los que ya existen
  (`GET /api/conversations`, `GET /api/contacts/:id`, SSE
  `conversation.updated`). No se crea `/api/settings/capi*`,
  `/api/settings/anuncios*` ni equivalente.
- Pestañas nuevas en Ajustes, ni en el sidebar de la app.

---

## Verification *(cómo se cierra "Hecho")*

1. Gates técnicos (SC-1).
2. Tests unitarios de los módulos puros (SC-2, SC-3, SC-4, SC-5).
3. Migración aplicada limpia desde base vacía y desde base con `0005` (SC-6).
4. Self-test E2E con `WA_MOCK_ENABLED=true` y los mocks del upstream (SC-7).
5. Inspección manual de los DTOs: nunca contienen el valor del `ctwa_clid`
   (SC-9).
6. Manual con Playwright del camino feliz y de los caminos infelices (SC-10).
7. No regresión de los specs cerrados (SC-11).
8. Cerrar el ciclo SDD: `tasks.md` con estado real, `docs/CURRENT_STATE.md`
   con el cierre del spec 006, sin reabrir nada.

---

## References

- **Upstream**: `kevinrivm/vocero-crm`, feature `018-anuncio-de-origen`
  (commits `f22ac03d5854a1f64581ceadb0a54072b2ae2419`,
  `2783c9a01ba79785bb9c1cafac085f1480edba74`,
  `53524ab1a163a504deaa0796d44c349ecbbf23ed`,
  `cf440653ab7b2d60090f1bdde51f1630d2a9ba47`,
  `17869cc6e79c868ad963f5b19132970ebf8342b4`).
  Este spec es un **puerto selectivo**: trae la pieza visible al raíz (bandeja
  con marca, panel con tarjeta, filtro Anuncios, copia best-effort del
  thumbnail). No trae CAPI (spec 007), no trae `Ajustes → Anuncios` (spec 007),
  no trae la pila multitenant del upstream (una instancia = un negocio).
- **Foundation vigente**: `CLAUDE.md` (reglas para Claude), `AGENTS.md`
  (jerarquía de verdad), `.specify/memory/constitution.md` (Principios I–IX).
- **Documentación relacionada**: `docs/CURRENT_STATE.md` (registra el spec
  abierto en este PR), `docs/SALES_ORCHESTRATOR.md` (no se toca en este
  spec), `.ai/tasks/vendeveloz-launch/00-overview.md` (este spec es el
  paso 3 del plan de salida a campañas de Vende Veloz).
