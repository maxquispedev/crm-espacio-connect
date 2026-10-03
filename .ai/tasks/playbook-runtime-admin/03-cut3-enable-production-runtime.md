# CUT 3 — Runtime publicado en producción

> **ESTE ES EL INTERRUPTOR DE PRODUCCIÓN.** Debe quedar aislado y reversible.

## Lee obligatoriamente, en este orden

- `AGENTS.md`
- `.specify/memory/constitution.md`
- `docs/CURRENT_STATE.md`
- `specs/009-playbook-runtime-admin/spec.md` (sobre todo **§4**, escenarios A–H)
- `specs/009-playbook-runtime-admin/plan.md` (sobre todo **§2** y **§5**)
- `specs/009-playbook-runtime-admin/tasks.md`
- `specs/009-playbook-runtime-admin/research.md` (DV-1, DV-10, DV-11)
- `specs/008-sales-playbook/plan.md` y `contracts/playbook-api.md` (el runtime
  ya existía; solo estaba congelado)
- `docs/SALES_ORCHESTRATOR.md` · `docs/playbook.md`
- `src/server/sales/build-state.ts` · `src/lib/sales/playbook/loader.ts` ·
  `src/server/sales/orchestrator.ts` · `src/server/sales/writer.ts` ·
  `src/server/sales/resolve-plan.ts` · `src/server/lab/runner.ts`
- `tests/unit/sales-launch-hardcoded.test.ts`
- `scripts/e2e-selftest.mjs` (§013, §014, §015)

## Antes de escribir código, inspecciona la realidad

```bash
grep -n "SALES_PLAYBOOK_RUNTIME_ENABLED" -r src tests
sed -n '1,90p' src/server/sales/build-state.ts
cat src/lib/sales/playbook/loader.ts
sed -n '60,95p' src/server/sales/orchestrator.ts
grep -rn "playbook_override_forbidden" src tests
```

- [x] **Usa el revisor de código** sobre toda la cadena que toca el flag: quién
  lee `usePlaybook`, qué se degrada, qué se audita y qué queda intacto.
- [x] Verifica que el loader **no** tiene cache (sin `cache()`, sin memoización,
  sin TTL) antes de prometer hot-switch.
- [x] Localiza las aserciones de congelamiento que hay que **invertir**.

## Objetivo único

Que las conversaciones reales consuman la versión **Published** del playbook de
su organización, en lugar de quedar forzadas permanentemente a los defaults
hardcodeados.

Hoy existe un freeze equivalente a `SALES_PLAYBOOK_RUNTIME_ENABLED = false`. La
Feature 008 ya tenía el loader runtime configurable y lo congeló para el
lanzamiento. **Este corte reactiva esa arquitectura; no la reescribe.**

## Requisitos

- Conversación real de una organización con Sales Orchestrator → carga el
  playbook **Published de SU organización**.
- **Sin cache**: publicar o rollbackear surte efecto en el **siguiente turno**.
- **Tenant-safe**: toda lectura por `organizationId`, vía `scoped()`.
- El **draft NUNCA** afecta producción.
- El **Lab conserva el override solo en `is_test`**.
- Sin Published, o Published inválida: **degradación segura** al baseline
  hardcodeado, **warning observable**, y **la conversación no tumba**.
- **Auditar** la versión usada: `last_jev_playbook_version_id`,
  `last_jev_playbook_schema_version` y el `playbook_version` dentro de
  `last_jev_decision` cuando el turno realmente use la Published.
- **Rollback** se refleja **sin redeploy** en el siguiente turno.
- No tocar sender, webhook, CAPI ni el motor de follow-ups, salvo adaptación
  estrictamente necesaria.

## Tareas

1. **T931 — El interruptor.**
   `src/server/sales/build-state.ts`: pon `SALES_PLAYBOOK_RUNTIME_ENABLED = true`.
   **No** crees feature flags nuevos, no reescribas el motor, no introduzcas otra
   condición. Debe quedar reversible en una línea.

2. **T932 — Cadena real.** Verifica (y solo adapta si fuera **imprescindible**)
   que el loader publicado alimenta de verdad `product` / `policy` / `offer` /
   `writer` / `questions` en el pipeline. **No** reescribas lo que ya funciona.
   Si no hace falta tocar nada más, no lo toques: dilo en `tasks.md`.

3. **T933 — Invertir la regresión de congelamiento.**
   `tests/unit/sales-launch-hardcoded.test.ts` afirma hoy que el loader publicado
   **no** se invoca en producción y que `lastJevPlaybookVersionId` queda `null`.
   **Reescribe** esas aserciones para afirmar lo contrario: el loader se invoca y
   la versión se audita. **No lo borres.** Renómbralo o ajusta su cabecera para
   que quede claro que hardcoded es ahora el **fallback**, no la única fuente.

4. **T934 — Evidencia E2E de A–H.** Extiende `scripts/e2e-selftest.mjs` con una
   sección que, sobre una conversación real, demuestre **de forma observable**:

   | # | Escenario | Resultado exigido |
   |---|---|---|
   | A | Published con precio `S/247` | el turno real usa `S/247` |
   | B | crear draft y cambiar precio/writer | producción **sigue** usando la Published anterior |
   | C | publicar el draft | el **siguiente** turno usa la config nueva **sin redeploy** |
   | D | rollback | el siguiente turno usa la versión restaurada **sin redeploy** |
   | E | Published ausente o inválida | fallback seguro, sin crash, con warning |
   | F | dos organizaciones | jamás se cruzan playbooks |
   | G | `is_test` / Lab | mantiene la semántica existente y no genera efectos reales |
   | H | auditoría | lead/decision registra exactamente la versión usada |

   A, B, C y D deben ser **conversaciones reales** (o su equivalente fiel con el
   pipeline real y la BD), no simulaciones de una simulación: son la prueba de que
   no hay cache. Deja la organización de pruebas como la encontraste.

5. **T935 — Gates y docs.**
   ```bash
   pnpm typecheck && pnpm lint && pnpm build && pnpm test
   ```
   Después el E2E comercial relevante. Actualiza `docs/CURRENT_STATE.md`
   (estado global: producción consume la Published),
   `docs/playbook.md` (qué significa ahora publicar) y
   `docs/SALES_ORCHESTRATOR.md` (runtime y auditoría).

## Precondición operativa (verifícala y documéntala)

Antes de encender, debe existir una **Published** con el baseline del corte 2. Si
no existe, **no la crees desde código ni por bootstrap**: el paso correcto es que
el administrador la publique desde la UI (ver `T927` del corte 2). Con la
degradación a fallback activa, encender sin Published es seguro pero no es lo que
queremos: documéntalo.

## Restricciones

- **NO** reescribas el runtime: reactívalo.
- **NO** añadas cache, flags nuevos, servicios ni dependencias.
- **NO** toques sender, webhook, inbox, CAPI, stage-gateway ni el motor de
  follow-ups.
- **NO** permitas que un draft afecte producción.
- **NO** permitas override de playbook fuera de `is_test`.
- **NO** relajes los guardarraíles Zod/Jev.
- **NO** declares la feature lista sin la evidencia A–H.
- No hagas deploy ni `git push`.

## Gates

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Máximo **2 iteraciones autónomas** de corrección si un gate falla por código.

## Cierre

- [x] Marca `T931`..`T935` en `tasks.md` con **evidencia real**, incluido qué
     De A–H quedó demostrado y **cómo**.
- [x] Si algún escenario quedó sin verificar por falta de entorno, dilo
      explícitamente. No lo declares cumplido.
- [x] **Un solo commit**:
      `feat(playbook): activar runtime publicado en producción`
- [x] Working tree limpio.

**STOP. Este es el último corte.**

Si el runner te relanza por un fallo previo, **no resetees nada**: termina
**este mismo** corte, corre los gates, deja **un** commit y árbol limpio.
