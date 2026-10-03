# Corte 2 — Prueba rápida embebida (sandbox)

Objetivo: probar un caso ad-hoc **en la misma pantalla** que edita el playbook,
usando el **mismo** pipeline comercial sandbox que el Laboratorio.

Al terminar: `feat(playbook): añadir prueba rápida sandbox`, gate en verde,
árbol limpio, y `tasks.md` con evidencia real.

---

## La regla que gobierna este corte

**Nada de motores paralelos.** No reimplementes `runSalesOrchestratorTurn`, ni el
cliente de Jev, ni el writer, ni mandes WhatsApp real. El preview invoca la
**misma** función que el Laboratorio. Si dudas entre reutilizar y duplicar,
reutiliza.

Decisión ya tomada y argumentada en
`specs/010-playbook-playground-ux/research.md` §2.5, con contrato en
`specs/010-playbook-playground-ux/contracts/playground-preview-api.md`. **No la
reabras**: aplícala.

## Contexto obligatorio (léelo antes de tocar nada)

1. `AGENTS.md`
2. `.specify/memory/constitution.md` (en especial multi-tenancy y el sandbox del Lab)
3. `docs/CURRENT_STATE.md`
4. `specs/010-playbook-playground-ux/spec.md` §3.2
5. `specs/010-playbook-playground-ux/contracts/playground-preview-api.md` (**normativo**)
6. `specs/010-playbook-playground-ux/research.md` §2, §3, §4
7. `specs/010-playbook-playground-ux/plan.md` §3
8. `specs/010-playbook-playground-ux/tasks.md` §Corte 2
9. Feature 009: `specs/009-playbook-runtime-admin/` (Published vs Draft)
10. Código real:
    - `src/server/lab/runner.ts` — `:410-444` **el andamiaje a extraer**,
      `runConversation` completa, `readActualOutcome`
    - `src/app/api/lab/runs/route.ts` — el patrón de auth de la zona (**no lo
      toques**, solo cópialo)
    - `src/server/sales/orchestrator.ts` — `:66` la firma,
      `:77-80` guard T306, `:138-155` `snapshotBase`, `:212-220` follow-ups
      (`scheduleNextFollowUp` solo si `!isTest`)
    - `src/server/ai/delivery.ts` — `:24-27` la rama sandbox de `deliverReply`:
      persiste y devuelve **antes** de `sendText`. Es la garantía de cero
      WhatsApp real; no la reimplementes.
    - `src/server/sales/build-state.ts`, `writer.ts`, `resolve-plan.ts`,
      `client.ts` (**sin cambios de comportamiento**)
    - `src/lib/sales/playbook/loader.ts` — cómo se resuelve published/draft
    - `src/components/agent/playbook/*` — la pantalla que dejó el corte 1
11. Tests: `tests/unit/lab-pipeline-real.test.ts` (**debe seguir verde sin
    cambios**), y los de tenant isolation.

Código y tests mandan sobre documentación antigua.

## Orden de trabajo

### Paso 1 — Extraer el andamiaje compartido (antes que el endpoint)

`src/server/lab/sandbox-case.ts` (nuevo), desde `runner.ts:410-444`:
contacto archivado + lead en el primer stage abierto (`reason: "lab_sandbox"`)
+ conversación con `isTest: true, aiEnabled: true`, más su cleanup.

- **Mover, no reescribir.** `runConversation` sigue haciendo lo mismo, ahora
  vía el helper.
- **Si `tests/unit/lab-pipeline-real.test.ts` necesita cambios, para.** Es la
  señal de que el movimiento cambió comportamiento del Laboratorio.
- El helper devuelve el snapshot crudo; cada consumidor proyecta lo suyo: el
  Lab conserva sus 3 escalares, el preview proyecta decisión + plan + writer.

### Paso 2 — `POST /api/lab/preview`

`withAuth`, igual que el resto de `/api/lab/*`. `organizationId` **siempre** de
la sesión, nunca del body.

- Zod en el borde: `mode` (`draft`|`published`, default `published`) y
  `conversation` (1..20 × `{ from: "lead", text }`), con tope de longitud.
- Resolver la versión con la **misma** función de loader que usa el Lab para su
  override, scopeada por la org de la sesión.
- Crear el caso sandbox → un turno por línea con `runSalesOrchestratorTurn`
  (`playbookOverride` **solo** en Draft, nunca fuera de `is_test`) → leer
  `lead.lastJevDecision` (decisión completa + plan + versión) y los mensajes
  `direction: "out"` (texto del writer) → **leer antes del cleanup** → `finally`
  de limpieza.
- Copia el corte por handoff del Lab; no lo inventes.
- **El body no acepta el documento del playbook.** La versión probada se resuelve
  en BD. Es lo que hace imposible "probé algo que no publiqué".

Respuesta y errores: exactamente los del contrato. Códigos que importan:
`draft_not_found`, `published_not_found`, `no_open_stage`, `no_decision`,
`no_writer_output`, `ai_not_configured`, `jev_failed`.

**Un fallo del proveedor nunca se convierte en una respuesta ficticia.**

### Paso 3 — La UI de la prueba rápida

Columna derecha en desktop; debajo del editor en pantalla estrecha.

- Entrada: `textarea` monoespaciado con la conversación pegada
  (`[{"from":"lead","text":"…"}]`), con una conversación de ejemplo por defecto
  para no arrancar en blanco.
- Selector `Probar: [ Draft ▼ ]` con Draft/Published. Sin draft → Draft
  deshabilitado y Published por defecto. `both` **no** aplica aquí: esa función
  se queda en el Laboratorio.
- `Ejecutar`: una sola ejecución por clic.
- Salida compacta: resumen humano (`next_action`, `lane`, `human`) + `Respuesta`
  + `[Ver JSON completo]` plegable. Sin cards enormes.
- Con `dirty`, aviso: **"Estás probando el último draft guardado. Guarda los
  cambios para probarlos."**
- Enlace pequeño "Abrir Laboratorio completo" → `/lab`.

## Reglas duras

- No toques pricing, `ConfigV1Schema`, option keys, contratos Jev, loader ni el
  writer comercial. **Cero cambios de comportamiento** en
  `orchestrator.ts`, `build-state.ts`, `writer.ts`, `resolve-plan.ts`,
  `client.ts`.
- No toques `/api/lab/runs` ni la UI del Laboratorio. Lo único que se toca del
  Lab es la **extracción** del paso 1.
- No toques el runtime Published, follow-ups, WhatsApp, webhook, CAPI ni el
  schema de BD.
- `organization_id` en toda fila nueva; `scoped()` en cada query.
- `is_test=true` en todo caso sandbox. Cero efectos reales.
- No añadas dependencias. No abstraigas en una plataforma de workflows.
- No refactors oportunistas.

## Las 10 demostraciones (tests, todas obligatorias)

1. `published` usa la publicada de la org.
2. `draft` usa el draft de la org.
3. Org A nunca lee draft/published de org B.
4. `is_test`/sandbox: cero llamadas al remitente real.
5. Cero follow-ups productivos.
6. Devuelve `jev`, `plan` y `writer.text` con contenido real.
7. Fallo del proveedor → error, no respuesta.
8. Draft inexistente → `draft_not_found` explícito.
9. Cambio local sin guardar **no** se usa.
10. **Estructural**: preview y `runConversation` importan el **mismo** helper, y
    el preview invoca `runSalesOrchestratorTurn`. Esta es la que prueba que no
    es una implementación paralela.

## Gate

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Luego, comportamiento observable:

- E2E: extiende `scripts/e2e-selftest.mjs` con la **Sección 019** (preview
  Published y Draft, aislamiento de org, cero efectos, y los caminos
  infelices). Patrón de las Secciones 016/017: `runSection019()` + dispatch en
  `main()`.
- Ejecuta `pnpm test:e2e` con `WA_MOCK_ENABLED=true` si el entorno lo permite.

**Máximo 2 iteraciones autónomas de fix por gate.** Si el gate no pasa en la
segunda, para y reporta con la salida real.

**No declares E2E si no lo ejecutaste.** Si no se pudo ejecutar, escribe
exactamente eso en `tasks.md`.

## Al terminar

1. Actualiza `specs/010-playbook-playground-ux/tasks.md` §Corte 2 con las 10
   demostraciones una por una, y con los comandos ejecutados y su resultado.
2. Actualiza `docs/CURRENT_STATE.md` y `docs/playbook.md` (sección de la
   Prueba rápida): hay contrato observable nuevo.
3. Un commit: `feat(playbook): añadir prueba rápida sandbox`.
4. `git status` limpio.
5. **STOP.**
