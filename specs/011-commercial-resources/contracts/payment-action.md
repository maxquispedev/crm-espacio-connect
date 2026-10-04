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


## Implementación C4 — 2026-10-04

`ConfigSchema` discrimina por `schema_version`: 1.0 usa el contrato estructural
anterior y siete criterios; 1.1 exige ocho y writer de pago no vacío, con
longitudes y guardarraíles protegidos. 1.0 conserva la tolerancia histórica
a metadata adicional del writer. Versiones desconocidas se rechazan. Loader
solo lee; store valida antes de escribir/publicar/rollback, sin migración.

`PUT /api/playbook/draft` acepta `upgrade_to: "1.1"` explícito, junto a las
ediciones actuales. Es la única transición del draft; no acepta `schema_version`
en el patch, ni habilita pago mediante writer añadido a un draft 1.0 sin
upgrade. `payment-extension.ts` contiene V3 derivada e instrucciones de pago.
La UI guarda ese patch al pulsar Actualizar draft a 1.1 (pago). Publicación y
rollback siguen explícitos. Pasos operativos en docs/playbook.md.

`payment-resource.ts` produce una plantilla completa sin llamar al LLM:
transferencias completas, Yape, link y transición final. Si supera el límite
de 4096, divide entre métodos. El orquestador entrega secuencialmente y marca
el fact solo al completar todas las partes; fallo parcial no marca ni reintenta.
El sender de texto existente no persiste outbound si Graph rechaza antes de
aceptar: se conserva handoff, no se inventa un mensaje failed. Sandbox persiste
texto localmente sin sender/Graph. Sin recursos, error de lectura o corrupción:
texto honesto y humano sin fact.

E2E 022 con mocks locales preparado; ejecución pendiente por app/PG ausentes.
Los tests del pipeline usan BD en memoria; lifecycle API usa store simulado;
el test integrado store/loader usa ambos reales con executor en memoria. Nada
de esto acredita PostgreSQL físico ni interpretación real de Jev. El freeze V2
no se modifica. Evidencia y siguientes pasos en tasks.md/quickstart.md.
