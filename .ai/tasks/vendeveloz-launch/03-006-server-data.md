# CUT 3 — Spec 006 servidor/datos

Reconstruye contexto desde:
- AGENTS.md
- Constitution
- docs/CURRENT_STATE.md
- specs/006-anuncio-de-origen/spec.md
- plan.md
- tasks.md
- upstream 018 citado en el spec
- código real actual

Objetivo único:
implementar el corte A de spec 006: servidor/datos. NO UI visible salvo tipos/DTOs estrictamente necesarios.

Port selectivo del upstream 018, adaptado al fork actual.

Debe incluir, según el plan aprobado:
- tipo WebhookReferral y referral? en WebhookMessage;
- normalizador puro y acotado del referral;
- tabla/adición de schema `ad_attribution` compatible con 006 y futuro 007;
- IDs/migración aditiva/re-ejecutable según patrón actual del repo;
- primer referral gana con idempotencia por tenant+conversation;
- flag `ATRIBUCION` solo controla ctwa_clid, NO la visibilidad del origen;
- ctwa_clid nunca sale por API;
- integración en ingest antes del dedup cuando corresponda, best-effort;
- queries/serialización necesarias para exponer anuncio a DTOs;
- copia segura del creativo usando el storage persistente ya existente del fork;
- no duplicar descarga del mismo source_id;
- no romper mensaje si falla persistencia/imagen;
- tests unitarios de normalización, idempotencia/tenant y guardrails relevantes;
- mocks mínimos necesarios para que el siguiente corte pueda probar referral.

No traer:
- CAPI;
- settings ads;
- conversion events;
- Results;
- Marketing API;
- refactors de Jev/follow-ups.

Gates:
pnpm typecheck && pnpm lint && pnpm build && pnpm test

Actualizar tasks.md con el corte A real.
Actualizar docs/CURRENT_STATE.md solo si el plan lo exige.

Un único commit:
feat(attribution): guardar anuncio de origen de conversaciones WhatsApp

Working tree limpio. No empieces UI.
