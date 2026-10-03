# CURRENT STATE — Espacio Connect

**Actualizado: 2026-10-03 — Corte 1 del spec 009 (Editor técnico JSON del Playbook).**
La pestaña de playbook en Agente pasó de ocho formularios por bloques a **dos
editores JSON técnicos** (`textarea` monoespaciado, sin dependencias nuevas):
**1. Configuración comercial JSON** (`product`, `offer`, `commercial_policy`,
`priorities`, `writer`, `prohibitions`, `handoff`, `urgency_rules`) y **2.
Preguntas Jev JSON** (`jev_questions`). La pestaña se renombró a **Comercial /
Jev**; `Comportamiento` y `Conocimiento` intactas.

Se conserva el ciclo completo (crear draft, validar, guardar, publicar con nota,
historial, rollback, eliminar draft), se muestran versión publicada/draft,
`schema_version` y `version_number`, fechas y notas, y hay un CTA **Abrir el
Laboratorio** hacia `/lab` (el Laboratorio existente; no se duplicó su runner).

**Regla histórica "NO JSON crudo": SUPERSEDED** para esta pestaña. La UI por
formularios nunca se usó para su propósito real; el usuario objetivo edita
configuración técnica. Queda registrado en
`specs/009-playbook-runtime-admin/tasks.md` para que no se lea después como
regresión. Sigue vigente en el resto del producto.

El split Config / Preguntas Jev es una **proyección de cliente**: al guardar se
reassembla `{ ...configEdit, jev_questions: jevEdit }` y se hace
`PUT /api/playbook/draft` con el `ConfigV1` completo, **igual que antes**. Cero
migraciones, cero endpoints nuevos, cero cambios en `ConfigV1Schema`,
`constants.ts`, el loader, la base de datos o el Laboratorio. El cliente **no**
implementa Zod: `POST /api/playbook/validate` sigue siendo la autoridad y los
`details[]` se pintan junto al editor con su `path` literal. Los errores de
sintaxis muestran línea y columna calculadas desde el `position` de `JSON.parse`
(sin inventarlas si el motor no da posición). `fields.tsx` quedó reducido a
`Modal` (lo usan publicar y rollback); los ocho primitivos de formulario se
borraron tras verificar con grep que quedaban **sin ninguna referencia**
(incluido `BlockSection`, que el plan daba por sobreviviente: no lo sobrevivió).

**NO se tocó producción:** `SALES_PLAYBOOK_RUNTIME_ENABLED` sigue en `false`
(eso es el corte 3). Cero cambios en `package.json`. Sender, webhook, CAPI,
follow-ups y option keys contractuales de Jev, sin tocar.

Gates: `pnpm typecheck` verde, `pnpm lint` verde (0 errores, 3 warnings
preexistentes), `pnpm build` verde, **830/830 tests en 89 archivos** verdes
(incluye 11 nuevos en `tests/unit/playbook-json-editor.test.ts`).
E2E: la sección 016 del arnés (`scripts/e2e-selftest.mjs`) cubre el ciclo
completo y los tres caminos infelices (JSON inválido → 400 `bad_json`, Zod
inválido → 422 con `path`, guardarraíl violado → 422), y parsea con
`node --check`; **no se ejecutó en vivo en esta sesión** porque el entorno no
tiene Docker, `psql` ni PostgreSQL ni la app levantada. Queda como verificación
pendiente.
Commit único: `feat(playbook): simplificar editor técnico JSON`.

## Checkpoint de handoff — campaña Vende Veloz lista para operar (2026-10-01)

Corte para retomar en una nueva sesión sin reconstruir contexto:

- Runtime comercial real de Vende Veloz queda deliberadamente en defaults hardcodeados de lanzamiento (`SALES_PLAYBOOK_RUNTIME_ENABLED=false`); Feature 008 queda preservada para V2.
- `JEV_SALES_QUESTIONS_V2`, producto/policy/offer y writer defaults son la fuente operativa de V1; Meta Ads context, resolver, lanes, handoff y CRM effects siguen activos.
- Follow-ups automáticos están estabilizados y verificados: scheduling, worker, cancelación por inbound/manual, 3 intentos, Dormido/STOP, ventana 24 h, retries, lease, concurrencia y tenant isolation.
- Últimos commits de cierre: `dbb0731` (freeze configurable runtime) y `ec70a79` (follow-ups worker).
- Gates del cierre: 818/818 tests; E2E follow-ups 40/40 en entorno real local con PostgreSQL 18.4 + mocks; sin pendiente técnico conocido dentro del objetivo de lanzamiento.
- Configuración operativa requerida en producción: Agente ON + Sales Orchestrator ON + Follow-ups ON; para continuidad fuera de 24 h seleccionar plantilla WhatsApp approved y 0 variables BODY.
- No reabrir Playbook/Lab antes de lanzar salvo bug que afecte conversaciones reales. El siguiente trabajo principal es comercial/marketing: campaña Meta Ads → WhatsApp → Espacio Connect.

**2026-10-01 — Hotfix bloqueante de follow-ups cerrado.**
Reproducido POST `/api/dev/follow-ups/run` → 500 `ERR_INVALID_ARG_TYPE`
con postgres-js/PostgreSQL 18.4 antes de editar: raw SQL recibía `Date` JS.
`claimDueJobs` usa reloj PostgreSQL UTC y precisión de milisegundos, lease
numérico parametrizado de 10 min y fechas RETURNING explícitamente UTC.
Conserva claim atómico, batch 10, SKIP LOCKED y recovery. La sonda dev
adelanta job y schedule del lead juntos (transacción + scope + comparación
con due anterior), evitando un `due_mismatch` artificial del arnés.

Gates: typecheck, lint (0 errores, 3 warnings preexistentes), build y
**818/818 tests en 89 archivos** verdes. E2E completo **40/40 checks verdes**
en localhost:3021 + PostgreSQL efímero 18.4 :55439, zona Lima, mocks HTTP
Jev/writer/Graph: A–E, concurrencia sin duplicados, retry sin consumir intento,
lease abandonado/vigente, HUMAN/STOP/handoff/OFF, dos tenants y sandbox sin
Graph. Arnés durable: `scripts/e2e-follow-ups.mjs`; detalle de reproducción
local en `docs/SALES_FOLLOW_UPS.md`. Sin cambios a estrategia, pricing,
Playbook, Jev questions, Lab, Meta Ads, resolver ni writer principal.
Commit único: `fix(follow-ups): estabilizar worker para lanzamiento`.
Sin pendientes de este E2E; despliegue productivo fuera de esta sesión.

**2026-10-01 — Hotfix de lanzamiento Vende Veloz.**
Feature 008 preservada pero runtime configurable pospuesto a V2.
Campaña inicial de Vende Veloz opera con estrategia hardcodeada conocida
para reducir riesgo y salir a producción.

`SALES_PLAYBOOK_RUNTIME_ENABLED=false`: conversaciones reales no cargan
publicada; producto/policy/questions/offer y writer usan defaults conocidos.
Auditoría `playbook_version_id`/schema/number y FK quedan null. Agent Profile,
resolver, lanes, handoff, Meta attribution y CRM effects se conservan.
Tablas, migraciones, datos, versiones, API/UI y Laboratorio preservados.
V2 puede reactivar la constante en `src/server/sales/build-state.ts`.

Verificación: typecheck, lint (0 errores, 3 warnings preexistentes), build y
**817/817 tests en 89 archivos** verdes. Regresión con builder/orquestador/
resolver reales cubre publicada V1 y cambio posterior, defaults completos,
Meta Ads, perfil, lane, entrega, facts, scheduling y scope en dos tenants.
Mutation check: reactivar la constante hace fallar la regresión.
E2E comercial **22/22 checks verdes** contra copia local en localhost:3019,
PostgreSQL efímero :55439 y mocks HTTP Jev/writer/Graph. Se capturaron payloads
antes/después de publicar producto/policy/offer/questions/writer modificados;
se observó outbound, auto_close, precio durable y auditoría null. Jev inválido
registró error sin nuevo outbound (camino infeliz).

**Antecedente (resuelto por el hotfix de follow-ups arriba):** subset del arnés existente ejecutado,
**16/26 checks**, con respuesta inicial y scheduling verdes. El tick devuelve
500 por `ERR_INVALID_ARG_TYPE` al serializar `Date` en `claimDueJobs`
(`src/server/sales/follow-ups/worker.ts:105`) en PostgreSQL local 18.4.
Ese worker no cambia en este hotfix; envío, agotamiento por silencio y bloqueo
por ventana cerrada NO quedan verificados. No se declara READY punta a punta.
El error del worker y el self-test se cerraron en el hotfix separado arriba;
deploy del hotfix por flujo habitual
no ejecutado aquí. Decisión comercial de congelar 008 debe sincronizarse en Obsidian.
Commit único: `fix(sales): congelar playbook configurable para lanzamiento`.

**Actualizado: 2026-10-01 — Hotfix productivo del Laboratorio comercial (Feature 008).**
Una corrida REAL en modo Borrador terminó con score/judge pero con los tres
`actual_*` vacíos. Causas confirmadas: runner sin lead (el orquestador retornaba
por `leadId=null`) y writer sandbox sin `deliverReply` (sin outbound ni facts
de entrega). Ahora cada caso crea contacto archivado único por run/case y lead
nuevo vía gateway, en la primera etapa open del tenant por position; sin etapa
open falla explícitamente. Los defaults del INSERT mantienen todos los facts
limpios, sin reutilización entre Published/Draft o corridas. `deliverReply`
persiste outbound local en `is_test=true`, sin WhatsApp real; siguen suprimidos
follow-ups y protegido CAPI. Se copian transcript/outcomes antes del judge y
se limpia el contacto en finally por cascada (lead/conversation/messages);
`agent_test_case` conserva resultado y versión, con conversation_id SET NULL.
Board excluye `contact.archived_at IS NOT NULL`, también para contactos reales.
Expected manual nullable sigue mostrando actual a la derecha. Sin cambios a
Playbook V1, sin publicación de Draft V2, pricing ni estrategia.

**Evidencia del hotfix:** typecheck, lint (0 errores, 3 warnings preexistentes),
build y **815/815 tests en 88 archivos** verdes. Runner ahora usa builder,
orquestador, resolver y delivery reales con Jev/writer mock; pruebas cubren
lead inicial limpio, historial/facts entre turnos, outcomes, aislamiento both,
board, legacy, fallo de judge y falta de etapa. Al reintroducir cada bug, su
regresión falla. `node --check scripts/e2e-selftest.mjs` verde.

**E2E real del Laboratorio EJECUTADO:** sección 015 aislada del arnés en copia
temporal de app (`/tmp/lab-hotfix-app`, localhost:3018), PostgreSQL local y
Graph/LLM/Jev apuntando a mocks locales: **33/33 checks verdes** (Published,
Draft, both, transcript cliente+agente, judge, actuals, versiones, expected,
board, 422 modo/versión inválidos, 404 caso inexistente, outbox vacío). El
fixture local requirió aplicar migraciones existentes pendientes y sembrar
perfil/etapas de su org de prueba, además de configurar modelo mock. Consulta
PostgreSQL posterior: **24 casos durables**, **0 actuals faltantes**, **0 FK de
conversación temporal**, **0 contactos sandbox/leads/conversaciones/mensajes**,
**0 follow-up jobs**, **0 eventos CAPI** en esa org E2E. El E2E completo de
otros módulos no se reejecutó; sus pendientes históricos no se cierran aquí.
Commit único previsto: `fix(lab): ejecutar pipeline comercial real en sandbox`.
Siguiente paso: desplegar este commit por el flujo habitual; repetir Borrador
para comprobar el reporte productivo (sin publicar V2).


**Actualizado:** 2026-10-01 (Corte 7 del spec 008 — **CIERRE de la feature 008, Sales Playbook durable**. La estrategia comercial que estaba congelada en TypeScript (`VENDE_VELOZ_*` / `JEV_SALES_QUESTIONS_V2`) pasó a ser configuración durable, versionada, tenant-safe y editable sin redeploy: el motor sigue igual y solo consulta la versión publicada. Los siete cortes quedaron cerrados. Este corte agrega "Guardar conversación como caso" (`POST /api/lab/cases/from-conversation`) con **PII minimizada**: la nueva tabla `lab_case` **no tiene columna de identidad** (garantía estructural, no disciplina de código) y encima el texto se sanea server-side (`[telefono]`, `[email]`, `[enlace]`, `[id]`), porque un cliente suele dictar su propio número dentro de un mensaje. El `conversation_id` se usa solo como input autenticado y nunca se persiste. El bootstrap en boot ahora loguea explícitamente por org ("Playbook V1 sembrada" / "ya existente" / "Org X no tiene Sales Orchestrator; sin playbook"). Decisión documentada: los defaults congelados **no se borran**, quedan como `DEFAULTS_ONLY` — red de arranque del runtime y baseline de regresión de los tests. Gates: typecheck/lint/build verdes, **810/810 tests en 88 archivos** (23 nuevos), `bash -n` del runner AI verde. **E2E en vivo PENDIENTE**: este entorno no tiene Docker, `psql` ni PostgreSQL y la app no está levantada; la sección 013 extendida parsea (`node --check`) pero no se ejecutó. Guía del dueño en `docs/playbook.md`.)

**Actualizado:** 2026-10-01 (Corte 6 del spec 008 — **Laboratorio comercial**: el Laboratorio dejó de evaluar solo el agente genérico y ahora corre el **pipeline comercial real** (Sales Orchestrator + Jev + resolver + writer) sobre conversaciones sandbox, con override de Playbook por caso y comparación **Published vs Draft**. Gaps cerrados: `agent_test_case` persiste `playbook_version_id`/`playbook_schema_version` (migración aditiva `0008b`), outcomes esperados declarados a mano por el dueño con ✅/❌ en el reporte, y 6 personas V1 comerciales de academias deportivas. Las 6 ferreteras **no se eliminan**: quedan como `legacy_*` con alias para el histórico. Cero efectos residuales verificado por test: sin WhatsApp real (spy sobre `graphRequest`), sin filas en `sales_follow_up_job` y sin CAPI en corridas `is_test=true`. Cambió el índice de concurrencia de corridas: el lock pasó de UNIQUE(organización) a UNIQUE(organización, `playbook_mode`) para que `both` corra published y draft en paralelo. Gates: typecheck/lint/build verdes, 787/787 tests en 87 archivos (29 nuevos). **E2E en vivo y self-test con `pnpm dev` + mocks PENDIENTES**: este entorno no tiene Docker, `psql` ni PostgreSQL, y la app no está levantada; la sección 015 del arnés E2E está escrita y parsea, pero no se ejecutó. NO se tocó el runtime productivo: el override solo aplica con `is_test=true` y sigue validado por el guard T306 del orquestador.)

**Actualizado:** 2026-09-30 (Hotfix Sales Orchestrator — contexto de Meta Ads en estado Jev. El builder `buildJevSalesState` ahora consulta `ad_attribution` tenant-safe y, cuando la fila existe con al menos un campo comercial (`source_type`/`headline`/`body`), emite `source: "Meta Ads"` + `ad_context: { source_type, headline, body }` en el state que Jev evalúa. Contrato jevveloz 89/89 restaurado para conversaciones atribuidas; conversaciones orgánicas sin cambios observables. Commit único `fix(sales): conservar contexto de Meta Ads en estado Jev`. Gates re-verificados: typecheck/lint/build verdes, 660/660 tests, 74 archivos (650 anteriores + 10 nuevos del hotfix). NO se tocó: questions-v2, commercial-policy, resolver, writer, Jev, follow-ups ni CAPI. Defensa Constitución I verificada: el state no contiene `ctwa_clid`, `sourceId`, `sourceUrl`, `imageAssetId`, access tokens ni PII del contacto.)

**Actualizado:** 2026-09-29 (Corte 9 — auditoría final de readiness para Vende Veloz. Gates técnicos re-verificados: typecheck/lint/build verdes, 646/646 tests, 74 archivos. `docs/VENDEVELOZ_LAUNCH_CHECKLIST.md` publicado con bloques A/B/C/D. Pendiente único externo: clic CTWA real contra Meta + self-test E2E local con app+Postgres. Ningún flag de producción fue tocado en este corte.)

**Hotfix 2026-09-29 (post-Corte 9):** `drizzle/meta/_journal.json` ahora
registra las migraciones `0006_anuncio_de_origen` y `0007_meta_capi` (que
existían en disco pero no estaban en el journal, por lo que el
`scripts/migrate.mjs` de arranque nunca las aplicaba y `/api/conversations`
rompía en producción por el LEFT JOIN contra `ad_attribution`). Commit
único `fix(db): registrar migraciones 0006 y 0007 en Drizzle journal`. Gates
re-verificados: typecheck/lint/build verdes, 650/650 tests, 74 archivos;
`drizzle-orm/migrator` descubre 8 migraciones (antes 6). Sin verificación
en vivo punta a punta con Postgres (no había BD local disponible en este
turno); producción debería migrar al próximo reinicio del contenedor sin
más acciones manuales.
**Branch:** `main`
**Baseline funcional previo a esta sincronización documental:** `bbae7cd1dfd98d5006cfd26440a8acf1def2c1bb`
**Propósito:** checkpoint técnico rápido. Las decisiones de negocio viven en el cerebro de Obsidian; la implementación y la historia SDD viven aquí.

---

## 1. Cómo recuperar contexto

Leer, en este orden:

1. `AGENTS.md`
2. `.specify/memory/constitution.md`
3. este archivo
4. spec activo en `specs/`
5. docs de dominio
6. código + tests reales

El flujo SDD completo está en `docs/sdd-workflow.md`.

---

## 2. Arquitectura actual

El repo actual refleja:

- Next.js 15 App Router + React 19
- TypeScript estricto
- PostgreSQL + Drizzle ORM
- Better Auth + organizations
- SSE para tiempo real
- WhatsApp Cloud API
- OpenRouter-compatible para LLM
- TypeSafe/Jev opcional para Sales Orchestrator
- Vitest + self-test E2E
- Docker multi-stage
- despliegue soportado con Coolify o docker compose + Caddy

El contexto histórico que hablaba de Ploi/PM2 ya no describe el estado técnico actual del repositorio.

---

## 3. Multi-organización

La instalación interna de Espacio Connect opera tres organizaciones:

- Max Quispe
- Vende Veloz 365
- Espacio Veloz

El modelo de datos es tenant-safe y el acceso de dominio debe pasar por
`organization_id` / `scoped()`.

Los docs upstream siguen describiendo “una instancia = un negocio” para
despliegues externos. Interpretación vigente:

- **operación interna:** tres organizaciones aisladas en la misma instalación;
- **producto externo v1:** no generalizar esta excepción interna a una plataforma
  SaaS centralizada.

---

## 4. WhatsApp

La base madura incluye:

- webhook Meta;
- contactos y conversaciones;
- inbox;
- texto/media/templates;
- ventana de 24 h;
- sandbox;
- SSE;
- credenciales tenant-safe;
- sincronización de templates.

Regla: no reescribir webhook/inbox/sender salvo bug real o spec nuevo.

---

## 5. WHMCS → Espacio Veloz

Endpoint único:

`POST /api/integrations/whmcs/events`

Código relevante:

- `src/app/api/integrations/whmcs/events/route.ts`
- `src/server/integrations/whmcs/hmac.ts`
- `src/server/integrations/whmcs/payload.ts`
- `src/server/integrations/whmcs/invoice-created.ts`
- `src/server/integrations/whmcs/invoice-paid.ts`

Estado:

- HMAC sobre body crudo + timestamp.
- Organización fijada server-side a `espacio-veloz`.
- `integrationEvent` durable con idempotencia por organización/source/event/external id.
- Política at-most-once para evitar WhatsApps duplicados.
- `invoice.created` usa template aprobado con variables y botón URL dinámico.
- `invoice.paid` usa template aprobado con 4 variables y sin botón.
- Tests cubren duplicados secuenciales/concurrentes, aislamiento tenant y
  convivencia de created/paid para el mismo invoiceId.

Evidencia operativa histórica: ambos eventos quedaron probados en producción en
agosto de 2026.

Regla de negocio con impacto técnico:

> WHMCS decide CUÁNDO; Espacio Connect decide CÓMO comunicar por WhatsApp.

No crear cron paralelo de cobranza en el CRM.

---

## 6. Sales Orchestrator — Vende Veloz 365

Documento durable: `docs/SALES_ORCHESTRATOR.md`.

Estado implementado:

- opt-in por organización;
- OFF = agente legacy;
- Jev interpreta estado comercial;
- código determinístico resuelve lane/efectos;
- GPT/OpenRouter redacta;
- lane y pipeline son conceptos separados;
- lanes: AUTO / AUTO_CLOSE / WAIT / HUMAN / STOP;
- HUMAN hace handoff;
- STOP no equivale automáticamente a `lost`;
- fallo Jev no inventa decisión;
- sandbox no toca Meta;
- UI muestra estado comercial.

Último freeze registrado: typecheck/lint/test/build verdes con 382 tests.
E2E/live Jev quedó pendiente en ese checkpoint por falta de app local y
credenciales TypeSafe/Jev.

### Checkpoint técnico — núcleo reusable vs. configuración Vende Veloz

El Sales Orchestrator **ya está cableado al flujo real del inbox** cuando
`agent_profile.sales_orchestrator_enabled=true`. Ruta vigente:

`ingest → maybeRunAgentTurn → runAgentTurn → runSalesOrchestratorTurn → Jev → resolver determinístico → writer → efectos CRM`.

Piezas que hoy funcionan como núcleo reusable:

- `src/server/sales/client.ts`: adaptador TypeSafe/Jev aislado, endpoint completo por env, retries y degradación segura;
- `normalize.ts` / `decision.ts`: frontera raw provider → decisión tipada;
- lanes y estado durable del lead;
- resolver determinístico de lane/efectos;
- handoff humano;
- follow-ups durables;
- separación estricta Jev = interpretación, CRM = efectos, writer = redacción.

Piezas todavía específicas del funnel/campaña **Vende Veloz 365**:

- `src/server/sales/vende-veloz.ts`: producto, política comercial y oferta;
- `src/server/sales/questions.ts`: preguntas y criterios Jev del funnel actual;
- `build-state.ts`: inyecta producto/política Vende Veloz al state;
- `writer.ts`: prompt, pricing, claims y reglas de respuesta de Vende Veloz;
- parte de `next_action` / semántica del resolver refleja ese proceso comercial.

### Decisión de continuidad — DEFERRED multi-campaign

**No generalizar ahora.** La prioridad inmediata es poner Vende Veloz en
operación real con lo ya construido y corregir únicamente evidencia que aparezca
en producción.

Cuando exista la siguiente campaña comercial concreta, abrir un nuevo spec SDD para
extraer la configuración específica hacia un concepto de **Campaign Playbook**.
La unidad de estrategia será la campaña, no la organización completa: una misma
organización podrá tener campañas diferentes con reglas diferentes.

Dimensiones candidatas del futuro playbook, sin definir todavía schema ni CRUD:

- Product / Offer Context;
- Jev Evaluation Questions;
- Lead Management Policy (autogestión, lane, pipeline, next action);
- Human Handoff Policy;
- Writer Policy;
- Follow-up Policy.

El trabajo futuro debe **extraer/injectar configuración alrededor del núcleo
existente**, no reescribir Jev ni el Sales Orchestrator. Vende Veloz queda como
primer playbook concreto y baseline de regresión.

**Punto de reanudación:** segunda campaña real → comparar sus necesidades con
Vende Veloz → abrir spec → extraer únicamente lo que efectivamente deba variar.

---

## 7. Follow-ups comerciales

Documento durable: `docs/SALES_FOLLOW_UPS.md`.

Implementado hasta phase 22:

- tabla/job durable;
- secuencias `awaiting_reply`, `after_demo`, `after_price`;
- `scheduled_wait` one-shot;
- máximo 3 intentos comerciales;
- inbound cancela pending y resetea resumen;
- respuesta manual cancela automatización;
- worker in-process con claim `FOR UPDATE SKIP LOCKED`;
- lease y retries técnicos separados del intento comercial;
- revalidación inmediatamente antes del side effect externo;
- ventana abierta → writer + texto;
- ventana cerrada → template approved 0-var;
- sin template → `template_required`, no texto libre;
- tercer intento sin respuesta → Dormido: STOP + `no_reply_exhausted`, sin
  mover pipeline a lost;
- flags del agente/Orchestrator/follow-ups bloquean correctamente ejecución;
- UI permite programar/cancelar/reactivar.

### Verificación registrada

| Gate | Estado |
|---|---|
| `pnpm typecheck` | verde |
| `pnpm lint` | verde |
| `pnpm test` | verde — 420 tests |
| `pnpm build` | verde |
| `pnpm test:e2e` | pendiente |

El E2E no se ejecutó porque en esa sesión no había app/PostgreSQL local
disponibles. Por Constitución, este bloque **no está verificado punta a punta**
hasta correr el self-test real.

---

## 8. Cobertura SDD existente

Specs formales actuales:

- `specs/001-vocero-core/`
- `specs/002-diseno-atlas-white-label/`
- `specs/003-paridad-inbox-whatsapp/`
- `specs/004-inbox-messaging-ux/` (cola de adjuntos del composer + UX polish, cerrado)
- `specs/005-quick-lead-name/` (edición inline de `contact.name` desde el panel del inbox — **CERRADO** en commit único)
- `specs/006-anuncio-de-origen/` (de qué anuncio de Meta llegó cada conversación — **CERRADO**, pieza visible sin CAPI todavía)
- `specs/007-meta-capi/` (reportar `QualifiedLead` y `Purchase` a Meta Conversions API — **CERRADO** en Cortes A+B+C tras commit único de cierre)
- `specs/008-sales-playbook/` (playbook comercial durable, versionado y editable sin redeploy — **CERRADO** en Cortes 1–7 tras commit único de cierre)

### Estado del spec 008 — Sales Playbook versionado

**Cerrado el 2026-10-01** en siete cortes secuenciales, cada uno con su
commit atómico. El objetivo era uno solo: que la estrategia comercial
(producto, oferta, política, preguntas de Jev, instrucciones del writer)
dejara de estar congelada en TypeScript y pasara a ser **configuración
durable, versionada, tenant-safe y editable sin redeploy**.

El motor (Sales Orchestrator, Jev, resolver, lanes, writer, follow-ups)
**no se reescribió**: solo se le agregaron adaptadores que consultan la
versión publicada. El runtime pasó de "conocer la estrategia" a
"consultar la estrategia publicada en su versión X".

#### Historia técnica — fecha de cierre de cada corte

| Corte | Contenido | Cerrado |
|---|---|---|
| 1 | Modelo y persistencia: `sales_playbook` + `sales_playbook_version`, schema Zod versionado, contenido V1, store con `scoped()`, bootstrap multi-org determinista | 2026-09-30 |
| 2 | API de versionado: `GET /api/playbook`, draft (POST/PUT/DELETE), validate, publish, rollback, versions (list/detalle) | 2026-09-30 |
| 3 | Runtime dinámico: loader sin cache, `buildJevSalesState` con config publicada, contrato dinámico de preguntas Jev, `SalesDecision` nullable con fallbacks, override solo `is_test`, supresión de follow-ups en sandbox, snapshot de versión en el lead | 2026-09-30 |
| 4 | UI Playbook: tabs en `agent-client.tsx`, editor por bloques, lista de versiones, publish/rollback con `notes` | 2026-09-30 |
| 5 | Editor Jev avanzado: tres clases con guardarraíles duros, candados por clase, editor inline por pregunta | 2026-09-30 |
| 6 | Laboratorio comercial: pipeline real en sandbox, override por corrida, expected outcomes humanos, comparación Published vs Draft | 2026-10-01 |
| 7 | Casos reales + auditoría + cierre: "Guardar conversación como caso" con PII minimizada, logs de bootstrap por org, E2E final, docs | 2026-10-01 |

#### Decisiones (todas revisables)

- **`VENDE_VELOZ_*` y `JEV_SALES_QUESTIONS_V2` son `DEFAULTS_ONLY`.**
  No se borraron. El runtime los consume **solo** cuando la organización
  no tiene versión publicada, de forma explícita y visible. Los tests los
  importan directamente como baseline congelado de regresión. Borrarlos
  tiraría la red de seguridad del arranque y rompería la red de tests a
  cambio de nada.
- **El runtime prefiere siempre la publicada.** El fallback es una red de
  seguridad, no un modo de operación: si aparece en los logs, hay que
  publicar una versión. Cada decisión persistida queda con
  `playbook_version_id` (columna denormalizada en `lead` + clave dentro del
  JSONB `last_jev_decision`), así que la degradación es visible y
  auditable, nunca ambigua.
- **Sin cache de playbook en V1.** El loader lee BD en cada turno; un
  publish/rollback toma efecto en el turno siguiente. Con el volumen
  actual, un SELECT es más barato que la complejidad de mantener un cache
  coherente, y Jev + writer cuestan muchísimo más que esa lectura.
  Optimización futura solo si las métricas lo exigen.
- **Bootstrap multi-org determinista.** Enumera
  `agent_profile WHERE sales_orchestrator_enabled = true` de forma
  explícita; nunca usa `SELECT organization.id LIMIT 1` ni heurísticas.
  Idempotente: una org ya sembrada genera cero inserciones, y una org con
  el orchestrator apagado **nunca** se siembra (y ahora eso se loguea
  explícitamente, para que un opt-in apagado por error sea diagnosticable).
- **Override de Playbook solo en `is_test=true`.** `runSalesOrchestratorTurn`
  lanza `playbook_override_forbidden_in_production` si recibe un override
  sobre una conversación no sandbox. En producción el override es siempre
  `undefined`; el Laboratorio es el único que lo inyecta, y el Laboratorio
  solo corre sobre `is_test=true`.
- **Tres clases de preguntas Jev**, con contratos distintos:
  `engine-required` 🔒 (`next_action`, `needs_human_call` — key, type,
  option keys y `enabled` inmutables), `known signals` 📊 (6 preguntas —
  key/type/option keys bloqueados, `enabled` editable con fallback
  documentado) y `analytical/custom` ➕ (libres; se preservan en
  `decision.signals` y **nunca** influyen en una decisión).
- **Sandbox suprime scheduling de follow-ups.** El orquestador detecta
  `is_test=true` y no llama a `scheduleNextFollowUp`, de modo que una
  corrida del Laboratorio termina con cero filas en
  `sales_follow_up_job`. Junto con el guard del sender (no toca WhatsApp
  real) y el de CAPI (no emite eventos), el Laboratorio no deja efectos
  residuales.
- **El caso de conversación real vive en `lab_case`, no en
  `agent_test_case`.** Es una decisión de Constitución I: la garantía de
  PII minimizada es **estructural** (la tabla no tiene columna de
  identidad) y no una disciplina de código. Reutilizar `agent_test_case`
  habría obligado a fabricar una corrida y habría dejado una columna
  `conversation_id` lista para colar un id.

#### PII minimizada — "Guardar conversación como caso"

El caso persistido contiene **únicamente**: `transcript`
(`{ role: 'cliente' | 'agente', text }[]`, solo texto), `playbook_version_id`,
`playbook_schema_version`, los expected outcomes editables y metadata no
identificante (`turns_approx`, `chars_total`, `detected_language`).

**Nunca** contiene `lead_id`, `contact_id`, `conversation_id`, `phone`,
`email`, `wa_identity`, `ctwa_clid`, `source_id`, `source_url`, IDs de
Meta, tokens de credenciales, ni ninguna combinación que permita
reconstruir la identidad original. El `conversation_id` se usa **solo**
como input autenticado para leer la conversación del tenant.

Encima de la garantía estructural, el **texto** se sanea server-side
(`src/server/lab/case-pii.ts`): teléfonos → `[telefono]`, emails →
`[email]`, enlaces → `[enlace]`, tokens de plataforma → `[id]`. Esto
importa porque un cliente suele dictar su propio número dentro de un
mensaje: sin el saneador, el caso devolvería un camino a la identidad
real. Precios, fechas y números cortos se conservan porque no son
identidad y son justo lo que el juez necesita evaluar.

#### Verificación del cierre (Corte 7)

| Gate | Estado |
|---|---|
| `bash -n scripts/ai/run-sales-playbook.sh` | verde |
| `pnpm typecheck` | verde |
| `pnpm lint` | verde (warnings preexistentes de `<img>`, ajenos a este corte) |
| `pnpm build` | verde |
| `pnpm test` | verde — **810 tests, 88 archivos** (23 nuevos en `lab-case-from-conversation.test.ts`) |
| E2E en vivo (`pnpm test:e2e`) | **PENDIENTE en este entorno** — sin Docker, `psql` ni PostgreSQL, y la app no está levantada. La sección 013 extendida **parsea** (`node --check`), pero no se ejecutó |

Los snapshots históricos de `last_jev_decision` siguen siendo compatibles:
las claves nuevas (`playbook_version_id`, `playbook_schema_version`,
`playbook_version_number`) son aditivas y su ausencia en snapshots viejos
se interpreta como ausencia de playbook, no como error.

#### Riesgos conocidos

- **Publicar cambia producción en el turno siguiente.** No hay cache ni
  periodo de gracia: lo que se publica es lo que el agente dice en la
  siguiente conversación. Publicar solo lo que ya pasó por el Laboratorio.
- **Un `schema_version` desconocido se rechaza en rollback (422)** porque
  no hay migrador de config. Es deliberado: es preferible fallar visible
  a aplicar una config que el motor no entiende.
- **El fallback a defaults es visible pero silencioso para el dueño.** El
  warning va al log del servidor, no a la UI. Un despliegue con la
  organización sin playbook sembrada opera con la estrategia congelada.
- **1 playbook por organización en V1.** La forma soporta multi-playbook
  (slug + label), pero no hay UI ni runtime para elegir. Multi-campaña
  sigue reservado.
- **`expected_*` usan catálogos cerrados** (7 `next_action`, 5 lanes) para
  que un typo no se persista y luego compare ❌ para siempre.
- **El E2E en vivo de los cortes 3, 6 y 7 sigue pendiente** de un entorno
  con el stack levantado. Los gates técnicos y la suite unitaria están
  verdes; por Constitución IX eso no equivale a "READY punta a punta"
  hasta correr el self-test real.

Guía del dueño: [`docs/playbook.md`](./playbook.md). Detalle del
Laboratorio comercial: `docs/SALES_ORCHESTRATOR.md` y
`docs/SALES_FOLLOW_UPS.md`.


### Estado del spec 006

**Cerrado el 2026-09-29** en dos cortes A+B tras el commit 0 documental.
Puerto selectivo de la spec 018 del upstream `kevinrivm/vocero-crm`: trae
la pieza visible al raíz (bandeja con marca de anuncio, panel con tarjeta
del creativo, filtro Anuncios, copia best-effort del thumbnail al volumen
de adjuntos) sin arrastrar su pila multitenant, su CAPI ni su spec 016
previa.

**Implementación entregada (corte A — servidor/datos, cerrado):**

- **Tabla nueva `ad_attribution`** con UNIQUE `(organization_id,
  conversation_id)` y migración aditiva `0006_anuncio_de_origen.sql`
  re-ejecutable. En este repo la tabla no existía y la creamos completa
  desde cero; mismo shape de columna que la 0014 del upstream 018.
- **Normalización pura** del `messages[].referral` de WhatsApp en
  `src/server/attribution/referral.ts`. Cotas: id 128, titular 300,
  texto 2000, URL 2048, raw 8 KB. `ctwa_clid` se trata como si la futura
  bandera `ATRIBUCION` estuviera **apagada**: la columna se guarda NULL y
  el `raw` no contiene la clave. La promesa del futuro spec 007 (una
  instancia que no atribuye no acumula identificadores de clic) se
  respeta desde el primer despliegue.
- **Imagen del creativo** copiada best-effort fuera del webhook a un
  `media_asset` con defensa SSRF (allowlist cerrada de hosts de Meta +
  `https://` obligatorio + tope 1 MB + timeout 3 s). Una descarga por
  `(organization_id, source_id)` deduplicada en memoria.
- **DTO `ConversationDto.anuncio`** con `{ headline, sourceId, sourceType
  }` para la lista, y **`AnuncioDto`** completo (sin el valor del
  `ctwa_clid`: solo `hasCtwaClid: boolean`) para el detalle del contacto y
  el evento SSE `conversation.updated`.
- **Conversaciones orgánicas** quedan iguales: sin marca, sin tarjeta,
  sin línea secundaria, sin cambio en el filtro.

**Implementación entregada (corte B — UI + E2E + cierre, este commit):**

- **Componente reusable `AnuncioOrigen`** en
  `src/components/anuncio-origen.tsx`: miniatura del creativo (o
  placeholder "Sin imagen" cuando la descarga falló), titular, body
  recortado a 2 líneas, "Primer mensaje · hace X", badge "con video",
  `ID <sourceId>`, enlace "Ver anuncio" solo si la URL es `https://`,
  punto "clic CTWA atribuido" cuando `hasCtwaClid === true`. Defensa
  explícita: jamás muestra el valor del `ctwa_clid`, solo presencia.
- **Helpers de glosario** (`etiquetaDeOrigen`, `titularDeOrigen`,
  `cuentaComoAnuncio`) en `src/lib/anuncios.ts` — el primero decide
  "Anuncio" vs "Publicación", el segundo decide el titular visible, y
  el tercero es el criterio del filtro (solo `sourceType === "ad"`).
- **Marca en la lista** (`conversation-list.tsx`): debajo del nombre del
  contacto aparece el chip «Anuncio · titular» o «Publicación · titular»
  con truncado y ellipsis cuando el espacio aprieta. Sin origen, no se
  muestra nada.
- **Filtro Anuncios** (`conversation-list.tsx`): chip con icono
  `Megaphone` y contador, solo aparece si hay al menos una conversación
  de anuncio en la bandeja actual (post-búsqueda + post-etapa). Es
  mutuamente excluyente con "No leídas" (decisión TB02 del spec).
- **Tarjeta en el panel lateral** (`contact-panel.tsx`): se inserta
  entre el header del contacto y el stepper de etapa cuando
  `GET /api/contacts/:id` devuelve `anuncio !== null`. Se rehidrata en
  cada `refreshLive` (SSE) sin tocar las notas. Si la imagen llega
  tarde, `key={imageAssetId ?? "none"}` fuerza re-render.
- **Línea secundaria en el pipeline** (`pipeline-client.tsx`): debajo
  del nombre del lead aparece «Anuncio · titular» o «Publicación ·
  titular» cuando el board trae origen; sin origen, no se muestra.
  Refactor mínimo: cero cambios en dnd-kit ni en el comportamiento de
  arrastre.
- **E2E automatizado** (`tests/e2e/011-anuncio-de-origen.md` +
  `runSection011` en `scripts/e2e-selftest.mjs`): cubre los 10 caminos
  del TB05 — orgánica, con referral, primer anuncio gana, reentrega,
  publicación deduce fuente "desconocida", imagen fuera de allowlist no
  rompe el inbound, filtro Anuncios, tenant isolation. El arnés existente
  del self-test se reusa tal cual; no se copia infraestructura.

Restricciones respetadas:

- Sin Marketing API, sin nombre de campaña / adset / ad (Meta no los
  entrega en el `referral`).
- Sin Conversions API, sin `Ajustes → Anuncios`, sin envío a Meta →
  spec 007.
- Sin cambios en Sales Orchestrator, Jev, follow-ups, sender,
  `window.ts`, `agent_profile`.
- Cero nuevas dependencias npm.
- Migración ADITIVA y tenant-safe: `organization_id NOT NULL` con
  índice org-first, FK con `ON DELETE CASCADE` a `organization`,
  `contact` y `conversation`.
- `ctwaClid` nunca sale por API: el DTO expone `hasCtwaClid: boolean`
  únicamente. Defensivamente, si Meta mandase `source_url: "http://"`
  la UI no renderiza el anchor.

**Verificación actual (este PR de cierre — corte B):**

| Gate | Estado |
|---|---|
| Constitution Check | sin violaciones |
| `pnpm typecheck` | verde |
| `pnpm lint` | verde |
| `pnpm build` | verde |
| `pnpm test` | verde — 594 tests |
| Self-test E2E (sección 011) | script agregado al arnés existente |
| E2E en vivo (`pnpm test:e2e` con app + BD + mocks) | **PENDIENTE en este entorno** — sin app local ni PostgreSQL activa |
| Playwright visual (TB07) | **PENDIENTE HUMANO/PRODUCCIÓN** — requiere clic CTWA real en producción |
| Clic CTWA real en producción | **PENDIENTE HUMANO/PRODUCCIÓN** — la imagen, el `oe=` del CDN y la calidad del JSON real de Meta solo se confirman en producción |

El spec 006 está **verificado unitariamente punta a punta** y la sección
011 del self-test está agregada al arnés, pero **NO verificado en vivo
punta a punta** hasta correr Playwright manual contra `pnpm dev` local
(pasos 1–10 de `tests/e2e/011-anuncio-de-origen.md`) y un clic CTWA real
en producción. Por Constitución IX no debe reportarse como READY punta a
punta hasta entonces. La verificación pendiente es del mismo tipo y
gravedad que las secciones 008, 009 y 010: si el entorno local no tiene
app ni BD activas, queda registrada como pendiente y se ejecuta en el
siguiente checkpoint que disponga de la app levantada. La verificación
del clic CTWA real **no es automatizable** y queda marcada como
PENDIENTE HUMANO/PRODUCCIÓN, igual que el upstream.

### Estado del spec 007

**Abierto el 2026-09-29** (este commit 0, sin código de implementación).
Adaptación selectiva del upstream 016 (`kevinrivm/vocero-crm`, commits
`0a154ea2711ad5350e20451c573a7863b926cfed` y
`75124422bba2298bb21cf3e712cae16b31f01ce2`) — `specs/016-atribucion-capi/`
y `docs/atribucion-capi.md`. **No es un port ciego**: este fork tiene
Sales Orchestrator (Jev) que hoy escribe `lead.stageId` por su propio
camino, y la etapa calificada la elige cada negocio (no se hardcodea
"Interesado").

**Alcance declarado (tres cortes secuenciales):**

- **Corte A — puerta única de etapa.** Refactor neutro. Los 6 callsites
  runtime que escriben `lead.stageId` hoy
  (`app/api/pipeline/leads/[id]/route.ts`,
  `app/api/pipeline/stages/[id]/route.ts`,
  `app/api/bot/reset/route.ts`, `server/ai/pipeline.ts`,
  `server/sales/orchestrator.ts`, `server/inbox/lead-activity.ts`)
  migran a un único helper `moveLeadStage(...)` tenant-safe. Cero
  cambios observables, cero llamadas externas, sin CAPI todavía. El
  Sales Orchestrator deja de escribir `lead.stageId` directamente:
  pasa por la puerta común conservando lanes y facts intactos.
- **Corte B — CAPI core + schema + APIs.** Migración aditiva
  `drizzle/00XX_meta_capi.sql` con `conversion_event` (UNIQUE
  `(organization_id, conversation_id, event_name)` para dedup
  durable) y `capi_settings` (config cifrada AES-256-GCM). Nuevo
  `src/lib/meta/capi.ts` (catálogo cerrado `QualifiedLead`/`Purchase`,
  validación Zod, acuse real `events_received >= 1`). Nuevo
  `src/server/attribution/{flag,settings,conversions}.ts`. APIs
  `/api/settings/capi` y `/api/settings/capi/events` protegidas por
  auth+tenant y la bandera `ATRIBUCION`. El gateway del corte A
  engancha `reportStageChange` **después** del commit, nunca dentro
  de la transacción larga. Mock equivalente al patrón
  `wa-mock`/`ai-mock` aprende `POST {dataset}/events`. Sin UI final.
- **Corte C — UI + E2E + cierre.** Pestaña **Anuncios** en Ajustes
  (visible solo con `ATRIBUCION=on`): dataset ID, token opcional,
  selector de etapa calificada (lista de `pipelineStage` con
  `kind = "open"` del tenant) y tabla de actividad con `fbtrace_id`.
  Arnés E2E en **las dos configuraciones** (`ATRIBUCION=on` y
  apagada), incluido el camino infeliz (Meta rechazando, token
  vencido, sin `ctwa_clid`, `is_test`, sin etapa calificada).
  `docs/atribucion-capi.md` espejo del upstream con notas del fork.

**Decisiones no triviales documentadas en el spec:**

- `ATRIBUCION` apagada por defecto; apagada ⇒ superficie CAPI inexistente
  (404 según patrón upstream) pero 006 sigue mostrando origen sin `clid`.
- Etapa calificada **configurable** por tenant; **no** hardcodeada a
  "Interesado". `QualifiedLead` se emite la primera vez que el lead entra
  a esa etapa; si el tenant no elige ninguna, queda en `skipped` con
  motivo.
- `Purchase` se emite automáticamente al entrar a cualquier etapa
  `kind = "won"`.
- `Purchase` incluye `value`/`currency` **solo si** el modelo de deal
  actual del lead tiene un monto válido; si no, se envía **sin**
  `value`/`currency`. Nunca se inventa `0` — un valor falso envenena la
  optimización por valor de Meta.
- `user_data` hacia Meta: solo `ctwa_clid` (de `ad_attribution` de 006)
  + `whatsapp_business_account_id`. **Nunca** teléfono, nombre, email
  ni texto del contacto.
- Token CAPI: si el tenant ya conectó WhatsApp, **se reusa** ese token
  cifrado (mismo que autoriza publicar en el dataset del WABA); pegar
  token específico es opcional y se cifra con la misma capa `lib/crypto`.
- Hacia el cliente solo `last4` y estado; nunca a logs.
- Conversaciones `is_test = true` jamás emiten evento (guardrail del
  Laboratorio, mismo patrón que el sender).
- Un fallo de Meta **jamás** revierte ni bloquea el cambio de etapa; el
  desenlace queda en `conversion_event` consultable.
- Sin Marketing API, sin Campaign Playbooks, sin espejo de
  `InitiateCheckout` de fábrica (la receta queda en `docs/atribucion-capi.md`
  para cada fork que quiera agregarla); sin backfill; sin 019/Resultados.

**Constitution Check (PASA sin violaciones):** I (seguridad: cifrado,
`last4`, sin PII hacia Meta) · II (soberanía: misma Meta Graph API del
canal ya permitido, traje completo de conector opcional apagado por
defecto) · III (multi-tenancy: `organization_id NOT NULL` + `scoped()`)
· IV (idempotencia: dedup `UNIQUE` + `ON CONFLICT DO NOTHING`,
migración re-ejecutable) · V (calidad: gate + unit + E2E en dos
configuraciones) · VI (specs antes de código: spec/plan/tasks
presentes antes del código) · VII (trazabilidad: decisiones no obvias
en el spec) · VIII (foco vertical: dos eventos, una pantalla, cero
dashboards) · IX (verificación en vivo: self-test con mocks en ambas
configuraciones antes de declarar Hecho).

**Estado actual (este commit):** Cortes A + B + C cerrados. Spec 007
**completo** salvo la verificación humana pendiente (clic CTWA real contra
Meta en producción — no automatizable, igual que el upstream 016).

- **Corte A** (commit `refactor(pipeline): centralizar cambios de etapa
  del lead`): los 6 callsites runtime de `lead.stageId` ya pasan por el
  gateway `src/server/leads/stage-gateway.ts`, incluido el Sales
  Orchestrator (Jev) que dejó de escribir `stageId` directamente.
  Cero cambios observables, lanes/facts/follow-ups intactos.
- **Corte B** (commit `feat(attribution): reportar QualifiedLead y
  Purchase a Meta CAPI`): migración aditiva `0007_meta_capi.sql` con
  `conversion_event` (UNIQUE `org/conv/event` para dedup durable) +
  `capi_settings` (config cifrada AES-256-GCM). Nuevo
  `src/lib/meta/capi.ts` (catálogo cerrado, validación Zod, acuse real
  `events_received >= 1`). Nuevo `src/server/attribution/{flag,settings,
  conversions}.ts`. APIs `/api/settings/capi{,/events}` con 404 duro si
  la bandera está apagada. Mock `wa-mock/graph/[...path]` aprende
  `POST {dataset}/events` con `DSET-FAIL` / `DSET-ZERO` para el camino
  infeliz. El gateway del Corte A engancha `reportStageChange`
  **después** del commit.
- **Corte C** (commit `feat(settings): operar atribución Meta CAPI desde
  Espacio Connect`, este commit): pestaña **Anuncios** en Ajustes (solo
  visible con `ATRIBUCION=on`), con dataset ID, token opcional (cifrado,
  `last4` al cliente, reutiliza el token de WhatsApp si ya está
  conectado), selector de etapa calificada (lista `kind = "open"` del
  propio tenant — nunca hardcodeada), tabla de actividad con
  `fbtrace_id` y motivo legible para `sent`/`failed`/`skipped`.
  Botón "Desconectar atribución" limpia token + etapa sin borrar
  historial. Arnés E2E extendido (`runSection012` en
  `scripts/e2e-selftest.mjs`) que cubre **ambas configuraciones**: con
  ATRIBUCION apagada, 404 en APIs + 404 en `/settings/ads` + 006 sigue
  mostrando anuncio sin `ctwa_clid`; con ATRIBUCION=on, etapa de otro
  tenant rechazada, QualifiedLead sent con `fbtrace_id`, dedup durable,
  Purchase sin `value` inventado, lead orgánico skipped, `DSET-ZERO`
  → failed pero el stage cambia, `is_test` nunca emite, Jev moviendo
  etapa usa la misma puerta, token vencido no rompe la app. `ctwa_clid`
  jamás aparece por API ni en logs. `docs/atribucion-capi.md` publicado
  con notas del fork.

**Pendiente único:** clic CTWA real contra Meta en producción. El
self-test con mocks cubre todos los caminos verificables (acuses
positivos, negativos, acuse con `events_received=0`, tokens vencidos,
tenant isolation, idempotencia, guardrail `is_test`, regla
anti-valor-falso). El clic real con un anuncio sirviendo, la URL con
`oe=` real del CDN, la calidad del JSON de Meta y el ciclo de feedback
del algoritmo solo se confirman en producción. Por Constitución IX este
spec **no se declara READY punta a punta** hasta que se ejecute ese
clic contra Meta y se observe la fila `sent` con `fbtrace_id` real.

### Corte A — puerta única de etapa (refactor neutro)

**Cerrado el 2026-09-29** en commit
`refactor(pipeline): centralizar cambios de etapa del lead` antes de tocar
CAPI. Piezas entregadas:

- **Helper/servicio único `src/server/leads/stage-gateway.ts`** con
  `moveLeadStage(...)`, `bulkMoveLeadsToStage(...)`, `createLeadInStage(...)`
  y `findFirstOpenStage(...)`. Errores tipados con `StageGatewayError {
  code, message }` para que las rutas traduzcan al contrato HTTP preexistente.
  Acepta `actor` opcional (`human`/`agent`/`bot`/`system`) y `extra` para que
  Jev conserve su atomicidad sin acoplar el gateway al Sales Orchestrator.
- **6 callsites runtime migrados** al gateway, con el `actor` y `reason`
  legible que cada camino necesita:
  - `app/api/pipeline/leads/[id]/route.ts` — drag/drop (`actor: "human"`,
    `reason: "drag_drop"`). `invalid_stage` → 422, `lead_not_found` → 404.
  - `app/api/pipeline/stages/[id]/route.ts` — bulk-move al eliminar/mover
    etapa (`actor: "human"`, `reason: "bulk_stage_delete"`).
  - `app/api/bot/reset/route.ts` — reset de conversación de pruebas
    (`actor: "system"`, `reason: "bot_reset"`) dentro del `try/catch`
    best-effort que ya tenía la ruta.
  - `src/server/ai/pipeline.ts` — acción `move_stage` del agente inline
    (`actor: "agent"`, `reason: "ai_move_stage"`). Si el contacto aún no
    tiene lead, no falla; si el gateway rechaza, se loguea sin romper el
    turno.
  - `src/server/sales/orchestrator.ts` — Jev/Sales Orchestrator
    (`actor: "agent"`, `reason: "jev:<nextAction>"`). **El patch
    `stageId = nextStageId` desapareció como write directo.** La
    atomicidad original (lane + facts + snapshot + stageId en el mismo
    UPDATE) se conserva pasando `basePatch` como `extra` al gateway.
  - `src/server/inbox/lead-activity.ts` — asignación del primer stage al
    crear lead por inbound (`actor: "system"`, `reason: "first_inbound"`).
    El gateway calcula `position = max+1` y conserva el
    `onConflictDoNothing` original.
- **Seed fuera del scope** (`server/seed/demo.ts` sigue escribiendo
  `lead.stageId` directo, como antes — es un script de demo, no runtime).
- **Tests del gateway** en `tests/unit/stage-gateway.test.ts` (20 casos):
  tenant isolation, lead inexistente, no-op mismo stage, `extra` con mismo
  stage, movimiento a etapa won/lost/open, `position` explícita,
  `lastActivityAt` explícito, Jev lane/facts preservados, bulk move
  cross-tenant rechazado, bulk no-op mismo origen/destino, bulk reasignación
  masiva, `createLeadInStage` con timestamp, cross-tenant, idempotencia
  `onConflictDoNothing`, position auto `max+1`, `findFirstOpenStage`
  primera open / ignora won/lost.
- **Regresión del Sales Orchestrator** en `tests/unit/sales-orchestrator.test.ts`
  sigue verde (con un ajuste mínimo del mock para proveer los SELECTs
  adicionales que el gateway ahora hace explícitos: 1 lead + 1 stage por
  cada move real, y KB/profile vacíos para los caminos best-effort).
- **Verificación del Corte A**:

  | Gate | Estado |
  |---|---|
  | `pnpm typecheck` | verde |
  | `pnpm lint` | verde (1 warning preexistente en `anuncio-origen.tsx`, no relacionado) |
  | `pnpm build` | verde |
  | `pnpm test` | verde — 614 tests, 71 archivos |
  | E2E en vivo | **PENDIENTE** — sin app local ni PostgreSQL activa en este entorno (mismo PENDIENTE registrado en el cierre de 006). El self-test del Corte C cubrirá los caminos con `ATRIBUCION=on` y apagada. |

### Estado del spec 005

**Cerrado el 2026-09-29** en un solo commit funcional tras el commit 0
documental. Implementación entrega:

- **Helper pura testeable** `applyContactNamePatch` en
  `src/components/inbox/conversation-patch.ts`: sincroniza `contact.name` en
  el array de conversaciones de forma inmutable, retornando la misma
  referencia cuando no hay match (evita renders espurios).
- **Microcomponente inline `ContactNameEditor`** dentro de
  `src/components/inbox/contact-panel.tsx`: estados `view` ↔ `edit`,
  trim+validación cliente, doble-submit corto-circuitado por
  `savingRef`, manejo de errores del servidor con mensaje inline.
- **Wiring en `inbox-client.tsx`**: handler `onContactUpdated` aplica
  `applyContactNamePatch` al array, y `key={selected.contact.id}` fuerza
  re-mount del panel al cambiar de conversación (descarta el estado de
  edición).
- **Tests unit nuevos**: 9 casos en
  `tests/unit/conversation-patch.test.ts`.
- **Guion E2E** `tests/e2e/010-quick-lead-name.md` con 10 pasos visuales
  de Playwright y caminos infelices documentados (red caída, 4xx/5xx,
  blur, doble Enter, cambio de conversación, SSE concurrente).

Restricciones respetadas:

- Reutiliza exclusivamente `PATCH /api/contacts/:id` (ya valida
  `name` trim 1–120 y aplica `scoped()`).
- Cero endpoints nuevos, cero cambios de schema, cero store global,
  cero nuevas dependencias npm.
- Fuera de alcance confirmado: phone/email/empresa/tags, modal, nueva
  página, pipeline, Sales, follow-ups, sender, webhook.

**Verificación actual:**

| Gate | Estado |
|---|---|
| `pnpm typecheck` | verde |
| `pnpm lint` | verde |
| `pnpm build` | verde |
| `pnpm test` | verde — **569 tests** (560 del spec 004 + 9 nuevos del spec 005) |
| `pnpm test:e2e` (sección 010) | **PENDIENTE en este entorno** — sin app local ni PostgreSQL activa |
| Playwright visual `tests/e2e/010-quick-lead-name.md` | **PENDIENTE en este entorno** |

El spec 005 está **verificado unitariamente punta a punta** pero **NO
verificado en vivo punta a punta** hasta correr Playwright manual contra
`pnpm dev` local con los 10 pasos visuales y los caminos infelices
documentados en el guion E2E. Por Constitución IX no debe reportarse
como READY punta a punta hasta entonces. La verificación pendiente es
del mismo tipo y gravedad que las secciones 008 y 009: si el entorno
local no tiene app ni BD activas, queda registrada como pendiente y se
ejecuta en el siguiente checkpoint que disponga de la app levantada.

Trabajo posterior documentado antes de exigir Spec Kit completo:

- WHMCS: código + tests + contexto histórico.
- Sales Orchestrator: `docs/SALES_ORCHESTRATOR.md`.
- Follow-ups: `docs/SALES_FOLLOW_UPS.md`.

No crear specs retroactivos falsos solo para "cumplir". **Desde el próximo
cambio observable**, abrir un nuevo `specs/NNN-...` y mantener `tasks.md`
como estado durable.

### Estado del spec 004

Implementado a través de commits atómicos `0 → 1 → 2 → 2a → 2b → 2c → 2d`:

- Commit 0 (`275f457`): docs SDD (spec/plan/tasks).
- Commit 1 (`b3cc38f`): cola de adjuntos, helpers puros, componentes
  presentacionales, drag&drop/paste, submitQueue, retry, a11y base.
- Commit 2a (`de12265`): bucle de envío `runQueueSend`, anti-doble-envío,
  retry por adjunto, confirmación explícita video→document, override
  tipado `kind=document` server-side.
- Commit 2b (`21cc101`): corte final de UX/pulido — header de cola con
  conteo inline, `clearSent`, `summarize`+`progressLabel`, navegación
  por teclado (←/→, Delete/Backspace, Esc), drop overlay animado con
  conteo, indicadores de estado con texto explícito, toolbar buttons
  ≥ 44 px, auto-focus textarea, `aria-current`.
- Commit 2c (`0e7148c`, **fix de comportamiento**): cuatro ajustes
  de comportamiento detectados antes de E2E, todos ya especificados —
  no agrega capacidades nuevas:
  1. **Cleanup automático tras éxito total**: cuando todos los adjuntos
     del envío terminan OK y no quedan `failed`/bloqueos, la cola se
     autovacía (revocando Object URLs), se limpia el textarea y el foco
     vuelve al textarea. "Limpiar enviados" queda solo para estados
     parciales. Heurística pura `shouldAutoClearQueue(result, attempted)`.
  2. **Caption durable**: `runQueueSend` ya no usa un contador local —
     lee `captionOwner`/`captionConsumed` de los adjuntos. El caption
     queda anclado al primer adjunto elegible de la cola original; su
     retry (si falló) conserva el caption; retries de otros adjuntos
     tras un envío exitoso del captionOwner NO re-envían el caption.
     El reducer expone `markCaptionConsumed` (idempotente, defensivo).
  3. **Pre-validación client-side**: `classifyForQueue` ahora refleja
     los límites `MEDIA_LIMITS.*` (image 5 MB, audio 16 MB). Image/audio
     oversized se rechazan al añadirlos a la cola con mensaje claro vía
     `rejectionReason`, sin esperar al POST. Video >16 MB sigue
     ofreciéndose como document; document >100 MB sigue rechazado. El
     backend sigue siendo la fuente de verdad (ningún límite relajado).
  4. **Botón engañoso en panel location/contact**: abrir el panel
     secundario sin texto ni adjuntos ya NO habilita el botón principal
     del textarea (`canSubmit` no depende de `panel !== null`).
     Adicionalmente, `onlyBlocked` ya no considera adjuntos con
     `status=sent` como bloqueantes — tras un envío total (con o sin
     cleanup automático disparado) el operador puede enviar un texto
     nuevo sin tener que pulsar "Limpiar enviados" primero.
- Commit 2d (este checkpoint, **fix de comportamiento post-2c**):
  tres regresiones detectadas al revisar el código desplegado tras
  `0e7148c`. NO agrega capacidades nuevas. NO toca backend de
  WhatsApp, límites, video-as-document, transcodificación, voice
  recorder, storage/historial, webhook ni Sales/WHMCS. Solo refina
  la lógica cliente del composer y de la cola:
  1. **Rama de submit** (`composer.submit()`): antes usaba
     `attachments.some(a => !a.needsVideoAsDocumentConfirm)` para
     detectar "hay adjuntos listos". Eso contaba `status="sent"`
     como listo, así que un sent residual bloqueaba el envío de un
     texto nuevo (`submitQueue()` retornaba con `readyToSend` vacío
     y el texto no salía). Nueva helper pura `decideSubmitMode`
     encola los tres casos (`"queue" | "text" | "noop"`) usando el
     mismo filtro que `readyToSend`. `submit()` la consulta y nunca
     se contradice con `canSubmit`.
  2. **Cleanup del happy path**: `submitQueue()` llamaba
     `q.clearSent()` después del envío, pero el callback `clearSent`
     filtra por `status === "sent"` y capturó el estado anterior al
     envío (todos `pending`), por lo que su loop de
     `URL.revokeObjectURL` no revocaba nada — quedaban Object URLs
     huérfanas aunque el reducer luego quitase los sent. Fix: el
     happy path usa `q.clear()` (revoca TODO sin filtrar status),
     y los callbacks `clear`/`clearSent`/`remove` del hook ahora
     leen de `attachmentsRef.current` (deps=[]) para ser estables
     frente a capturas obsoletas. Helper pura `revokeAllPreviews`
     encapsula la semántica "revocar sin filtrar status".
  3. **Transferencia de captionOwner al eliminar**: la acción `remove`
     del reducer (vía `applyRemoveWithCaptionTransfer`) ahora
     transfiere `captionOwner=true` al primer adjunto restante
     elegible cuando el eliminado era captionOwner con su caption aún
     NO consumido. Si el caption ya viajó (`captionConsumed=true`),
     NO transfiere. Si la cola era de un solo elemento, solo lo
     quita sin transferir. Reglas duras: nunca se transfiere a un
     adjunto que ya es owner (defensivo).

**Verificación actual:**

| Gate | Estado |
|---|---|
| `pnpm typecheck` | verde |
| `pnpm lint` | verde |
| `pnpm build` | verde |
| `pnpm test` | verde — **560 tests** (546 post-2d + 14 nuevos del corte 2e) |
| `pnpm test:e2e` (sección 009) | **PENDIENTE en este entorno** — sin app local ni PostgreSQL activa |
| Playwright visual `tests/e2e/009-inbox-messaging-ux.md` | **PENDIENTE en este entorno** |
| Sección 008 (regresión spec 003 cerrado) | pendiente de re-correr con la app levantada |

El spec 004 está **verificado unitariamente punta a punta** pero **NO
verificado en vivo punta a punta** hasta correr `pnpm test:e2e` local y
re-correr la sección 008 para regresión. Por Constitución IX no debe
reportarse como READY punta a punta hasta entonces.

**Detalle de tests del corte 2d** (24 nuevos):

- `attachment-queue-run.test.ts`: 12 nuevos
  - `decideSubmitMode` × 10 casos: cola vacía, sent residual, mezcla
    sent+sending, bloqueado video→document, mezcla bloqueado+listo,
    solo `sending`, consistencia con `canSubmit`, edge cases.
  - `runQueueSend` × 2 casos de integración con
    `applyRemoveWithCaptionTransfer`: caption viaja exactamente una
    vez con el nuevo owner; eliminar owner consumido NO reasigna.
- `attachment-queue-reducer.test.ts`: 12 nuevos
  - `applyRemoveWithCaptionTransfer` × 8 casos: owner no consumido
    transfiere, owner consumido no transfiere, eliminar no-owner no
    afecta, cola de 1, id inexistente no-op, selectedId cleanup,
    preservación de orden/flags, delegación coherente con
    `queueReducer`.
  - `revokeAllPreviews` × 4 casos: revoca todos sin filtrar status,
    ignora sin previewUrl, lista vacía, regresión "filtro por status
    dejaría huérfanas".

**Detalle de tests del corte 2e** (14 nuevos):

- `attachment-queue-run.test.ts`: 8 nuevos (1 modificado)
  - `decideSubmitMode` × 5 casos nuevos (FIX-1): blocked + texto →
    `"noop"`; sent residual + texto → `"text"` (confirmación); sent +
    blocked + texto → `"noop"`; sent + blocked + ready → `"queue"`;
    blocked + failed no bloqueado → `"queue"`.
  - Test de consistencia `decideSubmitMode` ↔ `canSubmit` actualizado
    para usar el filtro nuevo (`onlyBlocked`). Nuevo test "FIX-1
    consistencia: cola con solo bloqueado + texto → botón y Enter
    ambos deshabilitados".
  - `runQueueSend` × 2 casos de integración con
    `applyRemoveWithCaptionTransfer` saltando sent (FIX-2): A owner
    failed + B sent + C failed → C se vuelve owner y retry de C
    recibe caption exactamente una vez; A owner + B sent únicamente
    → nadie hereda captionOwner y runQueueSend omite B.
- `attachment-queue-reducer.test.ts`: 6 nuevos
  - `applyRemoveWithCaptionTransfer` × 5 casos (FIX-2): A owner + B
    sent + C failed → C owner; A owner + B sent únicamente → nadie;
    A owner + B sending + C pending → C owner; blocked con
    `needsVideoAsDocumentConfirm=true` SIGUE siendo candidato válido;
    sent primero + pending después → salta sent.
  - `canMutateQueue` × 2 casos (FIX-3): `sending=false` → true,
    `sending=true` → false.

---

## 9. Historia técnica corta

| Fecha | Hito |
|---|---|
| 2026-08-12 | baseline/fork auditado y estrategia de adaptación |
| 2026-08-19 | integración WHMCS created/paid implementada y validada |
| 2026-09-20 | Sales Orchestrator V1, phases 01–14 |
| 2026-09-20/21 | follow-ups, phases 15–22 |
| 2026-09-21 | último commit funcional auditado: `bbae7cd1dfd9` |
| 2026-09-29 | sincronización de memoria técnica + disciplina SDD |
| 2026-09-29 | spec 004 cerrado: cola de adjuntos + UX polish (commits 0→1→2→2a→2b, 500 tests) |
| 2026-09-29 | spec 004 corte 2c — fix de comportamiento antes de E2E (cleanup total, caption durable, pre-validación image/audio, botón engañoso del panel), 522 tests |
| 2026-09-29 | spec 004 corte 2d — fix de comportamiento post-0e7148c (rama submit con sent residual, cleanup happy path revoca todas las previews, transferencia captionOwner al eliminar owner), 546 tests |
| 2026-09-29 | spec 004 corte 2e — 3 últimos edge cases del cliente (decideSubmitMode=noop con solo bloqueados, transferencia captionOwner salta sent/sending, mutaciones de la cola bloqueadas durante sending), 560 tests |
| 2026-09-29 | spec 005 cerrado (commit único): edición inline de `contact.name` desde el panel del inbox + sync de UI en las tres superficies, 569 tests |
| 2026-09-29 | spec 006 ABIERTO: anuncio de origen de Meta — pieza visible sin CAPI todavía (puerto selectivo del upstream 018; migración 0006 + tabla `ad_attribution` + normalización + imagen best-effort; implementación en dos cortes A/B posteriores)
| 2026-09-29 | spec 007 ABIERTO: Meta CAPI para leads Click-to-WhatsApp — adaptación selectiva del upstream 016 (gate de etapa primero: refactor neutro que centraliza los 6 callsites runtime de `lead.stageId` en `moveLeadStage(...)` antes de tocar Meta; luego CAPI core + schema/API con `ATRIBUCION` apagada por defecto, token reusado de WhatsApp, etapa calificada configurable, `Purchase` sin valor inventado, dedup `UNIQUE`, `is_test` sin evento; luego UI Ajustes → Anuncios + E2E en dos configuraciones). Commit 0 documental; sin código. | |
| 2026-09-29 | **spec 006 CERRADO** (cortes A+B) — 594 tests |
| 2026-09-29 | **spec 007 CERRADO** (cortes A+B+C) — 646 tests / 74 archivos |
| 2026-09-29 | **Corte 9 — auditoría final de readiness Vende Veloz**: gates re-verificados (typecheck/lint/build verdes, 646/646 tests), `docs/VENDEVELOZ_LAUNCH_CHECKLIST.md` publicado con bloques A/B/C/D, `CURRENT_STATE.md` actualizado. Sin código de app tocado, sin flags cambiados, sin campañas creadas. Working tree limpio. |

---

## 10. Próximo checkpoint recomendado

**No bloquear la salida de Vende Veloz por el refactor multi-campaña futuro.**
Primero operar el funnel actual y obtener evidencia real.

Antes de añadir otra feature grande:

1. levantar app + PostgreSQL + mocks;
2. correr `pnpm test:e2e` para validar:
   - sección 008 (regresión spec 003 cerrado);
   - sección 009 (contrato backend del spec 004 — cola de adjuntos);
   - secciones existentes del Sales Orchestrator/follow-ups;
   - sección 011 (anuncio de origen, spec 006);
   - sección 012 (Meta CAPI, spec 007 — corre **dos veces** si la app está
     con `ATRIBUCION=on`, una sola si está apagada);
3. correr Playwright visual con `tests/e2e/009-inbox-messaging-ux.md`;
4. registrar evidencia en el doc correspondiente y aquí;
5. para cualquier comportamiento nuevo, abrir el siguiente spec numerado;
6. mantener commits atómicos y actualizar `tasks.md` al cerrar cada corte.

---

## 11. Corte 9 — Readiness técnico para Vende Veloz (este commit)

Documento durable: `docs/VENDEVELOZ_LAUNCH_CHECKLIST.md`.

**Propósito:** consolidar para Max (operador) el estado técnico del repo
antes de abrir la primera campaña real de Vende Veloz 365 sobre la
instalación interna de Espacio Connect. **No agrega features.**

### Verificación de gates ejecutada en este corte

| Gate | Resultado | Comando |
|---|---|---|
| `pnpm typecheck` | verde (exit 0) | `tsc --noEmit` |
| `pnpm lint` | verde (0 errors, 1 warning preexistente en `src/components/anuncio-origen.tsx:65` — `<img>` no `next/image`, aceptado) | `eslint .` |
| `pnpm build` | verde (exit 0; 60+ rutas server-rendered; las del 007 con 404 duro si `ATRIBUCION` está apagada) | `next build` |
| `pnpm test` | verde — **646/646 pass**, 74 archivos, 5.03 s | `vitest run` |
| `pnpm test:e2e` | **NO EJECUTADO** — `GET http://localhost:3000/api/health` retorna `000` (sin app levantada); sin PostgreSQL local; `pg_isready` no instalado en este WSL. Constitución IX exige ejecución en vivo antes de declarar READY punta a punta. **No se inventó resultado.** |

### Estructura del checklist publicado (`docs/VENDEVELOZ_LAUNCH_CHECKLIST.md`)

- **A) IMPLEMENTADO Y VERIFICADO EN REPO** — gates + specs 001–007 + Sales
  Orchestrator + follow-ups + inbox + CAPI + 006 + storage + salud/arranque.
- **B) CONFIGURACIÓN DE PRODUCCIÓN A CONFIRMAR** — env vars (`.env.example`
  como referencia), estado por organización Vende Veloz 365 en BD, plantillas
  WhatsApp (0-var BODY), WhatsApp conectado, volumen `/data/media`.
- **C) PRUEBAS REALES EXTERNAS PENDIENTES** — self-test E2E local con
  app+Postgres (Constitución IX), primer clic CTWA real en producción
  (no automatizable), primer lead real recibe respuesta, primer seguimiento
  se programa/cancela, movimiento a qualified produce evento Meta, compra
  real → `Purchase`.
- **D) NO BLOQUEA LANZAMIENTO / FUTURO** — Campaign Playbooks, Marketing API,
  019/Resultados, backfill, `InitiateCheckout` de fábrica, parsing fechas,
  múltiples plantillas, cadencias ajustadas, S3/R2/email/Stripe/Google
  (PROHIBIDOS por Constitución II).

### Veredicto del corte

**La base del CRM está técnicamente lista para abrir campañas reales.**
Los tres pendientes que sí tocan producción:

1. Self-test E2E local con app + Postgres activos (Constitución IX).
2. Clic CTWA real en producción (no automatizable; mismo límite que los
   upstreams 016 y 018).
3. Volumen persistente `/data/media` montado en el host antes del primer
   inbound con imagen, si se quiere conservar el creativo.

### Decisión de continuidad

NO se reinterpretó el contrato de Campaign Playbooks ni se reabrió
ningún spec cerrado. La unidad de estrategia sigue siendo **Vende Veloz 365
como funnel congelado** (`docs/SALES_ORCHESTRATOR.md`); la unidad futura
será la **campaña**, no la organización. Cuando exista la 2ª campaña,
abrir spec SDD nuevo y extraer config alrededor del núcleo reusable.

### Cambios al árbol

- **Nuevos:** `docs/VENDEVELOZ_LAUNCH_CHECKLIST.md` (~24 KB).
- **Modificados:** `docs/CURRENT_STATE.md` (header + nueva sección §11).
- **NO modificados:** ningún archivo de código (`src/**`), schema ni
  migraciones (`drizzle/**`), `.env.example`, `package.json`, `pnpm-lock.yaml`.
- **Commit único:** `docs: cerrar readiness técnico de Vende Veloz para
  campañas`. Working tree limpio.

---

## 12. Qué no hacer por defecto

---

## 11. Qué no hacer por defecto

- no reconstruir Vocero/Espacio Connect;
- no crear otro sender o webhook paralelo;
- no romper tenant isolation;
- no introducir dependencias externas no permitidas;
- no crear SaaS/billing/provisioning prematuro;
- no campañas masivas/analytics avanzado sin spec y necesidad real;
- no afirmar E2E verde si no se ejecutó.

---

## 13. Bootstrap feature 009 — Playbook Runtime Admin (este commit)

Abre `specs/009-playbook-runtime-admin/` para convertir la infraestructura de
la Feature 008 en **configuración comercial real de producción**: editar y
publicar pricing, oferta, política, writer y preguntas Jev **sin redeploy**.

**Este commit es solo bootstrap documental. Cero código productivo modificado y
el runtime intacto.**

### Qué ya resuelve la 008 (y esta feature NO reconstruye)

`sales_playbook` + `sales_playbook_version`, `ConfigV1` + Zod con guardarraíles
Jev, draft/validate/publish/rollback/historial, loader **sin cache**, bootstrap
multi-org, Laboratorio Published vs Draft, override restringido a `is_test`,
tenant isolation, auditoría de versión y fallback hardcodeado.

### Los tres cerr gaps

1. **Corte 1 — Editor técnico JSON.** La UI por formularios
   (`playbook-draft-editor.tsx`, `jev-questions-editor.tsx`) se sustituye por dos
   textareas JSON técnicos. La regla histórica *"NO JSON crudo"* queda
   **SUPERSEDED** para esa pestaña: su único usuario real es un administrador
   técnico. Sin dependencias nuevas (nada de Monaco/CodeMirror) y **sin tocar
   producción**.
2. **Corte 2 — Baseline comercial vigente.** La oferta en código es la anterior
   (`setup 497`, `monthlyBase 197`); la decisión vigente es **`0` + `S/247/mes`**,
   50 alumnos incluidos y `+S/1` desde el 51. **El runtime sigue apagado en todo
   este corte** y un test lo verifica. La estrategia de Jev V1 se expresa en el
   **bootstrap del playbook** (`v1.ts`), **no** en `questions.ts`, que está
   hash-frozen contra un blob upstream validado.
3. **Corte 3 — Runtime publicado.** Enciende
   `SALES_PLAYBOOK_RUNTIME_ENABLED` (`src/server/sales/build-state.ts:37`) para
   que las conversaciones reales consuman la **Published** de su organización.
   Aislado y reversible en una línea. **Este es el interruptor de producción.**

### Estado real en el código base

| Hecho | Ubicación |
|---|---|
| Interruptor en `false` | `src/server/sales/build-state.ts:37` |
| Loader sin cache | `src/lib/sales/playbook/loader.ts` |
| Override solo en `is_test` | `src/server/sales/orchestrator.ts:78` |
| Oferta vigente en código `497`/`197` | `src/server/sales/vende-veloz.ts` |
| Hueco ejecutable: `writer.ts` emitiría "S/0" con `setup = 0` | `src/server/sales/writer.ts:211` |
| `sales-launch-hardcoded.test.ts` **afirma hoy el congelamiento** | hay que invertirlo en el corte 3 |

### Cómo ejecutar

```bash
./scripts/ai/run-playbook-runtime-admin.sh            # desde el corte 1
START_CUT=2 ./scripts/ai/run-playbook-runtime-admin.sh  # reanudar
```

Logs en `.ai/logs/playbook-runtime-admin/`. Si un corte falla a mitad, **no
resetear ni descartar**: relanzar ese mismo corte en una sesión nueva y reanudar
con `START_CUT=N+1`.

### Done criteria

Los tres cortes verdes, un commit cada uno, árbol limpio, y **evidencia E2E de los
escenarios A–H** de `specs/009-playbook-runtime-admin/spec.md` §4 — incluido el
hot-switch y el rollback **sin redeploy**. **Sin esa evidencia no se dice READY.**

