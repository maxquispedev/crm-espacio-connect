# 020 — Correcciones conversacionales de producción

2026-10-06. Un corte cohesivo sobre Espacio Connect. Jev propone; CRM valida y
autoriza; Writer redacta. Basado exclusivamente en los cuatro incidentes aportados.

## Comportamiento y aceptación
- A–D: curiosidad genérica usa headline/body del anuncio para iniciar en pagos,
  verano, centralización o control general, sin asumir dolor. Beneficio breve,
  UNA pregunta, cero demo/fact. Sin anuncio: opener general seguro.
- E: comparar texto automático contra los últimos 10 textos IA no fallidos de la
  conversación (incluidos pending). Normalizar Unicode, case y whitespace, sin
  similitud semántica. Duplicado: un único retry Writer con texto rechazado y
  contexto explícito. Otro duplicado: silencio seguro auditable, sin envío,
  facts, jobs ni movimiento de etapa; IA sigue operable. Fallo/unknown del Writer
  conserva handoff silencioso de 016. Manuales/otros tenants no son candidatos.
- F/G: respuesta inequívoca todo/todos/varios/todos esos inmediatamente después
  de priorización explícita de categorías operativas permite show_operations_demo
  si Jev propone ask_more_questions, aún sin demo/precio/pago/humano y sin
  HUMAN/STOP/cierre prioritario. Fuera de ese contexto no inferir necesidad.
  Snapshot conserva decision original, plan efectivo y questionLoopGuardReason.
  Demo general una sola vez con reserva/ledger y fact tras status exitoso.
- H: Excel → pregunta útil → pagos/saldos → demo-pagos-saldos → precio intacto.
- I: precio directo responde primero precio sin exigir número de alumnos; S/247
  hasta 50; 70 alumnos activos S/267 cuando se indica. Implementación incluida;
  primer pago inicia implementación y cubre primeros 30 días; +S/1 desde 51;
  sin permanencia. Copy natural, sin setup/fee/cláusulas ni dominio irrelevante.

## Clarify
Requisitos suficientes. Silencio ante retry duplicado no es falta de evidencia ni
motivo comercial de handoff: no pausar IA ni fabricar atención humana. Guard
aplica al texto final realmente enviable (incluido fallback de demo ausente), no
solo al texto bruto del Writer. No modifica instrucciones de pago autorizadas,
writer de follow-ups, horarios ni sender. Refuerzo runtime protege Published
antiguas sin reescribir filas; bootstrap actualizado para futuras publicaciones.

## Límites
Sin Jev repo, LLM nuevo, campañas, scoring, embeddings, tablas, UI ni servicios.
Mantener specs 015–018: media/unknown silenciosos, tenant/scoped, is_test sin
Graph, freshness después de retry, entrega confirmada y reserva demo intactas.
Mocks locales + app/PG para E2E específico; proveedores reales no se validan.
