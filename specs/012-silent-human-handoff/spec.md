# 012 — Handoff humano silencioso

Fecha: 2026-10-04. Alcance autorizado: cambio de copy y salida comercial, sin
cambiar las reglas que deciden escalar ni publicar el playbook productivo.

## Contrato y clarificaciones

El handoff es interno del CRM. Nunca se anuncia al prospecto que se pasa la
conversación a equipo, persona, asesor u otro equivalente. HUMAN puro (incluido
schedule_call y complejidad que prevalece sobre otra acción) devuelve text=null
sin outbound artificial. applyHandoff conserva lane, motivo y efectos actuales.
La prioridad HUMAN/STOP no cambia ni autoriza ejecutar la acción desplazada.

La respuesta funcional autorizada de send_payment_instructions se entrega antes
del handoff silencioso: mismos destinos exactos del tenant, orden y partición,
encabezado «Estos son los medios de pago:» y cierre «Cuando realices el pago,
envíanos el comprobante por aquí para confirmarlo y continuar con la implementación.»
Sin recursos: «En este momento no tengo los medios de pago disponibles por aquí.»
Las protecciones de cobro, voucher, won y activación siguen siendo internas.

Prueba rápida reconoce el handoff silencioso como éxito con writer.text=null,
sin confundirlo con un fallo del escritor.

Sin cambios de precio, demos, follow-ups, STOP, sandbox ni decisiones Jev.
No migración ni publicación de filas existentes del playbook. La regla prevalece
sobre instrucciones publicadas antiguas mediante control determinístico.
Decisión comercial a sincronizar en Obsidian, sin acceder a él en esta sesión.

## Aceptación

Tests: HUMAN puro y schedule_call sin LLM/outbound y con handoff; pago con datos
exactos y CTA, sin anuncio ni copy de activación; vacío con mensaje natural y
handoff; sandbox cero WhatsApp; regresión de otras next_actions.
Gate completo typecheck/lint/build/test; self-test E2E feliz/infeliz con app/PG y
mocks locales. Si entorno ausente, registrar causa y mantener E2E pendiente.
Un único commit: fix(sales): hacer silencioso el handoff humano. STOP árbol limpio.
