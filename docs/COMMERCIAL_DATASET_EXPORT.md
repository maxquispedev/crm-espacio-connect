# Exportador comercial V1 — spec 019

En **Conversaciones → Bandeja → Exportar dataset comercial**, elegir Desde/Hasta y
«Descargar JSON». Disponible a usuarios autenticados de la organización activa;
no depende de CAPI/ATRIBUCION. Opcionales: solo anuncios pagados y un ID de origen.
No configura campañas ni llama a Jev/LLM/Meta. No persiste snapshots.

## Fechas y alcance

Los días de la UI son inclusivos en **America/Lima**. Seleccionan conversaciones
por `created_at`, no por última actividad. Para 2026-10-06 el intervalo SQL es
`2026-10-06T05:00:00Z <= created_at < 2026-10-07T05:00:00Z`.

Cada conversación seleccionada incluye **todo su historial disponible** de mensajes,
follow-ups, conversiones y entregas, aunque sus fechas estén fuera del intervalo.
Esto permite reconstruir el funnel sin cortar respuestas posteriores. Para incluir
un lead anterior a la campaña hay que ampliar Desde. Solo `is_test=false`.
Timestamps JSON en UTC ISO 8601. El snapshot es consistente (transacción de lectura
repeatable read); la etapa/lane/última decisión reflejan el estado actual al exportar,
no un historial inexistente de cambios de etapa o evaluaciones anteriores.

## Contrato JSON 1.0

`POST /api/commercial-export` es una superficie interna con sesión Better Auth y
organización revalidada por `requireSession()`. Body estricto:

```json
{"date_from":"2026-10-06","date_to":"2026-10-06","ad_attributed_only":false,"source_ids":[]}
```

No admite organización ni IDs de conversación/lead. source_ids: máximo 20 strings
no vacíos de hasta 128 caracteres (la UI ofrece uno). `ad_attributed_only=true`
exige `source_type=ad`, excluyendo publicaciones orgánicas `post`. Todos los joins y
consultas hijos exigen el mismo tenant. Un rango sin datos descarga un JSON válido
con arrays vacíos. Errores 401 (sin sesión), 422 (input), 500 (fallo interno).

Respuesta attachment `espacio-connect-commercial-export-YYYY-MM-DD.json`,
`application/json`, `private, no-store` y `nosniff`.

| Bloque | Campos |
|---|---|
| raíz | schema_version, exported_at, organization {id,name}, filters, summary, conversations |
| filters | date_from, date_to, ad_attributed_only, source_ids, timezone, conversation_date_field=created_at, from_inclusive, until_exclusive, history_scope=complete_conversation |
| conversación | conversation_id, created_at, last_message_at, lead, conversation, attribution, jev, messages, follow_ups, commercial_events, outbound_deliveries |
| lead (nullable) | lead_id, stage {id,name,kind} nullable, automation_lane, demo_shown_at, price_presented_at, payment_instructions_sent_at, human_requested_at, next_follow_up_at, follow_up_count, follow_up_reason |
| conversation | ai_enabled, handoff_at, handoff_reason, last_inbound_at |
| attribution (nullable) | source_id, source_type, headline, body, media_type, created_at |
| jev (nullable si falta lead) | last_evaluated_at, last_jev_decision, last_jev_playbook_version_id, last_jev_playbook_schema_version |
| messages | id, timestamp, created_at, direction, type, text, status, ai_generated, origin, media nullable |
| media | kind, mime_type, file_name (solo basename), caption |
| follow_ups | id, reason, attempt_number, due_at, status, created_at, updated_at, message_id nullable |
| commercial_events | id, event_name, status, custom_data, created_at |
| outbound_deliveries | message_id, plan, demo_slot, payment_group_id, payment_part, payment_parts, follow_up_job_id, confirmed_at, failed_at, invalidated_at, created_at |

`last_jev_decision` es una proyección segura `{decision, plan}` del JSON persistido:
se conservan las ocho señales normalizadas conocidas (realOperationalNeed,
productFit, motivationToChange, purchaseIntent, buyingTiming, mainValueProposition,
nextAction, needsHumanCall), con type/noul/score/choice/confidence cuando existen.
No se exportan snapshot crudo, requestId, model, probabilidades ni señales dinámicas
arbitrarias. El plan conserva lane/nextAction/shouldReply/shouldHandoff/handoffReason/
desiredPipelineSemantic/demoGuardReason/commercialEvidenceReason/paymentDeliveryAuthorized
cuando existen. Se conserva la diferencia entre acción propuesta y plan efectivo.

Delivery `plan` contiene `sales_plan` con esa misma proyección y `scheduleFollowUp`
si existe; excluye tokens de seguridad, anclas internas y fact_previous.
`custom_data` conserva solamente lead_stage/value/currency, el contrato CAPI vigente.
Un evento `Purchase` registra un intento de reporte estructurado: **status=sent**
significa recibo de Meta; no se infiere una venta de textos ni se inventan importes.
Los tres timestamps de delivery se conservan separados: pueden coexistir (fallo o
invalidación posteriores a confirmación), no se inventa un estado unificado.

## Mensajes y resumen

Orden ascendente por `wa_timestamp ?? created_at`; desempate created_at e id.
`timestamp` expresa esa fecha efectiva; created_at permite ver la ingesta.
`direction=in` identifica prospecto: su origin por defecto no representa operador.
En salientes, origin distingue ai/operator/manual/template; ai_generated se conserva.
Media excluye binarios, URLs, IDs WhatsApp, paths y payloads de contactos/ubicación.

summary se deriva exclusivamente del dataset: conversations/messages/inbound_messages/
outbound_messages/ad_attributed_conversations/ai_messages/operator_messages/
manual_messages/template_messages/handoffs/price_presented/demo_shown/
payment_instructions_sent. ai_messages: salientes ai_generated=true; los otros tres
contadores de autor son salientes con origin correspondiente. Flags preservados sin
heurísticas. Handoffs/hechos cuentan conversaciones con timestamp no nulo.

## Privacidad y coste

No se consultan contactos ni credenciales. Proyecciones explícitas excluyen teléfonos,
nombres de personas, email, wa_identity/wa_user_id/wa_message_id/wa_media_id, ctwa_clid,
raw, payload Meta, fbtrace_id, IP, errores de proveedor y rutas. JSONB también tiene
allowlist. Se conservan **textos y captions originales**, que pueden contener datos
personales escritos en el chat; V1 no hace anonimización NLP. Archivo para análisis
comercial, no réplica de contactos.

Dos consultas para cohorte vacía; seis para cohorte con datos (organización, cohorte
con joins y cuatro consultas batch). Ensamblado con mapas por conversación; no N+1.
Se genera en memoria bajo demanda, sin tablas ni servicios nuevos.

## Verificación

Vitest: input/límites/allowlists/ensamblado/SQL scope y endpoint autenticado.
Self-test: `E2E_SECTION=030 node --env-file=<env-local> scripts/e2e-selftest.mjs`.
Requiere PostgreSQL migrado `commercial_export_test[_...]`, app local de desarrollo
con `WA_MOCK_ENABLED=true` y `ALLOW_SIGNUP=true`. Crea dos orgs efímeras y elimina sus
fixtures al terminar. Conduce el formulario y descarga con Playwright, comprueba
límites exactos, orden, tenant (incluso mensaje corrupto cross-tenant), laboratorio,
PII y señales; prueba rango invertido, fallo de red y reintento.
