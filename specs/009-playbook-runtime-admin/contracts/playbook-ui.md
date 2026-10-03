# Contrato — Editor técnico JSON del Playbook

> Contrato de la **capa de cliente** introducida por el corte 1 de la feature
> 009. La configuración durable, el versionado, la validación y la publicación
> **no cambian**: se siguen usando `ConfigV1Schema`, `/api/playbook/validate` y
> el resto de endpoints definidos en
> [`../../008-sales-playbook/contracts/playbook-api.md`](../../008-sales-playbook/contracts/playbook-api.md).
>
> Este documento existe para fijar **cómo se mapea un `ConfigV1` a dos
> textareas y de vuelta**, que es la única novedad de este corte.

---

## 1. Principio: proyección, no modelo

`ConfigV1` tiene nueve claves de primer nivel:

```ts
{
  product, offer, commercial_policy, priorities,
  writer, prohibitions, handoff, urgency_rules, jev_questions
}
```

El modelo durable sigue siendo **una** versión con el `ConfigV1` completo. La UI
presenta dos documentos:

| Documento de UI | Claves | Textarea |
|---|---|---|
| **Configuración comercial** | `{product, offer, commercial_policy, priorities, writer, prohibitions, handoff, urgency_rules}` | A |
| **Preguntas Jev** | `{jev_questions}` (el objeto completo de preguntas) | B |

### 1.1 Proyección (cargar)

```ts
const configEdit = { ...config };
delete configEdit.jev_questions;           // A = todo menos jev_questions
const jevEdit = config.jev_questions;     // B = el objeto jev_questions
```

### 1.2 Reassembly (guardar)

```ts
const next: ConfigV1 = { ...configEdit, jev_questions: jevEdit };
```

Ese objeto se envía **completo** a `PUT /api/playbook/draft`, exactamente igual
que hoy. **No** existe columna de texto, tabla aparte, ni endpoint de
preguntas. Si mañana se quisiera un orden de claves estable en los textareas, se
ordena en el cliente al proyectar; no afecta lo que se persiste.

### 1.3 Consecuencia invariante

> Lo que se guarda es un `ConfigV1` completo, byte a byte igual que con la UI por
> formularios. Cambiar de UI no cambia el contenido de la base de datos.

## 2. Validación en dos capas

| Capa | Quién decide | Qué puede detectar |
|---|---|---|
| Parseo | Cliente (`JSON.parse`) | Error de sintaxis, con **línea y columna** |
| Semántica | Servidor (`POST /api/playbook/validate`) | Zod: tipos, longitudes, enums; guardarraíles Jev |

**El cliente no implementa Zod.** `ConfigV1Schema` y `constants.ts` son código de
servidor. Publicar exige que el backend haya aceptado el documento, así que el
editor no puede ser una puerta trasera.

### 2.1 Flujo de un cambio

1. El admin edita A y/o B.
2. `Validar` → reassembly → `POST /api/playbook/validate`.
3. `200` → sin errores; `422` → se listan los `details[]` con su `path`.
4. `Guardar` → `PUT /api/playbook/draft` con el documento reassemblado.

Guardar sin validar es legítimo (el draft puede quedar incompleto a medias), pero
**Publicar** sigue estando gobernado por el backend.

## 3. Errores de parseo con línea y columna

`JSON.parse` de V8 incluye la posición del fallo en el mensaje:

```
Unexpected token } in JSON at position 412
```

Conversión a línea/columna, sin dependencias:

1. Extraer `position` del mensaje con una expresión regular.
2. Contar los `\n` del texto **anteriores** a `position` → `línea`.
3. `columna = position - índiceDelUltimoSaltoDeLineaAntesDePosition`.
4. Resaltar en el textarea la línea problemática, o al menos mostrarla en el
   mensaje.
5. Si el mensaje **no** trae posición, mostrar el error crudo **sin inventar**
   línea ni columna.

## 4. Errores de Zod y guardarraíles

`POST /api/playbook/validate` responde `422` con `details[]`. Cada entrada se
muestra junto al editor, con su `path` literal:

```
offer.monthlyBase · Expected number, received string
jev_questions.product_fit · clave protegida: no se puede editar
```

Las clases de guardarraíl que deben seguir siendo legibles en la UI, aunque ya no
se editen visualmente:

| Clase | Significado | Editable |
|---|---|---|
| `engine-required` 🔒 | la consume el motor; cambiarla rompe el contrato | No |
| known signal 📊 | señal conocida, con contrato de respuesta | No (claves y tipos) |
| analytical / custom ➕ | Texto libre del admins | Sí, dentro del JSON |

## 5. Acciones de la pestaña (sin cambios de contrato)

Se reutiliza exactamente el mismo ciclo de la UI actual:

| Acción | Endpoint |
|---|---|
| Crear draft | `POST /api/playbook/draft` |
| Guardar | `PUT /api/playbook/draft` |
| Validar | `POST /api/playbook/validate` |
| Publicar | `POST /api/playbook/publish` (nota obligatoria) |
| Historial | `GET /api/playbook/versions` |
| Rollback | `POST /api/playbook/rollback` (nota obligatoria) |
| Eliminar draft | `DELETE /api/playbook/draft` |
| Ver published | `GET /api/playbook` |

**Requisito de estado y versionado**, visible junto a los editores: versión
publicada, versión draft, `schema_version`, `version_number`, fechas y notas.

**Requisito de laboratorio**: un enlace/CTA claro hacia `/lab` para probar
Published vs Draft. Reutiliza el Laboratorio existente; no replica su runner.

## 6. Experiencia

- `textarea` monoespaciado (`font-mono`), `spellCheck={false}`, altura generosa.
- Estado inicial: contenido formateado con `JSON.stringify(obj, 2)`.
- **Formatear JSON**: `JSON.parse` → `JSON.stringify(…, 2)`. Deshabilitado si no
  parsea. No escribe nunca un documento que no haya parseado.
- Errores siempre visibles (no solo al blur).
- Desktop-first (lo administra Max), sin romper responsive: los dos editores se
  apilan en móvil.
- Botones coherentes con `components/ui/` existentes.

## 7. Lo que este contrato NO cambia

- `ConfigV1Schema` ni `constants.ts` (las guardas de §4).
- Los endpoints, sus códigos y sus cuerpos.
- El modelo de datos: ni una migración.
- `sales_playbook` / `sales_playbook_version`.
- El loader sin cache.
- El Laboratorio.
- El comportamiento del runtime productivo (eso es el corte 3).
