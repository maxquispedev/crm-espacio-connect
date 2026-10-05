# Plan / analyze

1. Conocimiento de asistencia en bootstrap/default y refuerzo runtime SOLO del
   producto Vende Veloz 365 (no contaminar otros productos ni mutar Published).
2. Política de evidencia runtime + criterios next_action/needs_human_call
   extendidos sin cambiar opciones ni el contrato upstream hash-frozen.
3. Writer señala supported/context_needed/unknown; no ejecuta acciones. KB
   completa scoped ya se carga para writer. Jev mantiene decisión primaria;
   writer valida evidencia con fuentes completas antes de enviar texto/media.
4. CRM convierte unknown (o clasificación ausente/formato inválido) en plan
   schedule_call/HUMAN antes de persistir efectos comerciales/envío; audita
   propuesta Jev y motivo. Reutiliza applyHandoff/cola existente. Fallo de writer
   degrada también a atención humana, sin exponer incertidumbre.
5. Regresiones unitarias + E2E comercial separado, gates, docs, commit.

Constitution Check I–IX: scoped/tenant/opt-in/dedup/sender/is_test intactos;
sin dependencias ni migraciones; spec antes de código; happy/unhappy observables.
Analyze: solo cambiar bootstrap no arregla Published; no regex de incertidumbre,
no catálogo de integraciones asumidas, no segundo motor. La señal del writer
es verificación de evidencia, no permiso de ejecutar efectos. Estado histórico
no se reescribe. Corrección runtime por nombre canónico, no general a tenants.
