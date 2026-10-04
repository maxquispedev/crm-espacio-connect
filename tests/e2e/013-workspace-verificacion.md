# 013 C5 — Verificación del Operator Workspace (E2E 026)

Guion automatizado: `scripts/e2e-workspace-verification.mjs`, invocado por
`scripts/e2e-selftest.mjs` con `E2E_SECTION=026`.

Este corte **no añade superficie nueva**: su trabajo es verificar que todo el
workspace operativo se sostiene junto y cerrar los dos huecos que quedaban de
los cortes 1–4:

- el **handoff real** (el del corte 4 se sembraba por SQL): aquí el mensaje del
  cliente entra por el webhook, el agente lo ve, escala y la conversación
  aterriza en "Por atender" sin que nadie la siembre;
- **lead a Cliente / lead a Perdido**, el único caso de la tabla de `tasks.md`
  que seguía PENDIENTE.

Y comprueba, en la misma corrida, la mitad del objetivo: que los **dos
mecanismos no se confunden**. El recordatorio humano recuerda a Max y no manda
nada; el seguimiento automático escribe al cliente y jamás entra en la atención
humana.

## Ejecutar

```bash
# App de desarrollo contra una BD dedicada (nunca la de trabajo)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/operator_workspace_test_c5 \
E2E_OPERATOR_DATABASE_URL="$DATABASE_URL" \
WA_MOCK_ENABLED=true \
META_GRAPH_BASE_URL=http://127.0.0.1:3200/api/dev/wa-mock/graph \
OPENROUTER_BASE_URL=http://127.0.0.1:3200/api/dev/ai-mock \
pnpm dev --port 3200

# En otra terminal
E2E_SECTION=026 node --env-file=.env scripts/e2e-selftest.mjs
```

El script **aborta** si la app o la BD no son locales, si la BD no se llama
`operator_workspace_test[_…]`, si los mocks están apagados o si `NODE_ENV` es
`production`. Es el mismo guard que 023/024/025, y existe para que un descuido no
mande WhatsApp a contactos de verdad.

## La fixture

Las dos organizaciones se crean por la **puerta real de producto**
(`pnpm org:create` → `createOrganizationWithDefaults`), la única que siembra
pipeline y perfil del agente; el perfil se enciende después por
`PUT /api/agent/profile`. Sembrarlas a mano por SQL duplicaría el contrato de
las etapas y dejaría el fixture fuera de la realidad.

| Conversación (org A) | Estado inicial | Lead | Dónde se ve |
|---|---|---|---|
| `Atención Pendiente` | `pending` | — | Por atender (2) |
| `Atención Vencido` | `deferred` hace 30 min | sembrado | Por atender (2) + Vencidos + nav |
| `Atención Programada` | `deferred` en 48 h | sembrado | Comprometidos (1) + Agenda |
| `Atención Espera` | `waiting_client` | sembrado | solo la etiqueta |
| `Atención Motor` | IA activa, sin handoff | sembrado | sin etiqueta (para el caso 12) |
| `Atención Lab` | `deferred` 24 h, `is_test` | — | en ninguna parte |
| `Atención Real` | **no existe**: la crea el inbound | el de la ingesta | aparece en el caso 1 |
| `Atención Otra` (org B) | `deferred` 24 h | sembrado | solo en la Agenda de B |

Estado inicial leído por la UI: **Por atender 2 · Comprometidos 1 · Agenda 2 ·
nav vencidos 1 · Bandeja 5** (el Laboratorio no entra en ninguna superficie).

## Los doce casos

| # | Caso | Cómo se comprueba |
|---|---|---|
| 1 | Handoff → Por atender | Inbound real ("quiero hablar con un asesor"): el agente escala solo, `handoff_at` + `pending`, chip 2 → 3, motivo en castellano, **outbox sin cambios** |
| 2 | Abrir no resuelve | Se abre y se cierra la conversación: la cola sigue en 3 y la fila sigue `pending` |
| 3 | Reply manual coherente | Se responde desde el composer: 3 → 2, queda `waiting_client`, y es lo **único** que sale a WhatsApp |
| 4 | Recordatorio futuro | "Recordarme": sale de la cola (2 → 1), entra en Comprometidos (1 → 2), la Agenda lo lee "programado" con su nota |
| 5 | Inbound antes del vencimiento | La programada **no** está en la cola; al escribir el cliente entra **de inmediato** (1 → 2) y sale de Comprometidos |
| 6 | Recordatorio vencido | En BD sigue `deferred` con fecha pasada (nadie lo movió) y la UI lo pone en Por atender y en el grupo Vencidos; tras recargar, igual |
| 7 | Programar otro recordatorio | Una segunda conversación con su propio compromiso (Agenda 2 → 3) y reprogramar la primera **reemplaza** sin duplicar |
| 8 | Reactivar IA | El bloque desaparece, la fila de atención se borra, `handoff_at` se limpia, sale de Comprometidos y de la Agenda |
| 9 | Lead a Cliente / Perdido | `Perdido` saca la conversación de la cola y limpia su atención; `Cliente` limpia el estado y su recordatorio sale de la Agenda; ambos por `PATCH /api/pipeline/leads/{id}` y con el tablero verificable |
| 10 | Aislamiento tenant | B ve solo lo suyo (cola 0, Agenda 1, sin contador de vencidos) y no puede tocar conversaciones ni leads de A (404) |
| 11 | Cero Graph en recordatorio humano | El outbox crece **exactamente 1** (el reply manual) y ningún recordatorio creó `sales_follow_up_job` ni un mensaje de IA/plantilla |
| 12 | Follow-ups automáticos sin regresión | Se programa un seguimiento (crea el job y pone el lead en `wait`), se cancela, y se **rechaza** con 409 `handoff_active` y 409 `human_lane`; fecha pasada → 422 |

## Camino infeliz

- Sin sesión: `/api/reminders` → 401 y `/agenda` → login (también desde el
  navegador sin cookie).
- Conversación de **otra organización** → 404; lead de otra organización al
  moverlo → 404.
- Conversación de la IA → 409 con mensaje legible; del Laboratorio → 409.
- `{"state":"pending"}` → 422: el endpoint no deja fabricar un estado.
- `dueAt` en el pasado → 422 · nota de 400 caracteres → 422 · conversación
  inexistente → 404.
- Y, sobre todo: **ninguno de los rechazos dejó un estado a medias** (se
  comprueba la BD después de todos).

## Qué mira el "cero Graph"

El outbox del `wa-mock` registra **todo** POST a `/{phoneNumberId}/messages`, así
que es el testigo de "se mandó algo". Se combina con dos testigos de BD:

- `sales_follow_up_job` de la organización: un recordatorio humano **no** crea
  jobs automáticos (el único job de la corrida es el del caso 12, y se cancela).
- `message` con `origin IN ('ai','template')` en salientes: **cero**. Nada de lo
  que hizo una persona desde el CRM generó un envío autónomo.

## Nota sobre el caso 12

El seguimiento automático se programa con fecha **a una semana vista**, a
propósito: lo que se verifica es la ida y vuelta de la programación
(crear → `wait` → cancelar), no el envío. El envío del automático ya lo cubren
las secciones 020/021 de 011; si aquí se usara una fecha vencida, el worker
in-process lo reclamaría y el outbox crecería, y la aserción de "cero Graph" ya
no distinguiría "el recordatorio humano no mandó nada" de "el worker mandó algo".

## Hallazgos que dejó el E2E

Ninguno fue un defecto de producto: los cuatro fueron **expectativas del guion
que resultaron falsas** frente al comportamiento correcto y documentado. Se
corrigió el guion, no el código.

1. **Programar un recordatorio SACA la conversación de "Por atender"** (2 → 1).
   Es lo que dice el spec §3.2 paso 6 ("sale de Por atender"): la cola es "qué
   hago ahora", y un compromiso con fecha no es eso.
2. **Con un recordatorio vigente el panel ofrece "Cancelar", no una fecha
   nueva** (`reminder-schedule.tsx` solo pinta "Elegir fecha" cuando no hay
   compromiso). Es coherente con el spec §3.2 paso 9 — "puede programar otro"
   después de atender, no editar la fecha en silencio—, así que el caso 7
   verifica el camino real: cancelar y volver a comprometer, sin duplicar fila.
3. **Perder el lead limpia la TAREA, no la pertenencia.** La fila de atención se
   borra y la conversación sale de la cola y de la Agenda, pero `handoff_at`
   sigue puesto, así que la lista dice **"Atención humana"** —que
   `operational-state.ts` define como "sin nada pendiente"— en vez de "Por
   atender". El handoff no se revierte a propósito: reactivar la IA sobre un
   negocio cerrado sería peor que el ruido.
4. **Cancelar un seguimiento automático no borra la fila**: la deja en
   `cancelled` (auditable) y limpia `next_follow_up_at`. Lo que no puede quedar
   es un `pending` que el worker fuera a reclamar, y eso es lo que se comprueba.

## Detalle de la fixture que conviene saber

- Las organizaciones se crean con `pnpm org:create`, que deja
  `.tmp-org-create.mjs` en la raíz. La sección **lo borra al terminar**; además
  está en `.gitignore` y en los `ignores` de ESLint (antes no lo estaba, y
  `pnpm org:create` dejaba `pnpm lint` en rojo).
- `pnpm build` **pisa el `.next`** del `next dev` que esté corriendo y lo deja
  sirviendo `/inbox` en 500. Si se lanzan el gate y el E2E en la misma sesión,
  hay que **reiniciar la app de pruebas después del build**.
- Los buckets de la Agenda son por calendario (`overdue`/`today`/`tomorrow`/
  `week`/`later`), y cada item pinta `agenda-item-<bucket>` **y**
  `agenda-item-when`: un `^= 'agenda-item-'` cuenta cada item dos veces.

## Pendientes que este corte NO cierra

- Las secciones históricas **020/021/022** siguen PENDIENTES (no las ejecutó
  este corte).
- La opt-in de PostgreSQL de 013 (`tests/unit/attention-migration.test.ts`) sí
  quedó **11/11 verde** contra una BD real. La de **011**
  (`commercial-resource-postgres.test.ts`) sigue **3 de 4**: su última
  aserción recibe un `TypeError` de postgres.js al serializar un parámetro
  `sql.json()` dentro de vitest. Está fuera de este spec.
