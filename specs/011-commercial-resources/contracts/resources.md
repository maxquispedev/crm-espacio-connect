# Contrato de recursos — cortes 1 y 2

## Persistencia mínima

Tabla propuesta `commercial_resource`: id, organization_id NOT NULL (FK cascade),
slot NOT NULL, media_asset_id nullable (FK), payload JSONB nullable, created_at,
updated_at. UNIQUE organization_id/slot, índice org-first. Slot enum/check cerrado:
los tres demo_* de spec.md y `payment_instructions`.
Video: media requerido, payload null, asset kind video/mime video/mp4 disponible,
con archivo local y org coincidente. Pago: media null, payload validado siguiente.
Ausencia de fila = recurso no configurado, no seed ficticio. Borrar asset no puede
crear referencia válida a media de otro tenant; usar RESTRICT o nulificación segura.
Validar forma en servidor y restricciones SQL razonables; no motor genérico JSON.

Payload de cobro (valores reales SOLO desde UI):

```ts
{
  transfers: Array<{
    bank: string; holder: string; currency: 'PEN' | 'USD';
    accountNumber?: string; cci?: string;
  }>;
  yape: { phone: string; holder: string } | null;
  paymentLink: string | null;
}
```

Máximo 5 cuentas. Banco/titular trim 1–120; cuenta/CCI strings 1–40 de dígitos,
espacios o guiones, al menos uno requerido; no convertir a number ni perder ceros.
Yape completo o null: teléfono peruano 9 dígitos (normalizar prefijo +51 opcional)
y titular 1–120. Link null o URL HTTPS absoluta ≤2048, sin usuario/password ni
host localhost/IP privada; no fetch ni validación de existencia o cobro externo.
Bloque incompleto se rechaza, nunca se publica parcialmente. Vacío válido =
transfers [] / yape null / paymentLink null. No tokens/PIN/credenciales de banco.

## API administrativa (solo corte 2)

Todas las rutas withAuth + org de sesión; no aceptar organizationId externo.
Permisos igual que configuración Comercial/Jev vigente; documentar política real.

- `GET /api/commercial-resources`: tres slots con configured y metadata segura
  (assetId, fileName, fileSize, mimeType, previewUrl interna) más paymentInstructions
  (config vacía si ausente). No storagePath, waMediaId ni credenciales.
- `PUT /api/commercial-resources`: JSON `{ paymentInstructions: payload }`;
  validar y persistir solo cobro, devolver config guardada. No tocar videos/playbook.
- `PUT /api/commercial-resources/videos/[slot]`: multipart `file`; crear asset
  local y reemplazar vínculo de ese slot. Sin conversación, Graph ni red externa.
  Retorna metadata segura del nuevo recurso, upload/replacement mismo contrato.
- Preview: `GET /api/media/[assetId]` existente, sesión del mismo tenant.

Errores: 400 multipart/JSON inválido, 401 sin sesión, 404 slot inexistente/asset
ajeno, 413 oversized, 415 no MP4, 422 configuración/archivo vacío/inválido,
5xx controlado de persistencia sin rutas/secretos. No sobrescribir anterior en error.
Nombre se sanea para presentación; solo assetId/org validados determinan path.
Detectar al menos estructura/firma MP4 en bytes, no confiar en extensión/MIME;
no introducir transcodificador ni garantizar codec por esa detección.
