# Tasks

- [x] Contexto/spec/clarify/plan/analyze y Constitution Check.
- [x] Guard, evidencia runtime y playbook.
- [x] Routing ad_context, writer y DTO efectivo.
- [x] Regresiones A–E + sandbox/errores y harness commercial.
- [x] typecheck/lint/build/test.
- [x] E2E observable happy/unhappy.
- [x] Actualizar docs/checkpoint y commit final.

## Evidencia durable de cierre — 2026-10-05

Base limpia: `d9943ba`. Commit de cierre:
`fix(sales): prevent premature demos and route by ad context` (consultar git log).

- Guard/resolver y reglas runtime implementados. Bootstrap reforzado; Published
  existentes no se mutan. `evidence_rule` se extiende al armar el state real.
- Routing mantiene temas explícitos del lead y usa headline/body cuando no hay
  tema más específico; petición genérica de funcionamiento conserva tema.
- Writer opener usa respuesta breve controlada, no depende del LLM para garantizar
  UNA pregunta. Otros turnos mantienen writer LLM. Contexto del anuncio viaja al
  writer. UI consume plan efectivo; propuesta original permanece en snapshot.
- Regresiones unitarias e integración A–E con orquestador/resolver/store/FS/sender
  reales y DB en memoria; guard ante scores bajos, hechos durables y mensajes
  ambiguos; routing de cambio/negación; entrega sandbox/fallo sin facts falsos.
- Dos fixtures de tests preexistentes vencieron durante esta sesión:
  `attention-no-send` y `agenda-no-send` fijan ahora su reloj (solo tests).
  Fixtures de demo que antes usaban «hola» ahora piden ver el sistema; freeze
  conserva contrato/preguntas upstream y permite fortalecer criteria del bootstrap.

| Gate | Resultado |
|---|---|
| pnpm typecheck | exit 0 |
| pnpm lint | exit 0; 3 warnings preexistentes (img y 2 eslint-disable) |
| pnpm build | exit 0; advertencia CSS duration preexistente |
| pnpm test | exit 0; 1360 pass, 9 skipped, 117 archivos |
| E2E_SECTION=021 self-test | exit 0; **44/44**, 0 fallos |
| git diff --check | exit 0 |

Comandos pnpm usados con `--pm-on-fail=ignore`: el launcher normal falla
«unable to open database file» en este entorno; mismos scripts sin cambiar
package.json/lockfile. Tests/build requieren sockets locales autorizados.

E2E: instalación efímera `embedded-postgres` + `ffmpeg-static` solo en
`/tmp/hotfix-pg` (no dependencias runtime/repo). PG 18.4, localhost:55432,
DB `commercial_resources_test_hotfix`; Next dev localhost:3000 y proveedores
HTTP localhost:3033. Env de fixtures local `/tmp/hotfix.env`, videos sintéticos
`/tmp/hotfix-media`. Migración real desde `drizzle/`, sin tocar BD de producción.
Comando: `PATH=/tmp/hotfix-bin:$PATH node --env-file=/tmp/hotfix.env scripts/e2e-selftest.mjs`.

El mock Jev propone demo con necesidad 0.16, intención 0.1 y encaje 0.5. Se
observa inbound vía webhook → respuesta texto/video por sender → outbox mock
WhatsApp + hilo real; no solo inspección DB. A se prueba para ambos demos; C
reutiliza la misma conversación, sin repetir referral, confirma video de pagos
y fact durable. D cambia a matrícula; E orgánico; B pedido directo. API real
`/api/contacts/[id]` confirma acción efectiva en panel. Rechazo media no marca
fact/reintenta; recurso ausente responde honesto; preview sandbox conserva caption
sin Graph. **No se verificó un proveedor Jev real, WhatsApp real ni producción.**

Constitution Check final: tenant/scoped/dedup/opt-in/HUMAN/sandbox intactos, sin
servicios runtime nuevos ni cambios de campaña/precio/oferta. Sin nueva decisión
de negocio para Obsidian. Docs de dominio/checkpoint actualizados.

Siguiente paso: desplegar este commit por el mecanismo habitual; sin migraciones
nuevas ni necesidad de republicar playbooks. Pendientes históricos no relacionados
(9 tests opt-in omitidos y otros specs) no quedan cerrados por este hotfix.
