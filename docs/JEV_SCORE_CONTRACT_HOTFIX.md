# Hotfix contrato Jev — 2026-10-02

Causa raíz: el refactor runtime de Feature 008 reemplazó el contrato validado
por un snapshot distinto: `score.criteria` era un record con claves numéricas
en el tipo y en el hardcode. Jev exige una lista y rechazaba el turno con 422.
El freeze comparaba código y documentación local igualmente incorrectos.
Un cast en el orchestrator ocultaba que ConfigV1 sí contenía arrays.

Fuente recuperada directamente: `maxquispedev/jevveloz/config/questions-v2.json`,
blob `fe3e075ca43aec8f82e5bc34eb677ae6dcf82b68`. Las ocho preguntas se restauran
exactas. La fixture conserva el contenido fuente, con newline final añadido;
el test verifica el hash Git del contenido original y la igualdad JSON completa.

Score usa readonly string[], choice Record<string,string>, noul true/false.
Zod, ConfigV1, editor, store, loader y API ya preservaban arrays: se revisaron,
sin introducir conversiones object→array. Se retira el cast del orchestrator.
Las uniones/serializer usan opciones canónicas; el resolver restaura la condición
`future_season` existente antes del commit regresivo, sin estrategia nueva.
Runtime configurable false, Playbook/Laboratorio y copy del writer preservados.
No cambios a entorno, secretos, pricing, sender, tenant scope ni atribución.

## Verificación

- Typecheck, lint (0 errores/3 warnings preexistentes), build: verdes.
- Tests: 830/830 en 89 archivos; 12 regresiones nuevas.
- Fuente completa + hash, documentación §7, tres arrays canónicos de cinco
  criterios, contratos choice/noul y scores ConfigV1: verificados.
- API PUT rechaza records en las tres preguntas score antes de persistir.
- Captura del JSON final de evaluateJev en launch y tras roundtrip Zod/JSON de
  ConfigV1: arrays intactos, sin transformación del cliente.
- Tramo production-like con builder/orquestador/resolver/cliente HTTP reales:
  isTest=false, aiEnabled=true, handoffAt=null, lane auto. Proveedor local
  estricto captura las ocho preguntas exactas, responde 200; entrega y
  auto_close observados. 422 forzado registra error sin nuevo outbound.
  BD, writer y delivery son dobles: esto no equivale al E2E completo.
- `node --check scripts/e2e-follow-ups.mjs`: verde. Proveedor de ese arnés
  ahora valida score arrays y retorna 422 si recibe un record.
- E2E completo Next+PostgreSQL: **pendiente**, app localhost:3000 inaccesible,
  Docker/postgres/psql ausentes. Sin prueba contra TypeSafe real ni deploy.

## Archivos modificados

- `src/server/sales/questions.ts`
- `src/server/sales/answers.ts`
- `src/server/sales/orchestrator.ts`
- `src/server/sales/resolve-plan.ts`
- `src/server/sales/serialize-ui.ts`
- `src/server/dev/jev-mock.ts`
- `tests/fixtures/jev-questions-v2.json`
- `tests/fixtures/jev-questions-v2.source.md`
- `tests/unit/sales-questions-freeze.test.ts`
- `tests/unit/sales-client.test.ts`
- `tests/unit/sales-launch-hardcoded.test.ts`
- `tests/unit/playbook-jev-guards.test.ts`
- `tests/unit/playbook-jev-questions.test.ts`
- `tests/unit/playbook-api.test.ts`
- `tests/unit/playbook-fallback-decision-null.test.ts`
- `tests/unit/sales-fixtures.ts`
- `tests/unit/sales-orchestrator.test.ts`
- `tests/unit/sales-resolve-plan.test.ts`
- `scripts/e2e-follow-ups.mjs`
- `specs/008-sales-playbook/tasks.md`
- `docs/SALES_ORCHESTRATOR.md`
- `docs/CURRENT_STATE.md`
- `docs/JEV_SCORE_CONTRACT_HOTFIX.md`

## Handoff

Commit único: `fix(sales): restaurar contrato Jev validado para score criteria`.
Consultar hash con `git log -1 --format=%H`. Spec actual: 008, tareas JC1–JC4.
Siguiente paso: repetir arnés con app/BD efímeras y desplegar por flujo habitual.
Sin decisión comercial nueva que sincronizar en Obsidian.
