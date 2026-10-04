# Plan — 013 Operator Workspace

Cómo se implementa el comportamiento de `spec.md` sin sobrearquitectura y sin tocar
el motor de follow-ups automáticos. Decisiones técnicas verificadas contra el código
vigente a 2026-10-04 (HEAD `ef83302262f9b147ded271ba4d1d5b323f88e344`).

---

## 1. Constitution Check

| Principio | Evaluación |
|---|---|
| I Seguridad | Sin secretos nuevos. La nota del recordatorio es texto del operador en su propia org; no se expone al navegador fuera de la sesión ya autenticada ni se registra en logs. |
| II Soberanía | **Sin dependencias externas nuevas.** Sin S3/R2, email, Stripe ni Google. Sin cron SaaS: el vencimiento es una comparación de fechas en lectura, no un job. La lista cerrada no se amplía. |
| III Multi-tenancy | `organization_id` NOT NULL, indexado org-first, `scoped()` en toda query. La Agenda y "Por atender" se resuelven con la organización de la sesión, nunca con un parámetro del body. |
| IV Idempotencia | Las transiciones son upsert por `(organization_id, conversation_id)`: repetir un inbound o un handoff no duplica filas ni efectos. El recordatorio humano **no** es un evento entrante de un sistema externo, así que no introduce webhook nuevo. |
| V Calidad verificable | Gate completo obligatorio en cada corte + E2E real con mocks. Lo no ejecutable se marca pendiente, nunca "debería funcionar". |
| VI Specs antes de código | Este spec, plan y tasks existen antes de la primera línea de CUT 1. |
| VII Trazabilidad | Cada decisión con alternativa descartada queda registrada en §5 y §8. |
| VIII Foco vertical | Sirve a **atender y organizar conversaciones de un negocio**. No introduce campañas masivas, broadcast ni scraping. |
| IX Verificación en vivo | Cada corte con comportamiento observable ejecuta self-test E2E con app + PostgreSQL + mocks, feliz e infeliz. Sin entorno → PENDIENTE explícito. |

**Sin violaciones.** No hay excepción que justificar en Complexity Tracking.

---

## 2. Realidad ejecutable verificada (puntos de estrangulamiento reales)

Antes de diseñar, se localizó dónde hoy se escriben los hechos que este spec necesita.
Esto es lo que hace el diseño pequeño: **hay puntos de estrangulamiento únicos**.

| Hecho | Dónde ocurre hoy | Nota |
|---|---|---|
| Handoff (IA → humano) | `applyHandoff()` en `src/server/ai/delivery.ts:128` | **Único** choke point. Lo llaman `ai/pipeline.ts` (cliente, error, modelo, ventana) y `sales/orchestrator.ts`. Todo handoff pasa por aquí. |
| Inbound persistido | `src/server/inbox/ingest.ts` | Punto único tras insertar el mensaje. |
| Echo manual del dueño | `ingestManualEcho` en `src/server/inbox/ingest.ts` (`handoff_reason=manual_reply`) | El dueño respondió desde el teléfono. |
| Outbound manual del operador | `src/server/inbox/send.ts` (`origin: "operator"`) | Hoy ya llama `cancelFollowUpsOnManualReply`. |
| Cambio de etapa | `moveLeadStage()` en `src/server/leads/stage-gateway.ts` | **Puerta única** de etapa (`kind: open \| won \| lost`). |
| Reactivar IA | `updateConversation()` en `src/server/inbox/queries.ts` | `patch.reactivate` ya limpia `handoffAt/handoffReason`. |
| Lista de la Bandeja | `listConversations()` en `src/server/inbox/queries.ts` → `GET /api/conversations` | Ya filtra `is_test = false` y ordena por última actividad. |
| Filtros de la Bandeja | `src/components/inbox/conversation-list.tsx:73` | `useState<"all" \| "unread" \| "ads">` — **el filtro es cliente**, sobre el array completo. Añadir "Por atender" no requiere endpoint nuevo. |
| Seguimiento automático | `POST/DELETE /api/pipeline/leads/[id]/follow-up` → `src/server/sales/follow-ups/store.ts` | Rechaza `human_lane` y `handoff_active`. |

**Consecuencia de diseño:** los 7 puntos de estrangulamiento son pocos y ya existen.
CUT 1 no necesita redis architectura: engancha llamadas idempotentes en 5 de ellos.

---

## 3. Modelo de datos (CUT 1)

### 3.1 Tabla dedicada: `conversation_attention`

Se elige **tabla dedicada** (no columnas en `conversation`). Razones:

1. **Aislamiento de responsabilidades.** `conversation` describe el canal y el handoff
   (IA). La atención humana es un concepto de **operación**. Mezclarlos vuelve a
   ensuciar la tabla que la Bandeja lee en cada SSE.
2. **La Agenda lee una forma distinta** a la de los seguimientos automáticos
   (`due_at` + `note` + buckets). En CUT 4 la Agenda muestra ambas fuentes; con una
   tabla, cada fuente se consulta con su propio contrato sin conversiones de tipo.
3. **Precedente maduro del repo:** `sales_follow_up_job` y `commercial_resource` ya son
   tablas dedicadas con `organization_id` NOT NULL e índices org-first.
4. **Extensible sin romper:** un historial de compromisos pasados sería una segunda
   tabla, no un ensanchamiento de `conversation`.

```
conversation_attention
  id               text PK            prefijo ca_
  organization_id  text NOT NULL      FK organization  ON DELETE CASCADE
  conversation_id  text NOT NULL      FK conversation  ON DELETE CASCADE
  state            text NOT NULL      enum('pending','waiting_client','deferred')
  due_at           timestamp NULL     NOT NULL si state='deferred'
  note             text NULL          razón visible en Agenda
  created_at       timestamp NOT NULL defaultNow()
  updated_at       timestamp NOT NULL defaultNow()

  UNIQUE (organization_id, conversation_id)
  CHECK  (state <> 'deferred' OR due_at IS NOT NULL)
  INDEX  (organization_id, state)
  INDEX  (organization_id, state, due_at)     --buckets de Agenda
```

**Una fila por conversación es el máximo.** No se acumulan compromisos: programar uno
nuevo **reemplaza** el anterior (coherente con §3.4 del spec: un compromiso futuro no
sobrevive a que el cliente escriba). Esto elimina de raíz el caso difícil de
"compromisos múltiples en paralelo" sin añadir un estado `superseded`.

### 3.2 Id y migración

- `newId("conversationAttention")` → prefijo **`ca_`**, añadido a `src/lib/db/ids.ts`
  (patrón existente, sin inventar generadores).
- Migración **`0010_conversation_attention.sql`** + entrada `idx: 12` en
  `drizzle/meta/_journal.json`, siguiendo el patrón re-ejecutable de `0009_commercial_resources.sql`
  (drizzle-kit genera su propio archivo; si la herramienta no produce los constraints
  desired, se escriben a mano **de forma re-ejecutable**, como ya se hizo en 0008b/0008c/0009).
- `pnpm db:generate` primero; el archivo resultante se revisa antes de commitear.

### 3.3 Lo que NO se almacena

`needs_attention_now`, `waiting_client` y `scheduled` son **derivados** en lectura:

```
needs_attention_now = state = 'pending'
                   OR (state = 'deferred' AND due_at <= now())
waiting_client     = state = 'waiting_client'
scheduled          = state = 'deferred' AND due_at > now()
```

**No hay worker, ni intervalo, ni lease, ni job.** El vencimiento es una condición de
consulta. Consecuencias:

- El recordatorio vencido aparece en Por atender aunque nadie haya ejecutado nada
  (requisito 7 del ciclo) — no depende de que Max recuerde ni de un proceso vivo.
- Reiniciar la app no pierde nada: el estado vive en PostgreSQL.
- Un recordatorio humano **no puede** enviar WhatsApp porque **no existe código que
  envíe**: no hay entrada en el worker de follow-ups, ni registro en `outbox`, ni
  llamada al sender. La garantía es estructural, no una condición en tiempo de ejecución.

### 3.4 Módulo de dominio

Nuevo: **`src/server/inbox/attention.ts`** (junto a `queries.ts`, `send.ts`, `ingest.ts`).

API mínima, sin estado global ni singletons:

| Función | Transición | Disparador |
|---|---|---|
| `markAttentionPending` | (nada)→`pending`, o `deferred`→`pending` | handoff (FR-1.1), inbound durante HUMAN (FR-1.4) |
| `markAttentionWaitingClient` | `pending`/`deferred`→`waiting_client` | outbound manual (FR-1.6), echo manual del dueño |
| `scheduleHumanReminder` | `*`→`deferred(due_at, note)` | "Recordarme" (CUT 3) |
| `clearAttention` | `*`→(sin fila) | reactivar IA, `won`, `lost` (FR-1.7/1.8) |
| `getAttention` / `listAttention` | lectura | DTO + Por atender + Agenda |

Reglas transversales en el módulo, no en los call sites:

- Toda función recibe `organizationId` y usa `scoped()`.
- `markAttentionPending` **exige** `handoffAt != null` en la conversación: si la IA
  es dueña, no hay atención humana que registrar (FR-1.10).
- Idempotencia por upsert sobre `(organization_id, conversation_id)`: sin filas
  duplicadas ni errores en reintentos de webhook (FR-1.11).
- Ninguna función llama a Graph, al sender, a plantillas ni al store de follow-ups.
- La nota se recorta a un largo máximo y se valida con Zod en el endpoint; nunca se
  interpola en SQL ni se registra en logs.

### 3.5 Enganches en CUT 1 (los mínimos)

| Punto de estrangulamiento | Enganche | Requisito |
|---|---|---|
| `applyHandoff` (`ai/delivery.ts`) | `markAttentionPending` | FR-1.1 |
| Inbound persistido (`inbox/ingest.ts`) | `markAttentionPending` **solo si** hay handoff | FR-1.4 |
| `ingestManualEcho` (`inbox/ingest.ts`) | `markAttentionWaitingClient` | FR-1.6 |
| Outbound `origin=operator` (`inbox/send.ts`) | `markAttentionWaitingClient` | FR-1.6 |
| `updateConversation` con `reactivate` (`inbox/queries.ts`) | `clearAttention` | FR-1.7 |
| `updateConversation` con `aiEnabled=false` | `markAttentionPending` | FR-1.4/decisión D-4 |
| `moveLeadStage` a `won`/`lost` (`leads/stage-gateway.ts`) | `clearAttention` | FR-1.8 |

`markRead` **no** toca la atención (FR-1.5). Es un acierto a propósito: abrir la
conversación no es trabajar.

### 3.6 Aislamiento de los follow-ups automáticos (FR-1.9)

Cero cambios en `src/server/sales/follow-ups/**`, `lead.nextFollowUpAt`,
`lead.followUpCount`, `lead.followUpReason`, cadencias, worker o seeding. Ningún
import de `sales/follow-ups` en `attention.ts` y a la inversa.

El test de regresión obligatorio: la suite comercial existente
(`tests/unit/sales-follow-up-*.test.ts`, `sales-orchestrator`, `sales-writer`) debe
seguir verde sin modification de expectativas.

---

## 4. Superficies observables (CUT 2–4)

### 4.1 DTO (aditivo)

`ConversationDto` (`src/lib/types.ts`) suma un campo **aditivo y opcional**:

```ts
attention: {
  state: "pending" | "waiting_client" | "deferred";
  dueAt: string | null;
  note: string | null;
  needsAttentionNow: boolean;   // derivado: pending OR (deferred AND vencido)
} | null;
```

`listConversations` resuelve el LEFT JOIN **ya scoped a la organización**
(el patrón de `adAttribution` en esa misma función es el precedente exacto). Un solo
`SELECT`; sin N+1. `serializeConversation` mantiene su firma con un parámetro extra.

**Cero endpoints nuevos para "Por atender".** El filtro es cliente, igual que
`all/unread/ads` hoy (`conversation-list.tsx:73`). Añadir un endpoint sería
sobrearquitectura y rompería la reactividad SSE por partida doble.

### 4.2 Agenda (CUT 3)

Endpoint **nuevo y mínimo**: `GET /api/reminders` (organización de la sesión, sin
parámetros de org), con buckets calculados en el servidor para que cliente y servidor
no discrepen del reloj:

- `overdue` (vencidos), `today`, `tomorrow`, `week` (esta semana), `later`
- Acciones por separado, coherentes con el ciclo:
  `POST /api/reminders` (programar), `DELETE /api/reminders/[conversationId]`
  (cancelar). Entrada estricta con Zod: `dueAt` **futura** y `note` opcional
  recortado. Un `due_at` en el pasado se rechaza con error explícito en vez de
  aceptarse y aparecer vencido de inmediato.
- Zod rechaza `organizationId` en el body; la org sale de la sesión.

Todo el bucketing por **fecha local del operador** (`es-MX`/es-PE ya es la convención
de `formatTime`), con timestamps en UTC en la BD — el mismo criterio que ya usa el
hotfix de `claimDueJobs` documentado en `docs/SALES_FOLLOW_UPS.md`.

### 4.3 Cut 4 — alcance de la pulición

- Nav: añadir **Agenda** junto a Bandeja/Pipeline, con el conteo de vencidos.
- Badge en **Bandeja**: "Por atender (N)" como primera opción de la fila de filtros.
- Conversación: acción primaria **"Marcar atendido"** (→ `waiting_client`),
  **"Esperando respuesta"** visible, **"Recordarme"** y **"Reactivar IA"**.
- La Agenda puede listar seguimientos automáticos como **read-only** con
  `👤 Humano` / `🤖 Automático`, leyendo `sales_follow_up_job` **sin escribir** y sin
  tocar el worker. Opcional: si aporta claridad, sí; si obliga a replicar la
  lógica de cadencias, **no** — se listan solo los datos ya persistidos.

---

## 5. Decisiones y alternativas descartadas

### D-1 — Tabla dedicada vs. columnas en `conversation`

**Elegido:** tabla `conversation_attention`. Descartadas 3 columnas
(`attention_state`, `attention_due_at`, `attention_note`) en `conversation` porque
mezclan semántica de canal y de operación en la tabla más leída de la Bandeja, y
obligarían a reconstruir los buckets de la Agenda con joins a `lead`. Coste: un
`LEFT JOIN` y una tabla más. Beneficio: separación real, y el precedente del repo ya
paga ese coste dos veces.

### D-2 — Por qué NO reutilizar `sales_follow_up_job`

Descartado explícitamente (prohibido por el encargo). Si se hiciera, se romperían
**cinco** contratos de una vez:

1. **Efecto físico:** su worker **envía WhatsApp** al vencer. Un recordatorio humano
   que mandate un envío es exactamente el comportamiento prohibido.
2. **Guardas incompatibles:** `claimDueJobs` exige `handoff_at IS NULL`, IA activa,
   lead no HUMAN. El recordatorio humano solo existe con handoff activo: las guardas
   lo rechazarían siempre.
3. **Dirección del efecto:** el job automático es "el sistema escribe al lead"; el
   humano es "el lead vuelve a la cola de Max". Sentidos opuestos.
4. **Ciclo de vida:** el job tiene `attempt_number`, `run_attempts`, `claimed_at`,
   `message_id` y lease — concurrencia y reintentos que el recordatorio humano no
   tiene ni necesita. Un `one-shot` sin worker no necesita lease.
5. **Semántica de stages:** `blocked`/`failed` del job significan "no se pudo enviar".
   En un recordatorio humano, "no se pudo enviar" no significa nada.

### D-3 — Por qué NO reutilizar `lead.nextFollowUpAt`

Es un **resumen para UI** de `sales_follow_up_job`, no una fuente de verdad. No tiene
`state` (no distingue pendiente de esperado del cliente), no tiene `note`, no tiene
`organization_id` propio (habría que deducirlo), y su lectura/escritura está atada al
opt-in del motor automático. Reutilizarlo obligaría a guardar la nota en otro lado y
mezclaría ambos mecanismos en un solo campo visible.

### D-4 — Semántica exacta de los toggles de IA

- `reactivate: true` → `clearAttention`. Reanudó la IA: ya no hay compromisos humanos.
- `aiEnabled: false` (sin `reactivate`) → `markAttentionPending`. Apagar la IA
  significa que **ahora contesta el humano**, luego hay trabajo pendiente.

Ambas son coherentes con la misma idea: la atención humana existe mientras la IA no
sea la dueña de la conversación.

### D-5 — El vencimiento no se persiste

Guardar un `state='due'` exigiría un **worker o un tick** que mutara filas, con su
lease, su recuperación y su doble ejecución bajo retraso. Derivarlo en lectura
elimina esa clase entera de bugs y cumple el requisito 7 sin proceso. Coste: cada
consulta compara `due_at <= now()` — un índice `(organization_id, state, due_at)`
lo resuelve.

### D-6 — Un solo recordatorio vigente

Se **reemplaza** en vez de apilarse. Un segundo compromiso sobre la misma conversación
es ambiguo en operación ("¿cuál vence?") y el caso "el cliente escribió antes" lo
resuelve borrando. Si someday hacen falta varios, se añade una tabla de historial sin
tocar este contrato.

---

## 6. Plan por corte

### CUT 1 — Estado durable

Orden: `ids.ts` → `schema.ts` → migración + journal → `attention.ts` → enganches →
tests. Sin UI, sin endpoint nuevo, sin cambio de DTO. Los enganches son
**best-effort seguro**: un fallo al escribir la atención no puede tumbar el envío ni
la ingesta (se registra, no se propaga).

### CUT 2 — Bandeja "Por atender"

`ConversationDto` + LEFT JOIN scropeado + `needsAttentionNow` derivado + chip
"Por atender (N)" como primera opción + pruebas del filtro (casos de inclusión y
exclusión de FR-2.4/2.5) + verificación de que `all/unread/ads` y el filtro de etapa
siguen intactos.

### CUT 3 — Agenda

Store de consulta por buckets → `GET /api/reminders` + `POST` + `DELETE` (Zod,
`dueAt` futura, `note` recortada) → "Recordarme" en la conversación → buckets
visibles con contacto, fecha/hora, nota y estado. Tests de bucketing enUTC/local,
límite de fecha, aislamiento tenant y **cero llamadas a Graph/sender**.

### CUT 4 — Flujo operativo

Nav + badge, "Marcar atendido", "Esperando respuesta", unificar copy, y (si aporta
claridad) la vista read-only de automáticos. Sin tocar el motor.

### CUT 5 — Verificación

Extender el arnés `scripts/e2e-selftest.mjs` con una sección nueva (el precedente son
`020/021/022` con dispatch aislado) y extender `tests/e2e/`. Los 11 casos mínimos:
handoff→Por atender · abrir no resuelve · reply manual coherente · recordatorio
futuro en Agenda y fuera de Por atender · inbound antes de vencimiento → Por atender ·
vencido → Por atender · programar otro · reactivar IA · Cliente/Perdido · aislamiento
tenant · cero Graph en recordatorio humano · **sin regresión de follow-ups
automáticos**.

---

## 7. Requisitos de verificación

| Nivel | Qué |
|---|---|
| Unitario | Ciclo completo de los 10 pasos; derivación de `needsAttentionNow`; bucketing de Agenda; constraints; aislamiento tenant A/B; garantía de cero Graph (spy que falla si el sender es invocado). |
| Regresión | Suites `sales-follow-up-*`, `sales-orchestrator`, `sales-writer`, `handoff`, `media-send`, `playbook-*`, `lab-preview-*` sin expectativas modificadas. |
| Gate | `pnpm typecheck && pnpm lint && pnpm build && pnpm test`. |
| E2E | Sección nueva del arnés con app + PostgreSQL + mocks, **UI real con Playwright**, camino feliz e infeliz. |
| Físico | Suite opt-in de PostgreSQL si hay ejecutables, para constraints/FK/UNIQUE reales. Los dobles en memoria **no** sustituyen PostgreSQL. |

Los pendientes históricos **020/021/022/PG** siguen abiertos y no los cierra este
spec.

---

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| El recordatorio humano acaba enviando WhatsApp por un camino indirecto | Estructural: no hay entrada en el worker ni llamada al sender. Un test con spy lo convierte en fallo de compilación si alguien lo conecta. |
| "Por atender" se infiltra como equivalente a "No leídas" | La definición está en el store y en una función puramente derivada, con tests de inclusión/exclusión explícitos. |
| Doble escritura entre handoff e inbound | Upsert por UNIQUE `(org, conversation)`; ambos call sites son idempotentes. |
| Fallo al escribir atención tumba el envío | Los enganches nunca propagan el error de atención hacia el camino crítico. |
| La Agenda se confundía con el motor automático | Copy explícito 👤/🤖, solo lectura, y §D-2 documenta por qué no se fusionan. |
| Regresión silenciosa de follow-ups | FR-1.9 + regresión obligatoria + revisión de imports cruzados. |

---

## 9. Trazabilidad

Decisiones de negocio de este bloque (dos conceptos, ciclo de atención, "no crear
etapas operativas", "plantillas fuera de alcance") son **decisión del dueño ya
congelada** en `spec.md`. Deben sincronizarse en el cerebro de negocio (Obsidian),
fuera de esta sesión. Este repositorio guarda el detalle técnico; el detalle de
producto vive arriba y en el spec, no duplicado en comentarios de código.

Supuesto explícito (Principio VII): las plantillas WhatsApp para recordatorios están
**fuera** de este bloque por decisión del dueño. Si más adelante se piden, es un
spec nuevo, no una extensión silenciosa de 013.
