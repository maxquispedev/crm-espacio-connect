# Tasks / handoff
- [x] T001 Contexto, specify, clarify, plan, analyze y Constitution Check.
- [x] T002 Schemas, formatos, helper común y handlers.
- [x] T003 Route y pruebas unitarias/regresión.
- [x] T004 E2E happy/unhappy local.
- [x] T005 Gates ejecutados; suite global con tres fallos preexistentes (ver abajo).
- [x] T006 Contrato, checkpoint y evidencia final.

## Implementación y evidencia — 2026-10-14

Base: da04397, working tree inicialmente limpio. Handler compartido extraído de
created, que conserva defaults y su wrapper. Paid intacto. Schema/event handlers
nuevos en payload.ts / notifications.ts; receptor HMAC existente. Query scoped
exacta name+es_PE+approved; sin schema/migración ni servicios nuevos.
Contrato definitivo: docs/WHMCS_EVENTS.md. Sender y resolución de contactos reales
reutilizados. No se deduce producto ni se busca factura alternativa.

- WHMCS unit/regresión: **87/87** en seis archivos, exit 0 (26 tests nuevos).
- Typecheck: exit 0 (corrida final tras build, sin app concurrente).
- Lint: exit 0; tres warnings preexistentes (img, dos eslint-disable build-state).
- Build: exit 0; advertencia CSS duration preexistente.
- Suite completa final: **1572 pass / 3 failed / 9 skipped**, 126 archivos.
  Fallos en attention-queue (1) y operational-flow (2): fixtures con fechas
  fijas que ya vencieron al 2026-10-14. Reproducidos contra HEAD original da04397
  en /tmp/whmcs-021-baseline: mismos **3 failed / 55 pass**. Sin cambiar Agenda.
  El gate global NO está verde; no declarar repositorio READY global.
- E2E HTTP real Next/PostgreSQL/Graph stub: **26 comprobaciones PASS**, exit 0.
  Script durable scripts/e2e-whmcs-notifications.mjs. Ambas plantillas es_PE,
  BODY/botón y outbound con wamid; UNIQUE concurrente, duplicates, factura null,
  template pending sin fallback/otro tenant, servicios/futuras suspensiones,
  proveedor caído sin retry, contacto reutilizado y created/paid completos.
  Ingest excluye is_test: crea conversación real si solo hay sandbox. Aserción
  defensiva sandbox también cubierta unitariamente; ningún mensaje va a is_test.
- git diff --check: exit 0.

Entorno reproducible: embedded-postgres 18.4 solo /tmp/whmcs-021-tools (no dependencia
runtime), PG :55442/base whmcs_notifications_test, Next :3021, Graph stub :3034,
credenciales y datos ficticios, todas las migraciones existentes aplicadas.
Corrida verde: /tmp/whmcs-021-e2e.log; log app /tmp/whmcs-021-Ssswfr/next.log.
Tests/build/lint/typecheck: /tmp/whmcs-021-{tests,build,lint,typecheck}.log.
Base original: /tmp/whmcs-021-baseline.log. Sockets/build requirieron escalación.
Dependencias instaladas con lockfile congelado, package/lockfile sin cambios.

Incidentes del arnés corregidos: outbound aceptado conserva pending hasta webhook;
getOrCreateConversation crea real separado si solo hay sandbox (no bloquea contacto);
no convertir sandbox a real cuando ya existe real (índice partial UNIQUE).
Typecheck no debe correr junto con Next dev: .next/types cambia durante compilación.
Primer build restringido falló en webpack; fuera del sandbox pasó.

Constitution Check final conforme para feature: aislamiento, sender único,
idempotencia, HMAC, sandbox, SDD, E2E happy/unhappy; sin PII adicional en ledger,
sin scheduling/UI/campañas ni cambios comerciales. No decisión nueva para Obsidian.

## Límites / handoff

At-most-once heredado: reserved/failed no se reenvía, crash puede perder aviso y
aceptación seguida de fallo local puede ser incierta. WHMCS debe persistir IDs;
no regenerarlos para evadir dedup. CRM confía en asociación factura/servicio/client
autenticada: no puede corroborarla remotamente. Sin Graph/Meta real ni hooks WHMCS
probados; plantillas aún requieren aprobación y sincronización del operador.
Commit local pendiente: Git no tiene user.name/user.email configurados; intento
falló antes de crear commit. Cambios staged. Título preparado:
`feat(whmcs): support invoice reminders and service suspensions`.
No push/deploy. E2E histórico completo no ejecutado; nueve tests opt-in omitidos.
Siguiente paso: implementar hooks en whmcs-espacio-connect siguiendo contrato,
resolver fixtures temporales de Agenda en otro corte y después prueba autorizada
con plantillas aprobadas y destinatario de prueba. No necesita migración.
