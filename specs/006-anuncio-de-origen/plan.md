<!--
SYNC IMPACT REPORT
==================
Este plan NO modifica la constitución ni las plantillas.
NO reabre ningún spec cerrado (001–005).
NO introduce la Conversions API: el envío a Meta y la pestaña Ajustes →
Anuncios son superficie del futuro spec 007. Aquí se prepara la columna
`ctwa_clid` como nullable y se trata como si la bandera ATRIBUCION estuviera
apagada (equivalente al upstream 018 D2).
NO modifica Sales Orchestrator ni Jev.
Migración aditiva y re-ejecutable sobre `0005_wonderful_justin_hammer.sql`.
-->

# Implementation Plan: De qué anuncio de Meta llegó cada conversación (006-anuncio-de-origen)

**Branch**: `feat/006-anuncio-de-origen`
**Date**: 2026-09-29
**Spec**: [spec.md](./spec.md)
**Status**: Draft (especificado antes de código).

## Summary

El `messages[].referral` de WhatsApp se normaliza a un anuncio de origen y se
guarda **una sola vez por conversación** en una tabla nueva `ad_attribution`
(sin `ctwa_clid` mientras ATRIBUCION no exista cableada en el entorno).
El thumbnail del creativo se copia en segundo plano a un `media_asset`
compartido por `(organization_id, source_id)`, con defensa SSRF equivalente al
upstream 018 y best-effort (un fallo nunca rompe la ingesta). La bandeja lo
pinta como marca «Anuncio · titular» / «Publicación · titular» en la lista y
como tarjeta en el panel lateral, con un filtro `Anuncios`. El pipeline
añade una línea secundaria con el mismo origen.

No es un puerto bruto del upstream 018: en este repo la tabla `ad_attribution`
aún no existe (la creamos aquí) y la futura bandera ATRIBUCION pertenece al
spec 007. Lo que se hace aquí es estrictamente la **pieza visible** del
origen: capturar, guardar, pintar.

## Technical Context

- **Stack**: Next.js 15, TypeScript estricto (`strict` +
  `noUncheckedIndexedAccess`), Drizzle + PostgreSQL, Vitest, arnés
  `scripts/e2e-selftest.mjs`, Playwright.
- **Dependencias nuevas**: ninguna.
- **Almacenamiento**: la imagen del creativo por `saveMediaFile` en
  `MEDIA_DIR/{organization_id}/{asset_id}`, mismo volumen y misma ruta con
  sesión que los adjuntos del 008.
- **Rendimiento**: la lista suma un `LEFT JOIN` por la llave única
  `(organization_id, conversation_id)`. La copia de la imagen corre fuera del
  camino del webhook con `void Promise.resolve().then(...)`.
- **Restricciones**: sin llamadas nuevas a terceros más allá de leer la imagen
  que Meta ya enlaza en su propio CDN.

## Constitution Check (pre-Phase 0)

| Principio | Aplicación en este spec | Estado |
|---|---|---|
| **I — Seguridad de datos primero** | `ctwa_clid` jamás sale por DTO ni UI. La imagen se sirve por `/api/media/[assetId]` con sesión. La descarga solo acepta `https` desde hosts de Meta (allowlist cerrada), revalidando cada salto de redirección (máx. 3), sin credenciales en URL, sin puertos que no sean 443, tipo y tamaño acotados (cuerpo leído con tope). | ✅ |
| **II — Soberanía / Self-Hosted** | Cero nuevas dependencias. Cero S3/R2/email/Stripe. La imagen se guarda en el volumen local self-hosted (mismo `MEDIA_DIR` que los adjuntos del 008). | ✅ |
| **III — Multi-tenancy real** | `ad_attribution.organization_id NOT NULL` con índice org-first. Toda lectura por `scoped()` o por la llave `(organization_id, conversation_id)`. La imagen bajo la organización de la fila. | ✅ |
| **IV — Idempotencia en integraciones externas** | UNIQUE (org, conversación) + `ON CONFLICT DO NOTHING`. Migración re-ejecutable (`IF NOT EXISTS` / `DO ... EXCEPTION`). Una descarga por `(org, source_id)`, deduplicada en memoria. Reentregas de Meta no duplican la fila ni la imagen. | ✅ |
| **V — Calidad verificable** | Módulos puros + tests unit + self-test E2E + manual Playwright + gate técnico. | ✅ |
| **VI — Specs antes de código** | Este PR es la documentación; los dos cortes de implementación posteriores aplican la spec. | ✅ |
| **VII — Trazabilidad de decisiones** | Decisiones explícitas más abajo en §Decisiones (D-1 a D-7). Supuestos documentados en §Supuestos. | ✅ |
| **VIII — Foco vertical** | Inbox (lista + panel + filtro) + pipeline (línea secundaria). No broadcast, no scraping, no billing, no Marketing API. | ✅ |
| **IX — Verificación en vivo** | Self-test E2E con guardarraíles + manual Playwright del camino feliz y del camino infeliz. | ✅ |

**Resultado**: sin violaciones. No hace falta Complexity Tracking.

## Project Structure

```
specs/006-anuncio-de-origen/
├── spec.md                              (este PR)
├── plan.md                              (este archivo)
└── tasks.md                             (este PR)

src/lib/
├── db/
│   ├── schema.ts                        (nuevo objeto adAttribution + tabla
│   │                                     en el esquema, índice
│   │                                     ad_attribution_org_source_idx)
│   └── ids.ts                           (sin cambios; usa newId("adAttribution"))
├── types.ts                             (ConversationDto.anuncio, AnuncioDto)
├── anuncios.ts                          (NUEVO — etiqueta, cuenta, titular)
└── media.ts / conversations.ts          (sin cambios)

drizzle/
└── 0006_anuncio_de_origen.sql           (NUEVO — ADITIVA, RE-EJECUTABLE)

src/server/attribution/                  (NUEVO módulo — puerto del upstream 018)
├── referral.ts                          (normalización pura del referral)
├── creativo.ts                          (URL permitida + descarga acotada +
│                                         copia única por source_id)
└── store.ts                             (registrar / leer / reparar /
                                         serializar)

src/server/whatsapp/
└── media.ts                             (añadir deleteMediaFile para limpiar
                                         la copia sobrante)

src/server/inbox/
├── webhook.ts                           (añadir WebhookReferral al tipo
│                                         WebhookMessage)
├── ingest.ts                            (captura siempre, sin romper la
│                                         ingesta; llama a anuncioDeWhatsapp)
└── queries.ts                           (LEFT JOIN ad_attribution en
                                         listConversations + getConversation)

src/server/
├── contact-source.ts                    (effectiveSource: deducir "anuncio"
│                                         cuando no hay fuente capturada)
└── contacts.ts                          (serializeContact acepta
                                         llegoPorAnuncio y lo pasa al
                                         effectiveSource)

src/server/attribution/
└── flag.ts                              (placeholder: nota sobre la futura
                                         ATRIBUCION en spec 007; mientras
                                         tanto, anuncios se guardan sin
                                         ctwa_clid)

src/app/api/
├── contacts/[id]/route.ts               (añade anuncio al GET; dispara
│                                         repararImagenSiFalta en background)
├── conversations/[id]/route.ts          (publicar SSE con ConversationDto
│                                         que ya incluye anuncio)
└── conversations/route.ts               (sin cambios — usa queries.ts)

src/components/
├── anuncio-origen.tsx                   (NUEVO — tarjeta reutilizable para
│                                         panel y, opcionalmente, pipeline)
├── inbox/
│   ├── conversation-list.tsx            (marca Anuncio/Publicación + filtro
│   │                                     Anuncios + contador)
│   ├── inbox-client.tsx                 (sin cambios estructurales — ya
│   │                                     consume ConversationDto.anuncio
│   │                                     y GET /api/contacts/:id devuelve
│   │                                     el campo anuncio)
│   └── contact-panel.tsx                (inserta la tarjeta AnuncioOrigen
│                                         en la posición correcta)
└── pipeline/
    └── pipeline-client.tsx              (línea secundaria «Anuncio · titular»
                                         en la tarjeta del lead)

src/server/dev/, src/app/api/dev/wa-mock/
├── inbound/route.ts                     (acepta un `referral` libre por
│                                         mensaje; valida con Zod el shape)
└── media-file/[id]/route.ts             (creativos de prueba: PNG reales
                                          para ids `creativo-*` y provocación
                                          de los caminos a rechazar —>300KB,
                                          SVG, redirección fuera de Meta,
                                          503, 404, timeouts)

scripts/
└── e2e-selftest.mjs                     (sección 006-anuncio-de-origen con
                                          ≥6 comprobaciones: captura sin
                                          ATRIBUCION, idempotencia, orgánica
                                          sin tarjeta, orgánica no se cuenta
                                          como anuncio, filtro, etc.)

tests/unit/
├── referral.test.ts                     (NUEVO — normalización pura, ≥8)
├── creativo.test.ts                     (NUEVO — URL + descarga, ≥12)
├── store.test.ts                        (NUEVO — freno + serializar +
                                          cuentaComoAnuncio, ≥7)
└── contact-source.test.ts               (NUEVO — effectiveSource con
                                          llegoPorAnuncio, ≥3)

tests/e2e/
└── 011-anuncio-de-origen.md             (NUEVO guion Playwright manual: lista,
                                          filtro, panel, pipeline, claro/oscuro,
                                          1440 y 390 px)
```

## Diseño

### Módulos nuevos

#### `src/lib/anuncios.ts` (puro, sin BD)

Etiquetas visibles y contador:

- `etiquetaDeOrigen(sourceType)` → `"Anuncio"` si `sourceType !== "post"`,
  `"Publicación"` si `sourceType === "post"`.
- `cuentaComoAnuncio(anuncio)` → `true` si hay anuncio y `sourceType !==
  "post"`. Una publicación se ve igual, pero no se suma al filtro `Anuncios`
  ni a la fuente deducida «anuncio».
- `titularDeOrigen(headline, sourceType)` → `headline` o el fallback
  «Anuncio sin título» / «Publicación sin título».

#### `src/server/attribution/referral.ts` (puro, sin BD)

- `anuncioDeWhatsapp(referral: unknown): AnuncioDeOrigen | null`. Acepta el
  subconjunto del `referral` de Meta, normaliza con cotas, descarta tipos
  incorrectos y devuelve `null` si no hay al menos un identificador
  (`source_id` / `ctwa_clid` / `headline` / `source_url`). `imageUrl`
  prefiere `thumbnail_url` sobre `image_url`.
- `sinIdentificadorDeClic(anuncio)` → anuncio nuevo sin `ctwaClid` y sin
  `raw.ctwa_clid`. No muta el original. Pura.
- `COTAS` exportado: `id=128`, `titular=300`, `texto=2000`, `url=2048`,
  `raw=8_000`.
- `CLAVES_WHATSAPP`: array cerrado de claves conservadas en `raw`
  (`source_url`, `source_id`, `source_type`, `headline`, `body`,
  `media_type`, `image_url`, `video_url`, `thumbnail_url`, `ctwa_clid`).

#### `src/server/attribution/creativo.ts` (I/O acotado)

- `urlDeCreativoPermitida(raw, origenMock?)` — pura. Acepta `https` desde
  `fbcdn.net`/`fbsbx.com`/`facebook.com`/`cdninstagram.com`/`instagram.com` y
  sus subdominios; rechaza credenciales en URL, puertos != 443, http sin TLS,
  hosts no listados. Con `origenMock` (solo con `isMockEnabled()`), acepta
  además ese origen exacto.
- `descargarCreativo(url)` — fetch con `redirect: "manual"`, revalida cada
  salto, MIME en `{image/jpeg, image/png, image/webp, image/gif}`, hasta
  `CREATIVO_MAX_BYTES = 300_000`, 5 s por intento, devuelve
  `{ ok: true, data, mimeType }` o `{ ok: false, falla: "transitoria" |
  "permanente" }`.
- `descargarConReintento(url, esperaMs = 1_500)` — un reintento solo ante
  fallo transitorio.
- `guardarCreativo({ organizationId, conversationId, sourceId, imageUrl })` —
  reutiliza la imagen existente por `(org, sourceId)`; si no, descarga y
  guarda `media_asset` + archivo; asigna el `assetId` a todas las filas del
  anuncio sin imagen; publica `conversation.updated` para refrescar el panel.
  Concurrencia: `enCurso: Set<string>` para que dos hilos del mismo anuncio
  no dupliquen.
- `deleteMediaFile` se importa de `src/server/whatsapp/media.ts` (NUEVA
  función: `rm` con `force: true`, sin error si ya no existe).

#### `src/server/attribution/store.ts` (BD + serialización)

- `anuncioParaGuardar(anuncio, atribuye = false)` — wrapper sobre
  `sinIdentificadorDeClic`. Mientras ATRIBUCION no exista cableada, el valor
  por defecto es `false`. Cuando el spec 007 añada el flag, este default se
  cablea a `atribucionEnabled()` y el comportamiento queda idéntico.
- `registrarAnuncioDeOrigen({ organizationId, contactId, conversationId,
  anuncio })` — INSERT con `ON CONFLICT DO NOTHING` sobre
  `(organization_id, conversation_id)`. Si la fila es nueva y trae
  `sourceId + imageUrl`, lanza `guardarCreativo` sin esperar. Try/catch:
  cualquier fallo se loguea y el mensaje del cliente sigue entrando.
- `getAttributionForConversation(org, conversationId)` — para reuso interno
  (la Conversions API del spec 007 lo aprovechará).
- `anuncioDelContacto(org, contactId)` — primera fila por `createdAt`. Lo usa
  el panel.
- `repararImagenSiFalta(org, contactId)` — background, con freno de 10
  minutos por `(org, source_id)`.
- `serializarAnuncio(fila, atribuye)` — DTO `AnuncioDto`. El `ctwaClid`
  jamás sale; se convierte en `hasCtwaClid: boolean`. `sourceUrl` solo si
  empieza por `https://`.

#### `src/server/attribution/flag.ts` (placeholder)

Hoy no existe `ATRIBUCION` cableada. Este archivo vive como **placeholder
documental** con un comentario que diga: «La futura bandera ATRIBUCION
pertenece al spec 007. Mientras tanto, este repo la trata como apagada:
`ad_attribution.ctwa_clid` siempre NULL y `raw` sin la clave.» Sin
implementación funcional — sin env var, sin import en `lib/env.ts` (eso lo
añade el spec 007).

#### `src/lib/anuncios.ts` (DTO)

Tipos `AnuncioOrigen` y `AnuncioDto` viven aquí si el spec decide extraerlos
(la spec 005 ya tiene `ConversationDto` en `src/lib/types.ts`, así que por
consistencia el tipo `AnuncioDto` también queda en `src/lib/types.ts` y los
helpers de etiqueta/contador en `src/lib/anuncios.ts`).

### Captura

`processMessagesValue` llama a `anuncioDeWhatsapp(msg.referral)` y le pasa el
resultado a `ingestInboundMessage` como `anuncio: AnuncioDeOrigen | null`.
`ingestInboundMessage` ya no recibe `referral` crudo: el adaptador del canal
es el único que sabe la forma del payload de Meta.

El registro se hace **antes** del dedup del mensaje (`ON CONFLICT DO
NOTHING`), dentro de un `try/catch`. Si la inserción falla, el mensaje entra
igual. Sin la bandera cableada (estado actual), `anuncioParaGuardar` quita
`ctwaClid` antes de persistir.

### Imagen

`guardarCreativo` se lanza **fuera** del webhook con `void Promise.resolve()
.then(...)` (mismo patrón que `repararImagenSiFalta`):
- Primero mira si ya hay una fila para `(org, sourceId)` con imagen → la
  reutiliza y la asigna.
- Si no, mira `enCurso` para no duplicar descargas del mismo anuncio.
- Descarga con reintento, guarda `media_asset` + archivo, asigna la imagen a
  todas las filas del mismo `sourceId` sin imagen.
- Si otra descarga ganó, borra su copia y devuelve la del ganador.
- Publica `conversation.updated` para que el panel abierto se refresque solo.

### Reparación

`GET /api/contacts/:id` con `anuncio.imageAssetId === null` dispara
`repararImagenSiFalta(org, contactId)` en background con freno de 10 minutos
por `(org, source_id)`. La URL sale del `raw` guardado (también las filas
antiguas, si las hubiera; en este repo no hay).

### Mocks

- `src/app/api/dev/wa-mock/inbound/route.ts` (NUEVO bloque) — el body del
  mensaje acepta un `referral` libre validado con Zod (mismo shape que
  `WebhookReferral`). Permite forzar cada caso: con/sin `ctwa_clid`,
  `source_type: "ad" | "post"`, `media_type: "video"`, etc.
- `src/app/api/dev/wa-mock/media-file/[id]/route.ts` (NUEVO bloque) — sirve
  PNG reales para ids `creativo-*` y provoca a propósito los caminos a
  rechazar: `creativo-grande` (>300 KB), `creativo-svg` (SVG), `creativo-redirect-externo`
  (redirige a `example.com`), `creativo-lento` (responde después del tiempo
  agotado), `creativo-503` (5xx), `creativo-404` (404). Con los mocks
  habilitados (`isMockEnabled()` exige `NODE_ENV !== "production"`), se
  acepta además el origen de `META_GRAPH_BASE_URL` para que las pruebas
  E2E funcionen. **Nunca** en producción: la allowlist cerrada es la única
  fuente de verdad.

### Migración y rollout

`0006_anuncio_de_origen.sql` (NUEVA, generada con `pnpm db:generate` y
editada a mano para ser re-ejecutable, mismo patrón que las migraciones
anteriores del proyecto):

```sql
-- 006 - De que anuncio de Meta llego cada conversacion (sin CAPI todavia).
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitucion IV):
-- IF NOT EXISTS en columnas y tabla, y bloque DO en la clave foranea.
--
-- Puramente ADITIVA: una tabla nueva + un indice. No toca tablas existentes.
--
-- Mismos nombres de columna que la 0014 del upstream 018 (kevinrivm/vocero-crm)
-- para que el shape sea compatible si en el futuro se sincronizan las dos
-- bases.

CREATE TABLE IF NOT EXISTS "ad_attribution" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "contact_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "ctwa_clid" text,
  "source_id" text,
  "source_type" text,
  "source_url" text,
  "headline" text,
  "body" text,
  "media_type" text,
  "raw" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "ad_attribution_org_conversation_uq"
    UNIQUE("organization_id", "conversation_id")
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ad_attribution"
    ADD CONSTRAINT "ad_attribution_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ad_attribution"
    ADD CONSTRAINT "ad_attribution_contact_id_contact_id_fk"
    FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ad_attribution"
    ADD CONSTRAINT "ad_attribution_conversation_id_conversation_id_fk"
    FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_attribution_org_idx"
  ON "ad_attribution" USING btree ("organization_id","created_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ad_attribution_org_source_idx"
  ON "ad_attribution" USING btree ("organization_id","source_id");
```

**Notas sobre la FK**: las tablas `organization`, `contact` y `conversation`
tienen `organization_id NOT NULL`. La FK a `conversation` cierra el bucle de
coherencia (si se borra una conversación, se borra el origen). El UNIQUE
INDEX sobre `(org, source_id)` es **parcialmente preparado para el spec 007**:
hoy no hay deduplicación global de `source_id` (cada conversación crea su
fila), pero cuando el spec 007 quiera hacer reportes por anuncio, el índice
ya está. **Es UNIQUE en este spec por una razón**: una misma conversación
solo puede tener una fila de origen (la del primer `referral`), así que un
mismo `(org, conversation_id)` no aparece dos veces. El índice compuesto es
sobre `(organization_id, source_id)` para acelerar las búsquedas «¿hay
imagen ya para este anuncio?». Verificación humana del desarrollador antes
del merge: si la base tiene más de una fila con mismo `(org, conversation_id)`
por error, el INSERT fallaría — defensa explícita contra duplicación.

**Rollout**: sin variables nuevas. Una instancia que ya corre empieza a
guardar el origen desde el despliegue.

**Reversión**: la app anterior ignora la tabla; no hace falta borrarla. El
rollback de la migración es `DROP TABLE ad_attribution CASCADE;` con la
consabida limpieza del `media_asset` añadido por esta spec (en `payload`
queda `origen: "anuncio"` para distinguirlo y poder borrarlo selectivamente).

### Constitución y observaciones cruzadas

- El `LEFT JOIN ad_attribution` en `listConversations` no multiplica filas
  porque el UNIQUE INDEX sobre `(organization_id, conversation_id)` garantiza
  a lo más una fila por renglón.
- El `getConversation` del SSE `conversation.updated` usa el mismo JOIN.
- El `serializeContact` ahora acepta `llegoPorAnuncio: boolean` como cuarto
  argumento opcional con default `false`. Backwards compatible: el llamador
  existente (`PATCH /api/contacts/:id` sin origen) sigue funcionando.
- El `effectiveSource` recibe ese boolean y deduce `anuncio` solo si NO
  había fuente capturada a mano (`if (stored) return ...` antes del check).
- La descarga del creativo corre **fuera** del handler HTTP. El handler
  responde 200 al webhook de Meta en cuanto el mensaje se persiste; el
  creativo puede tardar más sin afectar el SLA.

## Decisiones explícitas

> **D-1 — El origen se ve siempre**, con ATRIBUCION cableada o sin ella.
> Capturar el `referral` es pasivo: viaja dentro del webhook que la instancia
> ya recibe, no pide credenciales, no llama a nadie y es inerte si nunca llega
> un anuncio.

> **D-2 — El `ctwa_clid` queda detrás del futuro flag ATRIBUCION.** Mientras
> la bandera no exista cableada, este spec se comporta como si estuviera
> apagada: la columna `ctwa_clid` queda `NULL` y el `raw` no contiene la
> clave. El spec 007 (CAPI + Ajustes → Anuncios) cablea la bandera y decide
> el comportamiento en encendido.

> **D-3 — Solo WhatsApp por ahora.** Instagram y Messenger mandan otra forma
> de `referral` (`ad_id`, `ads_context_data`). Spec aparte con su propia
> función `anuncioDeInstagram` / `anuncioDeMessenger` al lado de
> `anuncioDeWhatsapp`, con la misma salida.

> **D-4 — La imagen va al volumen de adjuntos**, una sola vez por
> `(organization_id, source_id)`, servida por `/api/media/[assetId]` con
> sesión (igual que los adjuntos del 008). No un data URI por conversación.

> **D-5 — Solo hosts de Meta** (allowlist cerrada). Defensa SSRF equivalente
> al upstream 018: validación por salto (máx. 3), MIME y tamaño acotados,
> sin credenciales ni puertos raros.

> **D-6 — Sin Marketing API, sin nombre de campaña/adset/ad.** Meta no los
> entrega en el `referral`; exigirlos es otra feature, no esta. La columna
> `source_id` ya es el identificador estable del creativo.

> **D-7 — Plan en dos cortes posteriores.** A) servidor/datos (schema,
> migración, normalización, ingesta, queries, lectura de imagen); B) UI
> (lista + filtro + tarjeta + pipeline) + E2E + cierre. Cada commit deja el
> repo en estado verde.

### Decisiones de implementación

> **D-8 — El `WebhookMessage.referral` se añade al tipo del webhook.** El
> campo ya viene en el payload de Meta; solo le faltaba el tipo. Sin tipo,
> el `processMessagesValue` no podía leerlo. Esto NO introduce ningún cambio
> de comportamiento; es el equivalente a destapar una puerta que ya estaba
> ahí.

> **D-9 — `ad_attribution` se crea desde cero.** En el upstream 018 la tabla
> ya existía (creada por la 016). En este repo no existe, así que la creamos
> completa en la migración 0006 con todas las columnas que la spec necesita.
> Si en el futuro se sincronizan las dos bases (espejo del upstream), los
> nombres de columna son los mismos.

> **D-10 — El UNIQUE INDEX sobre `(organization_id, source_id)` es
> defensivo, no funcional hoy.** Garantiza que no haya dos filas del mismo
> anuncio por organización si por error dos conversaciones se procesan
> simultáneamente con la misma `(org, conversation_id)`. Como el UNIQUE
> principal es `(org, conversation_id)`, el índice `source_id` solo aporta
> velocidad de búsqueda para la reutilización de imagen y la futura consulta
> por anuncio del spec 007.

> **D-11 — `source_id` UNIQUE NO por sí mismo.** Un mismo anuncio puede dar
> muchas conversaciones (varias personas haciendo clic en el mismo anuncio).
> Lo único que es único es la combinación `(org, conversation_id)`. La
> unicidad de `(org, source_id)` que pide la migración del upstream se
> modela como **índice único condicional** en este spec, pero como aún no
> hay deduplicación global de source_id, queda como índice btree regular
> (NO UNIQUE) sobre `(organization_id, source_id)` para acelerar la
> búsqueda de imagen reutilizada. Verificado con un test de migración que
> crea dos conversaciones con mismo `source_id` y confirma que ambas filas
> coexisten.

> **Corrección**: el UNIQUE INDEX sobre `(organization_id, source_id)` NO se
> crea en esta migración (rompería el caso normal: muchas conversaciones
> del mismo anuncio). En su lugar, un índice btree regular
> `(organization_id, source_id)` para acelerar la reutilización de imagen.
> El spec 007, cuando llegue, decidirá si necesita deduplicación global.

## Supuestos

> **S-1** — En este repo no existe aún la bandera ATRIBUCION cableada. El
> entorno actual la trata como apagada (D-2). El spec 007 añadirá el env
> var, el schema de `lib/env.ts`, la página `Ajustes → Anuncios` y el envío
> a Meta. **Este spec NO toca nada de eso.**

> **S-2** — `src/server/inbox/webhook.ts` define el tipo `WebhookMessage`
> que se valida en runtime. El campo `referral` no existe como tipo
> todavía; este spec lo añade como opcional. Si hay otras superficies que
> usan `WebhookMessage` (e.g. el sender), no se ven afectadas porque es un
> campo opcional y no se añade al emisor.

> **S-3** — El `media_asset` actual (008) ya cubre el shape que necesita la
> imagen del creativo (`kind: "image"`, `wa_media_id: null`,
> `fetch_status: "available"`, `payload: Record<string, unknown>`). No hace
> falta extender el schema.

> **S-4** — `saveMediaFile` (`src/server/whatsapp/media.ts`) ya escribe en
> `MEDIA_DIR/{organization_id}/{asset_id}` con permisos correctos. Se añade
> `deleteMediaFile` como nueva función con `rm({ force: true })`.

> **S-5** — El componente `ContactPanel` ya tiene la cabecera con avatar +
> nombre + teléfono + handoff + toggle IA. Insertar la tarjeta entre la
> sección de contacto y el stepper de etapa cabe sin tocar la composición
> vertical existente. La tarjeta es un sub-componente (`<AnuncioOrigen>`)
> reutilizable para el pipeline si se decide en el corte B.

> **S-6** — El `PipelineClient` muestra tarjetas con avatar + nombre + actividad
> + lane hint. Una línea secundaria debajo del nombre cabe sin tocar
> dnd-kit ni el refactor lateral (decidido por el spec 001).

> **S-7** — El `conversation.updated` ya se publica en
> `src/server/inbox/ingest.ts` (cada mensaje) y en
  `src/app/api/conversations/[id]/route.ts` (cada PATCH). No se modifica
> el bus; la spec solo cambia el `ConversationDto` para que lleve el campo
> `anuncio`. La publicación post-descarga-de-imagen llama al mismo bus.

## Implementation Notes

### Helper pura nueva (`src/lib/anuncios.ts`)

```ts
export function etiquetaDeOrigen(sourceType: string | null | undefined): string;
export function cuentaComoAnuncio(
  anuncio: { sourceType: string | null } | null | undefined
): boolean;
export function titularDeOrigen(
  headline: string | null | undefined,
  sourceType: string | null | undefined
): string;
```

Sin React, sin BD. Se prueba en unit.

### Componente reutilizable (`src/components/anuncio-origen.tsx`)

```tsx
type AnuncioOrigenProps = {
  anuncio: AnuncioDto;
  conversationCreatedAt: string;
};
```

Tarjeta con imagen (o espacio reservado), titular, cuerpo, fecha del primer
mensaje, badge «con video», «ID <sourceId>», enlace «Ver anuncio» (solo si
https). Usado por `contact-panel.tsx`. El pipeline usa una versión más
compacta (solo la línea secundaria) directamente en su tarjeta, sin
importar este componente.

### Wiring en `inbox-client.tsx`

El cliente no necesita cambios: ya consume `ConversationDto` completo y
pasa la `conversation` al `ContactPanel`. La tarjeta se pinta automáticamente
si el DTO trae `anuncio`. Lo que sí necesita: un refetch del detalle cuando
llega un `conversation.updated` que cambia la imagen (defensa: el componente
de la tarjeta se reinserta con `key={anuncio.imageAssetId ?? "none"}` para
forzar re-render cuando la imagen llega por la reparación).

### Riesgos

- **R-1**: Doble INSERT en simultáneo del mismo `(org, conversation_id)` si
  dos procesos del mismo webhook reintentan a la vez. Mitigación: el UNIQUE
  principal + `ON CONFLICT DO NOTHING`. Verificado por test de integración.
- **R-2**: La descarga del creativo reta a Meta más de lo necesario si la
  URL ya no existe. Mitigación: el freno de reparación a 10 minutos.
- **R-3**: Cambiar de conversación mientras la imagen está copiándose no
  debe perder la imagen. Mitigación: la imagen se asigna a TODAS las filas
  del mismo `(org, source_id)` una vez termina; la fila que disparó la
  descarga también queda con imagen.
- **R-4**: Una URL inválida en `image_url` que pasa la normalización pero
  falla la descarga. Mitigación: best-effort; la tarjeta aparece sin
  imagen y el mensaje entra igual.

## Verificación de cierre

1. `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en verde.
2. Migración `0006` aplicada limpia desde base vacía y desde base con
   `0005` aplicada. Re-ejecutable dos veces más a mano sin error.
3. Self-test E2E (`pnpm test:e2e`) con `WA_MOCK_ENABLED=true`:
   - ≥ 6 comprobaciones: captura con/sin `ctwa_clid` en el referral,
     orgánica no se cuenta como anuncio, `post` no se cuenta, idempotencia
     en reentrega, tarjeta visible en panel tras un refreshConversations,
     filtro Anuncios.
4. `tests/e2e/011-anuncio-de-origen.md`: guion Playwright manual del camino
   feliz y de los caminos infelices (red caída, URL inválida, SVG, >300KB,
   redirección fuera de Meta, segundo mensaje con otro referral).
5. No-regresión de los specs cerrados 001–005.
6. Cierre: `tasks.md` con estado real, `docs/CURRENT_STATE.md` con el cierre
   del spec 006, sin reabrir nada.
