# Auditoría base — Espacio Connect (multi-organización)

**Fecha:** 2026-08-12  
**Alcance:** solo lectura del código; sin cambios.  
**Objetivo inmediato:** un usuario (Max) con tres negocios independientes en **una** instalación.

---

## 1. Resumen ejecutivo

El **modelo de datos ya es multi-tenant real**: casi todas las tablas de dominio llevan `organization_id NOT NULL`, índices org-first, credenciales Meta 1:1 por organización, y el webhook enruta por `phone_number_id`.

La aplicación **opera hoy como single-organization a nivel de auth/UX**:

- El registro solo crea la **primera** organización de la instancia.
- `requireSession()` **ignora** `session.activeOrganizationId` y toma la **primera membresía** del usuario (`LIMIT 1`).
- No hay UI ni flujo de producto para listar/cambiar organizaciones.
- Varios módulos asumen explícitamente “una org por instancia” (`resolveInstanceOrg`, branding sin sesión).

**Veredicto:** **A** — multi-organización viable con cambios **pequeños**, reutilizando Better Auth + schema actual. No hace falta reescribir el CRM ni tres instancias.

---

## 2. Arquitectura real actual

| Área | Qué hay | Evidencia |
|---|---|---|
| **Stack** | Next.js 15 App Router, React 19, TS estricto, Tailwind (tema Atlas claro), PostgreSQL + Drizzle, Better Auth + plugin `organization`, pnpm, Vitest + E2E Playwright | `package.json`, `CLAUDE.md`, `next.config.ts` (`output: "standalone"` en no-Windows) |
| **Auth** | Email/password; plugin organization (`creatorRole: "owner"`); rate limit login/signup; registro público cerrado tras 1ª org | `src/lib/auth/index.ts` → `createAuth`; `src/server/auth/registration.ts` → `isPublicSignupAllowed` |
| **Sesión** | Tabla `session` con `activeOrganizationId`; al crear sesión se rellena, pero la app **no lo usa** después | `schema.session`; `databaseHooks.session.create`; `src/lib/auth/session.ts` → `requireSession` |
| **Orgs** | `organization`, `member`, `invitation`; alta inicial en `onUserCreated` (solo si `count(organization)=0`) | `src/lib/db/schema.ts`; `src/server/auth/on-signup.ts` |
| **Tenant helper** | `scoped(col, orgId, ...conds)` exige org no vacío | `src/lib/db/tenant.ts` |
| **WhatsApp** | Credenciales cifradas AES-GCM por org; wizard en settings; Graph client | `meta_credentials`; `src/server/whatsapp/credentials.ts`; `src/components/settings/whatsapp-wizard.tsx` |
| **Webhook** | URL única de instancia `/api/webhooks/wa/[META_WEBHOOK_VERIFY_TOKEN]`; routing por `phone_number_id` | `src/app/api/webhooks/wa/[webhookToken]/route.ts`; `processMessagesValue` en `ingest.ts` |
| **Inbox** | Contactos (`wa_identity`), conversaciones, mensajes, ventana 24h, send con sandbox test | `src/server/inbox/*` |
| **Pipeline** | Etapas + leads por org; seed en signup | `pipeline_stage`, `lead`; `SEED_STAGES` en `on-signup.ts` |
| **Agente IA** | `agent_profile` 1:1 org; KB; pipeline de turno con coalesce in-process; OpenRouter a nivel **instancia** (env) | `agent_profile`, `kb_entry`; `src/server/ai/pipeline.ts`; `.env.example` |
| **Plantillas** | Sync/envio Meta; unique `(org, name, language)` | `template`; `src/server/whatsapp/templates.ts` |
| **Branding** | Nombre + acento hex en `organization.metadata.branding` | `src/lib/branding.ts`; `src/server/branding.ts` |
| **Tiempo real** | SSE `/api/events`; bus `org:{organizationId}` | `src/app/api/events/route.ts`; `src/server/events/bus.ts` |
| **Media** | Disco local `MEDIA_DIR/{organizationId}/{assetId}` (sin S3) | `media_asset`; `mediaFilePath` en `src/server/whatsapp/media.ts` |
| **Lab** | Runs/casos por org; lock 1 run `running` por org | `agent_test_run`, `src/server/lab/runner.ts` |
| **Bot externo** | `/api/bot/*` + `BOT_API_KEY`; org resuelta como **primera de la instancia** (cache) | `src/server/bot/auth.ts` → `resolveInstanceOrg` |
| **Testing** | Unit Vitest; E2E `pnpm test:e2e` + mocks wa/ai | `tests/`, `scripts/e2e-selftest.mjs` |

Contradicción doc↔código: la constitución dice “una instancia = un negocio” **y** “modelo multi-tenant real para no cerrar evoluciones” (`.specify/memory/constitution.md` III). El código de dominio ya es multi-tenant; el producto UX/auth aún no.

---

## 3. Estado real del multi-tenancy

### 3.1 Datos: listo

Tablas de dominio con `organization_id` + FK a `organization` + índices org-first:

`contact`, `pipeline_stage`, `lead`, `conversation`, `message`, `media_asset`, `meta_credentials`, `agent_profile`, `kb_entry`, `template`, `agent_test_run`, `agent_test_case`.

Uniques relevantes (bien diseñados para multi-org):

| Unique | Significado |
|---|---|
| `contact_org_wa_identity_uq` | Mismo WA identity puede existir en orgs distintas |
| `meta_credentials_org_uq` | Una conexión WA por org |
| `meta_credentials_phone_uq` | `phone_number_id` **único en toda la instancia** (routing webhook) |
| `agent_profile_org_uq` | Un perfil de agente por org |
| `template_org_name_lang_uq` | Plantillas por org |
| `test_run_org_running_uq` | Un lab run activo por org |
| `message.wa_message_id` UNIQUE **global** | Idempotencia webhook (IDs Meta son globales; OK en la práctica) |

### 3.2 Auth plugin: presente, infrautilizado

- Server: `plugins: [organization({ creatorRole: "owner" })]` — `src/lib/auth/index.ts`
- Client: `organizationClient()` — `src/lib/auth/client.ts`
- **Ningún** uso de `authClient.organization.setActive` / create / list en UI de producto

### 3.3 Sesión activa: campo existe, resolución la anula

```ts
// src/lib/auth/session.ts — requireSession
const membership = await resolveMembership(session.user.id);
// → organizationId: membership.organizationId  (NO session.activeOrganizationId)
```

```ts
// src/server/auth/on-signup.ts — resolveMembership
.where(eq(schema.member.userId, userId)).limit(1)  // sin ORDER BY → no determinista si hay >1
```

`activeOrganizationId` solo se escribe en `session.create` hook; nunca se lee en la app.

### 3.4 APIs de producto: en general bien scoped

Patrón dominante: `withAuth` → `session.organizationId` → `scoped(...)` o `eq(...organizationId, ...)`.

Ejemplos correctos: inbox (`queries.ts`), media (`/api/media/[assetId]`), team, kb, pipeline board, SSE subscribe por org.

### 3.5 Supuestos hard-coded de single-org

| Sitio | Comportamiento |
|---|---|
| `onUserCreated` | Solo crea org si no existe ninguna |
| `isPublicSignupAllowed` | Cierra registro si `count(org) > 0` (salvo `ALLOW_SIGNUP`) |
| `resolveInstanceOrg` | Cachea `organization.limit(1)` — **rompe** multi-org para `/api/bot/*` |
| `getBranding()` sin org | `organization.limit(1)` — login/metadata de la “primera” org |
| Root layout | Usa branding sin sesión → primera org |

### 3.6 Schema gaps menores

- `member`: **sin** unique `(user_id, organization_id)` (el POST de team usa `onConflictDoNothing()` sin target útil).
- `meta_credentials.waba_id`: **no** unique; `getCredentialsByWabaId` hace `limit(1)` → riesgo si dos orgs comparten el mismo WABA (eventos de plantilla).

---

## 4. Bloqueos actuales para multi-organización

> ¿Qué impide que un usuario tenga y cambie entre Vende Veloz, Espacio Veloz y Max Quispe en esta instalación?

| Bloqueo | Tipo | Detalle |
|---|---|---|
| No hay selector de organización en UI | **solo UX** | `AppNav` muestra branding de la org de sesión; sin switcher |
| `requireSession` / `resolveMembership` ignoran org activa | **auth/sesión** | Siempre 1ª membresía |
| No hay flujo producto para crear orgs 2 y 3 | **auth/sesión + UX** | Signup solo 1ª org; Better Auth plugin no expuesto |
| `activeOrganizationId` no se actualiza al “cambiar” | **auth/sesión** | Campo listo; falta setActive + persistencia |
| `resolveInstanceOrg` cachea org única | **backend** | Solo afecta `/api/bot/*` (si se usa) |
| Branding sin sesión = primera org | **backend / UX** | Cosmético en login |
| Tres números WA + mismos webhook/env | **WhatsApp** (operativo, no código) | Código ya enruta por `phone_number_id`; hay que conectar 3 números distintos |
| Shared `OPENROUTER_*`, `ENCRYPTION_KEY`, verify token | **arquitectura** (aceptable) | Instancia compartida; perfil/KB/creds WA sí por org |
| Constitución/docs “1 instancia = 1 negocio” | **deuda documental** | No bloquea código |

**No es bloqueo de BD:** el schema ya soporta tres orgs con datos aislados.  
**No es bloqueo de webhook de mensajes:** ya resuelve org vía `getCredentialsByPhoneNumberId`.

---

## 5. Cambio mínimo recomendado

### Idea de producto

```text
Usuario: Max Quispe
Organización activa: [ Vende Veloz ▼ ]
  → Espacio Veloz
  → Max Quispe
```

Al cambiar: refetch de toda la app (inbox, pipeline, settings, SSE reconecta con nueva org de sesión).

### Diseño mínimo (sin reescribir)

1. **Crear orgs** (script one-shot o acción owner): insert `organization` + `member` (owner) + seed `pipeline_stage` + `agent_profile` (reutilizar lógica de `onUserCreated` extrayendo helper).
2. **Resolver sesión por `activeOrganizationId`**, validando membresía; fallback a primera membresía si null/inválido.
3. **Cambiar org activa** con Better Auth (`organization.setActive` / update session) o endpoint propio que actualice `session.active_organization_id`.
4. **UI switcher** en `AppNav` (lista membresías del usuario).
5. **Tras switch:** `router.refresh()` + clientes que refetch; SSE ya usa `requireSession` → se reabre con nueva org.
6. **Arreglar** `resolveInstanceOrg` (header `X-Organization-Id` o deprecar cache) **solo si** usas `/api/bot/*`.
7. **Opcional duro:** unique `(user_id, organization_id)` en `member` (migración pequeña).

### ¿Migración?

- **Funcionalidad core:** puede hacerse **sin** migración (columnas ya existen).
- **Recomendada:** unique en `member(user_id, organization_id)`.
- **No necesaria** para pipeline/KB/agente/WA: ya son 1:1 o N:1 por org.

### Reutilizar Better Auth

Sí. Plugin server + client ya cargados. Preferible `setActive` del plugin para no inventar sesión paralela.

### Cómo evitar fuga de datos

- Toda query de UI/API sigue pasando por `requireSession()` corregido → `organizationId` correcto.
- Webhook sigue anclado a credenciales, no a sesión de usuario.
- Media path ya namespaced por org.
- SSE canal `org:{id}`.
- Tras switch, no reutilizar estado cliente de otra org (refresh completo).

### WhatsApp por org

- Cada org: su fila `meta_credentials` (WABA + `phone_number_id` + token cifrado).
- Constraint: `phone_number_id` único en la instancia → tres números = tres orgs OK.
- Webhook **único** de instancia; Meta puede apuntar los tres números/WABAs a la misma URL (mismo `META_WEBHOOK_VERIFY_TOKEN`).
- Routing: `metadata.phone_number_id` → `getCredentialsByPhoneNumberId` → `organizationId` → ingest.

### Agente / pipeline / KB con schema actual

**Sí, cada org ya tiene los suyos** (`agent_profile_org_uq`, stages/leads/kb por `organization_id`). El modelo LLM (`OPENROUTER_*`) es compartido a nivel proceso: suficiente para operación personal; no es aislamiento de billing LLM.

### Complejidad

**Pequeña** (borde a media solo si se endurece bot API + plantillas multi-WABA + migración member).

Por qué no trivial: hay que tocar el camino crítico de sesión y probar aislamiento.  
Por qué no grande: no hay que remodelar schema ni WhatsApp ni inbox.

---

## 6. Archivos involucrados

### Tocar (mínimo)

| Archivo | Qué |
|---|---|
| `src/lib/auth/session.ts` | Respetar `activeOrganizationId` + validar membership |
| `src/server/auth/on-signup.ts` | `resolveMembership(userId, orgId?)`; extraer `seedOrganization` |
| `src/lib/auth/index.ts` | Hook session: no pisar active si ya válida; alinear con plugin |
| `src/lib/auth/client.ts` | Export helpers organization del client |
| `src/components/app-nav.tsx` | Switcher de org |
| Nuevo: API o server action “list my orgs / set active” | Si no se usa 100% el plugin HTTP |
| Script/admin create-org | Crear las 2 orgs restantes + memberships |
| `src/server/bot/auth.ts` | Solo si usas bot externo |

### Probablemente NO tocar

- `src/server/inbox/ingest.ts` / webhook (routing ya correcto)
- Schema de contact/conversation/message (salvo unique member)
- `src/server/ai/pipeline.ts` (ya toma org de la conversación)
- `src/server/events/bus.ts`
- `src/server/whatsapp/media.ts` (paths por org)
- Infra Ploi/Docker/Caddy
- Laboratorio (ya por org), salvo tests E2E que asuman 1 org

---

## 7. Riesgos de aislamiento

| Riesgo | Severidad | Notas |
|---|---|---|
| Sesión siempre 1ª membership | **Alta (hoy)** | Impide multi-org aunque existan filas |
| `resolveInstanceOrg` cache | **Alta si usas bot** | Todas las llamadas bot van a org #1 |
| `getCredentialsByWabaId` → `limit(1)` | **Media** | Template status mal enrutado si 2 orgs / mismo WABA |
| `wa_message_id` UNIQUE global | Baja | Colisión teórica entre orgs; IDs Meta globales |
| Branding/`generateMetadata` sin sesión | Baja | Login muestra marca de org arbitraria |
| Caches in-process (`__agentCoalesce`, bus, rate-limit, auth) | Baja para multi-org | Keys por conversationId / org channel; OK en un proceso PM2 |
| `OPENROUTER_*` / `BOT_API_KEY` / webhook token compartidos | Aceptable | No son datos de negocio; son de instancia |
| Queries por id sin scoped | Revisar al implementar | La mayoría de routes autenticadas ya combinan scoped+id; el agente carga conversación por id y deriva org (OK server-side) |
| E2E asume 1 org | Media en QA | Extender harness al verificar switch |
| `member` sin unique (user, org) | Baja | Duplicados posibles |

No se halló cache global de “datos de negocio” mezclando orgs más allá de los supuestos single-org citados.

---

## 8. WhatsApp y routing multi-organización

```text
Meta → POST /api/webhooks/wa/{META_WEBHOOK_VERIFY_TOKEN}
     → processMessagesValue / processEchoesValue
     → phone_number_id = value.metadata.phone_number_id
     → getCredentialsByPhoneNumberId(phoneNumberId)
     → credentials.organizationId
     → contact/conversation/message scoped a esa org
```

- **Una URL de webhook por instalación** (env), no por org — correcto para 3 negocios en la misma app Meta o varias apps con el mismo verify token/URL.
- **Una conexión guardada por org** (`meta_credentials_org_uq`).
- **Un `phone_number_id` no puede pertenecer a dos orgs**.
- Envío saliente: `getCredentialsByOrg(session.organizationId)` en send path.
- Plantillas sync/send: por org; eventos de estado de plantilla: por WABA (punto débil si WABA compartido).

Operación para tres negocios: tres números Business distintos, tres wizards (uno por org activa), mismo webhook.

---

## 9. Branding / dark mode

**Existe hoy**

- White-label: `Branding { name, accent }` en `organization.metadata`.
- CSS vars `--accent*` inyectadas SSR (`accentCssVariables`).
- Tema **Atlas solo claro** (`src/app/globals.css`: `--bg #fff`, etc.).
- Tailwind mapea tokens semánticos a esas vars (`tailwind.config.ts`).
- UI settings: `src/components/settings/branding-client.tsx`.
- Default name: `"Vocero"` (`DEFAULT_BRANDING`).
- Sin `dark:`, sin `prefers-color-scheme`, sin theme provider.

**Para “Espacio Connect” + dark mode después**

- Renombrar default / branding de org shell: cambio **poco invasivo**.
- Dark mode real: definir segundo set de tokens (o `.dark` en `:root`) — **medio** en superficie (muchas pantallas usan `bg-background`, `text-text-2`, etc.; si se respetan tokens, el alcance es globals + QA visual; si hay hex hardcodeados, más trabajo).
- Textos “Vocero” puntuales en copy (`contact-panel`, placeholders) — cleanup superficial.

Prioridad actual: no bloquear multi-org; branding puede seguir por organización.

---

## 10. Deploy Ploi actual

El código **no exige Docker**. Exige:

| Requisito | Origen |
|---|---|
| Node ≥ 20 | `package.json` engines |
| `pnpm build` → artefacto **standalone** (Linux) | `next.config.ts` `output: "standalone"` |
| Arranque típico: `node server.js` desde `.next/standalone` (+ `.next/static`, `public`) | Convive con Dockerfile; en Ploi equivalente manual |
| `DATABASE_URL` PostgreSQL | `.env.example` |
| Migraciones aplicadas (`pnpm db:migrate` o `scripts/migrate.mjs`) | Docker las corre al boot; **en Ploi hay que seguir aplicándolas en deploy** |
| Env runtime: `APP_BASE_URL`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `META_WEBHOOK_VERIFY_TOKEN`, opcional Meta/AI/bot, `MEDIA_DIR` persistente | `.env.example` |
| Health: `GET /api/health` | Usado en Docker HEALTHCHECK |
| Un proceso Node (PM2): SSE + agente in-process viven en ese proceso | Sin colas externas |
| Disco persistente para `MEDIA_DIR` | Constitución / media |

**Conservar en futuros cambios:** standalone build, migraciones versionadas en `drizzle/`, env en runtime (no bake), MEDIA_DIR fuera del deploy efímero, un solo proceso o sticky session si algún día hay >1 instancia (hoy el bus SSE es in-memory).

No migrar a Docker en esta fase.

---

## 11. Deuda técnica relevante

- Producto documentado como “1 negocio/instancia” vs schema multi-tenant.
- `activeOrganizationId` dead-letter.
- `resolveMembership` no determinista con N memberships.
- Bot API single-org.
- Template events por WABA ambiguo.
- `member` sin unique compuesto.
- E2E/tests orientados a una org.
- Copy/defaults “Vocero”.

---

## 12. Qué NO tocar

- Reescribir inbox, webhook, cifrado de tokens, Graph client.
- Introducir S3/Redis/colas (constitución).
- Separar microservicios.
- Refactor masivo a “SaaS multi-customer público”.
- Cambiar modelo de identidad WA (`wa_identity` / BSUID).
- Dark mode / rebrand completo **antes** del switcher de org.
- Tres bases de datos o tres deploys (innecesario dado el schema).

Prioridad: velocidad operativa con aislamiento correcto, no pureza arquitectónica.

---

## 13. Plan recomendado por fases

### Fase 0 — Preparación (sin UX)
1. Decumentar las 3 orgs objetivo y sus `phone_number_id` previstos.
2. Extraer `seedOrganization(name, slug, ownerUserId)` desde `on-signup`.
3. Crear orgs 2–3 + memberships owner (script); seed pipeline + agent_profile.
4. Corregir `requireSession` para respetar `activeOrganizationId`.

### Fase 1 — Switcher mínimo
5. Listar orgs del usuario + `setActive` (Better Auth o endpoint).
6. Switcher en `AppNav` + `router.refresh()`.
7. Verificar: inbox/pipeline/settings/WA/KB distintos por org; SSE no mezcla.

### Fase 2 — WhatsApp real
8. Conectar cada número en el wizard con la org activa correspondiente.
9. Confirmar webhook único recibe y enruta a la org correcta.
10. Probar in/out/imagen por cada negocio.

### Fase 3 — Endurecer (opcional)
11. Unique `member(user_id, organization_id)`.
12. Bot API multi-org si aplica.
13. Template events multi-WABA (update por `organization_id` de todas las creds con ese WABA, o unique WABA).
14. Ajustar E2E.
15. Rebrand “Espacio Connect” / dark mode cuando multi-org esté estable.

---

## Veredicto

**A.** Podemos convertir esta instancia en multi-organización con cambios pequeños.

El aislamiento de datos, WhatsApp por org, SSE, media, agente, KB y pipeline **ya están**. Falta sobre todo: **resolver y cambiar la organización activa**, **crear las orgs adicionales**, y un **switcher UX**.

### Cambios mínimos necesarios

1. Helper de creación/seed de organización reutilizable.
2. Crear las dos organizaciones faltantes + membership del owner.
3. Hacer que `requireSession` use `session.activeOrganizationId` validado contra `member`.
4. Endpoint/flujo Better Auth para listar membresías y `setActive`.
5. Switcher en la navegación + refresh de cliente/SSE.
6. (Si aplica) dejar de cachear una sola org en `/api/bot/*`.
7. Prueba manual de aislamiento en los tres negocios + tres WhatsApp.
8. (Recomendado) migración unique `(user_id, organization_id)` en `member`.

### Archivos críticos

| Archivo | Responsabilidad | Por qué importa |
|---|---|---|
| `src/lib/auth/session.ts` | Contexto org de toda la API/UI | Hoy anula multi-org |
| `src/server/auth/on-signup.ts` | Membership + seed 1ª org | Fuente de verdad rota (`limit 1`) |
| `src/lib/db/schema.ts` | Modelo tenant + uniques WA | Ya habilita 3 negocios |
| `src/server/whatsapp/credentials.ts` | Creds + routing `phone_number_id` | Aislamiento WA |
| `src/server/inbox/ingest.ts` | Webhook → org | Ya multi-org |
| `src/server/events/bus.ts` | SSE por org | Evita mezcla en tiempo real |
| `src/components/app-nav.tsx` | Shell app | Donde vive el switcher |
| `src/server/bot/auth.ts` | Org del bot externo | Singleton peligroso |
| `src/server/branding.ts` | Marca por org | Fallback single-org en login |
| `src/lib/db/tenant.ts` | `scoped()` | Contrato de aislamiento |

### Preguntas realmente bloqueantes

1. ¿Los tres negocios usarán **tres `phone_number_id` distintos** (y preferiblemente WABAs separados), o se pretende compartir un mismo número/WABA? (Esto define el riesgo de `getCredentialsByWabaId`.)
2. ¿Se usa hoy `/api/bot/*` con `BOT_API_KEY` en producción, o solo el agente in-process?
3. ¿Las tres orgs deben compartir el mismo usuario owner (Max) desde el día 1, o también cuentas de equipo distintas por negocio?
4. En el deploy Ploi actual: ¿las migraciones se aplican en cada release (`db:migrate` / `migrate.mjs`), y `MEDIA_DIR` apunta a disco persistente fuera del release?
)
