# Plan y análisis

1. Reforzar bootstrap y regla de evidencia runtime sin mutar Published/contrato
   hash-frozen de preguntas. Así protege también versiones publicadas antiguas.
2. Helper puro reconoce SOLO curiosidad genérica; resolver recibe conversación
   y considera facts durables existentes, mantiene prioridades HUMAN/STOP.
3. Routing extiende firma con ad_context opcional; writer recibe contexto y
   opener tiene respuesta breve controlada con una pregunta.
4. DTO prefiere plan efectivo con compatibilidad para snapshots viejos.
5. Regresiones integración pipeline y arnés HTTP/PG commercial 021 A–E.
6. Gates, self-test happy/unhappy, docs y commit atómico.

Constitution Check I–IX: scoped/sender/dedup/is_test intactos; sin secretos ni
servicios nuevos; spec antes del código; estado y limitaciones documentados.
Analyze: cambiar v1 solo no modifica Published ya persistida; regla runtime
necesaria. Guard whitelist evita segundo motor; no inferir necesidad de anuncio,
score o vendedor. Historial truncado con facts de avance no se toma como opener.
