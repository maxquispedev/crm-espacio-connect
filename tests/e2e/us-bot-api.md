# E2E — API de servicio para un cerebro externo (`/api/bot/*`)

Precondición: app corriendo con mocks (`WA_MOCK_ENABLED=true`,
`META_GRAPH_BASE_URL` → wa-mock), organización creada, conexión WhatsApp
guardada y `BOT_API_KEY` configurada (≥16 caracteres).

Esta superficie NO la usa el navegador: la usa un bot propio del operador que
quiere conducir la conversación sin que el token de WhatsApp salga del CRM. El
agente in-process de Espacio Connect puede quedar apagado.

## Autorización

1. `GET /api/bot/media/media123` SIN header `X-API-Key` → **401** `unauthorized`.
2. Lo mismo con una key equivocada → **401** (mismo cuerpo: no filtra si la key
   existe o no).

## Presencia: marcar leído + "escribiendo…"

3. Provocar un inbound (`POST /api/dev/wa-mock/inbound`) y tomar el
   `conversationId` de `GET /api/conversations`.
4. `POST /api/bot/typing {conversationId}` con la key → **200** `{ok: true}`.
5. `GET /api/dev/wa-mock/outbox` → el conteo NO cambió: marcar leído y el
   indicador no son mensajes salientes y no contaminan la bandeja.
6. Pausar la IA de esa conversación (toggle del panel, o
   `PATCH /api/conversations/{id} {aiEnabled:false}`) y repetir typing →
   **200** `{ok:false, reason:"ai_paused"}` y Meta ni se toca: con un humano
   atendiendo, "escribiendo…" le mentiría al cliente.
7. Conversación del Laboratorio (`is_test`) → `{ok:false, reason:"sandbox"}`.

## Media proxy

8. `GET /api/bot/media/media123` con la key → **200**, `content-type: image/*`
   y cuerpo no vacío. El token de WhatsApp nunca viajó al bot.
9. `GET /api/bot/media/media-inexistente` cuando Graph responde 404 → **404**
   `media_meta_failed` (no 500).

## Reinicio de la conversación de pruebas

10. Con la conversación en handoff (`aiEnabled:false`), `POST /api/bot/reset
    {conversationId}` con la key → **200** `{ok:true}`.
11. `GET /api/conversations` → esa conversación vuelve con `aiEnabled: true` y
    sin `handoffAt`; el lead está en la PRIMERA etapa del pipeline.
12. El historial de mensajes del inbox sigue completo: el reset es de estado,
    no borra auditoría.
13. `POST /api/bot/reset` sin key → **401**.

## Camino infeliz

14. `POST /api/bot/typing` con un `conversationId` inexistente → **404**.
15. Con Meta caído (token `...-invalid` en el mock), typing → **200**
    `{ok:false, reason:"meta_error"}`: es best-effort por contrato, al bot
    jamás le vale reintentarlo.
