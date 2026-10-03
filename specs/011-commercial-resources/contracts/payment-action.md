# Contrato comercial de pago — SOLO corte 4

## Extensión compatible

`send_payment_instructions` es octava option key protegida y nueva entrada writer.
No alias de schedule_call, no keyword hack en orchestrator ni acción LLM ejecutable.
Añadir contrato 1.1 con las siete keys originales y esta octava, tipos Jev originales,
shape writer correspondiente y mismos guardarraíles engine-required.

- 1.0 conserva exactamente siete keys y lectura, edición, publicación, Lab y rollback.
- 1.1 exige ocho keys; no admitir keys libres ni aceptar documento 1.0 como 1.1.
- V2 canónica/fixture/hash/doc §7 quedan intactos; derivar set nuevo V3 explícito
  y documentado con criterio/instrucción de pago sin modificar las otras señales.
- Loader/store/API/version checks y editor conocen ambas versiones. Actualizar
  tipos y normalizer para validar contra el contrato activo del turno; respuesta
  de pago en turno 1.0 se rechaza, no se ejecuta silenciosamente.
- Ofrecer actualización explícita del draft a 1.1 desde la UI, preservando
  contenido editado y añadiendo solo acción/instrucción nuevas. No mutar Published
  ni archivadas. Publicar con flujo/comentario vigente, rollback a 1.0 disponible.
- Fallback actual V2 se conserva; para habilitar pago, operador actualiza draft,
  prueba y publica 1.1. No auto-publicar en migración/bootstrap ni forzar capability
  en Published 1.0. Registrar este paso en CURRENT_STATE/docs/playbook.
- Catálogos de expected outcomes del Lab admiten nueva acción; no perder casos viejos.

## Plan y entrega

Jev reconoce intención explícita de pagar en su decisión estructurada.
Resolver mantiene disqualify/HUMAN/schedule_call prioritarios. Para acción de pago
estándar autoriza entregar instrucciones y luego handoff comercial (sin seguimiento
nuevo); no usar la transición HUMAN del writer para esconder la acción de pago.
Representar por separado entrega autorizada y handoff posterior en SalesPlan,
sin convertir el pago en schedule_call ni redefinir todas las lanes.

Writer redacta introducción breve conservadora; código renderiza los destinos
exactos del payload validado y controla el texto final de instrucciones. Si hace
falta, usar plantilla determinista completa para garantizar que el LLM no inserta
cuentas/URLs alternativas; no confiar solo en prohibición dentro del prompt.
No copiar datos de recursos al state externo de Jev (solo disponibilidad si resulta
necesaria). Sin métodos: transición humana honesta, ningún fact de pago.

Tras entrega aceptada/persistida: paymentInstructionsSentAt en lead del tenant;
después applyHandoff commercial. En sandbox simular en su conversación; cero Graph,
cero upload externo, follow-ups o CAPI reales. Fallo de envío no marca fact y degrada
con seguridad manteniendo camino humano. HUMAN prioritario no recibe cuentas
porque pago no está autorizado. No fact de pago por un mensaje de handoff.
