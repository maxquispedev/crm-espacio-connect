# 019 — Exportar dataset comercial JSON

Fecha: 2026-10-06. Solicitud explícita del dueño; V1 pequeña, lectura histórica.

## Specify / clarify

Desde Bandeja (acción secundaria disponible sin bandera CAPI) un usuario autenticado
puede abrir «Exportar dataset comercial», elegir Desde/Hasta, opcionalmente solo
anuncios y un source_id, descargar JSON sin salir de la pantalla. Loading y error
legible, reintento disponible. Sin campaña, analytics, snapshots ni proveedores.

Decisiones resueltas inspeccionando el modelo:
- Cohorte por `conversation.created_at`: días inclusivos America/Lima; SQL usa
  [inicio del Desde, inicio del día posterior al Hasta). Historial COMPLETO de cada
  conversación seleccionada, incluso mensajes/efectos fuera del rango. UI lo explica.
- Solo is_test=false y organización activa revalidada por requireSession.
- `ad_attributed_only` exige source_type=ad (post no es anuncio pagado).
- Lead único por contacto; estado y última decisión son snapshots actuales, NO
  historial de etapas/decisiones. No se infieren cierres del texto.
- Mensajes ordenados por wa_timestamp ?? created_at, desempate created_at/id.
  direction=in es prospecto; origin solo identifica autor en salientes.
- Listas explícitas de campos; jamás contactos, payloads raw ni errores de proveedores.
  Jev: decisión normalizada y plan comercial de last_jev_decision, sin snapshot raw.
  custom_data: solo lead_stage/value/currency actualmente producidos por el CRM.
  Media: kind/mime_type/file_name (basename)/caption; sin payload de contactos/ubicación.
  Texto de chats/captions conserva su contenido; sin anonimización NLP.
- JSON schema_version=1.0, timestamps UTC ISO; límites/zona/alcance documentados en filters.
- Resumen computado exclusivamente del dataset; operator_messages significa
  salientes origin=operator, manual_messages y template_messages separados.

## Aceptación

Caso completo (lead/etapa/Jev/atribución/jobs/deliveries/conversiones/media), orgánico,
laboratorio excluido, tenant A/B aun con source_id compartido o relaciones corruptas,
PII estructurada excluida también de JSON anidado, orden, fechas exactas e inválidas,
autenticación y descarga Playwright con fixture y error recuperable.
Sin cambios de schema, sender, Jev, worker ni decisiones comerciales.
