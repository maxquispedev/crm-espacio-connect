# Corte 1 — Simplificar Comercial / Jev + fix de Publicar

Objetivo: dejar la pantalla limpia y, sobre todo, **corregir la regla
Guardar/Publicar** sin tocar backend, versionado ni runtime.

Al terminar: `refactor(playbook): simplificar Comercial Jev`, gate en verde,
árbol limpio, y `tasks.md` con evidencia real.

---

## Contexto obligatorio (léelo antes de tocar nada)

1. `AGENTS.md`
2. `.specify/memory/constitution.md`
3. `docs/CURRENT_STATE.md`
4. `specs/010-playbook-playground-ux/spec.md` (alcance §3.1)
5. `specs/010-playbook-playground-ux/contracts/playground-ui.md` (**normativo**
   para el layout y la action bar)
6. `specs/010-playbook-playground-ux/research.md` §1
7. `specs/010-playbook-playground-ux/tasks.md` §Corte 1
8. Feature 009: `specs/009-playbook-runtime-admin/plan.md` §3 (la proyección
   Config/Preguntas Jev que este corte reorganiza)
9. Código real:
   - `src/components/agent/playbook/playbook-client.tsx` (el archivo grande:
     `:258-343` carga y cabecera, `:346` `VersionState`, `:349-364` CTA del
     Lab, `:373-388` card de la publicada, `:394-468` `DraftEditorPane`,
     `:470-477` historial inline, `:603-619` `VersionState`)
   - `src/components/agent/playbook/playbook-draft-editor.tsx`
     (`:77` `anySyntaxError`, `:124-165` action bar, **`:150` el bug**)
   - `src/components/agent/playbook/json-editor.tsx` (**conservar**)
   - `src/components/agent/playbook/playbook-versions-list.tsx`
     (**conservar**, pasa a modal)
   - `src/components/agent/playbook/summary.ts`, `types.ts`, `fields.tsx`
   - `src/app/api/playbook/*` (**no tocar**)
10. Tests: `tests/unit/playbook-json-editor.test.ts` y los tests de playbook.

Código y tests mandan sobre documentación antigua.

## Orden de trabajo

### Paso 1 — El fix, aislado, con sus tests

Antes de tocar nada visual. En `playbook-draft-editor.tsx:150`:

```tsx
// hoy (invertido)
<Button onClick={onPublish} disabled={busy || !dirty}>

// correcto
<Button
  onClick={onPublish}
  disabled={busy || dirty || anySyntaxError}
  title={dirty ? "Guarda los cambios antes de publicar" : /* … */}
>
```

- `anySyntaxError` ya existe (`:77`). No inventes estado nuevo.
- **Sin autosave.** Ningún guardado implícito. El corte no lo permite.
- Escribe los tests **antes** de verificar que pasan, y confirma que **fallan
  contra el código actual**. Un test que pasa antes de arreglar el bug no está
  fijando el bug.
- Casos mínimos (`contracts/playground-ui.md` §6): `dirty=true` → Publicar OFF;
  `dirty=false` → Publicar ON; JSON inválido → Publicar OFF y Guardar OFF;
  acción en vuelo → las cinco OFF.

### Paso 2 — La limpieza visual

Aplica el contrato. Piezas a eliminar del camino principal (con su reemplazo):

| Pieza | Reemplazo |
|---|---|
| `<h3>Sales Playbook</h3>` (`:311-313`) | La cabecera `Comercial / Jev` |
| `VersionState` (`:346`) | `Producción: Vx · Editando: Vy draft` en la cabecera |
| CTA con párrafo del Lab (`:349-364`) | Enlace de texto "Abrir Laboratorio completo" |
| `PlaybookPublishedCard` (`:373-388`) | La cabecera muestra la versión publicada |
| Historial inline (`:470-477`) | Modal desde `[Historial]` |
| 5 botones + 3 frases (`:124-172`) | 3 primarias + secundarias + `title` |
| "Crear draft desde esta versión" | **"Editar publicada"** (misma llamada `createDraft`) |

**Reutiliza, no reescribas**: `JsonEditor`, `FormatButton`, `Modal`,
`NoticeBanner`, `PlaybookVersionsList`, y los callbacks `onValidate`/`onSave`/
`onPublish`/`onDiscard`/`onDelete`.

**Conserva** el `key={draft.id}` (`:395`): impide que un refetch pise lo que el
admin escribe.

### Paso 3 — Tabs Config / Preguntas Jev

Un editor a la vez. El estado de los dos documentos vive en el padre, así que
cambiar de tab no pierde lo escrito. El guardado sigue reensamblando el
documento completo.

**Test obligatorio**: escribir en Config y en Preguntas, cambiar de tab varias
veces, guardar, y comprobar que el documento persistido llegó íntegro. Es el
riesgo real de los tabs y no lo cubre ningún test existente.

### Paso 4 — Historial en modal

`[Historial]` abre un modal con `PlaybookVersionsList` sin cambiar sus props ni
las APIs. Si el `Modal` (`max-w-lg`) queda estrecho, usa un `className` de ancho
o un panel. **No modifiques el `Modal` compartido** por el resto de la app.

### Paso 5 — Layout

Desktop-first; en pantalla estrecha, editor arriba. **La columna de Prueba rápida
no se crea en este corte**: llega en el corte 2. No dejes media pantalla vacía.

## Reglas duras

- **Solo cliente.** Nada de `src/app/api/**`, `src/lib/**`, `src/server/**`, ni
  schema de BD.
- No toques `/api/lab/*`, el runtime Published, pricing, `ConfigV1Schema`,
  option keys, contratos Jev, loader, writer, follow-ups, WhatsApp, webhook ni
  CAPI.
- No añadas dependencias. No Monaco. El textarea actual sirve.
- Si al simplificar no encuentras dónde quedó una acción, **no la elimines**: la
  simplificación no puede costar una capacidad.
- No hagas refactors oportunistas fuera de estos pasos.

## Gate

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Luego, comportamiento observable:

- Unit tests de la action bar y de no pérdida de estado.
- E2E: extiende el arnés `scripts/e2e-selftest.mjs` con la **Sección 018**
  (ciclo completo en la UI real + camino infeliz de JSON inválido + la regla
  Publicar por estado). Sigue el patrón de las Secciones 016/017: una función
  `runSection018()` y su dispatch en `main()`.
- Ejecuta `pnpm test:e2e` con `WA_MOCK_ENABLED=true` si el entorno lo permite.

**Máximo 2 iteraciones autónomas de fix por gate.** Si el gate no pasa en la
segunda, para y reporta con la salida real.

**No declares E2E si no lo ejecutaste.** Si no se pudo ejecutar, escribe
exactamente eso en `tasks.md`.

## Al terminar

1. Actualiza `specs/010-playbook-playground-ux/tasks.md` §Corte 1 con evidencia
   real: comandos ejecutados, resultados, y el estado real del E2E.
2. Actualiza `docs/CURRENT_STATE.md` y `docs/playbook.md` **solo si** cambió un
   contrato observable (la regla Publicar/`dirty` y el layout califican).
3. Un commit: `refactor(playbook): simplificar Comercial Jev`.
4. `git status` limpio.
5. **STOP.** No empieces el corte 2.
