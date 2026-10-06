# Plan — 018 horario comercial de follow-ups

## Decisiones técnicas

**D-1 · Una política pura y centralizada.** Nueva
`src/server/sales/follow-ups/business-hours.ts`: módulo puro (sin BD, sin red,
sin `Date.now()` dentro) con la ventana, la zona y las dos operaciones que la
consumen (`isWithinBusinessHours`, `nextAllowedInstant`) más el predicado
`isAutomaticFollowUpReason`. Ningún número mágico de hora fuera de ese archivo;
`policy.ts` expone la fachada `applyBusinessHours(reason, dueAt)` para que quien
programa no tenga que saber la regla.

**D-2 · Zona explícita `America/Lima`, sin fallback al servidor.**
`FOLLOW_UP_TIME_ZONE = "America/Lima"`. Se **NO** reutiliza
`resolveOperatorTimeZone`: su contrato es "lo que el operador/agenda ve"
(request → `OPERATOR_TIMEZONE` → zona del proceso → `UTC`) y para decidir si se
puede escribir comercialmente, caer a la zona del proceso o a `UTC` degradaría en
silencio la política en un servidor fuera de Lima. Se reutiliza, en cambio, su
matemática pura ya probada: `zonedParts` (instante → fecha/hora local) y
`fromLocalWall` (muro local → instante), que resuelve el offset de la zona con
dos rondas y es la única implementación `Intl` del repo. `fromLocalWall` pasa a
ser export para reutilización; no se duplica aritmética de offset en dos sitios.
Cero dependencias nuevas: `Intl` alcanza.

**D-3 · El timestamp durable sigue siendo UTC.** Solo la decisión de "hora
comercial" es policy. `due_at`/`next_follow_up_at` se siguen guardando como
`timestamp` UTC en la base, igual que el resto del motor.

**D-4 · Milisegundos conservados al normalizar.** `nextAllowedInstant`
conserva los ms del instante de entrada, así el normalizado es idempotente y
`dueMatchesLead` (tolerancia de 1s) no se descuadra entre job y lead.

**D-5 · Dos niveles, como pide el spec.**
- Nivel 1: `scheduleNextFollowUp` y `enqueueFollowUpAttempt` normalizan.
- Nivel 2: el worker, en `revalidate` (después de todas las otras
  verificaciones de vigencia), devuelve un gate nuevo `defer`.

**D-6 · `defer` es un tercer desenlace del gate, no un `blocked`.** El gate pasa
a ser `{kind:"cancelled"|"blocked"|"defer"}`. `defer` **no** consume
`attempt_number` ni `run_attempts`, no marca terminal y devuelve el job a
`pending` con el nuevo `due_at`, escribiendo solo bajo `stillOwnedWhere`
(mismo org + `processing` + mismo lease): si meanwhile el job fue cancelado por
inbound o respuesta manual, el update no toca fila alguna y tampoco el lead.
El orden importa: el horario se evalúa **último** para que un job que además es
inválido por otra causa (handoff, lane STOP, mensaje posterior al ancla) siga
terminando en `cancelled` como hoy, sin reschedule inútil.

**D-7 · `scheduled_wait` preservado** en ambos niveles (ver spec). Consecuencia
explícita y reversible: un operador que programe a las 03:00 seguirá recibiendo
el envío a las 03:00. Cubrirlo también es cambiar un contrato de persona a una
decisión de máquina; queda anotado como decisión a confirmar, y es una línea
(`isAutomaticFollowUpReason`) si el dueño decide lo contrario.

**D-8 · `now` inyectable en el worker, no reloj global mutable.** El patrón ya
existe en el repo (`agenda-buckets`: "`now` entra como parámetro, nunca
`Date.now()` dentro"). `runDueFollowUps({ now })` propaga el instante hasta la
última revalidación pre-envío y a los `preSendGuard`. El timer real pasa
`new Date()`; el endpoint de pruebas puede fijar un instante nocturno para que el
self-test sea determinista a cualquier hora del día. Consecuencia necesaria: los
unitarios del worker que Before usaban el reloj real pasan a fijar su `now`
(si no, un test que exige envío fallaría de madrugada y al mediodía).

**D-9 · Retry técnico también normalizado.** `requeueTechnicalRetry` programa
`now + 15min`; si cae de madrugada, el nivel 2 lo empujaría a 09:00 igual, pero
despertando el worker varias veces de noche sin efecto. Se normaliza con la
misma función, sin tocar `run_attempts` (siguen siendo retries técnicos).

**D-10 · Observabilidad.** El job reprogramado guarda
`error = "outside_business_hours"` y se publica `conversation.updated` para que
la UI muestre el nuevo `nextFollowUpAt` sin recargar.

## Constitution Check

| Principio | Cumple |
|---|---|
| I Seguridad | Sin secretos, sin telemetría nueva; solo un código de error legible |
| II Soberanía | Sin servicio externo ni dependencia nueva; solo `Intl` |
| III Multi-tenancy | Toda escritura pasa por `stillOwnedWhere`/`scoped()` |
| IV Idempotencia | Normalizar es idempotente; `defer` no muta intentos ni estados terminales |
| Sandbox | No se toca el guardrail `is_test`; sandbox sigue sin Graph |

## Archivos

- nuevo `src/server/sales/follow-ups/business-hours.ts`
- `src/server/sales/follow-ups/policy.ts` (fachada + predicado)
- `src/server/sales/follow-ups/store.ts` (nivel 1)
- `src/server/sales/follow-ups/worker.ts` (nivel 2, `now` inyectable)
- `src/app/api/dev/follow-ups/run/route.ts` (`now` para el arnés)
- `src/server/inbox/agenda-buckets.ts` (export de `fromLocalWall`)
- tests unitarios + `scripts/e2e-follow-ups.mjs` + `scripts/e2e-selftest.mjs` +
  `tests/e2e/us-sales-follow-ups.md`