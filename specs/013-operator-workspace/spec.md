# 013 — Operator Workspace (espacio de trabajo del operador)

Fecha: 2026-10-04. Alcance autorizado: el bloque de producto que convierte el CRM en
una herramienta operativa orientada a **"qué tengo que hacer ahora"**, separando
**trabajo operativo** del **pipeline comercial**.

Decisión de producto congelada en este spec. No es reinterpretable por la sesión
que implemente: si el código contradice este documento, el código está mal.

---

## 1. El problema observable

Hoy el CRM obliga a reconstruir el trabajo pendiente a mano:

- `handoffAt != null` significa a la vez "el humano tiene que actuar" y "el humano ya
  actúa". No hay forma de distinguir **pendiente** de **atendido**.
- Un compromiso humano ("háblame el jueves") no existe en el sistema. Solo existe el
  **seguimiento automático** (`sales_follow_up_job`), que además **escribe a
  WhatsApp** y está bloqueado en conversaciones con handoff.
- La Bandeja filtra por `Todas / No leídas / Anuncios`. "No leídas" es una métrica de
  lectura, no una cola de trabajo. Responde "¿qué no vi?", no "¿qué hago?".

Resultado: Max tiene que recordar lo prometido y filtrar a mano lo que realmente
requiere acción suya hoy.

---

## 2. Conceptos (dos, y solo dos)

### 2.1 POR ATENDER

Conversaciones que requieren una **acción humana AHORA**. Es una cola de trabajo, no
una vista de lectura. Se define **independientemente** de `unreadCount` y de la etapa
del pipeline.

### 2.2 AGENDA / RECORDATORIOS HUMANOS

Compromisos que **Max** tomó y debe retomar en una fecha futura
("háblame el jueves", "escríbeme la próxima semana", "retomemos en diciembre").

### 2.3 Recordatorio humano ≠ seguimiento automático (distinción obligatoria)

| | Seguimiento automático (existente) | Recordatorio humano (nuevo) |
|---|---|---|
| Origen | Lead dejó de responder | Max tomó la conversación |
| Actor | Sistema | Persona |
| Efecto al vencer | **Envía WhatsApp** | **Reaparece en Por atender** |
| Motor | `sales_follow_up_job` + worker in-process | Ninguno: derivación por fecha |
| Estados posibles | Con IA activa, sin handoff, sin lane HUMAN | Solo con atención humana activa |
| Bloqueo actual | Rechaza `human_lane` / `handoff_active` | Es **exactamente** el caso que el automático no cubre |

El contraste de la última fila es la prueba de que son dos mecanismos y no dos
nombres del mismo: el seguimiento automático **rechaza** programar cuando hay handoff
(`src/app/api/pipeline/leads/[id]/follow-up/route.ts`, errores `human_lane` /
`handoff_active`). El recordatorio humano solo existe en ese hueco.

**Prohibido** reutilizar `sales_follow_up_job` o `lead.nextFollowUpAt` como
recordatorio humano. Razón documentada en `plan.md` §5.

---

## 3. Modelo de atención humana (el ciclo que este spec resuelve)

`handoffAt` significa **IA pausada y la conversación es del flujo humano**. No
significa "pendiente para siempre". El estado **operativo** de esa atención es un
concepto aparte, con su propio ciclo de vida.

### 3.1 Estados

Tres estados operativos + la ausencia de estado. Nada más.

| Estado | Significado | ¿En Por atender? |
|---|---|---|
| `pending` | Requiere acción humana ahora | **Sí** |
| `waiting_client` | Atendido; Max está esperando al cliente | No |
| `deferred` + `due_at` | Pospuesto hasta una fecha futura | **No** mientras `due_at > ahora` |
| `deferred` + `due_at <= ahora` | Recordatorio **vencido** | **Sí** (derivado, no almacenado) |
| *(sin estado)* | La IA es dueña, o no hubo handoff, o se resolvió | No |

**El vencimiento no es un estado almacenado.** Es `deferred` cuya `due_at` ya pasó.
Consecuencia: el recordatorio vencido aparece en Por atender **sin worker, sin cron y
sin depender de que Max recuerde nada**. Es una comparación de fechas en cada lectura.

### 3.2 El ciclo, paso a paso

| # | Evento | Resultado |
|---|---|---|
| 1 | Jev hace handoff (`applyHandoff`) | → `pending` |
| 2 | Max **abre** la conversación | **Nada.** Abrir no es resolver (ni marcar leída) |
| 3 | Max **responde** desde el CRM (outbound manual) | → `waiting_client` |
| 4 | Max queda esperando al cliente | `waiting_client`, sin reactivar IA |
| 5 | Cliente escribe durante HUMAN | → `pending` (vuelve a Por atender) |
| 6 | Max acuerda "jueves 10:00" + nota | → `deferred(due_at)`, sale de Por atender, entra en Agenda |
| 7 | Cliente escribe **antes** del jueves | → `pending` inmediato; el recordatorio deja de esconderlo |
| 8 | Llega el jueves 10:00 | → `pending` **derivado**; reaparece solo |
| 9 | Max responde ese jueves | → `waiting_client` (compromiso atendido); puede programar otro |
| 10 | Reactivar IA / Cliente / Perdido | → estado humano incompatible **resuelto** de forma coherente |

### 3.3 Diagrama

```
        handoff (Jev)                inbound durante HUMAN
   (sin estado) ─────────────▶ pending ◀───────────── deferred(due_at futura)
                                  │                        │
                                  │ Max responde           │ due_at <= ahora
                                  │                        ▼ (derivado)
                                  ▼                   pending
                            waiting_client
                                  │                        │
                                  │ Max fija fecha         │ Max fija fecha
                                  ▼                        ▼
                             deferred(due_at) ◀───────────┘
                                  │
                                  │ Reactivar IA / Cliente / Perdido
                                  ▼
                             (sin estado)
```

### 3.4 Reglas de resolución coherente

- **Abrir o marcar leída NO resuelve** la atención. `markRead` sigue siendo
  ortogonal (`unreadCount = 0`).
- **Outbound manual exitoso** → `waiting_client` (el compromiso vigente queda
  atendido; el siguiente puede programarse aparte).
- **Desactivar la IA** (`aiEnabled: false`) → `pending`: la conversación pasa a ser
  del humano, así que requiere acción.
- **Reactivar IA** (`reactivate: true`) → se borra el estado humano: ya no hay
  commitments humanos y la IA es dueña.
- **Etapa `cliente` (kind `won`) o `perdido` (kind `lost`)** → se borra el estado
  humano: un compromiso sobre una conversación cerrada no tiene sentido.
- **Un recordatorio futuro NO se conserva** cuando el cliente escribe antes: la
  conversación está viva ahora, es trabajo presente. Max puede reprogramar.
- **Conversaciones `is_test` del Laboratorio** quedan fuera del modelo: no hay
  operador real atendiéndolas.

---

## 4. Requisitos

### CUT 1 — Estado durable de atención y recordatorios humanos

- **FR-1.1** Existe un estado durable y tenant-safe que distingue: atención humana
  pendiente ahora, atendido/esperando cliente, pospuesto hasta fecha futura, y
  recordatorio vencido (derivado).
- **FR-1.2** `organization_id` es NOT NULL, indexado org-first, y **toda** query pasa
  por `scoped()`. Una conversación de otra organización es invisible e inmodificable.
- **FR-1.3** Un recordatorio humano **nunca** envía WhatsApp: no invoca Graph, ni el
  sender, ni plantillas, ni el worker de follow-ups. Vencido significa "vuelve a la
  cola humana", no "mándale un mensaje".
- **FR-1.4** Inbound durante HUMAN reactiva `pending`.
- **FR-1.5** Abrir la conversación o marcarla leída **no** cambia el estado.
- **FR-1.6** El outbound manual resuelve la atención vigente de forma coherente
  (`waiting_client`), y no es un follow-up automático.
- **FR-1.7** Reactivar la IA limpia el estado humano incompatible.
- **FR-1.8** Mover el lead a `cliente` o `perdido` limpia el estado humano incompatible.
- **FR-1.9** El motor de follow-ups automáticos existente **no se modifica** en
  comportamiento: mismas cadencias, mismo worker, mismos estados, mismos errores.
- **FR-1.10** `pending` y `waiting_client` solo existen con conversación en HUMAN
  (`handoffAt != null`): si la IA es dueña, no hay estado humano.
- **FR-1.11** El estado es idempotente: repetir la misma transición no duplica filas ni
  efectos.
- **FR-1.12** Migración aditiva y re-ejecutable, con constraints que impidan estados
  incoherentes (p. ej. `deferred` sin fecha).
- **FR-1.13** Tests unitarios cubren el ciclo completo, el aislamiento tenant y la
  garantía de cero Graph.

### CUT 2 — Bandeja "Por atender"

- **FR-2.1** La Bandeja ofrece un chip/cola **"Por atender (N)"** con el conteo
  correcto.
- **FR-2.2** Muestra únicamente conversaciones que requieren acción humana **ahora**.
- **FR-2.3** La definición **no** usa `unreadCount` ni la etapa del pipeline como
  criterio de trabajo.
- **FR-2.4** Se incluyen: handoff recién creado, inbound nuevo durante HUMAN y
  recordatorio humano vencido.
- **FR-2.5** Se excluyen: recordatorios humanos todavía futuros y atención ya
  resuelta / esperando cliente.
- **FR-2.6** Se conservan `Todas`, `No leídas`, `Anuncios` y el filtro de etapa.
- **FR-2.7** El conteo y el listado son consistentes entre sí y con la definición.
- **FR-2.8** La lista sigue siendo tenant-safe y en vivo vía SSE como hoy.

### CUT 3 — Agenda y programación humana

- **FR-3.1** Desde una conversación en HUMAN se puede hacer equivalente a
  **"Recordarme" → fecha/hora → nota opcional**.
- **FR-3.2** Acepta fechas concretas ("jueves 10:00", "15 diciembre 09:00") y un
  compromiso abierto ("retomar cuando abra temporada") resuelto a una fecha concreta
  por la persona.
- **FR-3.3** Existe una superficie **Agenda** que agrupa: vencidos, hoy, mañana, esta
  semana, más adelante.
- **FR-3.4** Cada compromiso muestra contacto, fecha/hora, nota/razón y estado.
- **FR-3.5** La Agenda **no** envía mensajes automáticamente en ningún caso.
- **FR-3.6** Al vencer un recordatorio, la conversación vuelve a **Por atender**.
- **FR-3.7** Si el cliente escribe antes del vencimiento, vuelve a **Por atender**
  de inmediato.
- **FR-3.8** Se puede programar un siguiente recordatorio después de atender el
  anterior, sin acumular compromisos ambiguos.
- **FR-3.9** Se puede cancelar un recordatorio future explícitamente.
- **FR-3.10** La Agenda es tenant-safe: solo compromisos de la organización abierta.

### CUT 4 — Flujo operativo / UX integrada

- **FR-4.1** El vocabulario visible es de operación, no de internals: "Atención
  humana", "Marcar atendido / Esperando respuesta", "Recordarme", "Reactivar IA".
- **FR-4.2** No se le pide al usuario entender `handoffAt`, lanes, jobs ni timestamps
  internos.
- **FR-4.3** Desde la Bandeja se responde visualmente "¿qué tengo que hacer ahora?" y
  "¿qué tengo comprometido para después?".
- **FR-4.4** El estado humano/IA es visible en la conversación, en la lista y en la
  Agenda, con la misma semántica.
- **FR-4.5** Si la Agenda muestra también seguimientos **automáticos**, es
  **read-only**, claramente diferenciados (👤 Humano / 🤖 Automático) y **no**
  reimplementa ni modifica el motor automático.

### CUT 5 — Verificación

- **FR-5.1** E2E real con mocks cubre los 11 casos mínimos listados en `plan.md` §7.
- **FR-5.2** Ningún recordatorio humano toca Graph automáticamente.
- **FR-5.3** Sin regresión de follow-ups automáticos.
- **FR-5.4** Aislamiento tenant verificado con dos organizaciones.
- **FR-5.5** Gate completo `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
  en verde, más el self-test E2E correspondiente.

---

## 5. No objetivos (fuera de este bloque)

- **Plantillas WhatsApp** para recordatorios u otras finalidades. Explícitamente
  fuera; no se implementan ahora.
- Cambios en el pipeline comercial. Las etapas siguen siendo las comerciales: Nuevo →
  En conversación → Interesado → Cliente → Perdido.
- Etapas operativas tipo "Humano", "Seguimiento", "Pago pendiente" o "Recordatorio":
  **no son etapas comerciales** y no se crean.
- Enviar WhatsApp desde un recordatorio humano.
- Reimplementar, cambiar cadencias o "mejorar" el motor de follow-ups automáticos.
- Campañas masivas, analítica avanzada, dashboards nuevos, parsing automático de
  fechas en texto libre.
- Cualquier dependencia externa nueva (Constitución II).
- Rebrand y rediseño visual: viven en `specs/014-espacio-connect-rebrand`.

---

## 6. Aceptación del bloque

Los cinco cortes quedan implementados, cada uno con **exactamente un commit**:

| Corte | Commit objetivo |
|---|---|
| 1 | `feat(inbox): persistir atención y recordatorios humanos` |
| 2 | `feat(inbox): añadir cola por atender` |
| 3 | `feat(inbox): añadir agenda de recordatorios humanos` |
| 4 | `feat(inbox): integrar flujo operativo de atención` |
| 5 | `test(inbox): verificar workspace operativo` |

Criterio de cierre: gate técnico verde + self-test E2E de comportamiento ejecutados
(Constitución IX). Si el E2E no puede ejecutarse por entorno, se registra comando,
causa y **PENDIENTE** explícito en `tasks.md` y `docs/CURRENT_STATE.md`; no se
declara READY punta a punta.
