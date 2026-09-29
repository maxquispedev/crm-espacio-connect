# CUT 5 — Abrir spec 007: Meta CAPI para leads de anuncios

Lee:
- AGENTS.md
- Constitution
- docs/CURRENT_STATE.md
- docs/SALES_ORCHESTRATOR.md
- docs/SALES_FOLLOW_UPS.md
- specs/006-anuncio-de-origen/*
- schema y TODOS los caminos actuales que cambian lead.stageId
- pipeline API/UI
- Sales Orchestrator resolve/persist
- .ai/tasks/vendeveloz-launch/00-overview.md

Referencia upstream obligatoria:
`kevinrivm/vocero-crm`
- specs/016-atribucion-capi/
- docs/atribucion-capi.md
- commit 0a154ea2711ad5350e20451c573a7863b926cfed
- commit 75124422bba2298bb21cf3e712cae16b31f01ce2

NO copiar ciegamente: nuestro fork tiene Jev/Sales Orchestrator y hoy puede escribir stageId por su propio camino.

Objetivo único:
crear `specs/007-meta-capi/` con spec.md, plan.md y tasks.md.

NO código de implementación.

Contrato funcional:
- `ATRIBUCION=on` habilita CAPI/settings; apagada, superficie CAPI no existe/404 según patrón upstream, pero 006 sigue mostrando origen sin clid.
- configurar dataset ID;
- reutilizar token WhatsApp cuando sea válido o permitir token específico cifrado según patrón upstream;
- elegir una etapa OPEN del tenant como "lead calificado"; NO hardcodear "Interesado";
- entrar por primera vez a esa etapa → QualifiedLead;
- entrar por primera vez a etapa won → Purchase;
- Purchase incluye value/currency solo si el modelo actual dispone de monto válido; si no, enviar sin value, nunca inventar 0;
- eventos usan ctwa_clid + WABA, nunca nombre/teléfono/texto;
- dedup durable por organización+conversación+evento;
- Meta best-effort: error jamás bloquea cambio de etapa;
- events_received >= 1 es único acuse de éxito;
- conversaciones is_test nunca reportan;
- actividad sent/failed/skipped con motivo y fbtrace_id;
- UI Ajustes → Anuncios.

Arquitectura obligatoria previa:
centralizar TODOS los cambios de etapa reales en una única puerta tenant-safe reutilizable. Jev, drag/drop/API y caminos existentes deben pasar por ella antes de enganchar CAPI.
El primer corte de implementación del 007 será SOLO ese refactor, sin llamadas a Meta y sin cambio observable.

Planifica TRES cortes:
A) stage gateway/refactor neutro;
B) CAPI core + schema/API;
C) UI/settings + E2E + cierre.

No Campaign Playbooks.
No Marketing API.
No spec 019/Resultados salvo mínimo estrictamente requerido.
No acción externa real durante tests.

Constitution Check.
Actualizar CURRENT_STATE con 007 abierto.

Un commit:
docs(spec): open 007 — Meta CAPI para leads Click-to-WhatsApp

Working tree limpio.
