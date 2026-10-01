# CUT 3 — Sales Playbook: runtime consume playbook publicado

Lee obligatoriamente, en este orden:

- AGENTS.md
- `.specify/memory/constitution.md`
- `docs/CURRENT_STATE.md`
- `docs/SALES_ORCHESTRATOR.md`
- `docs/SALES_FOLLOW_UPS.md`
- `specs/008-sales-playbook/spec.md`
- `specs/008-sales-playbook/plan.md`
- `specs/008-sales-playbook/tasks.md` (Corte 3 ya está planificado)
- `specs/008-sales-playbook/data-model.md`
- `src/lib/sales/playbook/loader.ts` (a crear en este corte)
- `src/lib/sales/playbook/store.ts` (creado en Corte 1)
- `src/lib/sales/playbook/v1.ts` (creado en Corte 1)
- `src/server/sales/build-state.ts`
- `src/server/sales/writer.ts`
- `src/server/sales/orchestrator.ts`
- `src/server/sales/follow-ups/follow-up-writer.ts`
- `src/server/ai/pipeline.ts` y `src/server/ai/prompts.ts`
- tests existentes del Sales Orchestrator

Objetivo único:

implementar T301–T307 del Corte 3. `build-state`, writer y
follow-up writer consumen la versión publicada. Agent Profile
tone/instructions/escalation llegan al writer comercial. Snapshot
de versión persistido. Fallback explícito al hardcode mientras no
exista published. Sin UI todavía.

Tareas concretas:

1. **T301** — `src/lib/sales/playbook/loader.ts`.
   - `getPublishedForOrg(orgId): Promise<ConfigV1 | null>`.
   - `getDraftForOrg(orgId): Promise<ConfigV1 | null>`.
   - `getConfigByVersionId(versionId): Promise<{ config, schema_version, playbook_id, version_number } | null>`.
   - Cache en memoria: `Map<orgId, { value, expires }>` TTL 60s.
   - Invalidación: una función `invalidateOrg(orgId)`. El Corte 2 ya
     publica/rollback, pero **no** invalida el cache (eso entra acá).
     Solución: agregar un endpoint interno
     `POST /api/dev/playbook-cache-invalidate` (gate `mockGuard`) que
     invoque `invalidateOrg(orgId)` cuando se publique/rollbackee.
     Si la organización activa es la misma, la invalidación corre
     desde el server action del Corte 4 (UI). Por ahora, basta con un
     TTL de 60s y un endpoint dev para invalidar.

2. **T302** — `src/server/sales/build-state.ts`.
   - En `buildJevSalesState`, después de leer lead/contact, llamar
     `await getPublishedForOrg(organizationId)`.
   - Si la config existe → `state.product = config.product`,
     `state.commercial_policy = config.commercial_policy`.
   - Si no existe → fallback a `VENDE_VELOZ_PRODUCT` y
     `VENDE_VELOZ_COMMERCIAL_POLICY` (constantes). Emitir
     `console.warn` solo la **primera vez por proceso** (usar un
     `Set<orgId>` para eso).
   - En cualquier caso: `buildJevSalesState` debe devolver el shape
     actual (no romper la firma).
   - **Importante**: el state Jev sigue conteniendo `product` /
     `commercial_policy`. La decisión de cuál se inyecta es interna
     al builder.

3. **T303** — `src/server/sales/writer.ts`.
   - `writeSalesReply` ya acepta `product?`, `policy?`, `offer?`
     (overrides opcionales). Cambiar el system prompt:
     - `product` viene de `input.product ?? VENDE_VELOZ_PRODUCT`.
     - `policy` viene de `input.policy ?? VENDE_VELOZ_COMMERCIAL_POLICY`.
     - `offer` viene de `input.offer ?? VENDE_VELOZ_OFFER`.
   - **Nuevo**: agregar `writerInstructions?: Record<NextActionChoice,
     string>` en la firma (opcional). Si viene, usarlo en
     `nextActionInstruction(action)`. Si no, fallback al texto
     actual (`HUMAN_HANDOFF_INSTRUCTION` y la lista actual).
   - Importante: la firma cambia, pero los tests existentes que NO
     pasan `writerInstructions` deben seguir pasando (compatibilidad).

4. **T304** — `src/server/sales/follow-ups/follow-up-writer.ts`.
   - Mismo patrón que T303. Aceptar `writerInstructions?` (mapa de
     `next_action` → instrucción). Usar en `reasonInstruction` cuando
     aplique. Fallback al texto actual si no viene.

5. **T305** — `src/server/sales/orchestrator.ts`.
   - En `runSalesOrchestratorTurn`, antes de `writeSalesReply`,
     obtener el config publicado (si existe). Pasar al writer
     junto con `writerInstructions` derivados del bloque `writer`
     del config.
   - En `persistDecision`, persistir:
     - `lead.last_jev_playbook_version_id` (columna nueva de 0008).
     - `lead.last_jev_playbook_schema_version`.
     - Añadir al JSONB `last_jev_decision` las claves:
       `playbook_version_id`, `playbook_schema_version`,
       `playbook_version_number`.
   - Si no hay publicada → esas claves quedan `null`. No rompe
     nada.

7. **T306** — `src/server/ai/prompts.ts` (o donde se construya el
     system prompt del writer comercial).
   - Inyectar en el prompt del writer comercial (cuando Sales
     Orchestrator está activo):
     - `agent_profile.tone` (si existe)
     - `agent_profile.instructions` (si existe)
     - `agent_profile.escalationRules` (si existe)
   - Para los follow-ups, igual.
   - Cablear: el orquestador / el worker pasan el agent profile al
     writer. Si no se pasa, fallback al comportamiento actual (sin
     esos datos).

8. **T307** — Tests:
   - `tests/unit/playbook-fallback.test.ts`:
     - `buildJevSalesState` sin playbook publicado → `product` viene
       de `VENDE_VELOZ_PRODUCT`; el `console.warn` se emite una sola
       vez por proceso.
     - `writeSalesReply` sin override → mismo shape de prompt que
       antes (snapshot test del system prompt).
   - `tests/unit/playbook-snapshot.test.ts`:
     - `runSalesOrchestratorTurn` (mockeando Jev y writer) → persiste
       `lead.last_jev_playbook_version_id` y el snapshot en
       `last_jev_decision`.
     - Sin publicada → esos campos quedan `null`.
   - Tests existentes `sales-orchestrator.test.ts`,
     `sales-writer.test.ts`, `sales-follow-up-writer.test.ts`,
     `sales-build-state.test.ts` deben seguir verdes.

Restricciones:

- **NO** agregar UI (Corte 4).
- **NO** cambiar la lógica del Sales Orchestrator salvo para
  inyectar el config y persistir el snapshot.
- **NO** cambiar el worker de follow-ups salvo para pasar el
  override al writer.
- **NO** eliminar `VENDE_VELOZ_*`; siguen siendo
  `DEFAULTS_ONLY` reusables en tests.
- **NO** agregar nuevas dependencias.

Verificación:

- `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en
  verde. Cero regresión en los tests del Sales Orchestrator.
- Self-test E2E con `pnpm dev` + mocks:
  - Inbound sintético (`/api/dev/wa-mock/inbound`) →
    `lead.last_jev_playbook_version_id` poblado.
  - Borrar la publicada en BD →
    segundo inbound → `last_jev_playbook_version_id = null`,
    warning en logs.

Cierre:

- `tasks.md`: T301–T307 marcados con evidencia.
- Working tree limpio.
- Un commit:
  `feat(playbook): runtime consume playbook publicado`

NO empieces Corte 4.