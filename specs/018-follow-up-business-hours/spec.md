# 018 — Horario comercial de los follow-ups automáticos (2026-10-06)

Un follow-up automático no puede ser un mensaje comercial enviado a las 02:00.
Hoy el motor programa `anchorAt + delay` sin mirar el reloj local: con delays de
6h/18h/48h y 20h/52h/96h es fácil que elencadenado caiga de madrugada o a una hora
inconveniente. El prospecto recibe un mensaje comercial a la madrugada y la
marca pierde credibilidad; además se quema el WhatsApp Business de una cuenta
que ya recibe tráfico a esa hora.

Este spec define **una sola política de ventana comercial** para los seguimientos
automáticos, aplicada en **dos niveles** (al programar y justo antes de enviar)
para que ningún camino la esquive.

## Regla de producto

Los follow-ups automáticos de ventas solo se pueden enviar dentro de:

- timezone de decisión: **`America/Lima`** (explícita; nunca la del servidor)
- ventana: **`09:00 <= hora local < 20:00`**

El límite de las 20:00 es **exclusivo**: a las 20:00:00 ya no se envía y el
seguimiento se difiere. A las 09:00:00 sí se envía.

Ejemplos de normalización (`anchorAt + delay` → resultado):

| Calculado | Resultado |
|---|---|
| 16:30 | 16:30 (sin cambio) |
| 19:45 | 19:45 (sin cambio) |
| 20:30 | día siguiente 09:00 |
| 02:00 | 09:00 del mismo día |
| 07:40 | 09:00 del mismo día |
| 20:00 | día siguiente 09:00 |

**Quedarse fuera de horario no pierde ni consume un intento**: ni
`attempt_number`, ni `run_attempts`, ni el estado terminal de la secuencia. El
seguimiento simplemente se aplaza.

## Alcance

Aplica a las razones automáticas: `awaiting_reply`, `after_demo`, `after_price`.

`scheduled_wait` **queda fuera**: es una fecha elegida explícitamente por una
persona desde el CRM (`POST /api/pipeline/leads/[id]/follow-up`), documentada
como "seguimiento manual futuro" (§4 y §13 de `docs/SALES_FOLLOW_UPS.md`), no un
envío automático que la máquina decida. Su contrato se preserva en los dos
niveles. La Agenda humana (`conversation_attention`) tampoco cambia: nunca envía
WhatsApp por ningún camino.

No se introduce UI ni configuración por organización: la política es centralizada
y su constante está aislada para que convertirla en configuración sea un cambio
local, no una redistribución de horarios mágicos.

## Comportamiento observable

1. **Al programar.** `scheduleNextFollowUp` y el encadenamiento del siguiente
   intento normalizan `anchorAt + delay` al próximo instante permitido.
   `lead.next_follow_up_at` queda sincronizado con el `due_at` del job.
2. **Antes del envío.** El worker revalida la hora local actual justo antes del
   outbound. Si el job ya vencido fue reclamado fuera de 09:00–20:00:
   no se llama al writer, no se llama a Graph, no se incrementa el intento
   comercial, no se marca `failed` ni `blocked`; el job vuelve a `pending`, su
   `due_at` pasa al próximo inicio permitido y `lead.next_follow_up_at` queda
   sincronizado.
3. **Capa de seguridad, no sustituto.** Es la segunda barrera para jobs
   históricos ya persistidos con horas nocturnas, carreras y cambios futuros.

## Fuera de alcance

No cambian: los delays 6h/18h/48h ni los de `after_demo`/`after_price`, el
máximo de 3 intentos, la ventana de 24h de WhatsApp, las plantillas, las lanes,
el pricing, el Sales Orchestrator, ni el contrato de confirmación durable del
spec 017. Sin migración de schema, sin UI, sin dependencias nuevas.

## Criterios de aceptación

- Ventana `[09:00, 20:00)` en `America/Lima`, con 20:00 exclusivo.
- Programación y encadenamiento normalizados; `scheduled_wait` intacto.
- Worker: cero writer, cero Graph, cero intento, reprogramado a 09:00 local.
- Mismo job reclamado dentro de horario: flujo normal.
- Tenant isolation y sandbox intactos.
- Un caso nocturno en el E2E/self-test de follow-ups.