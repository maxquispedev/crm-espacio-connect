# Plan — 019

1. Input Zod estricto: fechas reales YYYY-MM-DD, orden válido, bool opcional,
   source_ids hasta 20 identificadores no vacíos. Zona fija America/Lima usando
   fromLocalWall existente. POST interno withAuth + parseBody; no tenant del input.
2. Servicio con transacción read-only repeatable read: cohorte + joins tenant-safe
   lead/stage/attribution y consultas batch mensajes/media/jobs/events/deliveries.
   Proyección de columnas explícita, índices org existentes, sin N+1.
3. Serializadores allowlist para JSON anidado; ensamblado con mapas por conversación.
   Respuesta attachment/no-store, sin persistencia. Export vacío válido.
4. Form pequeño desplegable en Bandeja. Fetch -> blob -> descarga y URL revocada.
5. Vitest input/shape/consulta scope/auth; sección 030 del self-test existente con
   PostgreSQL local dedicado, fixture A/B y Playwright happy/unhappy.
6. Gates y documentación contractual / CURRENT_STATE / tasks.

## Constitution Check / analyze (antes de implementar)

I/III: sesión y scope cada tabla/join; minimización por allowlist incluso JSONB.
II: sin red externa/dependencias. IV: solo lectura, no efectos. V/IX: gates + UI
real obligatorios. VI/VII: spec y decisiones documentadas antes del código.
VIII: export comercial pequeño. Sandbox: excluido, no se toca sender.
Complejidad: ninguna migración ni infraestructura runtime nueva. El uso de snapshot
consistente evita counts/historial de distintos instantes durante campaña activa.
