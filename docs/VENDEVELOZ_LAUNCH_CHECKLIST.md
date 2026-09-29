# Vende Veloz — Launch Readiness Checklist (Corte 9)

> **Cierre documental.** Este archivo NO agrega features; consolida el estado
> técnico del repositorio para que **Max** decida el lanzamiento de la primera
> campaña de Vende Veloz 365 sobre la instalación interna de Espacio Connect.
>
> La decisión de "go / no-go" sigue siendo del dueño del negocio. Este checklist
> responde "¿qué está verificado en el repo y qué falta confirmar en producción?".
>
> **No se ha ejecutado nada externo en este corte.** No se encendieron flags, no
> se creó ninguna campaña, no se gastó dinero. Tampoco se cambiaron flags de
> producción. La auditoría se limita a leer el repo, correr los gates en local
> (sin app ni BD activas) y consolidar el estado.

---

## Resumen ejecutivo

| Bloque | Verificación en repo | Bloquea lanzamiento | Estado |
|---|---|---|---|
| Agente (legacy + Orchestrator/Jev) | Unit + E2E parcial | No, pero exige credenciales reales para E2E vivo | Listo para prender |
| Follow-ups comerciales | Unit completo, E2E local pendiente | No, pero exige `pnpm dev` + Postgres para correr `runSection009`/`010` en vivo | Listo para prender con plantilla 0-var |
| Conversión CAPI (`QualifiedLead` / `Purchase`) | Unit + `runSection012` en código | Sí — exige **clic CTWA real** en producción para confirmar `fbtrace_id` real | Código listo; verificación humana pendiente |
| Inbox + remitente | Verificado desde 001–004 | No | Listo |
| Templates + sandbox | Verificado | No | Listo |
| Storage de media/creativos | Implementado, exige volumen persistente | Sí en producción | Listo al montar `/data/media` |
| Bandera `ATRIBUCION` (apagada por defecto) | Verificada | No (apagada) | Listo para prender |

**Veredicto técnico del corte 9:** la base del CRM está **técnicamente
lista** para abrir campañas reales. Los tres pendientes que sí tocan
producción son:

1. **E2E local con app + Postgres activos** (no automatizable en este entorno;
   requerido por Constitución IX para considerar punta a punta verificado).
2. **Clic CTWA real en producción** para confirmar la fila `sent` con
   `fbtrace_id` real de Meta. No automatizable (mismo límite que el upstream
   016 y 018).
3. **Storage persistente `/data/media` montado** en el host antes de que
   llegue un inbound con imagen, si se quiere conservar el creativo.

---

## A) IMPLEMENTADO Y VERIFICADO EN REPO

> Piezas cuyo código está en `main` y cuya verificación automática (gates)
> pasó en este corte. Cero afirmaciones sobre comportamiento externo: lo que
> está aquí está verificado en el repo, no en producción.

### A.1 Gates máximos razonables ejecutados en este corte

| Gate | Resultado | Notas |
|---|---|---|
| `pnpm typecheck` | **verde** (exit 0) | TypeScript estricto, `strict` + `noUncheckedIndexedAccess`. |
| `pnpm lint` | **verde** (0 errors, 1 warning) | Warning preexistente en `src/components/anuncio-origen.tsx:65` — `<img>` no `next/image` (aceptado, el repo ya opta por `<img>` autenticado para `/api/media/:assetId`). |
| `pnpm build` | **verde** (exit 0) | 60+ rutas server-rendered; las del Corte C (`/settings/ads`, `/api/settings/capi`, `/api/settings/capi/events`) están construidas y solo se sirven con `ATRIBUCION=on`. |
| `pnpm test` | **verde** — **646/646 pass**, 74 archivos, 5.03 s | Cubre 001–004 + 005 (helper + tests + sección 010), 006 (`attribution-referral`, `attribution-creativo`, `attribution-store`, `contact-source`) + sección 011, 007 (`capi-payload` 19 tests, `capi-flag` 7, `capi-conversions`) + sección 012 + gateway `stage-gateway.test.ts` (20 tests). |
| `pnpm test:e2e` | **NO EJECUTADO** | `GET http://localhost:3000/api/health` → `000` (sin app); sin Postgres local; `pg_isready` no disponible en el WSL actual. **No se inventó resultado**; Constitución IX exige ejecución en vivo antes de declarar READY punta a punta. |

### A.2 Specs SDD cerrados

| Spec | Estado | Commit de cierre | Evidencia |
|---|---|---|---|
| `001-vocero-core` | Cerrado | histórico | Webhook + inbox + sender + pipeline + agente legacy + Laboratorio |
| `002-diseno-atlas-white-label` | Cerrado | histórico | White-label |
| `003-paridad-inbox-whatsapp` | Cerrado | histórico | Paridad |
| `004-inbox-messaging-ux` | Cerrado | histórico | Composer + cola de adjuntos + drag&drop |
| `005-quick-lead-name` | Cerrado | `de8fcfd` | Helper `applyContactNamePatch` + editor inline + sync UI; 569 tests |
| `006-anuncio-de-origen` | Cerrado (Cortes 0 + A + B) | `15562c6` (servidor/datos), `1c7e297` (UI) | Tabla `ad_attribution`, normalización pura, captura del `referral`, imagen best-effort con allowlist cerrada, tarjeta en panel + marca en lista + filtro Anuncios + línea secundaria en pipeline; sección 011 del arnés E2E |
| `007-meta-capi` | Cerrado (Cortes A + B + C) | `6fbbc94` (gateway), `1b5f806` (CAPI), `81c3b62` (UI) | Puerta única `moveLeadStage`, `conversion_event` + `capi_settings`, `reportStageChange` después del commit, UI Ajustes → Anuncios, sección 012 del arnés E2E |

### A.3 Sales Orchestrator (Vende Veloz 365)

- **Opt-in por organización** vía `agent_profile.sales_orchestrator_enabled`
  (default `false`). Default OFF = ruta legacy `runAgentTurn`.
- **Lanes congeladas** `AUTO` · `AUTO_CLOSE` · `WAIT` · `HUMAN` · `STOP`
  (`src/server/sales/lanes.ts`).
- **Jev V2 contract** congelado en `docs/SALES_ORCHESTRATOR.md` §7 (8
  preguntas: real_operational_need, product_fit, motivation_to_change,
  purchase_intent, buying_timing, main_value_proposition, next_action,
  needs_human_call).
- **Producto y política comercial** congelados en
  `src/server/sales/vende-veloz.ts` + `docs/SALES_ORCHESTRATOR.md` §5/§6
  (`VENDE_VELOZ_PRODUCT`, `VENDE_VELOZ_COMMERCIAL_POLICY`,
  `VENDE_VELOZ_OFFER`).
- **Cliente TypeSafe/Jev** aislado en `src/server/sales/client.ts`: retries
  (≤3), `isJevConfigured()` exige los tres env vars, fallback seguro si Jev
  falla (`last_jev_error` durable, no inventa decisión).
- **Resolver determinístico** en `src/server/sales/resolve-plan.ts` (puro,
  testeado).
- **Writer** en `src/server/sales/writer.ts` — recibe lane ya decidida,
  redacta; sin acceso a `AgentAction.move_stage` ni `handoff`.
- **Handoff explícito** vía `src/server/sales/explicit-handoff.ts`.
- **Tests unit**: `tests/unit/sales-orchestrator.test.ts`, `sales-writer`,
  `sales-explicit-handoff`, `sales-answers`, `sales-decision` (verde con el
  gateway del Corte A integrado).
- **Regresión verificada**: la suite `tests/unit/sales-orchestrator.test.ts`
  pasó verde **antes y después** del refactor del gateway (`6fbbc94`), lo que
  cubre que mover `stageId` por `moveLeadStage` desde Jev no rompió lanes,
  facts ni efectos.

### A.4 Follow-ups comerciales

- **Tabla durable** `sales_follow_up_job` + worker in-process iniciado desde
  `src/instrumentation-node.ts` (clean orphan runs + startSalesFollowUpWorker).
- **Worker** (`src/server/sales/follow-ups/worker.ts`): claim atómico con
  `FOR UPDATE SKIP LOCKED`, lease 10 min, retry técnico ≤3 sin consumir otro
  intento comercial, revalidación inmediatamente antes del side effect
  externo (ventana, handoff, lane, flags, mensaje posterior al anchor).
- **Secuencias** (`policy.ts`): `awaiting_reply` (6h/18h/48h),
  `after_demo` y `after_price` (20h/52h/96h), `scheduled_wait` one-shot.
  Máximo **3 intentos comerciales**; el tercero sin respuesta → `STOP` +
  `follow_up_reason = no_reply_exhausted` (DORMANT) **sin mover pipeline a
  `lost`**.
- **Cancelación**: cualquier inbound cancela pending + `followUpCount = 0`;
  respuesta manual del operador también. DORMANT + inbound → vuelve a `auto`;
  STOP comercial (`pipeline kind=lost`) **no** se reactiva.
- **Ventana 24 h**: abierta → writer (no Jev) + texto; cerrada → plantilla
  aprobada con **0 variables BODY** (`worker.ts:702-703`); sin plantilla
  válida → `blocked` / `template_required` sin envío.
- **Opt-in**: `agent_profile.sales_follow_ups_enabled` (default OFF) +
  `sales_follow_up_template_id` (nullable). La ruta API
  `POST /api/agent/profile` valida que encender follow-ups exige Orchestrator
  encendido (`route.ts:64`).
- **UI**: `/agent` muestra toggles y selector de plantilla; panel lateral
  muestra estado / count / reason / `nextFollowUpAt`; programar / cancelar /
  reactivar con `datetime-local`; board pinta etiqueta **Dormido** cuando
  aplica.
- **Tests unit**: `tests/unit/sales-follow-up-writer.test.ts` (3),
  `template-manual-follow-up-cancel.test.ts` (2), más cobertura indirecta
  del orquestador y del worker.

### A.5 Inbox + remitente WhatsApp

- Webhook Meta + verificación HMAC (`src/server/inbox/ingest.ts`).
- Dedupe por `wa_message_id` UNIQUE.
- Sandbox `is_test = true` → el sender lanza `sandbox_violation`
  (no toca Graph). `tests/unit/send-sandbox.test.ts` lo cubre.
- Ventana 24 h (`src/server/inbox/window.ts`): texto libre solo si inbound
  dentro de 24 h.
- Templates (`src/server/whatsapp/templates.ts`): exige plantilla de la misma
  org con `status = approved`, body resuelto sin dejar variables sin asignar.
- Sync de plantillas (`/api/templates/sync`).

### A.6 Conversión CAPI (spec 007)

- **Bandera `ATRIBUCION`** runtime, leída por `isCapiEnabled()` en cada
  request (no requiere reinicio). Apagada por defecto. Encenderla:
  - expone `/api/settings/capi{,/events}` y `/settings/ads`;
  - persiste `ctwa_clid` que 006 captura;
  - engancha `reportStageChange` después del commit del gateway;
  - muestra Ajustes → Anuncios.
- **Tablas**: `conversion_event` (UNIQUE `(organization_id, conversation_id,
  event_name)`) y `capi_settings` (token cifrado AES-256-GCM con
  `lib/crypto`).
- **Cliente CAPI** (`src/lib/meta/capi.ts`): catálogo cerrado
  `QualifiedLead` / `Purchase`, `action_source: business_messaging`,
  `messaging_channel: whatsapp`, hash SHA-256 lowercase + trim de
  `ctwa_clid`, único acuse válido `events_received >= 1`.
- **Reporte** (`src/server/attribution/conversions.ts`): guardrails
  (flag apagada / `is_test` / sin `ctwa_clid` / sin config / sin token);
  dedup por `ON CONFLICT DO NOTHING`; mapeo
  `won → Purchase`, `qualifiedStageId → QualifiedLead`; regla anti-valor-
  falso (`value` / `currency` solo si monto válido positivo y currency de 3
  chars; nunca `0`); `user_data` mínimo (`ctwa_clid` hasheado +
  `whatsapp_business_account_id`, nunca PII).
- **Hook** (`src/server/attribution/report-on-stage-change.ts`):
  `reportStageChangeOnMove` (single) y `reportStageChangeOnBulkMove`
  (bulk), llamados **fuera del try/catch** del cambio de etapa. Meta 5xx
  jamás revierte el stage; el desenlace queda en `conversion_event`.
- **UI** (`/settings/ads`): dataset ID, token opcional (placeholder explica
  reuso del token de WhatsApp), selector de etapa calificada (lista de
  `kind = "open"` del tenant, validado contra `isQualifiedStageForTenant`),
  tabla de actividad (50 filas) con `fbtrace_id`, badges sent/failed/
  skipped, traducciones legibles.
- **Tests unit**: `tests/unit/capi-payload.test.ts` (19),
  `capi-flag.test.ts` (7), `capi-conversions.test.ts` (cubren caminos del
  adaptador y la lógica pura).
- **E2E**: `runSection012()` en `scripts/e2e-selftest.mjs:2206` cubre las
  dos configuraciones (`ATRIBUCION=on` y apagada) y los caminos infelices
  (Meta 200 con `events_received=0`, token vencido, `is_test`, lead
  orgánico, etapa de otro tenant, doble move).
- **Mocks**: `src/app/api/dev/wa-mock/**` aprende `POST {dataset}/events`.
  Sufijos `DSET-FAIL` (400), `DSET-ZERO` (`events_received=0`), éxito
  positivo con `fbtrace_id` simulado.

### A.7 Anuncio de origen (spec 006)

- Tabla `ad_attribution` con UNIQUE `(organization_id, conversation_id)`.
- Normalización pura (`src/server/attribution/referral.ts`): cotas 128/300/
  2000/2048/8 KB, defensa contra `javascript:` / `data:` / `file:`,
  `thumbnail_url` preferido sobre `image_url`.
- Descarga del creativo (`src/server/attribution/creativo.ts`): allowlist
  cerrada de hosts de Meta (`lookaside.fbsbx.com`, `*.fbcdn.net`,
  `*.cdninstagram.com`, `scontent-*.cdninstagram.com`), HTTPS obligatorio,
  timeout 3 s, tope 1 MB, nunca lanza.
- UI: componente `AnuncioOrigen` (`src/components/anuncio-origen.tsx`)
  reusable; marca en lista (`Anuncio · titular` / `Publicación ·
  titular`); filtro Anuncios mutuamente excluyente con "No leídas"; tarjeta
  en panel con `key={imageAssetId ?? "none"}` para forzar re-render; línea
  secundaria en pipeline.
- Defensa: `ctwa_clid` jamás sale por API; DTO expone solo
  `hasCtwaClid: boolean`.

### A.8 Storage de media/creativos

- Volumen local `MEDIA_DIR` (`src/server/whatsapp/media.ts:140`). Default
  `./.dev-media`; en Docker `Dockerfile:35` crea `/data/media` propiedad de
  `vocero:vocero`. `docker-compose.yml` (Ruta B) y `docker-compose.dev.yml`
  montan el volumen.
- `tests/unit/send-sandbox.test.ts` cubre el guardrail del sender.
- 006 descarga el creativo y lo guarda en `media_asset` con `kind: "image"`
  reutilizando `saveMediaFile`.

### A.9 Salud + arranque

- `GET /api/health` (`src/app/api/health/route.ts`): `select 1` contra la
  BD; 200 si OK, 503 `db_unavailable` si no.
- `src/instrumentation-node.ts`: limpia corridas huérfanas del Laboratorio
  y arranca el worker de follow-ups (idempotente ante HMR).
- `Dockerfile` multi-stage standalone con healthcheck contra
  `/api/health`.

---

## B) CONFIGURACIÓN DE PRODUCCIÓN A CONFIRMAR

> El código exige estas variables y estado en BD para operar. La auditoría
> **NO modificó** nada de esto. Cada línea debe ser verificada por el
> operador (Max) en el entorno de despliegue antes de prender campañas.

### B.1 Variables de entorno (runtime, no build)

Referencia canónica: `.env.example`. Estas son **mínimas** para Vende Veloz
en producción.

| Variable | Estado esperado en prod | Cómo confirmar |
|---|---|---|
| `APP_BASE_URL` | URL pública `https://...` de la instalación | Variable expuesta en Coolify / docker compose |
| `DATABASE_URL` | Cadena Postgres apuntando al servicio interno | Verificar `/api/health` → 200 |
| `BETTER_AUTH_SECRET` | ≥16 chars aleatorios | Generada con `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | 32 bytes base64 (44 chars) | `openssl rand -base64 32`; verificar con `echo "$ENCRYPTION_KEY" \| wc -c` ≈ 44 |
| `META_WEBHOOK_VERIFY_TOKEN` | string ≥8 chars | Ruta Meta: `POST /api/webhooks/wa/<este_valor>` |
| `META_APP_ID` | App ID pública | developers.facebook.com → Configuración → Básica |
| `META_GRAPH_API_VERSION` | `v25.0` (default) | default vigente |
| `OPENROUTER_API_TOKEN` | `sk-or-...` | https://openrouter.ai → Keys |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api` (default) | Default |
| `OPENROUTER_MODEL` | `anthropic/claude-sonnet-4.5` (o el elegido) | Confirmar que el modelo responde |
| `OPENROUTER_JUDGE_MODEL` | `anthropic/claude-haiku-4.5` (opcional) | Default si vacío usa el principal |
| `TYPESAFE_API_KEY` | key de typesafe.ai | https://typesafe.ai (panel del proveedor) |
| `TYPESAFE_JEV_ENDPOINT` | URL **completa** del POST (no path) | Confirmar pegando la URL entera |
| `JEV_MODEL` | nombre del modelo Jev contratado | Panel typesafe |
| `MEDIA_DIR` | `/data/media` en contenedor Coolify | Verificar volumen montado |
| `ATRIBUCION` | `on` **si y solo si** se va a reportar a Meta | Por defecto dejarla apagada hasta confirmar |
| `ALLOW_SIGNUP` | `true` solo si se quiere abrir registro | Apagada por defecto tras la primera org |

### B.2 Estado en BD a confirmar (por organización **Vende Veloz 365**)

> Toda esta configuración es por organización. Hay que verificar la fila de
> Vende Veloz 365 en concreto (no la de Max Quispe ni la de Espacio Veloz).

| Pieza | Cómo confirmar | Antes de lanzar |
|---|---|---|
| `organization.slug` o nombre identificable | `SELECT id, name FROM organization WHERE name LIKE '%Vende%';` | Identificar la org correcta |
| `agent_profile.enabled = true` | UI `/agent` debe mostrar toggle "Agente" encendido | Sí |
| `agent_profile.sales_orchestrator_enabled = true` | UI `/agent` debe mostrar toggle "Sales Orchestrator (Jev)" encendido | Sí |
| `agent_profile.sales_follow_ups_enabled = true` | UI `/agent` debe mostrar toggle "Seguimientos automáticos" encendido | Sí |
| `agent_profile.sales_follow_up_template_id` | UI `/agent` selector de plantilla 0-var aprobada | **Sí — bloqueante** |
| Conexión WhatsApp activa | UI `/settings/whatsapp` muestra número conectado, últimos 4 del token, sync de plantillas OK | Sí |
| `capi_settings.qualified_stage_id` (si `ATRIBUCION=on`) | UI `/settings/ads` muestra la etapa elegida en el selector | Solo si se enciende CAPI |
| `capi_settings.dataset_id` | UI `/settings/ads` muestra el ID del dataset Meta | Solo si se enciende CAPI |

### B.3 Plantillas WhatsApp

- La plantilla para follow-ups con ventana cerrada **debe estar**:
  - en la misma organización;
  - `status = approved`;
  - con **0 variables BODY** (`countVariables(template.body) === 0`).
- Verificar en UI `/settings/templates` después de `/api/templates/sync`.
- Si no se selecciona plantilla y un follow-up vence con ventana cerrada,
  el job queda `template_required` y se enlaza al panel `/agent` para
  configurarla.

### B.4 WhatsApp conectado

- Embedded Signup completado (Tech Provider con `META_APP_ID` +
  `META_EMBEDDED_SIGNUP_CONFIG_ID`).
- `META_APP_SECRET` recomendado para validar `x-hub-signature-256` en el
  webhook.
- WABA ID conocido (necesario para CAPI `user_data.whatsapp_business_account_id`).
- Verificación de webhook en Meta con el `META_WEBHOOK_VERIFY_TOKEN`.

### B.5 Almacenamiento persistente

- Volumen montado en `/data/media` antes del primer inbound con imagen.
- Coolify: persistent storage; docker compose: `volumes:` declarado en
  `docker-compose.yml`.
- Propietario del directorio debe ser el usuario `vocero` (la imagen del
  contenedor lo deja listo; verificar tras montar un volumen vacío en
  Coolify).

---

## C) PRUEBAS REALES EXTERNAS PENDIENTES

> Esto es lo que **no puede hacer el repo por sí mismo**: requiere que Max
> (operador) toque Meta, el panel de Vende Veloz y/o un cliente WhatsApp real.
> El orden importa — no se gasta dinero hasta que los dos primeros pasos
> estén verdes.

### C.1 Self-test E2E local con app + Postgres

- **Por qué:** Constitución IX. Gates unit verdes no equivalen a "READY
  punta a punta".
- **Cómo:**
  1. Levantar Postgres local (Docker o nativo).
  2. `pnpm install && pnpm db:migrate && pnpm seed:demo`.
  3. `WA_MOCK_ENABLED=true META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph OPENROUTER_BASE_URL=http://localhost:3000/api/dev/ai-mock/v1 ATRIBUCION=on pnpm dev`.
  4. `pnpm test:e2e` (debe correr secciones 008, 009, 010, 011 y 012).
- **Resultado esperado:** todas las secciones en verde; `runSection012` corre
  dos veces (con `ATRIBUCION=on` y apagada) si la app está en
  `ATRIBUCION=on` o una sola vez si no.

### C.2 Primer clic CTWA real en producción

- **Por qué:** confirmar la fila `sent` con `fbtrace_id` real de Meta (no
  automatizable; mismo límite que el upstream 016/018).
- **Cómo:**
  1. Con `ATRIBUCION=on`, configurar dataset y etapa calificada en
     `/settings/ads`.
  2. Crear un anuncio Click-to-WhatsApp con un creativo simple (mínimo viable).
  3. Desde un número personal, hacer clic en el botón WhatsApp del anuncio.
  4. Enviar un mensaje → llega a la bandeja.
  5. Mover el lead a la etapa calificada (manual o por Jev).
  6. Revisar `/settings/ads` → debe aparecer una fila `QualifiedLead sent`
     con `fbtrace_id`.
  7. Mover a una etapa `kind=won` → fila `Purchase sent` con `value` solo si
     el lead tiene monto.
- **Criterio de éxito:** las filas aparecen en `conversion_event` con
  `status = 'sent'`. Si aparecen con `status = 'failed'`, abrir `Detalle`,
  copiar el `fbtrace_id` y consultar el soporte de Meta.

### C.3 Primer lead real recibe respuesta

- **Cómo:** desde un cliente WhatsApp personal, mandar un mensaje al número
  conectado.
- **Criterio de éxito:**
  - Aparece en bandeja `/inbox` con marca "Anuncio · titular" si vino de
    CTWA.
  - Si `sales_orchestrator_enabled` está ON y `isJevConfigured` está ON: el
    Orchestrator responde con lane `AUTO` (o `AUTO_CLOSE` si ya hubo precio).
  - Si `enabled` global está ON pero Orchestrator OFF: el agente legacy
    responde.
  - SSE actualiza la conversación en tiempo real.

### C.4 Primer seguimiento se programa / cancela

- **Cómo:**
  1. Tras el primer lead con respuesta automática, abrir su panel lateral.
  2. Confirmar `next_follow_up_at` poblado y `follow_up_count` en 0.
  3. Esperar el primer vencimiento (o usar el endpoint dev
     `/api/dev/follow-ups/run` para acelerar).
  4. Confirmar `follow_up_count` incrementa a 1 y el mensaje se envía.
  5. Mandar un nuevo mensaje desde el cliente → `follow_up_count` vuelve a
     0, `next_follow_up_at` queda `null`.

### C.5 Movimiento a qualified produce evento Meta real

- Cubierto por C.2; verificar también que mover por drag/drop en el pipeline
  produce el evento (no solo el camino Jev). Esto valida que el gateway del
  Corte A (`6fbbc94`) engancha `reportStageChange` correctamente.

### C.6 Compra real → `Purchase`

- **Cómo:** tras cerrar una venta real, mover el lead a una etapa
  `kind = "won"`.
- **Criterio de éxito:** fila `Purchase sent` en `/settings/ads` con
  `fbtrace_id`. Si el lead tiene monto en su deal → `value` y `currency`
  viajan; si no, no viajan (regla anti-valor-falso).

---

## D) NO BLOQUEA LANZAMIENTO / FUTURO

> Todo esto es **diferido**, fuera del alcance del corte 9 y de los specs
> 001–007. Documentado en `docs/SALES_ORCHESTRATOR.md` y en el spec 007 §
> "Lo que NO entra".

| Pieza | Estado |
|---|---|
| Campaign Playbooks (multi-campaña, unidad = campaña) | Diferido. Cuando exista la 2ª campaña, abrir spec SDD para extraer config alrededor del núcleo reusable. |
| Marketing API (campaigns, adsets, ads, audiences, lookalikes) | No entra. Constitución II: lista cerrada. |
| 019 / Resultados / dashboards de atribución | Diferido. |
| Backfill de leads antiguos sin `ctwa_clid` | No entra (sin captura, sin reporte retroactivo). |
| `InitiateCheckout` de fábrica | Receta documentada en `docs/atribucion-capi.md` §8 (opt-in por fork). |
| Parsing automático de fechas futuras para `WAIT` | No entra en V1. |
| Múltiples plantillas por etapa | No entra en V1. |
| Cadencias ajustadas con datos reales | Iteración post-launch. |
| S3/R2, email, Stripe, Google services | **PROHIBIDOS** por Constitución II. |

---

## Cómo leer este checklist

- **Operador (Max):** recorre B → C en orden. No encenders `ATRIBUCION` hasta
  confirmar B.2 y B.3; no gastar dinero en campaña hasta C.2 verde.
- **Desarrollador:** A es la fuente de verdad de qué hay en el repo. Si
  re-abre un spec cerrado (001–007), actualiza este archivo.
- **Próxima campaña:** abrir spec SDD nuevo. **NO** reinterpretar este
  checklist como contrato único.

---

## Cambios desde el último cierre

- Corte 9 NO agrega código de aplicación. Solo este archivo documental +
  bump de `docs/CURRENT_STATE.md`.
- Commit único esperado: `docs: cerrar readiness técnico de Vende Veloz para
  campañas`.
- Working tree final: limpio.
