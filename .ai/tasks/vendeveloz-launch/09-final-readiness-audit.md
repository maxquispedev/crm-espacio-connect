# CUT 9 — Auditoría final de readiness Vende Veloz

Este corte NO agrega features.

Lee:
- AGENTS.md
- Constitution
- docs/CURRENT_STATE.md
- docs/SALES_ORCHESTRATOR.md
- docs/SALES_FOLLOW_UPS.md
- specs/005, 006, 007 y sus tasks
- configuración/env docs del agente, Jev, follow-ups, templates, WhatsApp y atribución

Objetivo:
hacer una auditoría técnica final antes de que Max lance campañas.

Ejecuta los gates máximos razonables:
- pnpm typecheck
- pnpm lint
- pnpm build
- pnpm test
- pnpm test:e2e si existe y el entorno permite mocks/Postgres
No uses credenciales reales ni Meta real.

Crear/actualizar `docs/VENDEVELOZ_LAUNCH_CHECKLIST.md`.

Separar:
A) IMPLEMENTADO Y VERIFICADO EN REPO
B) CONFIGURACIÓN DE PRODUCCIÓN A CONFIRMAR
C) PRUEBAS REALES EXTERNAS PENDIENTES
D) NO BLOQUEA LANZAMIENTO / FUTURO

Checklist producción explícita:
- Agent ON;
- Sales Orchestrator/Jev ON;
- TypeSafe/Jev env válido;
- OpenRouter env válido;
- Follow-ups ON;
- plantilla aprobada >24h seleccionada;
- WhatsApp conectado;
- ATRIBUCION=on;
- dataset CAPI configurado;
- qualified stage configurada;
- storage persistente para media/creativos;
- primer clic CTWA real muestra anuncio;
- primer lead real recibe respuesta;
- seguimiento se programa/cancela;
- movimiento a qualified produce evento Meta real;
- won/Purchase se reporta cuando ocurra una venta real.

NO actives nada externo.
NO cambies flags de producción.
NO envíes mensajes.
NO crees campañas.
NO gastes dinero.

Actualizar docs/CURRENT_STATE.md con el estado técnico final y siguiente paso exacto.

Un commit documental:
docs: cerrar readiness técnico de Vende Veloz para campañas

Working tree limpio.
