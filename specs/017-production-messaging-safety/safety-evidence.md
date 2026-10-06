# T003 — evidencia del worker de seguridad

Fecha: 2026-10-06 UTC. Worktree retenido: `messaging-safety`; rama `maxquispedev/messaging-safety`.
Alcance implementado: spec017 A/B/C/E/F. No push, deploy, modificación de main ni cambios en spec/tasks/docs globales.

## Commits y handoff

- `e545a9c`: ledger durable antes de Graph, receipts tempranos, confirmación transaccional, reservas únicas, tokens de inbound, guardas del pipeline/sender/media y worker durable.
- `1e94f29`: callbacks después de24h conservan freshness/permissions; ventana24h sigue limitando envío; schema alineado a FK compuestas/checks de migración y regresiones del status followup.
- `81a8c14`: merge de addressing fixtures `0bfc316` (cuatro suites asignadas al otro worker).
- `0d544db`: historial excluye inbound opaco y outbound pending/failed; callback cancela jobs processing del contexto invalidado o perfiles desactivados.
- `f142c96`: suites históricas adaptadas al contrato pending → status, incluyendo sandbox y pago multipart; sin cambiar permisos productivos para acomodar dobles.

## Contrato técnico para integración/E2E

`drizzle/0011_messaging_safety.sql` agrega `conversation.latest_inbound_message_id`, `sales_follow_up_job.source_message_id`, `sales_demo_reservation`, `sales_outbound_delivery`, `wa_status_receipt` y trigger de invalidación al pausar/cambiar handoff. FK compuestas incluyen organización; la reserva UNIQUE `(organization_id, conversation_id, slot)` no se libera ante fallo/incertidumbre. Sin backfill de hechos históricos.

Ingesta escribe mensaje/puntero e invalida ledger bajo lock de conversación antes del trabajo asíncrono; media conserva asset y cancela followups con `unsupported_media`/human/pending, sin Jev/writer/sender. Historial opaco entrante se omite, también después de reactivación. Captura un inbound id y watermark de respuesta manual aceptada; valida antes de decisiones, notas, movimientos, handoff y sender, otra vez después del upload. Los efectos locales relevantes usan transacción/lock. Respuestas AI pendientes no avanzan el watermark manual.

Cada outbound automático lleva ledger persistido junto al mensaje pending antes de Graph. `wamid` únicamente vincula aceptación. Receipt temprano se conserva por org/wamid/status; primera confirmación sent/delivered/read aplica hechos + marcador + planificación dentro de la transacción de status. Duplicados, eventos inversos y fallo de planificación se reconcilian sin duplicación. Confirmación fuera de24h observa entrega sin autorizar otro envío libre.

Worker real mantiene processing/messageId pending hasta confirmación, no incrementa count ni encadena por Graph acceptance. La confirmación avanza una sola vez; el tercer intento confirmado llega a stop/dormant, sin Lost. Reclaim excluye jobs con outbound durable; contexto invalidado/perfil disabled cancela processing y limpia solamente su due summary.

Failed131026 es terminal/visible y conduce a `delivery_failed`/human/pending cuando el contexto sigue autorizado, sin hechos/jobs/retry ni Lost. Fallo tardío retracta únicamente hechos propiedad del ledger y cancela su linaje de jobs; no borra hechos independientes. Pago multipart exige todas las partes confirmadas; su handoff comercial intencional se autoriza por `expected_handoff_at` sin revivir un handoff/manual posterior. Sandbox confirma persistencia local sin tocar Graph.

## Verificación ejecutada

Dependencias compartidas mediante symlink `node_modules` al proyecto original. Sin cambios en lock/dependencias. Comandos con `pnpm_config_verify_deps_before_run=false pnpm --pm-on-fail=ignore` para evitar reinstalación automática de este worktree.

- `typecheck`: PASS (tsc --noEmit), última ejecución después de `f142c96`.
- `lint`: PASS (eslint .), última ejecución después de `f142c96`.
- `exec vitest run`: PASS, 119 suites passed / 1 skipped; 1445 tests passed / 9 skipped, 2026-10-06 03:12 UTC, 14.26s.
- `messaging-safety.test.ts`: 32 casos de módulos reales, ORM/schema/scoped reales y executor de BD en memoria; incluye race durante writer/upload, inbound opaco7tipos, tenant, reservas concurrentes, receipt temprano, orden inverso/duplicados, rollback, fallo tardío, callback24h y cancelación tras pause/profile toggle.
- `sales-build-state.test.ts`: 16 casos, incluye exclusión de captions opacos y mensajes no confirmados.

Los dobles unitarios NO prueban locks, UNIQUE/FK/CHECK ni trigger de PostgreSQL físico. Nueve skips son gates opt-in; no se reportan como ejecutados. Algunas suites antiguas aíslan flags/producto con un doble explícito de turn-safety; las32 regresiones de seguridad mantienen el módulo real.

## Pendientes asignados al integrador

Build, migración reejecutable sobre PostgreSQL real, self-test E2E completo y camino infeliz live pertenecen al integrador/coordinador y no fueron ejecutados por este worker. No declarar READY punta a punta sólo por estas pruebas unitarias. Integrar hasta `f142c96` más este commit de evidencia; verificar callback post24h, payment group con handoff, failure tardío, pause trigger y concurrencia física. Actualización de tasks/CURRENT_STATE/docs globales corresponde al coordinador. No se tomó una nueva decisión comercial para sincronizar en Obsidian.
