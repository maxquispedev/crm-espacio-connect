# 029 — Seguridad de mensajería productiva (spec017)

Self-test ejecutable: `scripts/e2e-production-messaging-safety.mjs`, sección
`E2E_SECTION=029` de `scripts/e2e-selftest.mjs`. Conduce webhook real, APIs,
PostgreSQL y la Bandeja en Chromium; proveedores HTTP locales determinísticos.

## Entorno exclusivo

Base obligatoria `commercial_resources_test_safety` en PostgreSQL local migrado.
App local de desarrollo con `WA_MOCK_ENABLED=true`, `ALLOW_SIGNUP=true`,
`APP_BASE_URL` y `PORT` coincidentes, `AGENT_COALESCE_MS=1000`, `MEDIA_DIR`
exclusivo persistente local. Graph → `http://127.0.0.1:3043/graph`,
Jev → `http://127.0.0.1:3043/jev`, OpenRouter → `http://127.0.0.1:3043`;
tokens/modelos ficticios. `E2E_SAFETY_PROVIDER_PORT` cambia el puerto del mock
si se ajustan las tres URLs también en la app. ffmpeg/libx264 y Chromium
requeridos. No usar producción ni credenciales/destinatarios reales.

Ejecutar build antes de arrancar app: build y dev no pueden compartir `.next`
simultáneamente. Aplicar migraciones antes del test; en local hace falta
`MIGRATIONS_DIR` porque el script resuelve `drizzle/` junto a sí mismo (en el
contenedor el bundle ya vive junto a `/app/drizzle`, que es su disposición real):

```bash
MIGRATIONS_DIR="$PWD/drizzle" node --env-file=/tmp/messaging-safety.env scripts/migrate.mjs
```

El harness crea organizaciones/contactos nuevos y conserva evidencia en esa
base exclusiva; no elimina datos existentes. Genera MP4 sintético fuera de Git.
La app debe apuntar a `E2E_SAFETY_PROVIDER_PORT` en sus tres URLs: 029 usa
`:3043`, mientras que 021/022/028 usan `:3033` (`E2E_COMMERCIAL_PROVIDER_PORT`).

```bash
E2E_SECTION=029 node --env-file=/tmp/messaging-safety.env scripts/e2e-selftest.mjs
```

## Incidentes y observaciones

1. Audio/image/video/document/sticker/location con caption: conservar inbound y
   asset; `unsupported_media`, atención humana silenciosa, cero Jev/writer,
   outbound, facts o jobs.
2. Suspender primer proveedor Jev, recibir segundo inbound y liberar primero:
   exactamente una respuesta al contexto `LATEST-SAFETY`. Repetir con Sales
   Orchestrator OFF y primer LLM legacy suspendido.
3. Pedir slot pagos dos veces, primero todavía pendiente: un solo video con
   caption, `duplicate_demo` silencioso; reserva no depende de demoShownAt.
4. BSUID sin teléfono: payload `recipient` con BSUID y sin `to`.
5. Teléfono sin BSUID: `to` normalizado, sin `recipient`.
6. Graph devuelve wamid: pending sin precio/jobs; webhook failed131026: error
   visible, humano seguro, cero fact/job/retry; read tardío no resucita efectos.
7. Primer read confirma precio y un job; sent/delivered/read duplicados y fuera
   de orden no duplican; failed posterior revierte solamente efectos ligados.

Además: audio cancela un follow-up previamente confirmado sin proveedor ni
outbound nuevo; slots diferentes permitidos y fallo posterior conserva el fact
independiente de la demo anterior; operador responde mientras writer está
suspendido y suprime respuesta IA obsoleta. Delivered recibido antes de respuesta Graph se reconcilia; confirmación
tardía después de inbound/manual no programa; reply manual dentro de ventana;
fuera de 24h devuelve 409 sin Graph; sandbox preview cero Graph; tenant ajeno
no puede leer/enviar; Bandeja real muestra Por atender después de failed131026.

El harness no declara éxito por HTTP 2xx: comprueba texto/payload emitido,
contadores, facts/jobs durables y estado operativo visible. Fallos salen con
exit 1; ausencia de outbound/handoff a tiempo lanza error. La evidencia final
pertenece a `specs/017-production-messaging-safety/tasks.md` después de ejecutar,
no al resultado sintáctico `node --check`.

## Restricciones PostgreSQL e interfaz

Dos INSERT concurrentes para el mismo slot dejan un ganador y un rechazo UNIQUE
23505. La FK compuesta rechaza conversación de otra organización (23503) y
la unicidad del receipt rechaza duplicados (23505). Una transacción revertida
comprueba el trigger de pausa: invalida autorización pending y reactivar IA no
la recupera. El navegador muestra motivos legibles para archivo opaco, demo
repetida y entrega fallida. Un sent tardío tras 25h confirma fact pero conserva
la ventana cerrada para texto manual.

Corrida final: **55/55, exit 0**. Regresión en las superficies que toca: 021
**44/44**, 022 **27/27**, 028 **32/32**, 020 **44/44**. Entorno exacto, gates y
limitaciones: `specs/017-production-messaging-safety/integration-evidence.md`.
