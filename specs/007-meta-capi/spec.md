# 007 — Meta CAPI para leads Click-to-WhatsApp

**Branch**: `007-meta-capi` · **Carril**: ciclo completo (Principio VI) · **Fecha de apertura**: 2026-09-29

> Feature opcional y apagada por defecto. Se enciende con `ATRIBUCION=on`.
> Toca el modelo de datos (tablas nuevas), publica contratos HTTP
> (`/api/settings/capi/*`) y agrega una pantalla en Ajustes. **Reusa** el
> camino de captura del `ctwa_clid` que 006 ya sembró.

## Origen y motivación

Si anuncias con **Click-to-WhatsApp**, Meta sabe qué conversaciones
**empezaron** desde un anuncio. No sabe cuáles **sirvieron**. Sin nadie que se
lo diga, el algoritmo optimiza hacia lo único que ve —que alguien abra el
chat— y te entrega el público más barato de hacer escribir, que rara vez es el
que compra. Se siente como "llegan muchos mensajes y no cierra ninguno".

El CRM está en el único lugar donde esa verdad existe: sabe que esta
conversación llegó con `ctwa_clid`, que se calificó el martes y que se ganó el
viernes por un monto. **Encender esta feature es devolverle a Meta ese
desenlace**, para que el mismo presupuesto empiece a comprar clientes en vez
de chats.

## Lo que ya está (no se repite)

- **006 (atribución del primer mensaje)**: `ad_attribution` por conversación,
  `ctwa_clid` capturado en el primer inbound con `referral`, fuente efectiva
  (`source`) consultable en `serializeContact(...)`. Esta base es la entrada
  al reporte CAPI: sin `ctwa_clid` no hay evento.
- **Sales Orchestrator (Jev)**: hoy puede escribir `lead.stageId` por su
  cuenta (`runSalesOrchestratorTurn → patch.stageId = nextStageId`). Ese
  camino debe pasar por la **puerta única de etapa** del corte A antes de
  enganchar CAPI.
- **Capa `lib/crypto`**: AES-256-GCM, mismo patrón que el token de WhatsApp;
  secretos nunca al cliente, nunca a logs.
- **`graphRequest` (`lib/meta`)**: cliente HTTP para Meta Graph API; la salida
  CAPI reusa el mismo cliente.

## Contrato funcional (no negociable)

### 1. Bandera `ATRIBUCION`

- **Apagada por defecto**. Toda la superficie CAPI devuelve 404 según el
  patrón upstream (pantalla, APIs, captura). 006 sigue mostrando el origen
  del lead sin `ctwa_clid` a Meta.
- **Encendida**: aparece la pestaña **Anuncios** en Ajustes; las APIs CAPI
  existen; los eventos empiezan a emitirse.

### 2. Configuración del dataset

- El usuario pega el **dataset ID** y guarda.
- Si la conexión WhatsApp ya existe, **se reusa ese token** cifrado
  (`whatsapp.token`) — es el mismo que autoriza publicar en el dataset del
  WABA. Pegar un token CAPI específico es opcional, cifrado con la misma
  capa `lib/crypto`.
- Hacia el cliente solo se expone `last4` y estado (igual que WhatsApp).

### 3. Etapa "lead calificado" es **configurable** del tenant

- No se hardcodea "Interesado".
- El dueño elige **una etapa `kind = "open"`** del propio pipeline como
  "calificada" desde Ajustes → Anuncios.
- La venta **no se configura**: se reporta sola cuando el trato entra a la
  etapa ganada (`kind = "won"`).

### 4. Eventos que se emiten

| Cuándo | Evento | `custom_data` |
|---|---|---|
| Primera vez que el lead entra a la etapa calificada del tenant | `QualifiedLead` | `{ lead_stage: "qualified" }` |
| Primera vez que el lead entra a una etapa `kind = "won"` | `Purchase` | `{ lead_stage: "won", value, currency }` |

`Purchase` incluye `value`/`currency` **solo si** el modelo de deal del lead
dispone de un monto válido. Si no, se envía **sin** `value`/`currency`. Nunca
se inventa `0`. Esta regla protege la optimización por valor de Meta: un
solo valor falso envenena la optimización.

### 5. Identidad enviada a Meta (mínima)

- `user_data` solo con:
  - `ctwa_clid` (del `ad_attribution` existente de 006)
  - `whatsapp_business_account_id` (WABA ID de la conexión del tenant)
- **Nunca** teléfono, nombre, email ni texto del contacto. El `ctwa_clid` es
  un identificador de clic, no un dato personal.
- `action_source`: `business_messaging`.
- `messaging_channel`: `whatsapp`.

### 6. Deduplicación durable

- `UNIQUE (organization_id, conversation_id, event_name)`.
- `ON CONFLICT DO NOTHING`. No es un check previo: dos webhooks o dos
  movimientos simultáneos no duplican.

### 7. Semántica de fallo (best-effort)

- La emisión CAPI se engancha **DESPUÉS** del commit exitoso de la puerta de
  etapa. Nunca dentro de la transacción larga.
- Un fallo de Meta **jamás bloquea** el cambio de etapa. El lead ya quedó
  movido; la conversión queda registrada como fallida con su motivo.
- Acuse real: `events_received >= 1`. Si Meta responde 200 pero `events_received = 0`,
  la fila se marca como **fallida**.

### 8. Guardrail del Laboratorio

- Una conversación `is_test = true` **nunca** produce un evento CAPI.
  Misma familia de guardrails que el sender y los conectores de agenda.

### 9. Actividad consultable

Tabla propia (`conversion_event`) con estado y `fbtrace_id`:

| Estado | Significado |
|---|---|
| `sent` | Meta acusó recibo (`events_received >= 1`) |
| `failed` | Meta rechazó, token vencido, red caída; motivo textual de Meta |
| `skipped` | no había nada que reportar (sin `ctwa_clid`, sin config, `is_test`) |

La razón de skip/failure queda escrita — Ajustes → Anuncios muestra esa
tabla con su `fbtrace_id` (referencia que el soporte de Meta pide para
rastrear un evento).

### 10. UI

- Pestaña **Anuncios** en **Ajustes** (solo visible con `ATRIBUCION=on`).
- Formulario: dataset ID, token opcional, selector de etapa calificada
  (lista de `pipelineStage` con `kind = "open"` del tenant).
- Tabla de actividad: estado, evento, conversación, `fbtrace_id`, fecha.

## Arquitectura obligatoria previa — puerta única de etapa (Corte A)

Antes de tocar CAPI, **todos** los cambios de etapa pasan por un único
servicio tenant-safe. Sin esto, los reportes CAPI quedan incompletos sin
manera de saberlo.

### Estado actual de `lead.stageId` (auditoría mínima)

Callsites runtime que escriben `lead.stageId`:

| Camino | Archivo | Patrón |
|---|---|---|
| Drag/drop en pipeline (UI) | `app/api/pipeline/leads/[id]/route.ts` | `PATCH { stageId, position }` |
| Bulk-move al eliminar/mover etapa | `app/api/pipeline/stages/[id]/route.ts` | `UPDATE lead SET stageId = $moveTo WHERE stageId = $id` |
| Reset de conversación de pruebas | `app/api/bot/reset/route.ts` | set al primer stage |
| IA inline (acciones del agente) | `server/ai/pipeline.ts` | `set({ stageId, updatedAt, lastActivityAt })` |
| **Sales Orchestrator (Jev)** | `server/sales/orchestrator.ts` | `patch.stageId = nextStageId` antes del update |
| Primera inbound → lead nuevo | `server/inbox/lead-activity.ts` | set al primer stage |
| Seed (no runtime) | `server/seed/demo.ts` | demo |

### Contrato del gateway (Corte A — neutro, sin CAPI)

- Helper/servicio único, tenant-safe, testeable.
- **No emite eventos externos** todavía (no toca CAPI).
- Valida tenant y etapa destino del mismo tenant.
- Conserva la semántica actual: `updatedAt`, `lastActivityAt`, `position`,
  y los hechos/lanes de Jev (`patch.stageId = nextStageId` desaparece como
  write directo: Jev llama al gateway).
- Migración de callers **sin cambio observable** para el usuario.
- Acepta un `actor` opcional (`human`, `agent`, `bot`, `system`) para que
  CAPI pueda discriminar después sin re-arquitectura.

## Fuera de alcance (no entra en este spec)

- **Campaign Playbooks** (optimización de campaña).
- **Marketing API** (creativos, audiencias, lookalikes).
- **Resultados / dashboards** (019).
- **Backfill** de leads antiguos sin `ctwa_clid`.
- **Espejo de `InitiateCheckout`** para campañas de venta (eso queda
  documentado en `docs/atribucion-capi.md` para que cada fork lo agregue
  si quiere, pero **no** se incluye de fábrica a propósito).
- **Llamadas reales a Meta** durante tests. Todo va con mock equivalente
  al patrón `wa-mock`/`ai-mock`/`jev-mock`.

## Plan por cortes

Tres cortes, gate técnico verde al final de cada uno, self-test
(Playwright + mocks) verde al final de C:

- **Corte A — Puerta única de etapa (refactor neutro).**
  - Helper/servicio `moveLeadStage(...)`.
  - Migración de los 6 callsites runtime al gateway.
  - Cero cambios observables: mismo SQL efectivo, mismas respuestas HTTP,
    misma UX.
  - Cero llamadas externas. Sin flag CAPI todavía.
- **Corte B — CAPI core + schema + APIs.**
  - Migración `drizzle/` aditiva y re-ejecutable.
  - Tablas: `ad_attribution` ya existe de 006; nuevas `conversion_event`,
    `capi_settings`.
  - `src/lib/meta/capi.ts` con catálogo, payload y acuse.
  - `src/server/attribution/` (settings cifrados, conversions, flag).
  - `app/api/settings/capi/*` protegidas por auth+tenant y la bandera.
  - El gateway del corte A engancha `reportStageChange(...)` tras commit.
  - Mock de `{dataset}/events` aprende el contrato (D10 upstream).
  - Sin UI final salvo tipos estrictamente necesarios.
- **Corte C — UI + E2E + cierre.**
  - Pantalla Ajustes → Anuncios (dataset, token opcional, selector de
    etapa calificada, tabla de actividad).
  - Arnés E2E extendido (`tests/e2e/us-meta-capi.md` +
    `scripts/e2e-selftest.mjs`) en **las dos configuraciones** (con y sin
    bandera), incluida la ruta infeliz (Meta rechazando / token vencido).
  - `docs/atribucion-capi.md` espejo del upstream con notas del fork
    (Jev, gateway, elección de etapa calificada, escudo contra valor falso).

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| **I. Seguridad** | Token de dataset cifrado AES-256-GCM con `lib/crypto` (mismo mecanismo que WhatsApp); hacia el cliente solo `last4` y estado; nunca a logs. El `ctwa_clid` es identificador de clic, no dato personal — hacia Meta **no viaja** teléfono, nombre, email ni texto. |
| **II. Soberanía (1.4.0)** | ✅ No introduce un proveedor nuevo: es **la misma Meta Graph API** del canal WhatsApp ya permitido. Aun así se entrega con el traje completo de conector opcional: apagado por defecto, aislado en `lib/meta/capi.ts`, degradación definida (su fallo jamás bloquea la operación), credenciales del negocio cifradas, CI apagado/encendido. Cero dependencias de runtime nuevas. |
| **III. Multi-tenancy** | `organization_id NOT NULL` en todas las tablas nuevas; todo acceso por `scoped()`; configuración única por organización. |
| **IV. Idempotencia** | Dedup **es** un `UNIQUE (organization_id, conversation_id, event_name)` con `ON CONFLICT DO NOTHING`. Migración re-ejecutable. |
| **V. Calidad verificable** | Gate técnico + unit de las piezas puras (payload, catálogo, centavos→unidades, bandera, traducción de filas de actividad) + arnés E2E en las dos configuraciones, incluido el camino infeliz (Meta rechazando). |
| **VI. Specs antes de código** | Carril ciclo completo declarado; spec, plan, tasks preceden al código. |
| **VII. Trazabilidad** | Decisiones no obvias (etapa calificada configurable, sin valor inventado, sin espejo de `InitiateCheckout` de fábrica) quedan en este spec. |
| **VIII. Foco vertical** | El CRM ya sabe de dónde vino el lead y cómo terminó; esto solo lo devuelve a quien cobra por traerlo. No es una suite de analítica: dos eventos, una pantalla, cero dashboards. |
| **IX. Verificación en vivo** | `quickstart.md` define el self-test contra la app viva con mocks; nada se declara Hecho sin ese loop en verde, **en las dos configuraciones** (con y sin `ATRIBUCION`). |

**Resultado del gate**: PASA sin violaciones. No requiere enmienda
constitucional — no entra ningún proveedor nuevo (es la misma Meta Graph).

## Riesgos conocidos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Sales Orchestrator escribiendo por su cuenta salta CAPI | Corte A cierra el bypass antes de B. |
| Conversión duplicada por doble webhook | Dedup por `UNIQUE` con `ON CONFLICT DO NOTHING`, no check previo. |
| Valor falso envenena optimización por valor | Si no hay monto válido, `Purchase` sale sin `value`/`currency` — nunca `0` inventado. |
| Meta devuelve 200 pero tira el evento | Único acuse válido: `events_received >= 1`. |
| Optimizar campaña de **ventas** con `QualifiedLead` | Documentado: `QualifiedLead` solo aplica a campañas de clientes potenciales; la receta de `InitiateCheckout` queda en `docs/atribucion-capi.md` para cada fork. |
| Token de WhatsApp vencido | Si el token compartido no sirve, la fila queda como `failed` con motivo textual; la operación no se rompe. |
| Hardcodear "Interesado" | Etapa calificada configurable por tenant; el catálogo upstream no aplica tal cual al fork. |
| Flag encendida en producción sin querer | Apagada por defecto; el gate E2E corre en ambas configuraciones. |

## Definición de Hecho

Una feature no está "Hecha" hasta que:

1. `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en verde.
2. `pnpm test:e2e` en verde con la app viva y mocks encendidos, en **las dos
   configuraciones** (`ATRIBUCION=on` y `ATRIBUCION` apagada).
3. El camino infeliz (Meta rechazando, token vencido, `ctwa_clid` ausente,
   `is_test = true`, etapa calificada no configurada) está cubierto y de-grada
   sin colgar la app.
4. `docs/CURRENT_STATE.md` actualizado.
5. `docs/atribucion-capi.md` escrito con notas del fork.
6. Working tree limpio, un commit por corte.
