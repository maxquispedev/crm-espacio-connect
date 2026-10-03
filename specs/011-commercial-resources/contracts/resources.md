# Contrato de recursos — cortes 1 y 2

## Persistencia mínima

Tabla implementada en C1 `commercial_resource`: id, organization_id NOT NULL (FK cascade),
slot NOT NULL, media_asset_id nullable (FK), payload JSONB nullable, created_at,
updated_at. UNIQUE organization_id/slot, índice org-first. Slot enum/check cerrado:
los tres demo_* de spec.md y `payment_instructions`.
Video: media requerido, payload null, asset kind video/mime video/mp4 disponible,
con archivo local y org coincidente. Pago: media null, payload validado siguiente.
Ausencia de fila = recurso no configurado, no seed ficticio. Borrar asset no puede
crear referencia válida a media de otro tenant; usar RESTRICT/NO ACTION o nulificación segura.
Validar forma en servidor y restricciones SQL razonables; no motor genérico JSON.

### Contrato implementado del corte 1

`src/lib/commercial/resources.ts` exporta catálogos cerrados, tipos
`CommercialResourceValue` / `PaymentInstructions` y schemas Zod estrictos.
Es validación de servidor (usa `node:net` para direcciones IP); el cliente puede
consumir los tipos mediante `import type`, sin importar el validador al navegador.
`hasPaymentInstructions` distingue un payload válido vacío de uno con métodos.

`src/lib/commercial/store.ts` ofrece solo:

```ts
getCommercialResource(organizationId, slot): Promise<CommercialResource | null>
upsertCommercialResource(organizationId, value): Promise<CommercialResource>
```

`value` exige `{slot, mediaAssetId, payload}` completo: demo lleva media y payload
null; pago lleva media null y el bloque de cobro entero. El store valida antes
de escribir y devuelve valores normalizados. No acepta organizationId dentro de
value; exige tenant explícito no vacío. SELECT de recursos/media y condición
del UPDATE por conflicto usan `scoped()`. La unicidad org/slot gobierna el upsert
atómico: conserva id `cr_*` y createdAt; reemplaza el valor y updatedAt.

No hay seeds ni fallback ficticio. Lectura ausente devuelve null; pago vacío
se puede persistir pero `hasPaymentInstructions` es false. En lectura, una demo
cuya media dejó de estar disponible devuelve null sin borrar su configuración.
Errores de BD o payload persistido corrupto se propagan, no se disfrazan de ausencia.

Para demos, escritura y lectura comprueban asset del mismo tenant, kind video,
MIME exacto video/mp4, estado available, storagePath derivado org/id, tamaño
positivo dentro del límite nativo vigente y archivo regular local del tamaño
declarado. Una escritura inválida lanza `CommercialResourceMediaError` (code
`commercial_resource_media_invalid`) sin rutas ni metadata ajena y conserva el
slot anterior. No descarga Graph ni envía mensajes. Firma/codec del MP4 se
comprobarán en el upload del corte 2 (codec con archivo real); C1 valida
referencia, metadata y archivo. El disco puede perderse después de guardar:
esta comprobación no garantiza disponibilidad futura y se repite en lectura.

Migración **0009_commercial_resources.sql**, journal idx **11** (el número de
feature no determina el de migración). Sigue el mecanismo manual reejecutable
de 0008–0008c: CREATE IF NOT EXISTS y DO/duplicate_object, sin snapshots nuevos
ni cambios a migraciones previas. Añade UNIQUE media_asset(org,id), FK compuesta
commercial_resource(org,media) y org/slot UNIQUE, índice org/media, CHECK de
slots y forma básica JSONB (incluye máximo cinco transferencias). La validación
detallada de cuenta/Yape/link está en Zod, no en SQL; escritura directa en
BD no sustituye el store. El CHECK usa coalesce false para rechazar claves ausentes.

La FK media usa **ON DELETE NO ACTION**: impide borrar directamente un asset
referenciado y permite comprobar integridad al final de una sentencia que
elimina la organización y ambas tablas por cascade. No nulifica el vínculo ni
deja una demo con media null. El archivo no se elimina por este store.

**BD real PENDIENTE en este entorno:** no PostgreSQL/psql/Docker disponibles.
La suite `commercial-resource-postgres.test.ts` exige opt-in con
`COMMERCIAL_RESOURCES_TEST_DATABASE_URL`, host local y nombre de BD dedicada
`commercial_resources_test` (o sufijo `_...`). Nunca usa DATABASE_URL como fallback.
Prueba migrador dos veces, SQL nuevo dos veces, persistencia real, aislamiento,
FK cross-tenant, UNIQUE/CHECK, borrado de media y cascade de organización.
Los dobles unitarios no prueban estas restricciones físicas ni la aplicación
de migración: los cuatro casos PostgreSQL están omitidos hasta disponer de BD.

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
