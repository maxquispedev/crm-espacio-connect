# Operator Workspace + Espacio Connect — mapa de cortes

Estado **bootstrap**: ocho cortes pendientes, cero implementados. Cada archivo
numerado `01`–`08` es el prompt completo de **una sesión nueva e independiente de
mcode**. `00-overview.md` es guía: nunca se ejecuta.

| # | Corte | Spec | Commit objetivo |
|---|---|---|---|
| 1 | Estado durable de atención y recordatorios humanos | 013 | `feat(inbox): persistir atención y recordatorios humanos` |
| 2 | Bandeja "Por atender" | 013 | `feat(inbox): añadir cola por atender` |
| 3 | Agenda y programación humana | 013 | `feat(inbox): añadir agenda de recordatorios humanos` |
| 4 | Flujo operativo / UX integrada | 013 | `feat(inbox): integrar flujo operativo de atención` |
| 5 | Verificación del workspace | 013 | `test(inbox): verificar workspace operativo` |
| 6 | Rebrand Espacio Connect | 014 | `chore(brand): consolidar Espacio Connect` |
| 7 | Rediseño práctico | 014 | `refactor(ui): simplificar experiencia de Espacio Connect` |
| 8 | Polish y regresión final | 014 | `test(ui): cerrar workspace de Espacio Connect` |

Estado durable y evidencia: `specs/013-operator-workspace/tasks.md` y
`specs/014-espacio-connect-rebrand/tasks.md`.
Runner: `scripts/ai/run-operator-workspace-mcode.sh` (ver quickstart de 013).

Ejecución: Bash/WSL **externo**, nunca desde dentro de una sesión de mcode.

```bash
# Bloque 013
START_CUT=1 END_CUT=5 CUT_TIMEOUT=90m bash scripts/ai/run-operator-workspace-mcode.sh
# Bloque 014 (tras revisar gates/evidencia de 1–5)
START_CUT=6 END_CUT=8 CUT_TIMEOUT=90m bash scripts/ai/run-operator-workspace-mcode.sh
```

Nunca: resume, runner anidado, `reset`/`checkout`/`clean` automático, `stash`,
`rebase`, auto-revert, `push` ni deploy. Un corte fallido **conserva** sus cambios y
se termina en una sesión nueva e interactiva antes de reanudar en N+1.

Invariantes para los 8 cortes:

1. Sesión nueva por corte. El prompt es autosuficiente: no dependas de otro chat.
2. Un corte = un objetivo = **exactamente un commit**.
3. Árbol limpio al terminar. Si queda sucio, el runner se detiene (69).
4. Nunca declares READY sin E2E real ejecutado y registrado.
5. Actualiza `tasks.md` del spec activo con evidencia real y `docs/CURRENT_STATE.md`
   cuando cambie el estado global.
6. Código y tests reales > documentos históricos.
