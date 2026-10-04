# Tasks — 013 Operator Workspace

**Estado durable de este spec.** Base limpia de arranque:
`ef83302262f9b147ded271ba4d1d5b323f88e344`
(`fix(sales): hacer silencioso el handoff humano`).

Regla de este archivo: refleja el estado **real**. Una casilla solo se marca cuando
hay evidencia (comando + resultado). Un corte fallido deja su trabajo para una sesión
nueva; nunca se descarta ni se auto-revierte.

Spec activo: `specs/013-operator-workspace/spec.md` · `plan.md` · este archivo.
Runner: `scripts/ai/run-operator-workspace-mcode.sh` (sesión mcode nueva por corte).
Prompts de corte: `.ai/tasks/operator-workspace/`.

---

## Mapa de cortes

| Corte | Objetivo | Commit objetivo | Sesión |
|---|---|---|---|
| CUT 1 | Estado durable de atención y recordatorios humanos | `feat(inbox): persistir atención y recordatorios humanos` | `01-cut1-attention-state.md` |
| CUT 2 | Bandeja "Por atender" | `feat(inbox): añadir cola por atender` | `02-cut2-por-atender-queue.md` |
| CUT 3 | Agenda y programación humana | `feat(inbox): añadir agenda de recordatorios humanos` | `03-cut3-agenda-human-reminders.md` |
| CUT 4 | Flujo operativo / UX integrada | `feat(inbox): integrar flujo operativo de atención` | `04-cut4-operational-flow.md` |
| CUT 5 | Verificación del workspace | `test(inbox): verificar workspace operativo` | `05-cut5-verification.md` |

Cortes 6–8 (rebrand + rediseño) viven en `specs/014-espacio-connect-rebrand/tasks.md`.

---

## CUT 1 — Estado durable de atención y recordatorios humanos

- [x] T101 Spec, plan, Constitution Check y análisis del código real (choke points)
- [x] T102 `ca_` en `src/lib/db/ids.ts`; tabla `conversation_attention` en `schema.ts`
- [x] T103 Migración `0010` re-ejecutable + `idx: 12` en el journal Drizzle
- [x] T104 `src/server/inbox/attention.ts`: `markAttentionPending`,
      `markAttentionWaitingClient`, `scheduleHumanReminder`, `clearAttention`,
      `getAttention`/`listAttention`; todo con `scoped()` y upsert idempotente
- [x] T105 Enganche `applyHandoff` → `pending`
- [x] T106 Enganche inbound durante HUMAN → `pending` (y `ingestManualEcho` →
      `waiting_client`)
- [x] T107 Enganche outbound `origin=operator` → `waiting_client`
- [x] T108 Enganche `reactivate` → limpiar; `aiEnabled=false` → `pending`;
      `markRead` **no** toca atención
- [x] T109 Enganche `moveLeadStage` a `won`/`lost` → limpiar
- [x] T110 Tests unitarios: ciclo de 10 pasos, derivación, constraints, tenant A/B,
      cero Graph
- [x] T111 Regresión follow-ups automáticos sin expectativas modificadas
- [x] T112 Gate completo verde; **E2E NO ejecutado** (causa registrada abajo)
- [x] T113 Documentación, evidencia, un commit, árbol limpio

## CUT 2 — Bandeja "Por atender"

- [x] T201 `ConversationDto` + `attention` aditivo; LEFT JOIN scropeado en
      `listConversations` (patrón `adAttribution`), sin N+1
- [x] T202 `needsAttentionNow` derivado en un único lugar
- [x] T203 Chip "Por atender (N)" con conteo correcto, antes de `Todas`
- [x] T204 Inclusión: handoff nuevo, inbound durante HUMAN, recordatorio vencido
- [x] T205 Exclusión: recordatorio futuro, `waiting_client`, sin estado
- [x] T206 `Todas` / `No leídas` / `Anuncios` / filtro de etapa intactos
- [x] T207 Tests del filtro y del conteo
- [x] T208 Gate + E2E de UI **EJECUTADO y VERDE** (35/35, ver evidencia)
- [x] T209 Evidencia, un commit, árbol limpio

## CUT 3 — Agenda y programación humana

- [x] T301 Store de consulta con buckets `overdue/today/tomorrow/week/later`
- [x] T302 `GET /api/reminders` (org de sesión, sin org en el body)
- [x] T303 `POST /api/reminders` (Zod: `dueAt` **futura**, `note` opcional recortada)
- [x] T304 `DELETE /api/reminders/[conversationId]` (cancelar)
- [x] T305 Acción "Recordarme" en la conversación en HUMAN
- [x] T306 Vista Agenda: vencidos / hoy / mañana / esta semana / más adelante, con
      contacto, fecha/hora, nota y estado
- [x] T307 Vencido → Por atender; inbound antes → Por atender inmediato
- [x] T308 Programar un segundo recordatorio tras atender el anterior
- [x] T309 Cero envíos: ningún camino desde la Agenda hasta Graph/sender
- [x] T310 Tests de bucketing (UTC/local), fecha límite, tenant, cero Graph
- [x] T311 Gate + E2E **EJECUTADO y VERDE** (49/49, ver evidencia)
- [x] T312 Evidencia, un commit, árbol limpio

### Evidencia CUT 3

**T301 · store y bucketing en el servidor** — `src/server/inbox/agenda-buckets.ts`
(puro, sin BD ni red) + `src/server/inbox/agenda.ts` (lectura). Cinco grupos
calculados con `now` INYECTABLE y zona explícita; `overdue` con tope CERRADO
(`due_at <= now`, el mismo criterio que `isOverdue`) y los otros cuatro
semiabiertos `[from, to)`, encadenados sin huecos. `startOfLocalDay` /
`addLocalDays` / `startOfLocalWeek` trabajan en calendario local (no +24h), así
que un día con cambio de horario de 25 h no desplaza los límites. Zona:
`?tz=` → `OPERATOR_TIMEZONE` → zona del proceso → `UTC`; una zona inválida no
rompe la vista. La lista es UN SELECT con `innerJoin` y el `organization_id` de
AMBOS lados en el ON, `is_test = false`, y solo `state = 'deferred'`.

**T302-T304 · endpoints** — `GET`/`POST` en `src/app/api/reminders/route.ts`,
`DELETE` en `src/app/api/reminders/[conversationId]/route.ts`. Zod `.strict()`:
un `organizationId` en el body es 422. `dueAt` pasada → 422 `due_in_past`; nota
>280 o vacía → 422 (no un `null` silencioso). Org siempre de la sesión: ajeno →
404. `ai_owns_conversation` y `is_test` → 409. Cancelar un `pending` vivo → 409
(cancelar no borra trabajo de la cola) y sin recordatorio → 404. Programar y
cancelar publican `conversation.updated`, y por eso la Bandeja sale de
"Por atender" sin recargar a mano.

**Decisión de producto · qué significa "cancelar"**: se BORRA la fila
`deferred`. No se devuelve a `pending`, porque "cancelar" es "ya no hay nada que
retomar a esa hora" y devolverla a la cola sería lo contrario. La conversación
sigue siendo humana (`ai_enabled`/`handoff_at` intactos) y si el cliente
escribe vuelve a `pending` por la ingesta.

**T305 · "Recordarme"** — `src/components/inbox/reminder-schedule.tsx`, dentro
del panel de la conversación y solo si es del humano (`handoffAt || !aiEnabled`);
si no, ni se ofrece (el servidor lo rechaza con 409). Fecha por `datetime-local`
(conversión a ISO en el navegador) y nota opcional. **Sin parsing de texto
libre** (spec §2.3). El botón "Vencido" usa `attention.needsAttentionNow`, que
ya viene derivado del servidor: el cliente no recalcula el reloj.

**T306 · Agenda** — `src/app/(app)/agenda/page.tsx` +
`src/components/agenda/agenda-client.tsx`. Superficie PROPIA (enlace en el
`AppNav`, sin contador de vencidos: eso es T403, corte 4). Cada item muestra
contacto, fecha/hora, nota, estado ("programado" / "vencido · en Por atender") y
las dos acciones: **Abrir** (`/inbox?contact=…`, el mismo deep-link que ya usa la
Bandeja) y **Cancelar**. Se refresca con SSE y con botón "Actualizar"; camino
infeliz: si el GET falla, avisa y sigue vacía sin colgarse.

**T307-T308 · ciclo** — verificado en vivo (ver T311) y en unit: programar →
sale de Por atender; vencido → vuelve (sin proceso ni worker, es derivación de
lectura); inbound antes → `pending` inmediato y sale de la Agenda; segundo
recordatorio tras atender → **reemplaza** (UNIQUE `(org, conversation)`), nunca
se acumulan compromisos ambiguos; cancelar → desaparece de la Agenda y de la BD.

**T309 · cero envíos** — `tests/unit/agenda-no-send.test.ts`, que es requisito de
producto, no extra. Estructural: los 7 ficheros de la Agenda no importan ni
nominan sender/Graph/plantillas/motor (`sales_follow_up_job`, `nextFollowUpAt`),
y el motor de follow-ups no conoce la Agenda. Dinámico: el camino COMPLETO por
los endpoints reales con los 10 colaboradores de envío sabotajeados (si se
llaman, el test revienta) y `sales_follow_up_job` declarada en el doble
precisamente para comprobar que sigue VACÍA. El E2E lo confirma en pantalla:
outbox del wa-mock sin cambios y `sales_follow_up_job` intacta.

**T310 · tests** — 59 casos nuevos: `agenda-buckets.test.ts` (20: los cinco
grupos, reloj inyectable, 23:59:59/medianoche/cambio de día, sábado y domingo
con "esta semana" vacía, DST de 25 h, el mismo timestamp en distinto grupo según
zona), `reminder-agenda-api.test.ts` (26: contrato, ciclo, tenant A/B),
`agenda-no-send.test.ts` (8), `agenda-view.test.ts` (5, JSX real con
`renderToStaticMarkup`).

**T311 · gate + E2E EJECUTADO** —
`pnpm typecheck && pnpm lint && pnpm build && pnpm test`: typecheck limpio, lint
0 errores (3 warnings preexistentes), build OK y **1280 tests / 112 ficheros en
verde** (9 skipped, opt-in de PostgreSQL).
E2E `E2E_SECTION=024` (nuevo `scripts/e2e-operator-agenda.mjs`): **49/49 checks
VERDES** con app real en desarrollo, PostgreSQL real (`operator_workspace_test`),
wa-mock + ai-mock y Playwright. Cubre: los cinco grupos en pantalla; programar
desde la UI y verlo salir de "Por atender" (2→1) sin recargar; vencer y volver
(1→2); inbound real por el mock y vuelta inmediata; cancelar; aislamiento de
tenant en pantalla; y todo el camino infeliz. Guion en
`tests/e2e/013-agenda-recordatorios.md`.

**T312 · cierre** — `docs/CURRENT_STATE.md` y `docs/SALES_FOLLOW_UPS.md`
actualizados (nota de que existe un mecanismo HUMANO distinto, sin tocar ninguna
regla del motor). Un commit atómico:
`feat(inbox): añadir agenda de recordatorios humanos`.

**Hallazgos que dejó el E2E (arreglados en el corte)**

1. El bucketing `overdue` era semiabierto mientras la regla de dominio es
   cerrada: un recordatorio vencido hacía horas podía clasificarse como "hoy" y
   esconderse. Lo cazó el test de límites.
2. `cancelHumanReminder` filtra por `state = 'deferred'` en la propia sentencia
   del `DELETE`, no solo en un read previo: si un `pending` llegase entre medias,
   "cancelar" no puede borrar trabajo vivo de la cola.
3. Para el E2E, el `phone_number_id` del mock debe ser ÚNICO por corrida: el
   webhook resuelve la organización por la PRIMERA fila que coincide, así que un
   PN fijo hacía que el inbound acabase en la organización de una corrida
   anterior. Documentado en el guion.

**Lo que este corte NO abre**

- Sin plantillas WhatsApp, sin messaging proactivo, sin etapas operativas
  (decisión de producto, spec §5 y §6).
- El contador de vencidos en el nav es T403 (corte 4), no se metió aquí.
- `src/server/sales/follow-ups/**`, cadencias, worker, seeding y los errores
  `human_lane`/`handoff_active`: **intactos**. El endpoint de follow-ups sigue
  rechazando la vía humana, y ahora eso se afirma también en
  `agenda-no-send.test.ts`.

## CUT 4 — Flujo operativo / UX integrada

- [x] T401 Revisión de naming: "Atención humana", "Marcar atendido / Esperando
      respuesta", "Recordarme", "Reactivar IA"
- [x] T402 Nada de `handoffAt`, lanes, jobs ni timestamps internos en copy visible
- [x] T403 Nav con Agenda y conteo de vencidos
- [x] T404 Acciones coherentes en la conversación
- [x] T405 Estado humano/IA con la misma semántica en lista, hilo y Agenda
- [x] T406 (Opcional) Automáticos read-only con 👤/🤖, sin reimplementar el motor
- [x] T407 Gate + E2E de UI (o PENDIENTE con causa)
- [x] T408 Evidencia, un commit, árbol limpio

### T406 · NO se hizo, y por qué (decisión de corte, no un olvido)

La vista read-only de seguimientos automáticos en la Agenda se deja fuera a
propósito, aunque el corte la tenía como opcional. Mostrarla exigía **cambiar el
contrato `ReminderDto`** (añadir el estado del seguimiento y la fecha del
automático), y este corte tiene prohibido cambiar DTOs. La alternativa —leer la
tabla del motor desde la Agenda— es justo el acoplamiento que el spec §2.3
prohíbe: la Agenda dejaría de ser un mecanismo humano independiente para
convertirse en una segunda vista del motor.

Lo que sí se hizo, sin tocar ningún contrato, es resolver en el panel la
distinción 👤/🤖 que pedía FR-4.5: el lado humano se llama **"Recordarme"** y el
automático **"Seguimiento automático"** / "Intentos automáticos" / "Próxima
automatización". Con eso el operador ya sabe qué botón es suyo y cuál no, sin
tratar de unify dos mecanismos que deben seguir separados. Queda como candidato a
un corte propio que sí pueda cambiar `ReminderDto`.

**Qué entró**

Base: `73cd87c` (árbol limpio al empezar; cortes 1–3 cerrados). Este corte **no
introduce estados ni endpoints de dominio**: integra los que ya existían. Lo que
se toca es flujo, copy y una superficie de escritura nueva que delega en la
función del corte 1.

- `src/lib/operational-state.ts` (nuevo, puro): el vocabulario operativo en un
  solo sitio. `estadoOperativo()` deriva el estado visible de
  `{attention, aiEnabled, handoffAt}` y `estadoDeAtencion()` hace lo mismo desde
  la fila de atención sola, que es lo que tiene la Agenda. `ETIQUETA_ESTADO` y
  `EXPLICACION_ESTADO` son el copy; `vencidosDeAgenda()` lee el grupo `overdue`
  que el servidor ya calculó. **No recalcula el reloj**: "vencido" llega derivado
  en `needsAttentionNow`, igual que en los cortes 2 y 3.
- `src/app/api/conversations/[id]/attention/route.ts` (nuevo): `POST` con
  `{state: "waiting_client"}` en `.strict()`. La transición la ejecuta
  `markAttentionWaitingClient` — **la misma función** que ya corren el envío
  manual y el eco del dueño, así que "marcar atendido" y "contestar" no son dos
  puertas parecidas sino la misma. 404 (no existe / otra organización), 409 (la
  IA es la dueña / es del Laboratorio), 422 (cualquier otro estado). Publica
  `conversation.updated` con el DTO ya derivado, que es lo que hace salir la fila
  de la cola sin recargar.
- `src/components/inbox/attention-block.tsx` (nuevo): el bloque que junta el
  estado y las tres acciones. Aparece para **cualquier** conversación del humano
  (hubo handoff o se apagó la IA a mano); antes, con la IA apagada solo había
  "Recordarme", sin estado ni "Reactivar IA" — el hueco que dejaba el flujo
  incoherente. "Marcar atendido" se ofrece solo en `por_atender`, que es
  exactamente cuando hay una tarea.
- `conversation-list.tsx`: la etiqueta de la fila pasa de "atención humana" (que
  solo miraba `handoffAt`) al **estado operativo** compartido. Nuevo chip
  "Comprometidos" detrás de "Por atender" (FR-4.3) y `flex-wrap` en la fila para
  que quepan los cuatro sin aplastar el selector de etapa.
- `bandeja-filtros.ts`: `comprometida()` y el campo `comprometidos`, sobre la
  MISMA operación que el resto de contadores, para que el chip no pueda
  discrepar de su listado. `FiltroBandeja` es un tipo local del cliente, no un
  DTO: los tres filtros del corte 2 conservan su significado.
- `app-nav.tsx`: la Agenda (enlace ya existente desde el corte 3) pasa a llevar
  **contador de vencidos**, con la misma reactividad SSE que el de no leídas. Un
  solo refetch en paralelo para los dos contadores e independientes entre sí: si
  la Agenda falla, el número de no leídas no se congela. Lee el grupo `overdue`
  tal cual, así que el número del nav y el chip "Por atender" no pueden
  discrepar por construcción.
- `contact-panel.tsx`: entra `AttentionBlock`; el motivo del handoff pasa al
  bloque y se cuenta en castellano; el lado automático se nombra explícitamente
  ("Seguimiento automático", "Intentos automáticos", "Próxima automatización")
  para que no se confunda con el compromiso humano.
- `src/lib/sales-ui.ts`: el lane `human` del badge de "Venta" se renombra a
  "En manos de una persona". Decía "Atención humana", **la misma palabra que la
  etiqueta de estado humano**: dos significados distintos con un solo nombre, y
  se leía como un estado del ciclo cuando en realidad describía que el motor
  automático dejó de trabajar la conversación.

**T407 · gate + E2E EJECUTADOS**

`pnpm typecheck && pnpm lint && pnpm build && pnpm test`: typecheck limpio, lint
0 errores (3 warnings preexistentes), build OK y **1311 tests / 114 ficheros en
verde** (9 skipped, opt-in de PostgreSQL). 30 casos nuevos en
`operational-flow.test.ts`; `agenda-no-send.test.ts` pasa de 8 a 9 casos y su
lista de ficheros cubre ya el endpoint nuevo, el bloque, el vocabulario
compartido y los dos ficheros de la Bandeja.

E2E `E2E_SECTION=025` (nuevo `scripts/e2e-operator-flow.mjs`): **84/84 checks
VERDES**, dos veces seguidas, con app real en desarrollo, PostgreSQL real
(`operator_workspace_test`), wa-mock + ai-mock y Playwright. Recorre el flujo
completo como una persona: ver las dos preguntas, **abrir y comprobar que no
saca**, "Marcar atendido" (2 → 1), "Recordarme" (Comprometidos 1 → 2), verlo en
la Agenda, "Reactivar IA" que limpia y saca de la Agenda, y un inbound real
seguido de una respuesta escrita a mano que sí sale. Camino infeliz completo:
sin sesión, organización ajena, 409 de la IA y del Laboratorio, 422 por estado no
permitido, y **la Agenda en 500** avisando sin romper la vista. Guion en
`tests/e2e/013-flujo-operativo.md`.

**Garantía medible que dejó el E2E**: el outbox del wa-mock crece
**exactamente en 1** en todo el guion, y es el mensaje que la persona escribió a
mano. Ni "marcar atendida", ni "recordarme", ni "reactivar IA", ni un recordatorio
vencido mandan nada, y `sales_follow_up_job` queda intacta.

**Hallazgos que dejó el E2E (arreglados en el corte)**

1. El botón "Enviar" del composer está deshabilitado con el texto vacío
   (`canSubmit`), así que usarlo como prueba de "la ventana de 24 h está
   abierta" daba falso negativo. La comprobación mira el aviso real del composer.
2. La ventana se abre por SSE: el panel ya está pintado con la conversación
   anterior cuando el inbound aterriza. Se espera al `conversation.updated` en
   vez de leer el estado en el mismo tick.
3. Dos expectativas del guion mal calculadas (la Agenda acumula: al programar hay
   3 items, no 2; al reactivar quedan 2, no 1). Corregidas.

**Lo que este corte NO abre**

- Sin cambios de contrato: ni DTOs, ni endpoints existentes, ni la lógica de
  atención de 013, ni `src/server/sales/follow-ups/**`. El `ReminderDto` sigue
  igual.
- Etapas operativas en el pipeline, plantillas, envío proactivo y dashboards
  nuevos: no objetivos del spec (§5).
- Sigue pendiente de cortes anteriores: la FK compuesta de
  `conversation_attention` (ver "Evidencia → PENDIENTE…", punto 1).

## CUT 5 — Verificación del workspace

- [ ] T501 Sección nueva aislada en `scripts/e2e-selftest.mjs` (patrón 020/022)
- [ ] T502 Guion `tests/e2e/` del workspace
- [ ] T503 handoff → Por atender
- [ ] T504 abrir no resuelve
- [ ] T505 reply manual → estado coherente
- [ ] T506 recordatorio futuro en Agenda y fuera de Por atender
- [ ] T507 inbound antes de vencimiento → Por atender
- [ ] T508 recordatorio vencido → Por atender
- [ ] T509 programar otro recordatorio
- [ ] T510 reactivar IA
- [ ] T511 Cliente / Perdido
- [ ] T512 aislamiento tenant con dos organizaciones
- [ ] T513 ningún recordatorio humano toca Graph automáticamente
- [ ] T514 follow-ups automáticos existentes sin regresión
- [ ] T515 Gate completo + E2E real (o PENDIENTE con causa exacta)
- [ ] T516 Cierre: `tasks.md`, `docs/CURRENT_STATE.md`, docs de dominio, un commit

---

## Casos E2E mínimos (CUT 5) — estado

| Caso | CUT | E2E | Unitario |
|---|---|---|---|
| handoff → Por atender | 2 | **verde** (023) | **verde** (`attention-hooks`, `attention-queue`) |
| abrir no equivale a resolver | 1/2 | **verde** (023: `markRead` no cambia la cola) | **verde** (`attention-state`, `attention-hooks`) |
| reply manual → estado coherente | 1/4 | **verde** (025: respuesta real desde el composer) | **verde** (`attention-hooks`, `operational-flow`) |
| recordatorio futuro → Agenda, fuera de Por atender | 3/4 | **verde** (025) | **verde** (`attention-queue`, `operational-flow`) |
| inbound antes de vencimiento → Por atender | 3/4 | **verde** (025) | **verde** (`attention-queue`, `attention-hooks`) |
| recordatorio vencido → Por atender | 3/2/4 | **verde** (023, 025) | **verde** (`attention-queue`, `operational-flow`) |
| programar otro recordatorio | 3/4 | **verde** (025: 1 → 2 compromisos) | **verde** (`operational-flow`) |
| reactivar IA | 1/4 | **verde** (025: sale de la cola y de la Agenda) | **verde** (`attention-hooks`, `operational-flow`) |
| Cliente / Perdido | 1 | pendiente (CUT 5) | **verde** (`attention-hooks`) |
| aislamiento tenant | 1/2 | **verde** (023: dos orgs, API y UI) | **verde** (`attention-state`, `attention-hooks`, `attention-queue`) |
| cero Graph en recordatorio humano | 1/4 | **verde** (025: el outbox solo crece con la respuesta escrita a mano) | **verde** (`attention-no-send`, `agenda-no-send`) |
| follow-ups automáticos sin regresión | 1/5 | **verde** (025: `sales_follow_up_job` intacta) | **verde** (sin tocar expectativas) |

## Evidencia

### PENDIENTE que este corte envía a un corte posterior

1. **FK compuesta ausente en `conversation_attention`** (heredado de CUT 1,
   descubierto al poder ejecutar la suite opt-in por fin contra PostgreSQL real).
   `drizzle/0010_conversation_attention.sql` declara **dos** FK de una columna:
   `conversation_id → conversation.id` y `organization_id → organization.id`.
   Con eso, una fila puede decir `organization_id = A` apuntando a una
   conversación de B. La suite opt-in de CUT 1 asumía la FK compuesta
   (`INSERT (orgA, cv_b)` → 23503) y por eso falla en 2 checks. **No se arregla
   aquí**: es un cambio de schema (FK compuesta + `UNIQUE (organization_id, id)`
   en `conversation`) que exige migración propia y no pertenece a la cola.
   Impacto en este corte: **ninguno** — la lista, el LEFT JOIN y `getAttention`
   filtran por `organization_id`, y la fila solo se alcanza a través de una
   conversación de su propia organización, así que no hay fuga. Debe cerrarse en
   CUT 5 o en un corte de migración.
2. Suite opt-in `attention-migration.test.ts`: se arregló su fixture (omitía
   `contact.name`, NOT NULL desde 010) para que **pudiera** correr. Siguen
   fallando 2 checks por el punto 1; 9 verdes.

### CUT 2 — 2026-10-04 · commit `feat(inbox): añadir cola por atender`

Base: `771f3b3` (árbol limpio al empezar; corte 1 cerrado).

**Qué entró**

- `src/lib/types.ts`: `AttentionDto` (los 4 campos de `plan.md` §4.1) y
  `ConversationDto.attention` **opcional** — los consumidores que no lo conocen
  siguen compilando y no cambian de comportamiento.
- `src/server/inbox/attention.ts`: `resumenAtencion()` proyecta `AttentionView` →
  `AttentionDto`. La derivación **no** se toca ni se duplica: sigue viviendo en
  `deriveAttention`, y el DTO llega con `needsAttentionNow` ya calculado.
- `src/server/inbox/queries.ts`: un `leftJoin` a `conversation_attention` en la
  MISMA función y con el MISMO patrón que `adAttribution` — `organization_id`
  DENTRO del `ON`, no solo en el `WHERE`. Un solo `SELECT`, cero N+1, y el
  `UNIQUE (org, conversation)` del corte 1 garantiza ≤1 fila por conversación.
  `now` se toma **una vez** para toda la lista: con un reloj por fila, dos
  conversaciones que vencen en el mismo segundo caerían en listas distintas y el
  chip podría no cuadrar con el listado. `serializeConversation` suma un
  parámetro **con valor por defecto** → la firma anterior sigue siendo válida.
- `src/app/api/conversations/[id]/route.ts`: el DTO que se publica en
  `conversation.updated` lleva la atención ya derivada (una lectura extra, solo
  en esa acción explícita del operador). Sin esto, el evento anunciaría "sin
  estado humano" justo después de un `aiEnabled: false`, que es lo que crea el
  `pending`.
- `src/components/inbox/bandeja-filtros.ts` (nuevo, puro): `resumirBandeja`
  calcula **una vez** `cola`, `sinLeer` y `deAnuncio` sobre la vista
  (búsqueda + etapa) y el chip usa `.length` de ese mismo array. Contar y
  listar no pueden discrepar **por construcción**, no por disciplina.
  `necesitaAtencionAhora()` solo lee el flag derivado: no reimplementa nada.
- `src/components/inbox/conversation-list.tsx`: chip "Por atender" **primero**,
  con icono y `aria-pressed`; `Todas` / `No leídas` / `Anuncios` / etapa conservan
  su definición. Se añade `data-testid="conversation-item"` a la fila para que el
  E2E pueda contar filas de verdad.
- `tests/fixtures/mem-db.ts`: soporte de proyección por tabla y de
  `innerJoin`/`leftJoin` con evaluación del `ON` (incluida la comparación ENTRE
  TABLAS que emite Drizzle: `"attention"."conversation_id" = "conversation"."id"`,
  sin parámetros). `sortRows` ya no revienta con un ORDER BY que no sabe imitar
  (`desc(coalesce(...))`): lo ignora y conserva el orden. Las proyecciones de
  COLUMNA suelta (`select({ id: conversation.id })`) se resuelven contra la fila
  de su tabla — sin eso, `clearAttentionForContact` de CUT 1 dejó de borrar.
- `tests/unit/attention-queue.test.ts` (nuevo, 28 tests) y
  `scripts/e2e-operator-queue.mjs` + sección `E2E_SECTION=023`.

**Comandos y resultados**

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | verde |
| `pnpm lint` | verde (0 errores; 3 warnings preexistentes de `build-state.ts` / `anuncio-origen.tsx`) |
| `pnpm build` | verde |
| `pnpm test` | verde: **108 ficheros, 1221 tests** en verde, 9 skipped |
| `pnpm vitest run tests/unit/attention-queue.test.ts` | **28 verdes** |
| `E2E_SECTION=023 node scripts/e2e-selftest.mjs` | **35/35 checks OK, 0 fallos** |

**E2E de comportamiento: EJECUTADO Y VERDE con UI real (Playwright).**
Este corte sí tiene superficie observable, así que no valía la vía del corte 1.
Se levantó PostgreSQL real en `:55432` (binarios de `embedded-postgres` en
`/tmp`, `initdb` + `pg_ctl` como usuario normal, sin root) y la app en `:3100`
con los mocks; fixture por SQL directo sobre la BD dedicada
`operator_workspace_test` (el estado "vencido" exige esperar; sembrarlo es lo
que hace el escenario determinista).

Camino feliz, en pantalla y no por API: el chip "Por atender" existe, es la
primera opción de la fila, marca **3**; al pulsarlo la lista tiene **3** filas
—handoff, inbound y vencido— y excluye futuro, esperando al cliente, solo IA y
anuncio. Los otros tres filtros conservan su semántica ("Todas" 7, "No leídas"
las 2 conversaciones con no leídas, "Anuncios" 1) y la etapa "Interesado"
deja la cola en 1 y la recupera al volver a "Toda etapa". Aislamiento: la sesión
de la organización B ve su propia cola (1), ninguna de A.

Camino infeliz: sin sesión, `/api/conversations` → **401**; PATCH sobre
conversación de otra organización → **404** (y `GET` a ese recurso → 405, no
expone datos); PATCH sobre conversación inexistente → **404**; `/inbox` sin
sesión redirige a `/login` y la API responde 401 desde el navegador.

**Decisiones que se apartan de una lectura literal (quedan trazadas aquí)**

1. **Filtro cliente, no endpoint.** `plan.md` §4.1 lo dice y es lo correcto: un
   `/api/conversations?attention=now` sería sobrearquitectura para una lista que
   ya viaja entera al cliente, y rompería la reactividad SSE (el refetch
   completo no traería el filtro). El chip y su lista salen del mismo array.
2. **`GET /api/conversations/[id]` no existe** (solo hay `PATCH`), así que el
   caso "conversación no encontrada" se comprueba por `PATCH`: es la ruta real
   que resuelve conversación→organización. Se documenta 405 explícitamente.
3. **Sembrar el E2E por SQL y no por la API.** Los tres estados que hay que ver
   en pantalla incluyen el "vencido", y `POST /api/reminders` es del corte 3 (no
   existe todavía). Con SQL el escenario es determinista y no depende del worker
   de recordatorios, que este corte no toca.

**Lo que este corte NO abre**

`docs/SALES_FOLLOW_UPS.md` **no se tocó**: `src/server/sales/follow-ups/**`,
`automationLane` y el handoff quedan intactos. No se añadió endpoint, tabla,
estado de atención, etapa del pipeline, plantilla de WhatsApp ni dependencia
externa. La Agenda (corte 3) y el flujo operativo (corte 4) siguen sin empezar.

### CUT 1 — 2026-10-04 · commit `feat(inbox): persistir atención y recordatorios humanos`

Base: `33fb80e` (árbol limpio al empezar). Choke points verificados en el código
real antes de tocar nada: los seis de `plan.md` §2/§3.5 existen y son los puntos
únicos (`applyHandoff`, `ingestInboundMessage`, `ingestManualEcho`,
`persistOutbound` con `origin:"operator"`, `updateConversation`, `moveLeadStage`).

**Qué entró**

- `drizzle/0010_conversation_attention.sql` + journal `idx: 12`
  (`tag: 0010_conversation_attention`). Escrita a mano: `pnpm db:generate` emitió
  un diff de snapshot completo que recreaba tablas existentes y hacía
  `DROP INDEX "test_run_org_running_uq"`. Revisado el SQL generado y descartado,
  igual que en el corte comercial (0009).
- `src/lib/db/schema.ts`: `conversation_attention` con `organization_id` NOT NULL +
  FK, UNIQUE `(organization_id, conversation_id)`, CHECK de estado y CHECK
  bidireccional `deferred` ⇔ `due_at`, tres índices org-first.
- `src/server/inbox/attention.ts`: la API de `plan.md` §3.4 + `deriveAttention`
  (derivación en un solo lugar, la reutiliza el corte 2), `AttentionError`,
  `clearAttentionForContact` y `bestEffortAttention`.
- Seis enganches best-effort, uno por punto de estrangulamiento.
- `tests/fixtures/mem-db.ts`: doble de BD en memoria con ORM/`schema`/`scoped()`
  REALES (interpreta el SQL que Drizzle genera). Los constraints de PostgreSQL NO
  los comprueba esto: para eso está la suite opt-in.

**Comandos y resultados**

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | verde |
| `pnpm lint` | verde (0 errores; 3 warnings preexistentes de `build-state.ts` / `anuncio-origen.tsx`) |
| `pnpm build` | verde |
| `pnpm test` | verde: **107 ficheros, 1193 tests** en verde, 9 skipped |
| `pnpm vitest run tests/unit/attention-state.test.ts` | 27 tests verdes (ciclo de 10 pasos + tenant A/B + derivación) |
| `pnpm vitest run tests/unit/attention-hooks.test.ts` | 25 tests verdes (los 6 enganches, `markRead` intacto, best-effort) |
| `pnpm vitest run tests/unit/attention-no-send.test.ts` | 6 tests verdes (estructural + dinámico, cero Graph) |
| `pnpm vitest run tests/unit/attention-migration.test.ts` | 6 verdes + **5 skipped** (opt-in sin PostgreSQL) |

**Regresión obligatoria, sin modificar ninguna expectativa** (`git diff --name-only
-- tests/` vacío):
`tests/unit/sales-follow-up-*.test.ts`, `sales-orchestrator`, `sales-writer`,
`handoff`, `media-send` → 9 ficheros / 100 tests verdes.
`playbook-*` + `lab-preview-*` → 18 ficheros / 210 tests verdes.

**E2E de comportamiento: NO EJECUTADO (PENDIENTE con causa).**
Intento real: app construida arrancada en `:3111` con los mocks →
`GET /api/health` devuelve **503 `db_unavailable`** con
`ECONNREFUSED 127.0.0.1:5432`. En esta máquina no hay `postgres`, `psql`,
`pg_ctl`, `initdb` ni `docker`, así que no hay forma de levantar la BD
dedicada que exigen el harness y `migrate`. Playwright y Chromium sí están
instalados: el único bloqueo es la base de datos. Este corte no añade UI, ni
endpoint, ni DTO, así que la superficie observable empieza en el corte 2
(`tests/e2e/` y `scripts/e2e-selftest.mjs`); aun así el E2E real de la
`conversation_attention` debe ejecutarse en el corte 5 o en cuanto haya
PostgreSQL. **No se declara READY.**

**Decisiones que se apartan de una lectura literal (quedan trazadas aquí)**

1. **FR-1.10 vs spec §3.4.** `pending`/`waiting_client` se validan contra
   "la IA no es la dueña" = `handoffAt != null || aiEnabled === false`, no
   solo contra `handoffAt != null`. Con la regla literal, `aiEnabled=false`
   sin handoff (alcanzable desde el interruptor del panel de conversación)
   no podría generar el `pending` que el propio §3.4 exige. La invariante que
   FR-1.10 protege —"si la IA es dueña, no hay estado humano"— se cumple
   íntegra: con la IA activa y sin handoff no se escribe nada.
2. **`moveLeadStage` solo limpia con cambio REAL de etapa.** El no-op a la misma
   etapa documenta que no hace lecturas extra; no se rompió ese contrato de
   rendimiento. El efecto práctico (un lead ya en `cliente` al que se le
   reactivara la IA y se apagara después) se resuelve al moverlo a cualquier
   etapa y de vuelta.
3. **Extras del módulo sobre el mínimo de §3.4**, todos condicionados por lo que
   el corte 2/3 necesita y sin superficie nueva: `deriveAttention` (evita
   duplicar la derivación), `clearAttentionForContact` (el lead es el segundo
   anclaje del contrato), `ATTENTION_NOTE_MAX_LENGTH` (recorte defensivo, el
   Zod del endpoint irá en el corte 3) y `AttentionError` con
   `conversation_not_found | ai_owns_conversation | due_in_past`.

**Lo que este corte NO abre**

`docs/SALES_FOLLOW_UPS.md` **no se tocó**: el contrato de follow-ups no cambia
(`src/server/sales/follow-ups/**` intacto, sin entradas nuevas en el worker, sin
`automationLane`/`followUpCount`/`human_lane`/`handoff_active`). El test
`attention-no-send.test.ts` ata esa frontera por código: si alguien importa el
módulo desde el motor, o el motor desde el módulo, la suite falla.

Bootstrap 2026-10-04: creados `spec.md`, `plan.md`, `tasks.md` y `quickstart.md` de
este spec, más el runner `scripts/ai/run-operator-workspace-mcode.sh` y los prompts
`.ai/tasks/operator-workspace/01..05`. **Cero código funcional de 013 en este
commit.** CUT 1 no iniciado.

Pendientes históricos que este spec **no** cierra: E2E 020/021/022 y los 4 tests
PostgreSQL opt-in (`tests/unit/commercial-resource-postgres.test.ts`). Constitución IX
sigue abierta hasta que CUT 5 tenga E2E real ejecutado.
