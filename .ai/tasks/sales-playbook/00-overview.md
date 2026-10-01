# Sales Playbook — overview

> Convierte la estrategia comercial de Vende Veloz —hoy congelada en
> TypeScript en `src/server/sales/vende-veloz.ts` y
> `src/server/sales/questions.ts`— en configuración durable, versionada,
> tenant-safe y editable sin redeploy.

## Plan SDD

Lee obligatoriamente, en este orden:

- `specs/008-sales-playbook/spec.md`
- `specs/008-sales-playbook/plan.md`
- `specs/008-sales-playbook/tasks.md`
- `specs/008-sales-playbook/research.md`
- `specs/008-sales-playbook/data-model.md`
- `specs/008-sales-playbook/contracts/playbook-config.md`
- `specs/008-sales-playbook/contracts/playbook-api.md`
- `specs/008-sales-playbook/quickstart.md`

## Cortes (en orden estricto)

| # | Task file | Objetivo único | Commit esperado |
|---|---|---|---|
| 1 | `01-cut1-model-and-bootstrap.md` | Schema + migración + tipos Zod + bootstrap V1 (no tocar runtime) | `feat(playbook): schema versionado + bootstrap V1` |
| 2 | `02-cut2-api-versioning.md` | Endpoints tenant-safe: draft/update/validate/publish/rollback/list | `feat(playbook): API draft/publish/rollback` |
| 3 | `03-cut3-runtime.md` | build-state + writer + orchestrator cargan playbook publicado; agent profile tone/instructions al writer; snapshot persistido | `feat(playbook): runtime consume playbook publicado` |
| 4 | `04-cut4-ui-playbook.md` | Editor UI en `agent-client.tsx` por bloques (NO JSON crudo) | `feat(playbook): UI editor por bloques` |
| 5 | `05-cut5-jev-editor.md` | Editor Jev con guardarraíles (estructurales protegidas, analíticas flexibles) | `feat(playbook): editor Jev con guardarraíles` |
| 6 | `06-cut6-lab-commercial.md` | Laboratorio comercial ejecuta pipeline real con Published vs Draft | `feat(lab): laboratorio comercial con Published vs Draft` |
| 7 | `07-cut7-cases-bootstrap-audit.md` | "Guardar conversación como caso" + auditoría + cierre + docs | `feat(playbook): cerrar feature 008 — playbook durable V1 publicado` |

Cada task file ordena al agente:

1. leer AGENTS.md + constitución + CURRENT_STATE;
2. leer el spec/plan/tasks de 008 + docs de dominio;
3. leer código y tests reales;
4. verificar estado de tasks antes de implementar;
5. implementar **solo** ese corte;
6. actualizar `tasks.md` con marcas reales;
7. actualizar `docs/CURRENT_STATE.md` si aplica;
8. ejecutar gates apropiados;
9. **un solo commit** con mensaje explícito;
10. working tree limpio.

## Cómo ejecutar

```bash
# Desde repo root, Bash/WSL.
./scripts/ai/run-sales-playbook.sh           # desde CUT 1
START_CUT=4 ./scripts/ai/run-sales-playbook.sh  # reanudar
```

Variables configurables:

- `START_CUT=n` reanuda desde el corte N.
- `CUT_TIMEOUT` (default `60m`).
- `CUT_PERMISSION` (default `full`).
- `HEARTBEAT_SECONDS` (default `25`).

Logs por corte en `.ai/logs/sales-playbook/`.

## NO HACER

- Tocar webhook WhatsApp, sender, inbox, CAPI, stage-gateway, follow-up
  engine salvo inyección/configuración estrictamente necesaria.
- Crear Redis, colas externas, S3, dependencias nuevas.
- Crear un constructor visual de workflows.
- Importar los 89 checkpoints históricos de jevveloz (queda fuera del
  008).
- Editar `VENDE_VELOZ_*` o `JEV_SALES_QUESTIONS_V2` salvo para
  reasignarlos como `DEFAULTS_ONLY`.

## Done criteria global

La feature 008 no se declara Hecha hasta que los siete cortes estén
verdes. Ver `specs/008-sales-playbook/spec.md` § Definición de Hecho.