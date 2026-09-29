# CUT 4 — Spec 006 UI + E2E + cierre

Lee:
- AGENTS.md
- Constitution
- docs/CURRENT_STATE.md
- specs/006-anuncio-de-origen/*
- implementación del CUT 3
- componentes actuales del inbox/pipeline
- upstream commit 53524ab1a163a504deaa0796d44c349ecbbf23ed
- upstream tests commit cf440653ab7b2d60090f1bdde51f1630d2a9ba47

Objetivo único:
terminar y cerrar spec 006.

Implementar/adaptar:
- marca "Anuncio · titular" / "Publicación · titular" en lista;
- filtro "Anuncios" con contador solo cuando aplique;
- componente reusable de tarjeta de anuncio;
- panel lateral del contacto;
- pipeline/cajón del trato si existe superficie equivalente sin forzar rediseño;
- creativo servido mediante ruta autenticada existente;
- `hasCtwaClid` puede mostrar solo presencia, nunca valor;
- responsive coherente con UI actual.

E2E/mocks:
- inbound orgánico sin tarjeta;
- inbound con referral;
- primer anuncio gana;
- ATRIBUCION off: origen visible y clid no persistido/expuesto;
- ATRIBUCION on: hasCtwaClid true sin exponer valor;
- filtro Anuncios;
- camino de imagen fallida sin romper inbound;
- tenant isolation.
Adapta self-test existente del repo, no copies infraestructura incompatible.

Verificación obligatoria:
pnpm typecheck && pnpm lint && pnpm build && pnpm test
+ self-test E2E de 006 si el entorno está disponible.
Si falta prueba con clic CTWA real, marcarla explícitamente como PENDIENTE HUMANO/PRODUCCIÓN, igual que upstream; no bloquear el commit por ausencia de anuncio real.

Cierre:
- tasks.md completo con evidencia;
- docs/CURRENT_STATE.md actualizado: 006 cerrado o estado exacto;
- doc de dominio corto si hace falta para recuperar contrato;
- working tree limpio.

Un solo commit:
feat(inbox): mostrar anuncio de origen en conversaciones y leads

No empieces 007.
