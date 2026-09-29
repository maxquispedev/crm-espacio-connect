# Runner Vende Veloz — salida a campañas

Objetivo: dejar Espacio Connect listo técnicamente para lanzar campañas Click-to-WhatsApp de Vende Veloz sin reabrir el núcleo comercial ya construido.

Este paquete se ejecuta con `scripts/ai/run-vendeveloz-launch.sh`.

## Principio operativo

Un corte = una sesión nueva de MiniMax = un objetivo acotado = un commit atómico.

No usar `--continue`. Cada corte reconstruye contexto desde el repositorio.

## Secuencia

1. Cerrar spec 005: rename rápido del contacto.
2. Abrir spec 006: anuncio de origen.
3. Implementar servidor/datos de 006.
4. Implementar UI/E2E y cerrar 006.
5. Abrir spec 007: atribución/CAPI.
6. Crear una única puerta de cambio de etapa, sin cambiar comportamiento.
7. Implementar CAPI core y conexión con la puerta de etapas.
8. Implementar Ajustes → Anuncios, E2E y cerrar 007.
9. Auditoría final de readiness para Vende Veloz.

## Upstream de referencia

Repositorio: `kevinrivm/vocero-crm`.

Commits relevantes:

- `f22ac03d5854a1f64581ceadb0a54072b2ae2419` — spec 018 anuncio de origen.
- `2783c9a01ba79785bb9c1cafac085f1480edba74` — persistencia/captura 018.
- `53524ab1a163a504deaa0796d44c349ecbbf23ed` — UI 018.
- `cf440653ab7b2d60090f1bdde51f1630d2a9ba47` — pruebas 018.
- `17869cc6e79c868ad963f5b19132970ebf8342b4` — cierre 018.
- `0a154ea2711ad5350e20451c573a7863b926cfed` — spec 016 CAPI.
- `75124422bba2298bb21cf3e712cae16b31f01ce2` — implementación 016 CAPI.
- `52c503462889f4df30f042727034fa083a3624a6` — merge 016.

Portar selectivamente. **Nunca hacer merge/rebase bruto del upstream.**

## Guardrails

- Respetar multi-organización interna y `organization_id`.
- No romper Sales Orchestrator/Jev ni follow-ups.
- Jev interpreta; CRM ejecuta; writer redacta.
- El cambio de etapa del Sales Orchestrator debe pasar por la misma puerta que operador/API antes de conectar CAPI.
- CAPI es best-effort: una falla de Meta nunca bloquea el CRM.
- Sin secretos en commits.
- Sin acciones externas irreversibles desde el runner.
- No crear Campaign Playbooks todavía.
- No integrar Marketing API.
- No traer Resultados/spec 019 salvo piezas mínimas estrictamente requeridas por 006/007.
