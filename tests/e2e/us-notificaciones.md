# Guion E2E — Notificaciones de inbox (multi-org)

> Conducido por `scripts/e2e-selftest.mjs` contra la app real con mocks.
> Cubre el canal SSE, no la Notification API del SO (eso requiere gesto
> humano y permiso del navegador).

## Alcance

1. Usuario miembro de dos organizaciones.
2. Org A activa; inbound llega a org B.
3. El stream `GET /api/events` entrega `message.new` de B con payload enriquecido
   (`organizationId`, `organizationName`, `direction=in`, preview, contacto).
4. Un saliente en B (`direction=out`) no se trataría como notificación
   (el cliente filtra outbound).
5. Un eco del celular es `direction=out`.

## Fuera de este guion

- Navegador cerrado / Web Push.
- Click real en una Notification del SO.
