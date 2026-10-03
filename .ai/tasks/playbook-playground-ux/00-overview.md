# Overview — Feature 010 Playbook Playground UX

Runner: `scripts/ai/run-playbook-playground-ux.sh`
Spec: `specs/010-playbook-playground-ux/`
Estado durable: `specs/010-playbook-playground-ux/tasks.md`

---

## Qué se está construyendo

`Comercial / Jev` como **playground técnico**: el admin pega/edita JSON, valida,
guarda, publica y prueba, sin ruido en medio. Dos cortes, ni uno más.

El bug que abre la feature está en producción y es de seguridad de estado, no de
estética: `Publicar` se habilita con cambios sin guardar
(`playbook-draft-editor.tsx:150`, `disabled={busy || !dirty}`), mientras
`POST /api/playbook/publish` publica el draft **persistido**. Un admin puede
creer que publica lo que está escribiendo y en realidad publicar la versión
anterior de su draft. El corte 1 cierra eso primero, aislado.

## Los 2 cortes

| # | Corte | Commit | Núcleo |
|---|---|---|---|
| 1 | Simplificar Comercial / Jev + fix Publicar | `refactor(playbook): simplificar Comercial Jev` | La regla `dirty` correcta y la pantalla limpia. Solo cliente. |
| 2 | Prueba rápida embebida | `feat(playbook): añadir prueba rápida sandbox` | Un caso ad-hoc por el pipeline real del Lab, con decisión + plan + writer. |

El orden es fijo: la prueba rápida vive en la pantalla que simplifica el corte 1.

## Decisiones ya tomadas (no re-litigar en los cortes)

Están argumentadas en `specs/010-playbook-playground-ux/research.md` con
evidencia de código. Los cortes las aplican, no las reabren:

1. **Fix de Publicar = una línea + `title`**, sin estado nuevo y **sin
   autosave**. `anySyntaxError` ya está en el scope (`playbook-draft-editor.tsx:77`).
2. **Se borra ruido, no capacidad.** Cada pieza eliminada tiene reemplazo
   declarado en `contracts/playground-ui.md` §3.2. Si al simplificar no
   encuentras dónde quedó una acción, no la elimines.
3. **Tabs sin pérdida de estado** porque el estado de los dos documentos vive
   en el padre, no en el subárbol que se desmonta, y el guardado reensambla el
   documento completo (`playbook-client.tsx:411-414`).
4. **`POST /api/lab/runs` no sirve** para la prueba rápida: solo acepta
   `playbook_mode`, corre la cohorte de personas y responde 202.
5. **Corte 2 = Diseño A**: el preview invoca `runSalesOrchestratorTurn`, la
   **misma** función que el Laboratorio, mediante un helper de sandbox
   **extraído** del runner. Descartada la composición DB-free: recompone el
   pipeline y deja de ser el pipeline real.
6. **`runSalesOrchestratorTurn` devuelve `void`**: la decisión se lee de
   `lead.lastJevDecision` y el texto del writer de los mensajes `out`, antes
   del cleanup.
7. **El preview no acepta JSON local**: lo probado sale de BD, así que no puede
   haber divergencia entre lo probado y lo publicado.
8. **`/lab` queda como Laboratorio completo.** La prueba rápida es el atajo
   "cambié una instrucción → ¿qué haría ahora?".

## Invariantes (válen en los 2 cortes)

- No tocar: pricing, `ConfigV1Schema`, option keys, contratos Jev, loader,
  writer comercial, follow-ups, WhatsApp, webhook, CAPI, DB schema, runtime
  Published.
- No añadir dependencias. No Monaco. No plataforma de workflows.
- `organization_id` en toda fila nueva; `scoped()` en cada query; org siempre de
  la sesión.
- `is_test=true` en cualquier caso sandbox. Cero efectos reales.
- Un commit por corte, árbol limpio, sin push.
- No declarar E2E si no se ejecutó.

## Cómo corre el runner

```bash
# los 2 cortes
scripts/ai/run-playbook-playground-ux.sh

# reintentar un corte
START_CUT=2 scripts/ai/run-playbook-playground-ux.sh
```

- Una sesión **nueva** de `mcode exec` por corte. Nunca `--continue`.
- `CUT_TIMEOUT` (por defecto 3600s), `CUT_PERMISSION` (por defecto
  `bypassPermissions`), `HEARTBEAT_SECONDS` (30).
- Logs en `.ai/logs/playbook-playground-ux/`.
- Fail-fast: exit ≠ 0, árbol sucio o sin commit nuevo ⇒ para.

## Recuperación (si un corte falla a mitad)

1. **No** reset, **no** checkout destructivo, **no** descartar trabajo parcial.
2. `git status` + `git log` para ver qué quedó.
3. Nueva sesión para terminar **ese mismo** corte: `START_CUT=N`.
4. Gates, commit, árbol limpio, y seguir con `N+1`.

El runner está hecho para exactamente eso: `START_CUT` existe para reintentar
un corte sin repetir los anteriores.

## Orden de los archivos

| Archivo | Rol |
|---|---|
| `specs/010-playbook-playground-ux/spec.md` | Qué y por qué (alcance, fuera de alcance, DoD) |
| `.../research.md` | Evidencia de código y decisiones de arquitectura |
| `.../plan.md` | Estrategia por corte, Strategy Matrix, Constitution Check |
| `.../tasks.md` | **Estado durable** — se actualiza con evidencia real |
| `.../contracts/playground-ui.md` | Layout, cabecera, tabs, action bar |
| `.../contracts/playground-preview-api.md` | Contrato de `POST /api/lab/preview` |
| `01-cut1-simplify-playbook-ui.md` | Prompt del corte 1 |
| `02-cut2-embedded-quick-test.md` | Prompt del corte 2 |
