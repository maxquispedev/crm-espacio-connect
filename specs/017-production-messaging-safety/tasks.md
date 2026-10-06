# Tasks / handoff 017

- [x] T001 Specify → clarify interno → plan → tasks → analyze; Constitution Check previo.
- [x] T002 Worker addressing: contrato oficial, abstraction, todos callers, tests; commit atómico.
- [x] T003 Worker safety: media opaca + handoff, freshness legacy/comercial, reserva demo durable, ledger status/effects transaccionales; tests y commits atómicos.
- [x] T004 Integrador descendiente: integrar workers/revisar regresiones y migración real.
- [x] T005 Ampliar self-test y ejecutar siete incidentes + happy/unhappy/tenant/sandbox.
- [x] T006 pnpm typecheck/lint/build/test y diff --check finales.
- [x] T007 Docs de dominio, CURRENT_STATE, evidencia real y decisiones/limitaciones; Constitution Check final; commits.
- [x] T008 Coordinador: integración de los tres descendientes, verificación propia y UN único commit final en main LOCAL; sin push/deploy/cleanup.

Base main: 847bfe7961dab3d2fc969ee26728048d0cc23146. Coordinador: maxquispedev/production-messaging-safety-coordinator, descendiente de main. Run Orca run_b3b55e39237b. Workers/integrador deben ser hijos Orca y Git del coordinador. Decisión media opaca → humano silencioso debe sincronizarse en Obsidian; no escribir allí en este corte.

## Estado verificado (2026-10-06 UTC, integrador)

Gates: typecheck exit 0 · lint exit 0 (0 errores, 3 warnings preexistentes) ·
build exit 0 · test **1446 pass / 9 skipped** (119 archivos + 1 skipped).

E2E en vivo (app Next + PostgreSQL 18.4 en base exclusiva
`commercial_resources_test_safety` + proveedores HTTP locales + Chromium):

| Sección | Resultado |
|---|---|
| 029 — siete incidentes de spec017 | **55/55, exit 0** |
| 021 — demos/routing (spec 015) | **44/44, exit 0** |
| 022 — pago comercial | **27/27, exit 0** |
| 028 — evidencia comercial (spec 016) | **32/32, exit 0** |
| 020 — recursos comerciales (spec 011) | **44/44, exit 0** |

Migración `0011_messaging_safety` aplicada y **re-ejecutable** (dos corridas, sin
backfill). Rechazos observados en PostgreSQL físico, no doblados: 23505 por
reserva concurrente del mismo slot, 23503 por FK compuesta entre organizaciones,
23505 por receipt de status duplicado, trigger de pausa que invalida la
autorización pending y que reactivar IA no recupera.

Commits de integración sobre el trabajo previo:
`89e6ba2` fix del arnés 020 (locator ambiguo por `#__next-route-announcer__`),
`8e1f1c8` evidencia de integración, `ca0340b` contrato de entrega en docs de
dominio + runbook 029 corregido.

Evidencia completa, entorno exacto y límites:
`specs/017-production-messaging-safety/integration-evidence.md`.

## Pendientes declarados (no se declaran ejecutados)

1. **Aplicar 0011 en el entorno destino antes de desplegar** este código.
2. `020 · persistencia tras reinicio` quedó PENDIENTE: es check opt-in que exige
   `E2E_COMMERCIAL_RESTART_ARGV_JSON`. La recarga sin reinicio sí se verificó.
3. Validación semántica de proveedores reales (Jev/LLM) sigue pendiente, como en
   015/016; aquí todo fue contra fixtures deterministas.
4. Sin backfill de hechos/reservas históricas: la cobertura histórica queda
   fuera a propósito, no es un olvido.
5. T008 **cerrado**: los tres descendientes quedaron contenidos en el integrador
   (nada quedó sin commit ni fuera de la integración) y el coordinador verificó el
   árbol final por sí mismo. Sin push, deploy ni limpieza de worktrees.
6. Decisión de producto «media opaca → humano silencioso» pendiente de
   sincronizar en Obsidian.

## Verificación propia del coordinador (T008)

El coordinador **no heredó los resultados del integrador**: repetió los gates y
los cinco cortes E2E contra el árbol integrado, en su propio worktree y sus
propias instancias de app. Salida idéntica a la del integrador.

| Verificación del coordinador | Resultado |
|---|---|
| `pnpm typecheck` | **exit 0** |
| `pnpm lint` | **exit 0** — 0 errores, 3 warnings preexistentes |
| `pnpm build` | **exit 0** |
| `pnpm test` | **exit 0** — **1446 pass / 9 skipped**, 119 archivos + 1 skipped |
| Unitarios 017 (`messaging-safety` + `messaging-addressing`) | **70/70 pass** |
| E2E **029** (siete incidentes) | **55/55**, exit 0 |
| E2E 021 / 022 / 028 / 020 | **44/44 · 27/27 · 32/32 · 44/44**, exit 0 |
| Migración 0011 | aplicada y re-ejecutable (dos corridas) |
| `git diff --check` | limpio |

Dos condiciones del entorno que el coordinador tuvo que resolver para poder
ejercitar el comportamiento (no son cambios de código):

1. **Chromium no arrancaba** por `libnspr4.so` ausente en el host. Se quantified
   `LD_LIBRARY_PATH` quedó apuntando a las libs ya presentes en la máquina. Sin
   tocar runtime.
2. **ffmpeg no estaba en `PATH`** y el fixture MP4 del self-test lo exige. Se usó
   un binario estático **sólo de prueba** para generar el MP4 sintético; no se
   añadió a `package.json` ni al runtime (Principio II).

El `.next` de la instancia de app que dejó el integrador corriendo quedó
corrupto (`Cannot find module './8381.js'`, build y dev compartiendo `.next`), por
lo que el coordinador levantó **instancias propias** en puertos limpios para los
cortes 029 y 021/022/028/020. Los worktrees del integrador **no se tocaron**.

### Estado final

`main` LOCAL contiene **un único commit** con todo el Spec 017 (squash de los
commits de los tres workers + integrador). Árbol limpio, ancestry verificado
(`main` era ancestro del árbol integrado), sin push, sin deploy y sin borrar
worktrees.