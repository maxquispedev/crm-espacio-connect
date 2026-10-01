# CUT 3 — Sales Playbook: runtime dinámico (contrato Jev, override, sandbox)

Lee obligatoriamente, en este orden:

- AGENTS.md
- `.specify/memory/constitution.md`
- `docs/CURRENT_STATE.md`
- `docs/SALES_ORCHESTRATOR.md`
- `docs/SALES_FOLLOW_UPS.md`
- `specs/008-sales-playbook/spec.md`
- `specs/008-sales-playbook/plan.md`
- `specs/008-sales-playbook/tasks.md`
- `specs/008-sales-playbook/data-model.md`
- `specs/008-sales-playbook/research.md`
- `src/lib/sales/playbook/loader.ts` (a crear en este corte)
- `src/lib/sales/playbook/store.ts` (creado en Corte 1)
- `src/lib/sales/playbook/v1.ts` (creado en Corte 1)
- `src/server/sales/build-state.ts`
- `src/server/sales/writer.ts`
- `src/server/sales/orchestrator.ts`
- `src/server/sales/follow-ups/follow-up-writer.ts`
- `src/server/sales/normalize.ts` (qué exige el normalizer hoy)
- `src/server/sales/decision.ts` (`SalesDecision` actual)
- `src/server/sales/resolve-plan.ts` (qué usa `buyingTiming.choice`)
- `src/server/sales/serialize-ui.ts` (qué lee del snapshot)
- `src/server/ai/pipeline.ts` y `src/server/ai/prompts.ts`
- `src/server/ai/delivery.ts` (sender de WhatsApp; respeta `is_test`)
- tests existentes del Sales Orchestrator
  (`sales-orchestrator.test.ts`, `sales-writer.test.ts`,
  `sales-build-state.test.ts`, `follow-up-writer.test.ts`,
  `lab-sandbox.test.ts`, `judge.test.ts`)

Objetivo único:

implementar T301–T313 del Corte 3. Contrato dinámico real con
Jev, override de Playbook solo en `is_test=true`, suprimir
follow-ups en sandbox, sin cache. NO UI.

Tareas concretas:

### Loader sin cache (T301)

1. `src/lib/sales/playbook/loader.ts` — **sin cache, sin TTL, sin
   invalidación**.
   - `getPublishedConfigForOrg(orgId): Promise<ConfigV1 | null>`:
     SELECT directo contra `sales_playbook_version` filtrando por
     `status='published'`. Retorna `null` si no hay.
   - `getDraftConfigForOrg(orgId): Promise<ConfigV1 | null>`:
     SELECT directo filtrando por `status='draft'`.
   - `getConfigByVersionId(orgId, versionId): Promise<{config,
     schema_version, version_number, status} | null>`: SELECT
     directo. Usado por el override del Laboratorio (Corte 6).
   - **NO** cache en memoria, **NO** TTL, **NO** invalidación.
     Publish/rollback toma efecto en el siguiente turno.

### Build-state (T302)

2. `src/server/sales/build-state.ts`.
   - En `buildJevSalesState`, después de leer lead/contact, llamar
     a `await getPublishedConfigForOrg(organizationId)`.
   - Si la config existe → `state.product = config.product`,
     `state.commercial_policy = config.commercial_policy`.
   - Si no existe → fallback a `VENDE_VELOZ_PRODUCT` y
     `VENDE_VELOZ_COMMERCIAL_POLICY` (constantes). Emitir
     `console.warn` solo la **primera vez por proceso** (usar un
     `Set<orgId>` para eso).
   - El shape `JevSalesState` no cambia.

### Set activo a Jev (T303)

3. **El motor pasa a Jev el set activo del playbook.**
   - En `runSalesOrchestratorTurn` (o `build-state`), antes de
     `evaluateJev`, calcular:
     ```ts
     const config = await getPublishedConfigForOrg(orgId); // o override
     const jevQuestions = config?.jev_questions ?? JEV_SALES_QUESTIONS_V2;
     const activeQuestions = Object.fromEntries(
       Object.entries(jevQuestions).filter(([, q]) => q.enabled)
     );
     ```
   - Llamar a `evaluateJev({ state, questions: activeQuestions })`.
     La firma ya soporta `questions` opcional
     (`src/server/sales/client.ts`).
   - Si llega override (T306), usar el override en lugar del
     publicado.

### Normalizer configurable (T304)

4. **Refactor de `src/server/sales/normalize.ts`** **+ contrato
   genérico runtime en `src/server/sales/questions.ts` y
   `src/server/sales/client.ts`**.

   El código actual usa `type JevSalesQuestionsV2 = typeof
   JEV_SALES_QUESTIONS_V2` — un literal type de las 8 congeladas
   que NO admite `analytical/custom` arbitrarias. **Está
   prohibido** usar `as any` o casts inseguros para saltarse
   TypeScript. Hay que introducir un contrato genérico:

   ```ts
   // src/server/sales/questions.ts
   export type JevQuestionDefinition =
     | {
         type: 'choice';
         instructions: string;
         enabled: boolean;
         criteria: Record<string, string>;
       }
     | {
         type: 'noul';
         instructions: string;
         enabled: boolean;
         criteria: { true: string; false: string };
       }
     | {
         type: 'score';
         instructions: string;
         enabled: boolean;
         criteria: string[];
       };

   export type JevQuestions = Readonly<
     Record<string, JevQuestionDefinition>
   >;
   ```

   - `JEV_SALES_QUESTIONS_V2` (DEFAULTS_ONLY) sigue existiendo y
     debe satisfacer `JevQuestionDefinition`. Sus tipos
     concretos (`NextActionAnswer`, `BuyingTimingAnswer`,
     `MainValuePropositionAnswer`, etc.) se mantienen donde el
     normalizer los necesite para narrow.
   - `evaluateJev({ state, questions })` ahora acepta
     `JevQuestions | undefined` (no el literal type). Cambiar la
     firma en `src/server/sales/client.ts`.
   - `JevSalesState` no cambia de forma.

   Nueva firma del normalizer:

   ```ts
   function normalizeJevResponse(
     raw: unknown,
     activeQuestions: Readonly<Record<string, JevQuestionDefinition>>,
     knownSignalKeys: readonly string[]
   ): Result<SalesDecision, NormalizeError>;
   ```
   - `engine-required` (`next_action`, `needs_human_call`):
     - Si faltan en `activeQuestions` o `enabled=false` → el motor
       **ya no las envía** a Jev (T303). Pero si la respuesta de
       Jev las omite por error, **fall** con
       `code: 'missing_required'`.
     - Si `type` incorrecto → `code: 'type_mismatch'`.
     - Option keys de `next_action` fuera del set V1 → `code:
       'invalid_choice_key'`.
   - `known signals`: si la key está activa, parsear; si la
     respuesta viene mal formada → `null`. Si la key está en
     `activeQuestions` pero `enabled=false` o no viene respuesta
     → `null` con fallback documentado.
   - `analytical/custom`: cualquier key extra que venga en la
     respuesta y no esté en `knownSignalKeys` se parsea según su
     shape y se preserva en `signals[key]`.
   - **Eliminar** la asunción de que las 8 están siempre
     presentes.

### SalesDecision nullable (T305)

5. **Refactor de `src/server/sales/decision.ts`** + consumidores.
   - `nextAction` y `needsHumanCall` siguen **requeridos**.
   - Los 6 known signals pasan a **nullable**:
     `realOperationalNeed`, `productFit`, `motivationToChange`,
     `purchaseIntent`, `buyingTiming`, `mainValueProposition`.
   - `signals: Record<string, NormalizedAnswer>` para extras.
   - **Fallbacks explícitos** en los consumidores:
     - `resolve-plan.ts`: si `buyingTiming === null` → tratar
       como `"unknown"`. El branching `future_season` no se
       ejecuta; `schedule_follow_up` sigue el camino por defecto.
     - `writer.ts`: si `mainValueProposition === null` → no
       incluir línea de ángulo; si `buyingTiming === null` → no
       incluir línea de timing.
     - `follow-up-writer.ts`: tolerar `null` en `mainValueProposition`
       y `buyingTiming`; usar `pickChoice` con fallback a
       `"unknown"` o `"unspecified"`.
     - `serialize-ui.ts`: omitir campos `null` en el snapshot DTO;
       no inventar defaults.
     - Tests de cada consumidor con `null` explícito.

### Override de Playbook (T306)

6. **Override SOLO si `conversation.is_test === true`.**
   - En `runSalesOrchestratorTurn(conv, opts: { playbookOverride?
   })`:
     ```ts
     if (opts.playbookOverride !== undefined && !conv.is_test) {
       throw new Error("playbook_override_forbidden_in_production");
     }
     ```
   - Si llega override válido (con `is_test=true`):
     - Cargar `config` del `versionId` por
       `getConfigByVersionId(orgId, versionId)`.
     - Reemplazar `product`, `commercial_policy`, `offer`,
       `writerInstructions`, `activeQuestions` para este turno.
   - En producción, `opts.playbookOverride` siempre `undefined`.
     El Laboratorio (Corte 6) es el único caller que lo pasa.

### Writer y follow-up writer (T307)

7. `src/server/sales/writer.ts` y
   `src/server/sales/follow-ups/follow-up-writer.ts`:
   - Ya aceptan override `product?`, `policy?`, `offer?` (verificar
     en la firma actual). Usar el override si llega; fallback a
     `VENDE_VELOZ_*` si llega `null`.
   - Aceptar `writerInstructions?: Record<NextActionChoice,
     string>` (opcional). Si viene, usarlo en
     `nextActionInstruction(action)` y en el prompt del follow-up
     writer. Si no, fallback al texto actual.
   - **Tolerar `decision.mainValueProposition === null` y
     `decision.buyingTiming === null`** sin fallar.
   - Compatibilidad total con tests existentes (los defaults
     siguen aplicables cuando no llega override y los campos del
     decision siguen viniendo poblados desde el fallback
     interno).

### Orchestrator (T308)

8. `src/server/sales/orchestrator.ts`:
   - Cargar config publicado via
     `loader.getPublishedConfigForOrg`.
   - Pasar al writer el override correspondiente
     (`product`, `policy`, `offer`, `writerInstructions`,
     `activeQuestions`).
   - **Suprimir scheduling de follow-ups cuando
     `conversation.is_test === true`**: el
     `runSalesOrchestratorTurn` detecta `is_test` y NO llama a
     `scheduleNextFollowUp`. Los jobs sandbox quedan cancelados;
     la fila `sales_follow_up_job` queda vacía para esa
     conversación al terminar la corrida.
   - Persistir en `lead`:
     `last_jev_playbook_version_id`,
     `last_jev_playbook_schema_version`.
   - En `last_jev_decision` JSONB añadir claves
     `playbook_version_id`, `playbook_schema_version`,
     `playbook_version_number`.

### Agent Profile al writer (T309)

9. `src/server/ai/prompts.ts` (o equivalente):
   - Inyectar en el system prompt del writer comercial (cuando
     Sales Orchestrator está activo):
     - `agent_profile.tone` (si existe)
     - `agent_profile.instructions` (si existe)
     - `agent_profile.escalationRules` (si existe)
   - Cablear: el orquestador / el worker pasan el agent profile
     al writer. Si no se pasa, fallback al comportamiento actual.

### Tests (T310–T311)

10. **Tests unitarios nuevos**:
    - `tests/unit/playbook-jev-questions.test.ts`:
      - `evaluateJev` recibe el set activo correcto
        (verificable por spy sobre la firma del HTTP client).
      - Pregunta con `enabled=false` NO se envía.
      - `next_action` ausente en respuesta → `fail`.
      - `needs_human_call` ausente en respuesta → `fail`.
      - `product_fit` activo sin respuesta → `null` con
        fallback.
      - Pregunta analítica nueva presente → preservada en
        `signals`.
      - `next_action.choice` con key fuera del set V1 → `fail`
        con `code: 'invalid_choice_key'`.
      - `buying_timing.choice` con key fuera del set V1 → `fail`.
      - **Una pregunta `analytical/custom` arbitraria (por ejemplo
        `foo_bar: { type: 'noul', ... }`) compila sin `as any`
        ni casts inseguros**, llega al payload de `evaluateJev`,
        y su answer se preserva en `decision.signals['foo_bar']`.
    - `tests/unit/playbook-fallback.test.ts`: sin published,
      fallback a constantes con warning una vez por proceso.
    - `tests/unit/playbook-snapshot.test.ts`: snapshot persiste
      `playbook_version_id` correctamente.
    - `tests/unit/playbook-override-guard.test.ts`: override con
      `is_test=false` → lanza; override con `is_test=true` →
      acepta.
    - `tests/unit/playbook-lab-suppress-followups.test.ts`:
      corrida `is_test=true` no crea filas en
      `sales_follow_up_job`. Verificar también que el sender de
      WhatsApp no se invoca.
    - `tests/unit/playbook-fallback-decision-null.test.ts`: el
      resolver y el writer toleran `decision.buyingTiming === null`
      y `decision.mainValueProposition === null` sin fallar.

11. **Regresión completa**:
    - `sales-orchestrator.test.ts`,
      `sales-writer.test.ts`, `sales-build-state.test.ts`,
      `follow-up-writer.test.ts`, `lab-sandbox.test.ts`,
      `judge.test.ts` → todos verdes.

### Self-test (T312)

12. **Auto-test con mocks**:
    - Inbound sintético con V1 publicada →
      `lead.last_jev_playbook_version_id` poblado; system prompt
      cita `product.name` del playbook; log del Jev
      `questions` enviado refleja el set activo (no las 8).
    - Borrar la publicada en BD → segundo inbound →
      `last_jev_playbook_version_id = null`; warning en logs.
    - Override en `is_test=false` → `throw`. Override en
      `is_test=true` → acepta.
    - Corrida `is_test=true` → cero filas en
      `sales_follow_up_job`.

### E2E (T313)

13. E2E (`tests/e2e/us-sales-playbook.md` sección runtime) verde
    con `pnpm test:e2e`. Extender `scripts/e2e-selftest.mjs` con
    sección 012a: configurar V1 publicada, lanzar inbound
    sintético, verificar snapshot + log.

Restricciones:

- **NO** agregar UI (Corte 4).
- **NO** cache en loader.
- **NO** permitir override sobre conversación real
  (`is_test=false`).
- **NO** cambiar la lógica del Sales Orchestrator salvo para
  inyectar el config, propagar set activo y persistir el
  snapshot.
- **NO** eliminar `VENDE_VELOZ_*`; siguen siendo `DEFAULTS_ONLY`
  reusables en tests.
- **NO** agregar nuevas dependencias.

Verificación:

- `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en
  verde. **Cero regresión** en los tests del Sales Orchestrator.
- Self-test E2E con `pnpm dev` + mocks.
- Self-test de sandbox: verificar cero filas en
  `sales_follow_up_job` tras una corrida `is_test=true`.

Cierre:

- `tasks.md`: T301–T313 marcados con evidencia.
- Working tree limpio.
- Un commit:
  `feat(playbook): runtime consume playbook publicado (contrato
  dinámico)`

NO empieces Corte 4.