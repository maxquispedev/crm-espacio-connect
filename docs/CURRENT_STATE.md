# CURRENT STATE — Espacio Connect

**Actualizado:** 2026-09-29 (spec 005 abierto + checkpoint técnico de evolución multi-campaña del Sales Orchestrator)
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
3. correr Playwright visual con `tests/e2e/009-inbox-messaging-ux.md`;
4. registrar evidencia en el doc correspondiente y aquí;
5. para cualquier comportamiento nuevo, abrir el siguiente spec numerado;
6. mantener commits atómicos y actualizar `tasks.md` al cerrar cada corte.

---

## 11. Qué no hacer por defecto

- no reconstruir Vocero/Espacio Connect;
- no crear otro sender o webhook paralelo;
- no romper tenant isolation;
- no introducir dependencias externas no permitidas;
- no crear SaaS/billing/provisioning prematuro;
- no campañas masivas/analytics avanzado sin spec y necesidad real;
- no afirmar E2E verde si no se ejecutó.
