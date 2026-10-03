# Contrato — Comercial / Jev: layout y action bar

> Contrato de la **capa de cliente** de la feature 010. El backend
> (`/api/playbook/*`), el modelo de versionado y la proyección
> Config ↔ Preguntas Jev de la feature 009 **no cambian**.
> La justificación de cada decisión está en [`../research.md`](../research.md).

---

## 1. Principio: playground, no formulario

La pantalla no narrativo su propio producto. El admin es técnico: pega JSON,
valida, guarda, publica, prueba. Todo lo que no ayude a esas cinco acciones
sale del camino principal.

## 2. Layout (desktop-first)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Comercial / Jev     Producción: V2 · Editando: V3 draft   [Historial]│
│                     schema 1.0                                       │
├────────────────────────────────┬─────────────────────────────────────┤
│ CONFIGURACIÓN                  │ PRUEBA RÁPIDA          (corte 2)     │
│ [ Config ] [ Preguntas Jev ]   │ Conversación                         │
│                                │ { … }                               │
│ { JSON … }                     │ Probar: [ Draft ▼ ]  [ Ejecutar ]   │
│                                │                                     │
│                                │ RESULTADO                           │
│                                │ next_action  ask_more_questions     │
│                                │ lane          auto                  │
│                                │ human         false                 │
│                                │ Respuesta    "…"                    │
│                                │ [Ver JSON completo]                 │
├────────────────────────────────┴─────────────────────────────────────┤
│ [Validar] [Guardar] [Publicar]                    ···                │
└──────────────────────────────────────────────────────────────────────┘
```

- **En pantallas estrechas**: editor arriba, prueba rápida abajo. Mismos
  componentes, distinto orden.
- La columna derecha **solo aparece en corte 2**. En corte 1 el editor ocupa el
  ancho completo: el layout de dos columnas llega con la prueba rápida, para no
  dejar media pantalla vacía en un corte que no la tiene.
- La action bar es **sticky al fondo** del área de edición.

## 3. Cabecera compacta

Un solo bloque. Sin segunda cabecera "Sales Playbook" (la pestaña ya se llama
`Comercial / Jev`).

| Elemento | Origen del dato |
|---|---|
| `Comercial / Jev` | Nombre de la pestaña (`agent-client.tsx:19`) |
| `Producción: V{published.version_number}` | `/api/playbook` |
| `Editando: V{draft.version_number} draft` \| `Sin draft` | `/api/playbook` |
| `schema {schema_version}` | `/api/playbook` |
| `[Historial]` | Abre el modal de historial |

**No** se muestra en el camino principal: resumen del producto, precio,
prioridades en pills, cantidad de preguntas, explicación larga Published vs
Draft, CTA gigante al Laboratorio, ni badges de guardarraíles.

### 3.1 Sin draft: la acción es "Editar publicada"

Cuando no hay draft, el botón principal es **"Editar publicada"** (secundario:
"Historial"). Internamente sigue llamando a `createDraft` sobre la publicada.
Se elimina el copy "Crear draft desde esta versión" y "Crear draft desde esta
versión": es la misma acción, dicha como la que es.

Con draft, la cabecera ya dice `Producción: V2 · Editando: V3 draft`, así que
no hace falta un botón de crear.

## 4. Tabs Config / Preguntas Jev

Un **solo** editor JSON visible a la vez.

| Tab | Claves |
|---|---|
| `Config` | `product, offer, commercial_policy, priorities, writer, prohibitions, handoff, urgency_rules` |
| `Preguntas Jev` | `jev_questions` |

- La proyección y el reassembly son **los de 009** (`research.md` §1.4). El
  documento completo se reensambla al guardar.
- El estado de cada documento vive en el padre, así que cambiar de tab **no
  pierde lo escrito**.
- Se conservan textarea monoespaciado, `Formatear JSON`, error de parseo con
  línea/columna y errores server-side con `path`.
- Se conserva el `key={draft.id}` en el editor padre: es lo que impide que un
  refetch pise lo que el admin está escribiendo.

## 5. Línea de guardarraíles

Una línea discreta bajo los tabs, con ayuda pequeña:

> 🔒 `next_action`, `needs_human_call` y option keys contractuales están
> protegidas.

Es **informativa**: la autoridad es el servidor
(`assertJevProtectedKeys` + `ConfigV1Schema`). La línea no sustituye a la
validación ni promete nada que el backend no cumpla.

## 6. Action bar (contrato normativo)

Tres botones primarios, dos secundarias.

| Estado | `Validar` | `Guardar` | `Publicar` | `Descartar` | `Eliminar draft` |
|---|---|---|---|---|---|
| `dirty=true`, JSON válido | ON | **ON** | **OFF** | ON | ON si hay publicada |
| `dirty=true`, JSON inválido | OFF | OFF | OFF | ON | ON si hay publicada |
| `dirty=false`, JSON válido | ON | OFF | **ON** | OFF | ON si hay publicada |
| `dirty=false`, JSON inválido | OFF | OFF | OFF | OFF | ON si hay publicada |
| operación en vuelo | OFF | OFF | OFF | OFF | OFF |

`busy` deshabilita las cinco (comportamiento actual, se conserva).

### 6.1 La regla que fija C1-1

```tsx
// src/components/agent/playbook/playbook-draft-editor.tsx:150
<Button
  onClick={onPublish}
  disabled={busy || dirty || anySyntaxError}
  title={
    dirty
      ? "Guarda los cambios antes de publicar"
      : anySyntaxError
        ? "Corrige la sintaxis JSON antes de publicar"
        : "POST /api/playbook/publish: publica el draft guardado"
  }
>
  {publishing ? "Publicando…" : "Publicar"}
</Button>
```

Invariantes:

1. **Nunca** se habilita Publicar con `dirty=true`. `POST /api/playbook/publish`
   publica el draft **persistido**, no el texto local: habilitarlo ahí ofrece
   publicar algo que el admin no está viendo.
2. **No hay autosave.** El corte 1 no introduce ningún guardado implícito.
3. Publicar con `dirty=false` sigue siendo una decisión **deliberada**: abre el
   modal de comentario obligatorio ya existente.
4. La autoridad de si el draft es publicable sigue siendo el backend.

### 6.2 Estados visibles (sin saturar)

Una línea de estado, no cinco:

| Estado | Texto |
|---|---|
| cambios sin guardar | `Cambios sin guardar` |
| guardado | `Guardado` (o el aviso que ya emite `onSave`) |
| JSON inválido | `Hay JSON que no parsea` + línea/columna del editor |
| validando | `Validando…` en el botón |
| publicando | `Publicando…` en el botón |

Se elimina el párrafo explicativo de tres frases
(`playbook-draft-editor.tsx:167-172`): el `title` de cada botón ya lo dice.

## 7. Historial en modal

`[Historial]` abre un modal con `PlaybookVersionsList`, que **no cambia de
props ni de API**:

```
V3 · Published · 12 mar 2026 · "Ajuste de precios"
V2 · Archived  · 02 mar 2026 · "Baseline inicial"        [Rollback]
V1 · Archived  · 01 mar 2026 · "Semilla"                 [Rollback]
```

- El modal de `Modal` es `max-w-lg`; si el historial queda estrecho, se permite
  un `className` de ancho o un panel. **No** se modifica el `Modal` compartido.
- `Rollback` sigue exigiendo su comentario obligatorio (modal existente).
- El historial **no** aparece en el cuerpo principal de la pantalla.

## 8. Enlace al Laboratorio

Un enlace de texto pequeño, no un CTA con párrafo: **"Abrir Laboratorio
completo"** → `/lab`. El Laboratorio conserva su función completa; la prueba
rápida (corte 2) es el atajo, no el sustituto.

## 9. Cambio de comportamiento observable

| Antes | Después |
|---|---|
| Publicar habilitado con cambios sin guardar | Publicar deshabilitado; hay que guardar |
| Segunda cabecera "Sales Playbook" + card de estado | Una cabecera compacta |
| Dos editores JSON apilados | Tabs, un editor a la vez |
| Historial inline | Modal |
| 5 botones + 3 frases de explicación | 3 botones + estados, resto como secundarias |
| CTA con párrafo al Laboratorio | Enlace de texto |
| "Crear draft desde esta versión" | "Editar publicada" |

Backend, versionado, publicación, rollback y validación: **sin cambios**.
