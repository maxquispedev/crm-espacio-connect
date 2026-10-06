# T004–T007 — Evidencia de integración spec017 (verificada en vivo)

Fecha de ejecución: 2026-10-05/06 UTC. Rama: `maxquispedev/messaging-integrator`
(base main local `847bfe7`). Worktree retenido; sin push, sin deploy, sin limpieza.
Documento reproducible: cualquier agent puede repetir estos comandos y obtener
los mismos resultados **con el entorno exacto descrito abajo**.

## Qué se verificó y cómo (no por sintaxis)

Todos los resultados siguientes son de **comportamiento real**: app Next servida
por HTTP, webhook `POST /api/webhooks/wa/...` firmado, PostgreSQL 18.4 en base
exclusiva, proveedores HTTP deterministas locales y Chromium conduciendo la
Bandeja. Ningún check declara éxito por un 2xx: comprueba texto emitido, payloads
Graph, contadores, hechos/jobs durables y estado visible en pantalla.

### Entorno exacto

| Pieza | Valor |
|---|---|
| App | `next dev` (modo desarrollo: los mocks exigen `NODE_ENV != production`) |
| Base exclusiva | `commercial_resources_test_safety` en PostgreSQL local `127.0.0.1:55432` |
| Migraciones aplicadas | 14 (incluye `0011_messaging_safety`), re-ejecutadas 2 veces OK |
| Puertos | app `:3041` con proveedor `:3043` (sección 029); app `:3042` con proveedor `:3033` (secciones 021/022/028) |
| Tokens/modelos | ficticios; `WA_MOCK_ENABLED=true`; `ALLOW_SIGNUP=true`; `AGENT_COALESCE_MS=1000` |
| Chromium | Playwright con `LD_LIBRARY_PATH` a las libs de `libnspr4`/`libnss3` |
| ffmpeg | binario estático local, sólo para el MP4 sintético de fixture |

Los puertos de proveedor **no** son intercambiables: cada arnés levanta su propio
proveedor y exige que la app apunte al mismo puerto, o aborta con error
explícito antes de ejecutar checks.

## Gates técnicos (Principio V) — verdes

| Gate | Comando | Resultado |
|---|---|---|
| `pnpm typecheck` | `tsc --noEmit` | **exit 0** |
| `pnpm lint` | `eslint .` | **exit 0** — 0 errores, 3 warnings preexistentes (`anuncio-origen.tsx:65` `<img>`; 2 directivas `eslint-disable` sin uso en `build-state.ts`) |
| `pnpm build` | `next build` | **exit 0** |
| `pnpm test` | `vitest run` | **exit 0** — **1446 pass / 9 skipped**, 119 archivos pass + 1 skipped |

Los 9 skips son gates opt-in del propio repo; no se reportan como ejecutados.

## Migración 0011 — re-ejecutable sobre PostgreSQL real

`MIGRATIONS_DIR="$PWD/drizzle" node scripts/migrate.mjs` → `migraciones aplicadas`
en dos ejecuciones consecutivas, sin error y sin backfill. Sin `MIGRATIONS_DIR` el
script busca `scripts/drizzle` y falla: en el contenedor Docker el bundle vive
junto a `/app/drizzle`, que es la disposición para la que está escrito.

## E2E 029 — los siete incidentes y el resto del contrato (55/55)

`E2E_SECTION=029 node --env-file=… scripts/e2e-selftest.mjs` → **exit 0,
55/55 checks OK, 0 fallos**. Cobertura observada:

- **Incidente 1 (media opaca):** audio, imagen, video, documento, sticker y
  ubicación persisten inbound + asset y producen handoff silencioso
  `unsupported_media`; cero llamadas a Jev/writer, cero outbound, cero facts y
  cero jobs. El audio además cancela un follow-up ya confirmado.
- **Incidente 2 (ráfaga):** con el primer proveedor Jev suspendido, un segundo
  inbound entra y al liberar el primero sale **exactamente una** respuesta al
  contexto `LATEST-SAFETY`. Repetido con Orchestrator OFF y con el primer LLM
  legacy suspendido.
- **Incidente 3 (demo repetida):** dos peticiones del mismo slot de pagos con la
  primera todavía pendiente producen **un solo video** con su caption;
  `duplicate_demo` silencioso; la reserva no depende de `demoShownAt`. Slots
  distintos sí se permiten.
- **Incidente 4/5 (dirección):** BSUID sin teléfono → payload con `recipient` y
  sin `to`; teléfono sin BSUID → `to` normalizado y sin `recipient`.
- **Incidente 6 (wamid ≠ entrega):** el `wamid` deja el mensaje pending sin facts
  ni jobs; el webhook `failed` 131026 deja error visible, atención humana segura,
  **cero facts, cero jobs, cero retry**; un `read` tardío no resucita efectos y un
  éxito posterior a un fallo no autoriza nada.
- **Incidente 7 (confirmación única):** el primer `read` confirma precio y un job;
  `sent`/`delivered`/`read` duplicados y fuera de orden no duplican; un `failed`
  posterior revierte sólo los efectos ligados a ese outbound y conserva el fact
  independiente de la demo anterior.

Además, en la misma corrida: entrega recibida **antes** de la respuesta Graph se
reconcilia al ligar el `wamid`; ventana cerrada bloquea el envío mientras hay
status pendiente; confirmación tardía tras 25 h confirma el fact **sin reabrir la
ventana**; inbound nuevo o respuesta manual invalidan la autorización y no crean
jobs obsoletos; respuesta manual con el writer suspendido se acepta y suprime la
respuesta IA obsoleta; sandbox confirma efectos locales con **cero Graph**; 24 h
cerrado devuelve 409 sin Graph; un tenant no puede leer ni enviar el hilo ajeno.

### Restricciones físicas de PostgreSQL (no dobleadas en unit tests)

| Comprobación | Resultado observado |
|---|---|
| Dos `INSERT` concurrentes del mismo slot | un ganador + **23505** en el perdedor |
| FK compuesta con conversación de otra organización | **23503** |
| Unicidad del receipt de status duplicado | **23505** |
| Trigger de pausa en transacción revertida | invalida la autorización pending |
| Reactivar IA después del trigger | **no** recupera esa autorización |

## E2E de regresión en las superficies que toca la 017

| Sección | Alcance | Resultado |
|---|---|---|
| 021 | demos y routing de apertura (hotfix 015) | **44/44**, exit 0 |
| 022 | pago comercial | **27/27**, exit 0 |
| 028 | evidencia comercial / handoff silencioso (spec 016) | **32/32**, exit 0 |
| 020 | recursos comerciales (spec 011) | **44/44**, exit 0 (tras la corrección de locator de abajo) |

## Corrección durante esta integración

La sección 020 —cerrada en spec 011 y nunca re-ejecutada desde entonces— moría
por ambigüedad de locator, no por comportamiento roto: `page.getByRole("alert")`
resolvía también al `<div id="__next-route-announcer__">` que Next inyecta, y en
modo strict eso son dos elementos. El error real de la pantalla sí se pintaba.
Se acotó el locator a `[role="alert"]:not(#__next-route-announcer__)`; es cambio
**sólo de arnés**, no de runtime, y queda en su propio commit atómico.

## Checks opt-in NO ejecutados

- `020 · persistencia tras reinicio` queda **PENDIENTE**: es un check opt-in que
  exige `E2E_COMMERCIAL_RESTART_ARGV_JSON` (reinicia la app a mitad de corrida)
  y esa variable no se usó. La recarga sin reinicio sí se verificó. No se cuenta
  como ejecutado.
- Los 9 skips de `pnpm test` son gates opt-in preexistentes del repo.

## Constitution Check de cierre (I–IX)

- **I** — sin secretos nuevos ni PII en logs; los tokens del entorno de prueba son
  ficticios y este documento no reproduce ninguno.
- **II** — PostgreSQL y Next self-hosted; los proveedores siguen siendo los tres
  permitidos (Graph, LLM, Jev) detrás de sus adaptadores. Chromium y ffmpeg son
  herramientas de prueba, no dependencias de runtime; no se tocó `package.json`
  ni el lockfile.
- **III** — los datos nuevos llevan `organization_id` NOT NULL, indexes org-first y
  FK compuestas; toda lectura pasa por `scoped()`; verificado con la prueba de
  tenant y con los rechazos 23503.
- **IV** — idempotencia de status preservada: la unicidad del receipt y la
  confirmación única lo demuestran en base física, no sólo en unit tests.
- **V** — los cuatro gates ejecutados y verdes, con números, no con descriptores.
- **VI** — el spec 017 y su plan preceden al código.
- **VII** — las limitaciones quedan aquí explícitas, no enterradas.
- **VIII** — el cambio sirve a atender/conversaciones de un negocio; ninguna
  campaña, broadcast ni superficie nueva.
- **IX** — el comportamiento se ejerció en vivo contra la app real, con camino
  feliz **y** infeliz (131026, ventana 24 h cerrada, tenant ajeno, sandbox,
  concurrencia, rollback de trigger).

## Limitaciones y pendientes declarados (no se inventó resultado)

1. La 24 h, el sandbox, la plantilla aprobada y la atribución se verificaron
   contra fixtures deterministas: cubren el contrato, no el comportamiento de la
   API real de Meta.
2. No hay backfill de hechos ni reservas históricas: mensajes y facts previos no
   se inventan ni se reescriben. La cobertura histórica queda fuera a propósito.
3. Los proveedores reales (Jev/LLM) no se validaron semánticamente; sigue
   pendiente como en specs 015/016.
4. **Migración 0011 obligatoria antes de desplegar este código.** El código
   consulta columnas y tablas que sólo existen después de aplicarla.
5. La decisión de producto «media opaca → humano silencioso» sigue pendiente de
   sincronizar en el cerebro de negocio (Obsidian); este corte no escribe allí.

## Siguiente paso

Coordinador: fast-forward local de `main` con árbol limpio y ancestry verificados.
Nada de push, deploy ni limpieza. Tras el merge, el despliegue necesita aplicar
0011 en el entorno destino antes de levantar la versión nueva.