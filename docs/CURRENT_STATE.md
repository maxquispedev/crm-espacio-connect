# CURRENT STATE — Espacio Connect

**Actualizado:** 2026-09-29 (sync técnico tras spec 004 polish)
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
- `specs/004-inbox-messaging-ux/` (cola de adjuntos del composer + UX polish)

Trabajo posterior documentado antes de exigir Spec Kit completo:

- WHMCS: código + tests + contexto histórico.
- Sales Orchestrator: `docs/SALES_ORCHESTRATOR.md`.
- Follow-ups: `docs/SALES_FOLLOW_UPS.md`.

No crear specs retroactivos falsos solo para "cumplir". **Desde el próximo
cambio observable**, abrir un nuevo `specs/NNN-...` y mantener `tasks.md`
como estado durable.

### Estado del spec 004

Implementado a través de commits atómicos `0 → 1 → 2 → 2a → 2b`:

- Commit 0 (`275f457`): docs SDD (spec/plan/tasks).
- Commit 1 (`b3cc38f`): cola de adjuntos, helpers puros, componentes
  presentacionales, drag&drop/paste, submitQueue, retry, a11y base.
- Commit 2a (`de12265`): bucle de envío `runQueueSend`, anti-doble-envío,
  retry por adjunto, confirmación explícita video→document, override
  tipado `kind=document` server-side.
- Commit 2b (este checkpoint): corte final de UX/pulido — header de
  cola con conteo inline, `clearSent`, `summarize`+`progressLabel`,
  navegación por teclado (←/→, Delete/Backspace, Esc), drop overlay
  animado con conteo, indicadores de estado con texto explícito,
  toolbar buttons ≥ 44 px, auto-focus textarea, `aria-current`.

**Verificación actual:**

| Gate | Estado |
|---|---|
| `pnpm typecheck` | verde |
| `pnpm lint` | verde |
| `pnpm build` | verde |
| `pnpm test` | verde — **500 tests** (488 baseline + 12 nuevos: 4 `clearSent`, 3 `summarize`, 5 `progressLabel`) |
| `pnpm test:e2e` (sección 009) | **PENDIENTE en este entorno** — sin app local ni PostgreSQL activa |
| Playwright visual `tests/e2e/009-inbox-messaging-ux.md` | **PENDIENTE en este entorno** |
| Sección 008 (regresión spec 003 cerrado) | pendiente de re-correr con la app levantada |

El spec 004 está **verificado unitariamente punta a punta** pero **NO
verificado en vivo punta a punta** hasta correr `pnpm test:e2e` local y
re-correr la sección 008 para regresión. Por Constitución IX no debe
reportarse como READY punta a punta hasta entonces.

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

---

## 10. Próximo checkpoint recomendado

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
