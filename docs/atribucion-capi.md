# Atribución Meta CAPI — guía para el operador del fork

> Cómo opera la atribución de conversiones de Meta desde Espacio Connect.
> Espejo adaptado del upstream 016 (`kevinrivm/vocero-crm`), con las
> decisiones que este fork tomó para no quedar atado al catálogo original.

## Qué es y por qué está

Si anuncias con **Click-to-WhatsApp**, Meta sabe qué conversaciones
**empezaron** desde un anuncio. No sabe cuáles **sirvieron**. Sin nadie
que se lo diga, el algoritmo optimiza hacia lo único que ve —que alguien
abra el chat— y te entrega el público más barato de hacer escribir, que
rara vez es el que compra. El CRM está en el único lugar donde esa
verdad existe: sabe que esta conversación llegó con `ctwa_clid`, que se
calificó el martes y que se ganó el viernes. Encender esta feature es
**devolverle a Meta ese desenlace** para que el mismo presupuesto
empiece a comprar clientes en vez de chats.

Esta feature está **apagada por defecto**. Se enciende con
`ATRIBUCION=on` en el entorno (runtime, no build). Mientras esté
apagada:

- No existe la pestaña **Anuncios** en Ajustes.
- Las APIs `/api/settings/capi*` devuelven 404.
- El reporte de conversiones es `skipped` con motivo.
- 006 sigue mostrando el origen del lead (anuncio / publicación) en la
  bandeja, panel y pipeline — eso no depende de la bandera.

## Cómo se enciende

1. Levantar la bandera:

   ```bash
   ATRIBUCION=on
   ```

   (`Coolify`/docker compose: añadirla a las variables de runtime, no de
   build. La app la lee en cada request — no hace falta reinicio.)

2. En el CRM, ir a **Ajustes → Anuncios** (la pestaña solo aparece con
   la bandera encendida).

3. Pegar el **dataset ID** de Events Manager → tu dataset → Configuración.

4. **No hace falta pegar token** si ya conectaste WhatsApp: el CRM reusa
   ese mismo token (es el que autoriza publicar en el dataset del WABA).
   Pegar uno específico es opcional, cifrado con la misma capa
   `lib/crypto`. Hacia el cliente solo se ve `last4`.

5. Elegir la **etapa calificada** del propio pipeline (lista de etapas
   con `kind = "open"` del tenant). Esta elección es **por negocio**, no
   hardcodeada a "Interesado". Si la dejas vacía, `QualifiedLead` queda
   en `skipped` con motivo.

6. Guardar. A partir de ahí, cada vez que un lead entre a la etapa
   calificada, Meta recibe un `QualifiedLead`. Cuando entre a una etapa
   con `kind = "won"`, Meta recibe un `Purchase`.

## Decisiones específicas del fork

> Estas son las diferencias intencionales respecto al upstream 016.
> Si estás sincronizando desde el upstream, no las "arregles": son
> contrato del fork.

### 1. Etapa calificada es configurable, no "Interesado"

El catálogo del upstream asume que "Interesado" es la etapa calificada.
Aquí cada negocio decide cuál es su "calificada". El selector lista
solo las etapas con `kind = "open"` del propio tenant; pasar una etapa
de `kind = "won"`, `kind = "lost"` o de otro tenant devuelve 422
`invalid_stage` (el gateway centralizado del Corte A y la validación de
`isQualifiedStageForTenant` lo aplican).

### 2. Purchase sin valor inventado

Si el lead no tiene monto válido en el modelo de deal actual, `Purchase`
sale **sin** `value`/`currency`. Nunca `0`. Esta regla protege la
optimización por valor de Meta: un valor falso envenena la optimización.
El caller pasa `dealValue?: number | null` al helper; si es `null` o no
es un número positivo válido, el campo no viaja en el payload.

### 3. Jev pasa por la misma puerta que tú al arrastrar

El Sales Orchestrator (Jev) ya no escribe `lead.stageId` por su cuenta.
Pasa por `moveLeadStage(...)` (Corte A), que ahora engancha
`reportStageChange` **después** del commit. Si Jev mueve una conversación
a la etapa calificada, dispara `QualifiedLead` exactamente igual que si
tú arrastraste la tarjeta. Mismo dedup (`UNIQUE`), mismo acuse
(`events_received >= 1`), misma fila en la tabla de actividad.

### 4. Guardrail del Laboratorio

Una conversación con `is_test = true` jamás produce un evento CAPI. Es
la misma familia de guardrails que el sender y los conectores de agenda:
las pruebas del Laboratorio no tocan el exterior.

### 5. Regla anti-valor-falso

`buildCustomData` solo añade `value`/`currency` al `custom_data` si:

- `dealValue` es un `number` finito y **estrictamente positivo**.
- `dealCurrency` es un string de **exactamente 3 caracteres**.

Cualquier otro caso (incluido `0`, `null`, `undefined`, string vacío)
omite ambos campos. Esta regla es no negociable: en el spec
consta como riesgo explícito y mitigación dura.

### 6. Token reusado del WhatsApp business

Si la conexión WhatsApp del tenant existe y no se pegó token propio, el
reporte CAPI reusa ese token descifrado server-side (nunca al cliente).
Esto evita pedir al dueño una credencial que ya autorizó. Pegar token
específico es opcional, cifrado con la misma capa AES-256-GCM que el
token de WhatsApp.

### 7. user_data mínimo

Hacia Meta solo viaja:

- `ctwa_clid` (hasheado SHA-256 lowercase + trim, por contrato Meta).
- `whatsapp_business_account_id` (WABA ID de la conexión del tenant,
  **no** se hashea — es un identificador de cuenta comercial, no de
  usuario).

**Nunca** teléfono, nombre, email ni texto del contacto. El `ctwa_clid`
es identificador de clic, no dato personal — pero igual se hashea por
defensa en profundidad y porque el `click_id` real puede traer prefijos
del CDN.

### 8. Cero espejo de InitiateCheckout de fábrica

El upstream incluye `InitiateCheckout` para campañas de venta.
Aquí **no** se incluye de fábrica a propósito: la decisión de reportar
ese evento es de negocio, no una verdad del CRM. La receta para
agregarlo si tu fork lo quiere:

```ts
import { emitConversion } from "@/server/attribution/conversions";

// En el camino que decide que el lead va a pagar:
await emitConversion({
  organizationId: ctx.organizationId,
  conversationId: ctx.conversationId,
  eventName: "InitiateCheckout",
  customData: {
    lead_stage: "checkout",
    value: deal.value,
    currency: deal.currency,
  },
});
```

El helper ya está exportado y respeta los mismos guardrails, dedup y
tabla de actividad. No hace falta tocar el gateway.

## Lo que NO entra (fuera de alcance del spec)

- **Campaign Playbooks** (optimización de campaña). Diferido.
- **Marketing API** (creativos, audiencias, lookalikes). No es Meta
  Graph del canal WhatsApp; no entra.
- **Resultados / dashboards** (019). Diferido.
- **Backfill** de leads antiguos sin `ctwa_clid`. Sin captura, sin
  reporte retroactivo.
- **Espejo de `InitiateCheckout` de fábrica** (ver receta arriba si
  quieres agregarlo).
- **Clic CTWA real contra producción.** El self-test cubre todos los
  caminos verificables con mocks; el clic real queda como **PENDIENTE
  HUMANO/PRODUCCIÓN** (el upstream 016 tiene el mismo límite).

## Cómo leer la tabla de actividad

Ajustes → Anuncios muestra las últimas 50 filas de `conversion_event`
del tenant. Las columnas:

| Columna | Significado |
|---|---|
| **Fecha** | Cuándo se reportó. |
| **Conversación** | `conversationId` (clickeable en producción). |
| **Evento** | `QualifiedLead` o `Purchase`. |
| **Estado** | `enviado` / `falló` / `omitido` (sent / failed / skipped). |
| **Detalle** | Para `sent`: `value=X currency=Y` si los había. Para `failed`: motivo textual de Meta. Para `skipped`: la causa (lead orgánico, sin etapa calificada, `is_test`, etc). |
| **fbtrace_id** | La referencia que el soporte de Meta pide para debug. |

Desconectar la atribución (botón "Desconectar atribución") pone la
config en `qualifiedStageId = null` y `accessToken = null`. **No borra
el historial** de eventos — el dueño puede ver qué se reportó mientras
estuvo conectado.

## Verificación

- **Self-test:** `node --env-file=.env scripts/e2e-selftest.mjs`. La
  sección 012 cubre el modo en que arrancó la app (on/off). En CI se
  ejecuta dos veces, una por modo.
- **Pendiente humano/producción:** clic CTWA real → ver la fila en
  `conversion_event` con `status = sent` y un `fbtrace_id` real de Meta.
- **Soporte Meta:** si Meta reporta un evento "rechazado", copiar el
  `fbtrace_id` de la fila y mandárselo. El CRM no expone más que ese ID
  y el `errorMessage` textual que vino de Meta — no se loguea nada del
  token ni del payload completo.

## Riesgos conocidos (y cómo los mitiga este fork)

| Riesgo | Mitigación |
|---|---|
| Jev saltándose CAPI por bypass directo | Corte A cierra el bypass: `orchestrator.ts` ya no escribe `stageId` directamente, pasa por `moveLeadStage`. |
| Doble webhook duplicando evento | `UNIQUE (organization_id, conversation_id, event_name)` + `ON CONFLICT DO NOTHING` en el INSERT. |
| Valor falso envenenando optimización | `Purchase` sin `value`/`currency` si no hay monto válido — nunca `0` inventado. |
| Meta 200 con `events_received = 0` | Único acuse válido: `events_received >= 1`. |
| Flag encendida en producción sin querer | Apagada por defecto; CI corre ambas configuraciones. |
| Token de WhatsApp vencido | El reuso del token WA puede fallar; la fila queda `failed` con motivo textual, la app no se rompe. |
| Hardcodear "Interesado" | Etapa calificada configurable por tenant; el selector lista solo `kind = "open"`. |
| Optimizar campaña de ventas con `QualifiedLead` | Documentado arriba: `QualifiedLead` aplica a leads, no a ventas; la receta de `InitiateCheckout` queda como opt-in por fork. |
