# CUT 1 — Cerrar spec 005: quick lead name

Lee obligatoriamente, en este orden:
- AGENTS.md
- .specify/memory/constitution.md
- docs/CURRENT_STATE.md
- docs/sdd-workflow.md
- specs/005-quick-lead-name/spec.md
- specs/005-quick-lead-name/plan.md
- specs/005-quick-lead-name/tasks.md
- código/tests referidos por ese spec

Objetivo único:
implementar y CERRAR el spec 005 ya aprobado. No rediseñar.

Ejecuta T101–T111 de `specs/005-quick-lead-name/tasks.md`.

Restricciones:
- NO tocar Sales Orchestrator, Jev, follow-ups, atribución, schema ni upstream.
- NO ampliar a phone/email/tags.
- Reutilizar exclusivamente PATCH /api/contacts/:id para guardar name.
- Mantener tenant safety existente.
- Un solo corte funcional.

Verificación obligatoria:
- pnpm typecheck
- pnpm lint
- pnpm build
- pnpm test
- self-test/E2E indicado por el spec si el entorno lo permite
- registrar explícitamente cualquier live/E2E pendiente; no inventar evidencia

Cierre:
- marcar tasks.md con estado real;
- actualizar docs/CURRENT_STATE.md;
- working tree limpio;
- exactamente UN commit nuevo con mensaje:
  feat(inbox): edición inline de contact.name en el panel lateral + sync de UI

No empieces spec 006.
