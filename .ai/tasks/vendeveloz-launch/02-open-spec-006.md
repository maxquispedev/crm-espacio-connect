# CUT 2 — Abrir spec 006: anuncio de origen de Meta

Lee obligatoriamente:
- AGENTS.md
- .specify/memory/constitution.md
- docs/CURRENT_STATE.md
- docs/sdd-workflow.md
- docs/SALES_ORCHESTRATOR.md
- schema, webhook, ingest, inbox queries/DTOs, contact panel, conversation list y pipeline actuales
- .ai/tasks/vendeveloz-launch/00-overview.md

Referencia upstream obligatoria:
`kevinrivm/vocero-crm`, feature 018:
- specs/018-anuncio-de-origen/
- commit f22ac03d5854a1f64581ceadb0a54072b2ae2419
- commit 2783c9a01ba79785bb9c1cafac085f1480edba74
- commit 53524ab1a163a504deaa0796d44c349ecbbf23ed
- commit cf440653ab7b2d60090f1bdde51f1630d2a9ba47
- commit 17869cc6e79c868ad963f5b19132970ebf8342b4

Puedes inspeccionar esos commits con git fetch remoto o GitHub, pero NO hagas merge, cherry-pick ni rebase bruto.

Objetivo único:
crear el SDD de nuestra adaptación:
`specs/006-anuncio-de-origen/`
- spec.md
- plan.md
- tasks.md

NO implementar código en este corte.

Comportamiento requerido del spec:
- WhatsApp `messages[].referral` se captura cuando existe.
- Guardar el PRIMER anuncio de origen por conversación; reintentos/mensajes posteriores no lo reemplazan.
- Persistir source_id, source_type, source_url, headline, body, media_type, captured_at y raw acotado.
- Preparar campo nullable de ctwa_clid compatible con el futuro 007.
- Con `ATRIBUCION` apagada, NO persistir ctwa_clid ni dentro del raw.
- Con `ATRIBUCION=on`, conservar ctwa_clid en servidor, pero jamás exponer su valor por DTO/UI.
- Copiar miniatura/imagen del creativo de forma best-effort al storage persistente actual, con defensa SSRF equivalente a upstream; falla de imagen nunca rompe el inbound.
- Lista del inbox: marca "Anuncio · titular" / "Publicación · titular" y filtro Anuncios.
- Panel lateral: tarjeta con creativo, titular, texto, primer mensaje/fecha, source_id y enlace https si existe.
- Pipeline: mostrar la misma procedencia si la arquitectura actual lo permite sin refactor lateral.
- Conversaciones orgánicas quedan iguales.
- No Marketing API; no nombre de campaña/adset/ad porque Meta no lo entrega en referral.
- No CAPI todavía.
- No modificar Sales Orchestrator/Jev.
- Migración aditiva y tenant-safe.

Planifica exactamente DOS cortes de implementación posteriores:
A) servidor/datos;
B) UI + E2E + cierre.

Constitution Check obligatorio.
Actualizar docs/CURRENT_STATE.md solo para registrar spec 006 ABIERTO.

Un único commit documental:
docs(spec): open 006 — anuncio de origen de Meta

Working tree limpio.
