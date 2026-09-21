# Sales Follow-ups — contrato del motor automático

Fuente durable de contexto para los siguientes commits de esta feature.
No es spec de implementación: congela decisiones. El código funcional aún no cambia.

Este documento es independiente de `docs/SALES_ORCHESTRATOR.md`. El Sales
Orchestrator V1 está **congelado**. Aquí se define el motor que programa,
cancela y envía seguimientos comerciales automáticos.

Principio:

```
seguimiento sí
persecución no
```

Anclas actuales del CRM (no modificar en este phase):

- Ventana 24h: `src/server/inbox/window.ts` (`WINDOW_MS`, `isWindowOpen(lastInboundAt)`). Texto libre solo si el último inbound está dentro de 24h.
- Envío de texto: `src/server/inbox/send.ts` (`prepareSend` lanza `window_closed` si la ventana está cerrada; sandbox `is_test` lanza `sandbox_violation`).
- Plantillas: `src/server/whatsapp/templates.ts` (`sendTemplate` exige plantilla de la misma org con `status=approved`; no abre la ventana).
- Ingesta inbound: `src/server/inbox/ingest.ts` persiste, `onLeadActivity`, `maybeRunAgentTurn`.
- Echo manual del dueño: `ingestManualEcho` registra `origin=manual` y pausa IA (`handoff_at` + `handoff_reason=manual_reply`).
- Arranque in-process: `src/instrumentation.ts` → `src/instrumentation-node.ts` (limpia corridas huérfanas del Laboratorio y arranca el worker de follow-ups).
- Resumen UI ya en `lead`: `next_follow_up_at`, `follow_up_count`, `follow_up_reason`.
- Cola durable: `sales_follow_up_job` + worker in-process (`src/server/sales/follow-ups/worker.ts`).
- Lanes congeladas: `auto` | `auto_close` | `wait` | `human` | `stop`.
- Opt-in Sales Orchestrator: `agent_profile.sales_orchestrator_enabled` (default false).
- Opt-in follow-ups: `agent_profile.sales_follow_ups_enabled` (default false) + `sales_follow_up_template_id` nullable.

---

## 1. Objetivo

Automatizar el seguimiento de leads que dejan de responder **sin consumir
tiempo humano** y **sin perseguirlos indefinidamente**.

El sistema debe:

- programar seguimientos después de respuestas comerciales automáticas;
- cancelar seguimientos si el prospecto vuelve a escribir;
- respetar HUMAN, STOP y handoffs;
- usar texto libre únicamente dentro de la ventana WhatsApp de 24h;
- usar una plantilla aprobada cuando la ventana esté cerrada;
- detenerse después de un número finito de intentos;
- distinguir un lead **dormido por silencio** de un lead **comercialmente perdido**.

---

## 2. STOP vs DORMANT

**NO** crear una nueva automation lane `dormant`.

Se conservan las lanes congeladas del Orchestrator:

`AUTO` · `AUTO_CLOSE` · `WAIT` · `HUMAN` · `STOP`

Definición:

**STOP** = la automatización activa se detiene.

Dos casos distintos sobre la misma lane:

| Caso | Estado | Semántica |
|---|---|---|
| A | `STOP` + pipeline `lost` | Lead descalificado / perdido comercialmente. |
| B | `STOP` + pipeline todavía `open` + `follow_up_reason=no_reply_exhausted` | **DORMANT**. |

**DORMANT no es perdido.** Puede reactivarse si vuelve a escribir o mediante
una acción manual / campaña futura (campañas: fuera de alcance de esta V1).

Esto evita cambiar el contrato congelado de lanes.

El worker de follow-ups **no envía** a un lead en `STOP`. El único STOP
permitido como resultado de este motor es DORMANT (caso B), y se aplica
**después** de agotar la secuencia, nunca como destino de un envío extra.

---

## 3. Política de silencio

Máximo **3 seguimientos automáticos** por secuencia.

Cadencia inicial (delays relativos; el intento N se ancla al mensaje anterior
de la secuencia, no a un cron absoluto):

### `awaiting_reply`

| Intento | Delay |
|---|---|
| 1 | 6 horas después del mensaje anterior |
| 2 | 18 horas después del seguimiento anterior |
| 3 | 48 horas después del seguimiento anterior |

Resultado aproximado si todos se envían a tiempo: **6h → 24h → 72h** desde el
mensaje inicial.

### `after_demo`

| Intento | Delay |
|---|---|
| 1 | 20 horas |
| 2 | 52 horas después |
| 3 | 96 horas después |

Resultado aproximado: **20h → 72h → 7 días**.

### `after_price`

Mismo esquema que `after_demo`: **20h → +52h → +96h**.

Después del intento 3 sin respuesta:

```
automation_lane     = stop
follow_up_reason    = no_reply_exhausted
next_follow_up_at   = null
```

**NO** mover el pipeline a `lost`.

Las constantes de cadencia y el máximo de intentos deben quedar posteriormente
centralizadas y fáciles de modificar. No hardcodearlas dispersas.

---

## 4. WAIT / futuro

Si Jev devuelve WAIT pero no existe fecha concreta:

**NO inventar una fecha.**

Puede quedar:

```
lane                = wait
next_follow_up_at   = null
```

Debe poder programarse **manualmente** una fecha futura desde el CRM.

Un seguimiento manual futuro es `scheduled_wait`.

`scheduled_wait` es inicialmente **ONE-SHOT**:

- envía una reactivación en la fecha indicada;
- no encadena automáticamente tres mensajes sin respuesta;
- después espera respuesta.

No hacer extracción automática de meses/fechas en esta versión.

---

## 5. Cancelación

Cualquier **nuevo mensaje del prospecto**:

- cancela jobs pendientes de la secuencia anterior;
- `next_follow_up_at = null`;
- `follow_up_count = 0`;
- limpia razones de silencio anteriores;
- si estaba DORMANT por `no_reply_exhausted`, vuelve a `auto`.

**NO** reactivar automáticamente:

- HUMAN
- conversaciones con handoff activo
- STOP comercial por descalificación (pipeline `lost`)

El siguiente turno normal de Jev vuelve a decidir cuando corresponda.

Una **respuesta manual del operador/propietario** también debe invalidar
seguimientos automáticos pendientes (incluye echo `origin=manual` desde la app
de WhatsApp Business y envío `origin=operator` desde el CRM).

---

## 6. WhatsApp 24h

Dentro de ventana abierta → se puede enviar **texto libre**.

Fuera de la ventana → **SOLO plantilla aprobada**.

El motor jamás intentará saltarse la ventana de 24h. Reutiliza
`isWindowOpen(conversation.lastInboundAt)` en el momento del envío, no en el
momento de programar el job.

Conversaciones `is_test` jamás tocan Graph (guardrail existente; no
“arreglarlo”).

---

## 7. Plantilla automática

Agregar posteriormente a `agent_profile`:

| Campo | Default | Semántica |
|---|---|---|
| `salesFollowUpsEnabled` | `false` | Opt-in del motor. Distinto de `salesOrchestratorEnabled`. |
| `salesFollowUpTemplateId` | `null` | Plantilla usada cuando la ventana está cerrada. |

La plantilla automática:

- debe existir en la misma organización;
- debe estar `approved`;
- para V1 follow-ups automáticos debe tener **CERO variables BODY**;
- no inventar valores;
- no enviar plantillas no aprobadas.

Si un seguimiento vence con ventana cerrada y no existe plantilla válida:

- **NO** enviar nada;
- marcar el seguimiento como `blocked`;
- dejar evidencia visible;
- no hacer retry infinito.

---

## 8. Redacción

Jev **NO** se vuelve a llamar por el simple paso del tiempo.

No hay nueva evidencia del prospecto.

Flujo:

```
follow-up vence
  → reglas CRM
  → writer limitado redacta texto si la ventana sigue abierta
  → CRM envía
```

El writer de follow-up:

- solo escribe texto;
- no decide lane;
- no decide pipeline;
- no hace handoff;
- no cambia precio;
- no introduce nueva oferta;
- no inventa URLs;
- no pregunta varias cosas;
- debe sonar como seguimiento natural, no como mensaje de bot.

Fuera de ventana no se usa el writer → plantilla aprobada.

---

## 9. Persistencia

Usar **PostgreSQL como cola durable**.

NO:

- Redis
- BullMQ
- n8n
- colas externas
- cron SaaS

Crear posteriormente una tabla `sales_follow_up_job`.

Concepto:

| Campo | Semántica |
|---|---|
| `id` | Identificador |
| `organization_id` | Tenant (NOT NULL) |
| `lead_id` | Lead |
| `conversation_id` | Conversación |
| `reason` | `awaiting_reply` \| `after_demo` \| `after_price` \| `scheduled_wait` |
| `attempt_number` | Intento comercial 1..3 (1 en `scheduled_wait`) |
| `due_at` | Cuándo vence |
| `anchor_at` | Ancla: no enviar si hubo mensaje posterior |
| `status` | `pending` \| `processing` \| `sent` \| `cancelled` \| `blocked` \| `failed` |
| `run_attempts` | Retries técnicos del mismo job |
| `claimed_at` | Lease del worker |
| `message_id` | Mensaje enviado, si aplica |
| `error` | Causa visible si `blocked` / `failed` |
| timestamps | `created_at` / `updated_at` |

`lead.next_follow_up_at`, `follow_up_count` y `follow_up_reason` siguen siendo
el **resumen rápido para UI**. La fuente de verdad de envío es el job.

---

## 10. Seguridad contra duplicados

El worker debe reclamar jobs de forma **atómica**.

Dos workers nunca deben enviar el mismo seguimiento dos veces.

Antes de enviar debe volver a comprobar:

- el job sigue vigente (`pending`/`processing` reclamado por este worker);
- `organization_id` coincide;
- la conversación sigue válida y no es `is_test` hacia Graph;
- no existe handoff (`handoff_at` null);
- IA sigue activa (`conversation.ai_enabled`);
- Sales Orchestrator sigue activo;
- follow-ups siguen activos;
- no hubo mensaje posterior al `anchor_at`;
- el lead no está HUMAN;
- el lead no está STOP (DORMANT y descalificación incluidos: no hay envío extra).

Jobs `processing` abandonados por reinicio deben poder recuperarse después de
una lease razonable.

---

## 11. Worker

El proyecto sigue **sin colas externas**.

Se usará un worker in-process iniciado desde la infraestructura existente:

```
src/instrumentation.ts
  → src/instrumentation-node.ts
```

Con **guard global** para no duplicar intervalos por hot reload.

Tick aproximado: **60 segundos**.

El estado durable está en PostgreSQL, así que reiniciar el proceso no pierde
los jobs. Un job `processing` huérfano se recupera por lease (§10).

---

## 12. Reintentos técnicos

No confundir:

| Concepto | Qué es |
|---|---|
| **FOLLOW-UP ATTEMPT** | Mensaje comercial 1, 2 o 3 de la secuencia. |
| **RUN ATTEMPT** | Retry técnico del **mismo** job. |

Un error transitorio del LLM/Meta puede reintentarse técnicamente **sin
consumir** otro follow-up comercial.

Máximo inicial: **3 run attempts**.

Después: `failed` o `blocked` según causa.

- Transitorio (LLM/Meta 5xx / red) → `failed` tras agotar run attempts.
- Política permanente (ventana cerrada sin plantilla válida, lane HUMAN/STOP,
  handoff, flag off) → `blocked`, sin retry infinito.

---

## 13. Integración con Sales Orchestrator

Después de una respuesta comercial enviada **correctamente**:

| Lane / situación | Efecto |
|---|---|
| `AUTO` / `AUTO_CLOSE` | Crear secuencia si corresponde. |
| `HUMAN` | No programar. |
| `STOP` | No programar. |
| `WAIT` sin fecha | No programar. |
| `WAIT` con fecha manual | `scheduled_wait`. |

Clasificación inicial de la secuencia (según `next_action` del plan ya
resuelto, no según una nueva llamada a Jev):

| `next_action` | `reason` |
|---|---|
| `present_price` | `after_price` |
| `show_operations_demo` | `after_demo` |
| `show_online_enrollment_demo` | `after_demo` |
| resto de respuestas `AUTO` / `AUTO_CLOSE` | `awaiting_reply` |

Programar **después** del envío correcto (el mismo criterio post-entrega que
ya usa el Orchestrator para `demo_shown_at` / `price_presented_at`). Si el
writer o Graph fallan, no se crea job.

---

## 14. Out of scope

No implementar todavía:

- campañas masivas;
- atribución Meta Ads;
- lead scoring;
- nuevas Questions Jev;
- parsing inteligente de fechas futuras;
- múltiples plantillas por etapa;
- analytics avanzado.

---

## Implementation log

### 2026-09-20 — phase 15

- Contrato follow-ups creado.
- `CLAUDE.md` sincronizado con Constitución 1.3.0 (WhatsApp Cloud API + LLM/OpenRouter opcional + TypeSafe/Jev opcional).
- Ningún código funcional todavía.

### 2026-09-20 — phase 16

- Tabla durable `sales_follow_up_job` creada.
- Flags de organización `salesFollowUpsEnabled` / `salesFollowUpTemplateId` creados.
- Worker aún no existe.

### 2026-09-20 — phase 17

- Política/cadencias centralizadas en `src/server/sales/follow-ups/policy.ts`.
- Writer text-only creado (`follow-up-writer.ts`); ventana cerrada sigue siendo plantilla, sin LLM.
- Aún sin persistencia/worker live.

### 2026-09-20 — phase 18

- Store durable: schedule/cancel/reset/dormant sobre `sales_follow_up_job`.
- Enganchado post-envío del orchestrator, inbound y respuestas manuales.
- Worker aún no ejecuta jobs.

### 2026-09-20 — phase 19

- Worker durable: claim atómico (`FOR UPDATE SKIP LOCKED`), revalidación, texto o plantilla, retries técnicos.
- Arranque in-process desde `instrumentation-node.ts` (tick ~60s, guard HMR).
- UI todavía no.

### 2026-09-20 — phase 20

- `/agent`: toggle `salesFollowUpsEnabled` (default OFF, exige Orchestrator) + selector de plantilla 0-var aprobada (`salesFollowUpTemplateId`).
- Panel de contacto: estado/count/reason/`nextFollowUpAt`; Dormido ≠ Perdido; programar/cancelar/reactivar con `datetime-local`.
- `POST`/`DELETE` `/api/pipeline/leads/[id]/follow-up` tenant-safe (`scheduleManualFollowUp` / cancel).
- Board: etiqueta **Dormido** cuando `STOP` + `no_reply_exhausted`. `template_required` enlaza a `/agent`.

