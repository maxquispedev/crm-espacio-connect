# CUT 8 — Spec 007: Ajustes → Anuncios + E2E + cierre

Lee spec/plan/tasks 007, core implementado y upstream UI 016.

Objetivo único:
cerrar 007 con superficie operable y verificación.

Implementar:
- pestaña/pantalla Ajustes → Anuncios solo con ATRIBUCION habilitada;
- dataset ID;
- token reutilizado de WhatsApp o específico según backend; jamás mostrar token completo, solo last4 si aplica;
- selector de etapa calificada limitado a etapas válidas del tenant;
- desconectar config sin borrar historial de eventos;
- actividad reciente: contacto/anuncio/evento/estado/motivo/fbtrace_id/fecha;
- copy claro, sin prometer gasto/ROAS ni traer Marketing API.

E2E:
- flag off → rutas/pantalla ausentes y 006 sigue mostrando anuncio sin clid;
- flag on → guardar config;
- etapa de otro tenant rechazada;
- lead CTWA entra a qualified → un QualifiedLead;
- repetir entrada no duplica;
- won → un Purchase;
- lead orgánico/skipped;
- Meta 200 events_received=0 → failed pero stage cambia;
- is_test nunca emite;
- Jev moviendo etapa usa la misma puerta y dispara la misma lógica con mocks;
- valor ctwa_clid jamás aparece por API/UI.

Verificación:
pnpm typecheck && pnpm lint && pnpm build && pnpm test
+ pnpm test:e2e o equivalente con ATRIBUCION off y on si el entorno lo permite.

Cierre:
- tasks.md con evidencia exacta;
- docs/CURRENT_STATE.md;
- doc técnico de atribución/CAPI adaptado al fork;
- declarar pendiente únicamente el clic CTWA/CAPI real si no se ejecutó contra Meta;
- no afirmar READY real sin esa prueba.

Un commit:
feat(settings): operar atribución Meta CAPI desde Espacio Connect

Working tree limpio.
