# CUT 7 — Spec 007: CAPI core + schema/API

Lee spec/plan/tasks 007, implementación del gateway y upstream 016.

Objetivo único:
implementar corte B del 007, sin UI final todavía.

Adaptar selectivamente upstream 016.

Datos:
- capi_settings tenant-scoped;
- conversion_event durable;
- relaciones con ad_attribution existente de 006;
- migración aditiva/re-ejecutable según patrón del repo;
- secretos cifrados usando la capa crypto existente;
- dedup UNIQUE apropiado.

Meta:
- QualifiedLead/Purchase;
- action_source business_messaging;
- messaging_channel whatsapp;
- user_data solo ctwa_clid + whatsapp_business_account_id;
- custom_data.lead_stage;
- events_received >= 1 para éxito;
- best-effort.

Servidor:
- settings store;
- APIs settings CAPI protegidas por auth+tenant y flag ATRIBUCION;
- reutilizar token WhatsApp si corresponde;
- enganchar reportStageChange DESPUÉS del commit exitoso del gateway, nunca dentro de transacción larga;
- qualified stage configurable del tenant;
- won reporta Purchase;
- no reenvío duplicado;
- is_test no reporta;
- sin ctwa_clid/config → skipped legible;
- failure Meta → lead ya quedó movido;
- actividad consultable por API.

Tests unitarios/integración con Meta mock equivalente al upstream, adaptados al fork.
NO llamar Meta real.

No UI settings todavía salvo tipos estrictamente necesarios.
No Results.
No Marketing API.

Gates completos.
Actualizar tasks.md.

Un commit:
feat(attribution): reportar QualifiedLead y Purchase a Meta CAPI

Working tree limpio.
