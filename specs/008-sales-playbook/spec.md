# 008 — Sales Playbook versionado

**Branch**: `008-sales-playbook` · **Carril**: ciclo completo (Principio VI) ·
**Fecha de apertura**: 2026-09-30

> Convierte la estrategia comercial de Vende Veloz —hoy congelada en
> TypeScript en `src/server/sales/vende-veloz.ts` y `src/server/sales/questions.ts`—
> en **configuración durable, versionada, tenant-safe y editable sin redeploy**.
> El motor de Sales Orchestrator / Jev / Writer / Follow-ups deja de ser el
> "dueño del qué decir" y se queda con el "cómo decidir y redactar".

## Origen y motivación

La estrategia comercial de Vende Veloz es **iterativa por naturaleza**:
producción → conversaciones reales → evidencia → aprendizaje → modificar
estrategia → probar regresión → publicar → nueva producción. Hoy, cada cambio
estratégico (una pregunta nueva de Jev, un criterio más estricto, una
instrucción distinta del writer, un cambio en la oferta, una prioridad que
sube o baja) **requiere redeploy**. Eso está mal.

Lo que el operador quiere tocar cada semana:

- el **producto** (quién es, qué hace, qué no);
- el **posicionamiento** y la **promesa**;
- la **oferta** y el **pricing**;
- las **prioridades** comerciales (qué dolor liderar);
- las **prohibiciones** (qué jamás prometer);
- la **política comercial** (automático vs handoff vs descalificar);
- las **preguntas y criterios** de Jev;
- las **instrucciones del writer** por `next_action`;
- la **política de handoff** por lane.

Lo que NO se quiere tocar cada semana (sigue siendo código, no
configuración):

- el cliente HTTP de TypeSafe/Jev;
- la sanitización de respuestas del proveedor;
- el resolver determinístico;
- los lanes, sus efectos y el `moveLeadStage`;
- el pipeline de mensajes;
- el worker de follow-ups;
- el envío a WhatsApp;
- la captura del `ad_attribution`;
- la emisión CAPI.

## Principio arquitectónico

**Tres capas, separadas de verdad**:

1. **Motor (código)** — el "cómo decidir". Tipos, normalización, resolver,
   lanes, writer de WhatsApp, follow-ups engine, guardarraíles. Tiene
   *contratos* (`SalesPlaybookConfig` versionado por `schema_version`) y
   *adaptadores* para leer la config actual del runtime.
2. **Playbook (configuración versionada)** — el "qué decir". Producto,
   posicionamiento, promesa, oferta, pricing, prioridades, prohibiciones,
   política, preguntas de Jev, criterios, instrucciones del writer, política
   de handoff, contexto temporal. Por organización, versionada, con
   draft/publish/rollback.
3. **Knowledge base (hechos)** — lo concreto del negocio. NO es estrategia.
   El agente lo usa como referencia factual; Jev no decide con KB.

El runtime SIEMPRE consume una **versión publicada**. Si una organización no
tiene playbook publicado, el motor cae a un fallback explícito, y ese caso
queda visible y debe corregirse (no es el modo permanente).

## Lo que ya está (no se repite)

- **Sales Orchestrator (Jev)**: cliente TypeSafe, normalización, build-state,
  resolver (`resolveSalesPlan`), lanes, writer, follow-ups, persistencia y
  reporte de decisiones. El motor está cerrado y congelado.
- **Agent Profile**: ya guarda `name`, `tone`, `instructions`,
  `escalationRules`, `greeting` (más flags `salesOrchestratorEnabled` /
  `salesFollowUpsEnabled`). Esos campos **no se duplican** en el playbook:
  son del agente y deben llegar al writer comercial como contexto de estilo.
- **Stage Gateway (007)**: la única puerta que cambia `lead.stageId`. El
  playbook no la toca.
- **CAPI (007)**: el reporte de QualifiedLead/Purchase. No se toca.
- **Laboratorio existente**: 6 personas ferreteras, judge heurístico,
  runner in-memory. Se **evoluciona**, no se reescribe.
- **Migraciones Drizzle re-ejecutables** (`0000`..`0007`): patrón
  `IF NOT EXISTS` + `DO $$ … EXCEPTION WHEN duplicate_object THEN null $$`.

## Concepto durable

### `sales_playbook`

Un playbook por organización en V1. La forma está **preparada** para
múltiples playbooks/campañas en el futuro (slug + label + estado) sin
implementar un gestor multicampaña. En V1: 1 fila por `organization_id`.

### `sales_playbook_version`

Cada cambio material se materializa en una **versión** inmutable con un
`version_number` autoincremental por playbook. Estados:

| Estado | Reglas |
|---|---|
| `draft` | Una sola activa por playbook (índice parcial UNIQUE). Editable. |
| `published` | Una sola activa por playbook (índice parcial UNIQUE). Inmutable. El runtime la consume. |
| `archived` | Versión previamente publicada que se "durmió" al publicar una nueva. Conserva valor histórico. |

Reglas duras:

- `version_number` único por `playbook_id`.
- Al publicar: la versión publicada anterior pasa a `archived` automáticamente
  dentro de la misma transacción.
- Al hacer rollback: se republica la versión elegida y la publicada actual
  pasa a `archived`. El contenido en sí no se modifica (las versiones son
  inmutables).
- No se permite editar una `published`. Para cambiar, se crea un nuevo
  `draft` desde la publicada actual o se duplica cualquier versión histórica.
- El `config_json` viaja con un `schema_version` (string semver) para que el
  motor pueda migrar o rechazar configs antiguas.

### Trazabilidad

- Cada decisión de Jev persiste en `lead.last_jev_decision` un snapshot que
  incluye `playbook_version_id` y `playbook_schema_version`. Eso permite
  reconstruir **qué estrategia** atendió esa conversación aunque el playbook
  haya cambiado después.
- Cada corrida del Laboratorio guarda `playbook_version_id` por caso para
  que la comparación Published vs Draft sea limpia.
- El estado Jev (`buildJevSalesState`) carga la versión publicada al
  construir el `product` y `commercial_policy` que viajan a Jev. **Jev nunca
  ve el draft**: si solo hay draft, el estado se rechaza (no degradar a un
  estado ambiguo en producción).

## Contrato funcional (negocio)

### A) Producto y posicionamiento

Campos editables: `name`, `one_liner`, `who_it_is_for`, `core_jobs`,
`not_the_product`, `how_it_starts`. Limites de tamaño coherentes con el
estado actual (ver `VENDE_VELOZ_PRODUCT`).

### B) Oferta y pricing

Campos editables: `currency`, `setup`, `setupIsOneTime`, `monthlyBase`,
`includedActiveStudents`, `extraPerActiveStudent`, `implementation.purpose`,
`implementation.includes`, `neverPromise`. Tipos numéricos validados;
`setup` y `monthlyBase` enteros ≥ 0; `includedActiveStudents` ≥ 1;
`neverPromise` lista no vacía.

### C) Política comercial

Campos editables como objeto:
- `defaultChannel` (enum cerrado);
- `goal` (texto);
- `automationFirst`, `autoClose`, `humanHandoff`, `futureInterest`,
  `noResponse`, `disqualification`, `evidenceRule` (cada uno texto medio
  largo, ≤ 800 chars).

### D) Prioridades comerciales

Tres listas ordenadas:

- `priorities.primary` (1–8 items);
- `priorities.secondary` (0–8 items);
- `priorities.tertiary` (0–8 items).

Cada item ≤ 200 chars. El writer las usa para **frasear** el ángulo
(`mainValueProposition`), no para puntuar: la decisión puntual sigue siendo
de Jev.

### E) Writer por `next_action`

Para cada uno de los 7 `next_action` (`ask_more_questions`,
`show_operations_demo`, `show_online_enrollment_demo`, `present_price`,
`schedule_call`, `schedule_follow_up`, `disqualify`) un bloque de texto
instructivo. Texto ≤ 1500 chars. Si el editor no pone nada, el motor usa un
fallback interno (las instrucciones actuales) y queda visible como
"heredado del default" en la UI.

### F) Jev — preguntas y criterios

El motor exige que existan —en cualquier versión válida— las preguntas
estructurales:

| key | type | rol |
|---|---|---|
| `next_action` | `choice` | requerido por el resolver |
| `needs_human_call` | `noul` | requerido por el resolver |

Estas dos:

- **son editables** en `instructions` y `criteria`;
- **no pueden cambiar de `type`**;
- **no pueden cambiar de `key`**;
- **no pueden eliminarse**.

Las demás (`real_operational_need`, `product_fit`, `motivation_to_change`,
`purchase_intent`, `buying_timing`, `main_value_proposition`):

- son **requeridas** en la V1 (el motor las emite al Jev provider);
- su `instructions` y `criteria` son editables;
- su `type` **no puede cambiarse**;
- su `key` no puede cambiarse;
- se pueden **desactivar** (`enabled: false`) para que el motor las omita
  del state — pero solo si las estructurales siguen activas.

Adicionalmente el editor puede crear **preguntas analíticas flexibles** (tipo
`noul`/`choice`/`score`) con `key` libre, `enabled` toggle, `order`,
`instructions` y `criteria`. Esas preguntas **no alimentan** al motor
(puremente observacionales); no cuentan para `next_action` ni
`needs_human_call`. Sirven para que la organización mida cosas sin tocar el
contrato productivo.

### G) Prohibiciones

- `neverPromise` ya viene del bloque de oferta.
- `prohibitedClaims` adicional: lista libre de cosas que el writer tiene
  prohibido afirmar (ej. "ROI", "generamos alumnos"). Cada item ≤ 200 chars.

### H) Contexto temporal / estacionalidad

- `urgencyRules`: texto libre (≤ 1000 chars) sobre cuándo corresponde
  activar tono de "temporada alta" en función del contexto del prospecto.
  Default conservador: no inventar urgencia.

### I) Handoff policy por lane

- `handoffByLane`: objeto `{ auto: string, auto_close: string, human:
  string, wait: string, stop: string }`. Cada valor ≤ 500 chars y describe
  cuándo la lane deriva a humano. Si vacío, el motor usa su default interno.

## Fuera de alcance (no entra en este spec)

- Reescribir el motor (resolver, lanes, persistencia, sender).
- Campañas múltiples, gestor de campañas, asignación de playbook por
  conversación. La V1 admite multi-playbook estructuralmente, pero **no
  expone UI ni runtime** para elegir.
- Marketing API, CAPI, automatización de pauta.
- Constructor visual de workflows ("Zapier interno").
- Importar los 89 checkpoints históricos de `jevveloz` como dataset del
  Laboratorio. Se deja previsto el camino (importador) pero no se ejecuta
  en este spec — pertenece a un corte posterior si la evidencia lo justifica.

## Plan por cortes

Siete cortes, gate técnico + self-test (mocks) verde al final de cada uno.
Working tree limpio, un commit por corte.

- **Corte 1 — Modelo y persistencia.** Drizzle schema + migración
  re-ejecutable + tipos Zod del config + bootstrap idempotente que crea la
  V1 ("Vende Veloz 365 — Academia Bajo Control") para la organización que
  ya tiene `salesOrchestratorEnabled` encendido. Tests del esquema y del
  bootstrap. **Sin tocar runtime productivo.**
- **Corte 2 — API + versionado.** Endpoints tenant-safe para leer,
  crear draft, actualizar, validar, publicar, rollback y listar versiones.
  Validación estricta (Zod) en server-side. Tests de endpoints cubriendo
  tenant isolation, draft único, published único, rollback, schema
  incompatible rechazado.
- **Corte 3 — Runtime.** `buildJevSalesState` carga la versión publicada y
  reemplaza los `VENDE_VELOZ_PRODUCT` / `VENDE_VELOZ_COMMERCIAL_POLICY`
  congelados. Writer y follow-up writer aceptan override; el orquestador
  resuelve y pasa. Agent Profile `tone` / `instructions` / `escalationRules`
  llegan al writer comercial. Fallback explícito al hardcode mientras no
  exista published. Snapshot de versión persistido en
  `lead.last_jev_playbook_version_id` y en el snapshot de decisión.
  Regresión completa del Sales Orchestrator.
- **Corte 4 — UI Playbook.** Evolución de `agent-client.tsx` con sección
  "Sales Playbook". Pestañas o bloques por bloque funcional: publicado,
  draft, prioridades, oferta, política, writer, handoff. Botones para
  crear draft, validar, publicar, rollback. Versión visible.
- **Corte 5 — Editor Jev avanzado.** Editor de preguntas estructurales y
  analíticas, con guardarraíles (key/tipo estructurales protegidos;
  analíticas flexibles). Reordenar, desactivar, añadir, duplicar.
- **Corte 6 — Laboratorio comercial.** Ejecución del pipeline real
  (conversation sandbox → Jev → resolver → writer → efectos sandbox) sin
  WhatsApp real. Expected outcomes humanos por caso. Comparación
  Published vs Draft. Persistencia de `playbook_version_id` por caso.
- **Corte 7 — Casos reales + bootstrap final + auditoría.** UI "Guardar
  conversación como caso" con minimización de PII. Confirmación de la V1
  "Academia Bajo Control" publicada. Decisión explícita sobre el fallback
  (retirar o documentar). E2E (Playwright + mocks). Documentación
  actualizada. Cierre.

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| **I. Seguridad** | El config nunca contiene secretos. Validación de tamaño/forma en runtime con Zod (rechaza payloads abusivos antes de tocar BD). En el flujo "guardar conversación como caso" se minimiza PII (no se exporta phone, email ni wa_identity por defecto). |
| **II. Soberanía** | Cero dependencias nuevas. La capa de persistencia es la misma Drizzle + PostgreSQL del repo. El editor es UI propia. No entra ningún proveedor externo. |
| **III. Multi-tenancy** | `organization_id NOT NULL` en `sales_playbook` y `sales_playbook_version`; todo acceso por `scoped()`; UNIQUE por organización. La V1 asume 1 playbook por org pero la forma lo permite multi. |
| **IV. Idempotencia** | Índices parciales UNIQUE en (`draft`/`published` por `playbook_id`) más UNIQUE(`playbook_id`, `version_number`). Migración re-ejecutable (mismo patrón que 007). Bootstrap idempotente. |
| **V. Calidad verificable** | Gate técnico + unit tests para schema/Zod/pure helpers + tests de integración del runtime con el snapshot del playbook + E2E (Playwright + mocks) en cada corte que toque UI. |
| **VI. Specs antes de código** | Este spec + plan + tasks preceden al código. |
| **VII. Trazabilidad** | `playbook_version_id` y `playbook_schema_version` en cada decisión Jev persistida y en cada caso del Laboratorio. Documentación de decisiones no obvias en `docs/playbook.md`. |
| **VIII. Foco vertical** | El playbook es un documento versionado con editor; no un constructor de workflows. Los 7 `next_action` son los del motor; no se añade una categoría "trigger custom". |
| **IX. Verificación en vivo** | Self-test por corte. El Corte 7 corre la suite E2E con mocks (`WA_MOCK_ENABLED`, `OPENROUTER_BASE_URL` → mocks) y verifica Published vs Draft en el Laboratorio. |

**Resultado del gate**: PASA sin violaciones. No requiere enmienda
constitucional. No entra ningún proveedor nuevo; toda la superficie nueva
corre en el mismo proceso Node.

## Riesgos conocidos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Una organización activa queda sin playbook publicado tras un rollback mal hecho | El fallback al hardcode es explícito y solo se desactiva explícitamente. Cualquier conversación cuya decisión se haya tomado con el fallback queda registrada con `playbook_version_id = null`. |
| El editor deja publicar un payload inválido que rompe Jev | Validación Zod en server-side antes del INSERT; rechazo con error legible. Test dedicado. |
| Cambios en `next_action` o `needs_human_call` destruyen el resolver | El schema marca esas dos como `protected` (no se puede cambiar `type` ni `key`); el editor UI no expone esas dos columnas; los tests cubren el intento de saltarse la protección. |
| Crecimiento de config_json a algo no mantenible | El config se almacena en columnas tipadas (`product_json`, `policy_json`, `offer_json`, `priorities_json`, `writer_json`, `jev_questions_json`, `prohibitions_json`, `handoff_json`, `urgency_rules`) para legibilidad en SQL; el Zod es versionado por `schema_version`. |
| Versionado del schema evoluciona y rompe drafts viejos | El campo `schema_version` se valida al publicar/reactivar; si una versión vieja no migra, se rechaza con motivo legible y se exige crear un nuevo draft. |
| El editor Jev se convierte en un Zapier | El editor no crea ni modifica lanes. Solo edita instrucciones/criterios/orden/enabled. El motor es el dueño de los efectos. |
| Bootstrap automático mete datos donde Max no quiere | El bootstrap detecta la organización con `salesOrchestratorEnabled=true` y solo entonces siembra la V1. Sin esa condición, no siembra nada. Max no rellena nada a mano. |

## Definición de Hecho

Una feature no está "Hecha" hasta que:

1. `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en verde.
2. `pnpm test:e2e` en verde con la app viva y mocks encendidos, en la
   ruta del flujo real y el camino infeliz (config inválida, schema
   incompatible, dos organizaciones distintas sin leakage).
3. La organización de Vende Veloz que ya usa Sales Orchestrator tiene una
   versión publicada con el contenido del Anexo V1 y el Sales Orchestrator
   runtime consume esa versión (no el hardcode) en al menos una corrida E2E.
4. `docs/CURRENT_STATE.md` actualizado al cerrar la feature.
5. `docs/playbook.md` escrito con la guía del dueño.
6. Decisión explícita sobre el fallback: retirado o documentado como
   ventana de migración.
7. Working tree limpio, un commit por corte, sin secretos.