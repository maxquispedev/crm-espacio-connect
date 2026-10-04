# E2E — Bandeja "Por atender" (013 · CUT 2)

Guion de comportamiento del corte 2. El arnés lo conduce contra la app real; no
hay que pasárselo a una persona.

## Requisitos

- App en desarrollo (los mocks `/api/dev/*` exigen `NODE_ENV !== production`)
  con `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock y
  `OPENROUTER_BASE_URL` → ai-mock.
- BD **dedicada** llamada `operator_workspace_test` o `operator_workspace_test_*`
  (el harness aborta si no). El fixture escribe ahí por SQL: el estado
  "recordatorio vencido" exige esperar, y `POST /api/reminders` es del corte 3.
- Chromium con `libnspr4`, `libnss3` y `libasound2` disponibles.

## Comando

```bash
E2E_SECTION=023 node --env-file=.env scripts/e2e-selftest.mjs
```

Sale con código 1 si algún check falla. Última ejecución: **35/35, 0 fallos**.

## Qué comprueba

**Por API (el DTO que llega a la pantalla).** Con ocho conversaciones sembradas
—handoff `pending`, inbound humano `pending`, recordatorio `deferred` vencido,
recordatorio `deferred` futuro, `waiting_client` con 4 no leídas, una solo de IA,
una de anuncio, una `is_test` del Laboratorio, más una de otra organización—:
el Laboratorio no aparece, la atención llega con los cuatro campos de
`plan.md` §4.1, el vencido entra, el futuro no, `waiting_client` no entra aunque
tenga no leídas, y la que no tiene estado humano viene con `attention: null`
(no `false`).

**Por UI (Chromium real).**

| Caso | Resultado esperado |
|---|---|
| El chip existe y es la primera opción de la fila | antes que "Todas" y "No leídas" |
| El chip marca 3 | handoff + inbound humano + vencido |
| Al pulsarlo, la lista tiene 3 filas | y el chip dice 3: no pueden discrepar |
| La cola contiene | handoff, inbound, vencido |
| La cola excluye | futuro, esperando al cliente, solo IA, anuncio, Laboratorio |
| "Todas" | sigue contando 7, sin el Laboratorio |
| "No leídas" | sigue contando 2 (esperando + anuncio), ninguna de la cola |
| "Anuncios" | sigue contando 1 y lista solo esa |
| Filtro de etapa "Interesado" | la cola baja a 1 y la lista a 1; al volver a "Toda etapa", 3 |
| Aislamiento por UI | la sesión de B ve su cola (1), ninguna conversación de A |

**Camino infeliz.**

| Caso | Resultado esperado |
|---|---|
| Sin sesión, `GET /api/conversations` | 401 |
| `GET /api/conversations/[id]` | 405 (el recurso no expone lectura) |
| PATCH sobre conversación de otra organización | 404, sin fuga |
| PATCH sobre conversación inexistente | 404 |
| `/inbox` sin sesión | redirige a `/login`; la API responde 401 desde el navegador |

## Nota de mantenimiento

La Bandeja mantiene abierto el SSE de `/api/events`, así que **`networkidle` no
llega nunca**: hay que esperar a `domcontentloaded` y luego al selector de la
fila. Los números de los chips se leen del texto del botón (la etiqueta y el
contador son hermanos, sin separador), no de una cadena completa.
