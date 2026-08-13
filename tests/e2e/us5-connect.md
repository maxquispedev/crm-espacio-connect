# Guion E2E — US5: Conexión del número (Embedded Signup)

> Conducido con Playwright (MCP) o `pnpm test:e2e` contra `pnpm dev` con wa-mock
> (`META_GRAPH_BASE_URL` → wa-mock/graph). El popup real de Meta no corre en
> wa-mock: el selftest ejercita el POST `/api/settings/whatsapp/embedded-signup`
> con `code` de prueba.

## Camino feliz

1. Abrir `/settings/whatsapp`.
   ✅ El camino principal es el botón **Conectar con Meta** (Coexistencia /
   WhatsApp Business App). El pegado manual queda plegado como
   “Conexión manual (operaciones)”.
2. GET `/api/settings/whatsapp` expone `embeddedSignup.appId` y `configId`
   (públicos) y **nunca** `META_APP_SECRET` ni el token completo.
3. Completar Embedded Signup (o POST autenticado con `code` + `wabaId` +
   `phoneNumberId` contra wa-mock).
   ✅ El backend canjea el code, valida el número, llama `subscribed_apps`
   (obligatorio), cifra el token y deja estado **Conectado** con display
   number, verified name si existe, y token …last4.
4. Sección Webhook (diagnóstico):
   ✅ URL COMPLETA con el verify token como segmento; no instruye a pegar
   override en Meta.

## Caminos infelices

5. Body sin `code` / `wabaId` / `phoneNumberId` → 422; no se guarda.
6. `code` con sufijo `-invalid` (wa-mock) → error de OAuth; no se guarda.
7. `wabaId = WABA-NOSUB` → `subscribed_apps` falla y el onboarding **no**
   queda como conectado.
8. Webhook GET handshake con verify token correcto → challenge; segmento
   incorrecto → 404 (cubierto también en guion US1).
9. El PUT manual (fallback operativo) sigue reconectando con token de
   prueba válido; token `-invalid` no pisa una conexión previa.
