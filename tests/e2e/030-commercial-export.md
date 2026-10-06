# 030 — Dataset comercial JSON

Automatizado en scripts/e2e-commercial-export.mjs, invocado por E2E_SECTION=030
scripts/e2e-selftest.mjs. App local Next dev, mocks true, BD PostgreSQL dedicada
commercial_export_test migrada y ALLOW_SIGNUP=true. Nunca datos reales.

1. Autenticar y activar org A, con fixtures A/B/source compartido/Laboratorio.
2. Abrir Bandeja, exportador, Desde=Hasta=2026-10-06.
3. Descargar JSON y validar versión/nombre/org/señales comerciales completas.
4. Verificar límites [05:00Z, día siguiente 05:00Z), historial completo y orden.
5. Asegurar ningún dato estructurado PII/raw/secretos/rutas ni mensaje cross-tenant.
6. Solo anuncios/source compartido: únicamente ad de A (post excluido).
7. Sin sesión 401; selectors ajenos 422; source inexistente export vacío.
8. Rango invertido: error visible, botón disponible. Fallo de red: error y reintento
   exitoso sin navegación.
