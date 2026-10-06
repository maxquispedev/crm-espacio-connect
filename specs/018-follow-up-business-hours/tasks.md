# Tasks — 018 horario comercial de follow-ups

Estado durable. Reanudar desde aquí.

## FASE 1 — Spec y plan

- [x] T001 Leer estado (`AGENTS.md`, `docs/CURRENT_STATE.md`, Constitution).
- [x] T002 Revisar contrato vigente (`docs/SALES_FOLLOW_UPS.md`) y decidir el
      caso `scheduled_wait` (D-7: preservado, es fecha manual de persona).
- [x] T003 `spec.md` con la regla exacta `[09:00, 20:00)` en `America/Lima`.
- [x] T004 `plan.md` con decisiones, Constitution Check y archivos tocados.

## FASE 2 — Policy

- [x] T005 `business-hours.ts`: zona, ventana, `isWithinBusinessHours`,
      `nextAllowedInstant`, `isAutomaticFollowUpReason`.
- [x] T006 Exportar `fromLocalWall` en `agenda-buckets.ts` (reutilizar, no
      duplicar aritmética de offset).
- [x] T007 Fachada `applyBusinessHours(reason, dueAt)` en `policy.ts`.

## FASE 3 — Nivel 1 (programar)

- [x] T008 `scheduleNextFollowUp`: normalizar `anchor + delay`.
- [x] T009 `enqueueFollowUpAttempt` (encadenado): normalizar.
- [x] T010 `scheduleManualFollowUp` (`scheduled_wait`) sin tocar.

## FASE 4 — Nivel 2 (worker)

- [x] T011 `now` inyectable propagado hasta la última revalidación y los
      `preSendGuard`.
- [x] T012 Gate `defer` como tercer desenlace, evaluado al final de `revalidate`.
- [x] T013 `deferUntilAllowed`: `pending` + nuevo `due_at`, sin
      `attempt_number` ni `run_attempts`, con `stillOwnedWhere` y lead sincronizado.
- [x] T014 Propagar `defer` sin perderlo en el camino `aborted` del `DeliverResult`.
- [x] T015 Normalizar el `due_at` del retry técnico.

## FASE 5 — Arnés

- [x] T016 `POST /api/dev/follow-ups/run` acepta `now` (solo mocks, tras `mockGuard`).

## FASE 6 — Tests

- [x] T017 Unitarios de policy: 08:59→09:00, 09:00, 15:00, 19:59, 20:00/20:01,
      cruce de día, UTC que es madrugada en Lima, idempotencia, `scheduled_wait`
      intacto, encadenado normalizado.
- [x] T018 Unitarios de store: `scheduleNextFollowUp` y encadenado normalizados;
      `scheduled_wait` conserva la fecha del operador.
- [x] T019 Unitarios de worker: vencido a las 02:00 → cero writer/Graph,
      reprogramado; mismo job a las 10:00 → flujo normal; reprogramar no consume
      `attempt_number` ni `run_attempts`; retry nocturno; tenant; sandbox.
- [x] T020 Unitarios del worker existentes con `now` fijo (dejar de depender del
      reloj real).
- [x] T021 E2E: caso nocturno + ticks deterministas en `scripts/e2e-follow-ups.mjs`
      y en el bloque de follow-ups de `scripts/e2e-selftest.mjs`; guion `.md`.

## FASE 7 — Cierre

- [x] T022 `pnpm typecheck` · `pnpm lint` · `pnpm build` · `pnpm test`.
- [x] T023 E2E de follow-ups ejecutado contra app real + Postgres + mocks.
- [x] T024 `docs/SALES_FOLLOW_UPS.md`, `docs/CURRENT_STATE.md`, este archivo.
- [ ] T025 Commit atómico. Sin push. Sin deploy.

## Evidencia durable de cierre — 2026-10-06

**Gates.** `pnpm typecheck` exit 0 · `pnpm lint` exit 0 (0 errores, 3 warnings
preexistentes) · `pnpm build` exit 0 · `pnpm test` **1472 pass / 9 skipped**
(121 archivos: 120 pass + 1 skipped). Antes de este spec eran 1446 pass: +26
tests (14 de policy, 4 de store, 8 de worker).

**E2E de follow-ups: 48/48, exit 0** (`FOLLOW_UP_E2E=1 node --env-file=… 
scripts/e2e-follow-ups.mjs`). App Next real en modo desarrollo con
`WA_MOCK_ENABLED=true`, PostgreSQL 18.4 en base exclusiva
`commercial_resources_test_bizhours`, Graph/Jev/writer deterministas locales,
cero Meta real y cero WhatsApp real. La sección nueva "horario comercial
09:00-20:00 America/Lima (spec 018)" comprueba en vivo:

```
OK F tick de madrugada aceptado por el arnés
OK F 02:00 Lima: cero Graph (el outbox del mock no crece)
OK F el job vuelve a pending, ni failed ni blocked
OK F reprogramado al próximo inicio permitido (09:00 Lima)
OK F lead.next_follow_up_at queda sincronizado con el job
OK F quedarse fuera de horario no consume intento comercial ni run attempt
OK F tick de día aceptado por el arnés
OK F el mismo job se envía dentro del horario y conserva su intento
```

Regresiones A–E en verde en la misma corrida (secuencia de 3 intentos hasta
Dormido, `blocked template_required` con ventana cerrada), más tenant A/B,
sandbox sin Graph y cancelación cross-tenant sin tocar el lead ajeno.

**El arnés quedó determinista.** `POST /api/dev/follow-ups/run` acepta `now`
(después de `mockGuard`), y los ticks de A–E y de los guardrails pasan
`DAY_NOW` (14:00 Lima). Antes, un E2E ejecutado de madrugada habría diferido
todos los envíos por la regla nueva; ahora la suite da el mismo resultado a
cualquier hora.

**Dos defectos reales encontrados y corregidos durante el trabajo:**

1. `Date.UTC(year, month, day, h, m, s, ms)` **no** acepta un epoch en el
   último argumento: el milisegundo se suma al muro y producía 2083 en vez de
   2026. Ahora el resto de milisegundo se aplica aparte y el normalizado es
   idempotente (test con `.123`).
2. `next start` corre con `NODE_ENV=production` y `isMockEnabled()` exige
   producción **fuera**, así que los mocks respondían 404 y el E2E no tenía
   contra qué enviar. El self-test seconductor con `next dev`.

**`pnpm test:e2e` completo: NO verde, y NO por este spec.** El `main()` de
`scripts/e2e-selftest.mjs` no completa en este entorno:

1. En una base recién migrada, el operador `e2e@vocero.test` se crea **sin
   organización** (el registro de Better Auth no la crea) y la primera llamada
   autenticada responde 401 "No autenticado"; ni siquiera
   `organization/set-active` lo arregla porque no hay organización a la que
   activar. El script dedicado de follow-ups sí la crea si falta, por eso su
   corrida es válida.
2. Con la organización sembrada a mano, el self-test avanza y vuelve a caer:
   el bloque de follow-ups falla porque esa organización quedó sin
   `agent_profile`, y el script completo **muere** en `runSection011`
   (`scripts/e2e-selftest.mjs:2098`, sección de UI) sin try/catch, antes de
   terminar.

**Comparación con línea base, para que la afirmación sea verificable:** se
ejecutó el mismo `scripts/e2e-selftest.mjs` contra el mismo Postgres, la misma
app y la misma base, con el árbol **sin los cambios de 018** (`git stash`). El
bloque de follow-ups falla **igual o peor**: 7 checks FAIL de base frente a 6
con 018, y el primer fallo es el mismo. Es decir: la sección general del
self-test no estaba verde antes de este spec y sigue sin estarlo por motivos
propios del arnés, en áreas que 018 no toca (identidad BSUID, `/api/bot/*`,
echoes de coexistence, UI de la 011).

Lo que sí se verificó en vivo y es concluyente para esta feature es el E2E
dedicado de follow-ups: **48/48**, incluidas las ocho comprobaciones nocturnas
nuevas y las regresiones A–E, tenant y sandbox.

**Decisiones de negocio pendientes de Obsidian:** la ventana 09:00–20:00 Lima
y la excepción `scheduled_wait` (un operador que programe a las 03:00 sigue
recibiéndolo a las 03:00).

**Sin push, sin deploy, sin migración, sin dependencias nuevas.**