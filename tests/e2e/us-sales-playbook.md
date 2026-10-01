# US — Sales Playbook: editor por bloques (Corte 4, Feature 008)

Historia de usuario: **como operador de Espacio Connect, quiero editar el
playbook comercial por bloques (producto, oferta, política, prioridades,
writer, prohibiciones, handoff, urgencia) y publicarlo con un comentario,
sin tocar JSON ni construir flujos visuales.**

Cubre T401–T407. La parte API está automatizada en
`scripts/e2e-selftest.mjs` → sección **013** (`pnpm test:e2e`); este guion
cubre lo que la automatización no puede: el comportamiento visible.

> Nota de arnés: el corte 4 se añadió como **sección 013**, no 012, porque
> la 012 ya la ocupa el spec 007 (Meta CAPI). Ver `tasks.md`.

## Precondiciones

- App arriba con los mocks del entorno de pruebas:

  ```bash
  WA_MOCK_ENABLED=true \
  META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph \
  OPENROUTER_BASE_URL=http://localhost:3000/api/dev/ai-mock \
  pnpm dev
  ```

- Sesión con una organización que tenga el Sales Orchestrator activo, para
  que el bootstrap haya sembrado la V1. Si `GET /api/playbook` responde
  404, la UI muestra el estado vacío explicativo (no siembra por su cuenta).

## 1. Llegar al editor (T401)

1. Entra a `/agent`.
2. El header conserva el switch **Encendido/Apagado** del agente (no se
   movió con los tabs).
3. Abajo aparecen tres tabs: **Comportamiento**, **Conocimiento**,
   **Sales Playbook**.
4. `Comportamiento` sigue mostrando `SalesOrchestratorCard`,
   `SalesFollowUpsCard` y `ProfileSection`; `Conocimiento` muestra
   `KbSection`. Nada se perdió al tabificar.
5. Click en **Sales Playbook**.

**Esperado:** la tarjeta de la versión publicada con metadatos, el
mini-resumen del contenido y los badges por clase de pregunta Jev.

## 2. Estado vacío (T402)

Si la organización no tiene playbook:

- El mensaje dice literalmente: *"El bootstrap multi-org siembra la V1 al
  boot del sistema. Si no aparece, contacta al administrador."*
- Se puede pulsar **Crear draft** (operación administrativa) y **Refetch**.
- La UI **no** siembra la V1 por su cuenta.

## 3. Tarjeta de la publicada (T403)

Verifica en la tarjeta de la versión publicada:

- `version_number` (V1), `schema_version` (1.0), `published_at` y `notes`.
- Producto: nombre + one-liner.
- **Precio** en una línea: `S/{setup} (una vez) + S/{monthlyBase}/mes hasta
  {N} activos` (+ extra por activo si aplica).
- **Prioridades primarias** numeradas y en orden.
- Badges por clase de pregunta Jev:
  - 🔒 obligatorias para el motor → **2**
  - 📊 señales que el motor reconoce → **6**
  - ➕ analíticas / propias → las que haya
- **Crear draft desde esta versión**: deshabilitado si ya hay draft
  abierto (con la explicación debajo).
- **Ver historial** despliega la tabla de versiones.

## 4. Editar por bloques (T404)

1. **Crear draft desde esta versión** (o el botón homónimo de la barra).
   Aparece la tarjeta `Draft V2`.
2. Recorre los ocho bloques: Producto · Oferta · Política · Prioridades ·
   Writer · Prohibiciones · Handoff · Urgencia.
3. No hay JSON crudo en ninguna parte: cada bloque es un formulario.
4. **Writer** muestra exactamente 7 textareas, una por `next_action`, en
   orden fijo.
5. **Prioridades**: tres listas con flechas ↑/↓ para reordenar y tope de 8
   elementos por nivel (`3/8` en el contador).
6. **Prohibiciones**: edita `prohibitedClaims`; la lista
   *nunca prometer* de la Oferta aparece como referencia de solo lectura.
7. **Handoff**: 5 textareas (auto, auto_close, human, wait, stop).
8. **Preguntas Jev**: no editables en este corte. Solo el resumen con el
   total y el badge por clase.

### Validación en vivo

1. Vacía el campo **Nombre** del bloque Producto.
2. Espera ~300 ms (throttle) sin tocar nada más.
3. **Esperado:** el error aparece en rojo **debajo del campo**, y la barra
   inferior resume los problemas. **Publicar** queda deshabilitado.
4. Escribe un nombre válido → el error desaparece solo.
5. Deja un precio negativo → el error aparece bajo ese campo numérico.

## 5. Guardar y descartar (T404)

1. Cambia `writer.present_price` (bloque Writer).
2. **Guardar cambios** → banner "Cambios guardados en el draft". El botón
   se deshabilita hasta que vuelvas a editar (no hay cambios pendientes).
3. Edita otra cosa y pulsa **Descartar cambios** → el editor vuelve al
   contenido del servidor (tu edición se pierde a propósito).

## 6. Publicar (T406)

1. Con el draft válido, pulsa **Publicar**.
2. Aparece un modal con el comentario **obligatorio**:
   - con menos de 3 caracteres el botón **Publicar** está deshabilitado
     y sale el aviso "Mínimo 3 caracteres";
   - con un comentario válido, confirma.
3. **Esperado:** banner de éxito, la versión nueva pasa a **En vigor** y el
   draft desaparece.

## 7. Historial y rollback (T405/T406)

1. Pulsa **Ver historial**.
2. La tabla muestra versión, estado, creada, publicada, archivada, notas y
   tamaño.
3. Click en una fila → se despliega el detalle (producto, precio,
   prioridades, conteo Jev) y se pide bajo demanda a
   `GET /api/playbook/versions/:id`.
4. En una fila **archivada** que **no** es la publicada actual aparece
   **Rollback a V{n}**.
5. Pulsa **Rollback** → modal con comentario obligatorio → confirma.
6. **Esperado:** la versión elegida vuelve a **En vigor** y la anterior se
   archiva. El contenido publicado es el de esa versión.

## 8. Eliminar draft (T406)

1. Crea un draft.
2. Con una publicada activa, aparece **Eliminar draft** (rojo).
3. Confirma → el draft desaparece y la publicada sigue en vigor.
4. Si **no** hay publicada activa, el botón no aparece y se explica por
   qué: no se puede dejar el negocio sin playbook en vigor.

## 9. Camino infeliz

- **Sin red**: una llamada fallida muestra el error en un banner y la app
  **no se cuelga**; puedes reintentar con **Refetch**.
- **Dos pestañas**: si otra sesión publica mientras editas, el publish
  devuelve 409 y la UI lo muestra; recargas con **Refetch**.
- **Validación rota**: si el documento no pasa las guardarraíles Jev,
  **Publicar** nunca se habilita y el error se ve por campo.

## 10. Rejillas y móvil

- Reduce el ancho: los formularios de **Oferta** y **Política** pasan de 2
  columnas a 1, y las tablas del historial hacen scroll horizontal
  (`min-w` + `overflow-x-auto`) sin romper el layout.
