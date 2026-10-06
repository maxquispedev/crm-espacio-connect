# Plan / analyze

1. Helper semántico mínimo ad topic: headline primero, body como fallback,
   verano antes de pagos mencionados secundariamente. Compatible con demo-routing.
2. Helper auditable broad-need: whitelist de respuestas + pregunta inmediata
   de priorización + categorías explícitas (o referencia próxima a lista).
   Resolver lo evalúa después de prioridades HUMAN/precio/pago/cierre; no scores.
3. Guard de duplicación en orquestador: lectura scoped de últimos 10 textos IA,
   normalización pura, máximo un retry. Retry omite opener determinístico y usa
   mismo Writer/evidencia. Comparar fallback real; agotamiento persiste reason
   y shouldReply=false, sin effects. Token vigente tras cada await/envío.
4. Writer: opener por tema, reglas generales y precio natural que prevalecen
   sobre copy antiguo; bootstrap y refuerzo next_action runtime, contrato canónico
   questions.ts hash-frozen intacto. No cambiar números ni oferta persistida.
5. Unit/integración cerca de código y E2E 031 por webhook real app/Postgres/mocks.
6. Gates y regresiones 021/028/029 + follow-ups 018; docs, evidencia, commit local.

Constitution Check I–IX antes de implementar: sin secretos/servicios nuevos,
queries scoped; sin schema; sender, idempotencia y sandbox existentes; SDD previo;
happy/unhappy observables con fixtures locales; sin push/deploy. Sin violaciones.

Causas verificadas: opener binario por slot; ask_more_questions no consume
respuesta de priorización; ausencia de comparación pre-envío; copy setup/fee
presente en bootstrap y fallback. Published no se muta: refuerzo runtime necesario.

Refinamiento tras diseño: price override canónico se sustituye únicamente para
Vende Veloz 365; otros productos mantienen sus overrides. Textos descriptivos del
primer pago en oferta/fallback se alinean sin cambiar cifras ni condiciones.
Pregunta deíctica «esos temas» exige lista del vendedor anterior dentro de los
últimos tres turnos previos, sin saltar un vendedor intermedio. No usa contexto
viejo arbitrario. SDD/Constitution Check final conforme: gates y E2E 031/028/029/018 verdes;
la evidencia detallada y límites quedan en tasks.md.
