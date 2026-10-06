# Tasks — 019

- [x] T001 Leer reglas, checkpoint, specs y contratos/modelos relevantes.
- [x] T002 Specify → clarify sin bloqueos → plan → analyze / Constitution Check.
- [x] T003 Input y servicio batch / serialización segura.
- [x] T004 Endpoint autenticado descargable y UI secundaria.
- [x] T005 Tests de datos, auth, tenant, PII, fechas, orden.
- [x] T006 Extender y ejecutar self-test 030 UI happy/unhappy.
- [x] T007 typecheck/lint/build/test.
- [x] T008 Docs contrato y checkpoint; registrar evidencia y pendientes.
- [x] T009 Commit atómico sin push/deploy.

Commit de cierre: `feat: add authenticated commercial JSON dataset export`
(`git log -1` muestra el hash; este registro forma parte del propio commit).

## Evidencia — 2026-10-06

- typecheck/lint/build: exit 0; 3 warnings de lint preexistentes.
- test: 1492 pass / 9 skipped, 124 archivos; 20 tests nuevos del exportador.
- self-test sección 030: 16/16, app Next real de desarrollo en localhost:3030,
  PostgreSQL efímero en localhost:55440, base exclusiva commercial_export_test,
  Playwright headless. CAPI apagado; ningún provider ni canal real ejecutado.
- Se verificó download como usuario, JSON/version/nombre, organización, límites
  Lima inclusivos al milisegundo, historial completo (mensaje dos días después),
  orden por wa_timestamp aunque created_at posterior, señales Jev/lead/etapa/
  jobs/delivery/conversion/media, summary, exclusión de PII/raw/secretos/paths,
  tenant B (incluyendo mensaje corrupto apuntando a conversación A), is_test,
  anuncios vs post, source_id compartido, export vacío, auth 401, selector tenant
  rechazado 422, rango invertido legible, red caída y reintento sin navegar.
- El fixture ahora usa timestamps ISO con Z: postgres-js serializaba strings sin
  zona en America/Lima, desplazando las filas del límite. No era defecto de SQL
  productivo. El test de red apunta al alert del formulario (Next tiene otro).
- Dependencias temporales de prueba en /tmp: embedded-postgres y bibliotecas
  Chromium recuperadas del entorno. Sin dependencias nuevas en package/lock.
- Suite completa encontró dos fallos históricos ligados al reloj de fixtures de
  Agenda. Ajuste de tests únicamente: fake Date fijo + restauración; runtime intacto.
- Contrato documentado en docs/COMMERCIAL_DATASET_EXPORT.md, checkpoint actualizado.
- Sin E2E histórico completo, datos reales, push ni deploy. No se requieren
  decisiones de negocio ni sincronización Obsidian.

Archivos clave: src/server/commercial-export/{input,safe-json,dataset}.ts,
src/app/api/commercial-export/route.ts, src/components/inbox/commercial-export.tsx,
scripts/e2e-commercial-export.mjs. Próximo paso: usar export con campaña real tras
desplegar el cambio; MCP/API/analytics siguen fuera del alcance.
