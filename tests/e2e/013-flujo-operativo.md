# 013 C4 — Flujo operativo integrado (E2E 025)

Guion automatizado: `scripts/e2e-operator-flow.mjs`, invocado por
`scripts/e2e-selftest.mjs` con `E2E_SECTION=025`.

Este corte no introduce estados ni endpoints nuevos de dominio: **integra** los que
ya existían (cortes 1–3) en un flujo que una persona pueda recorrer sin conocer
`handoffAt`, los lanes ni los buckets. Por eso la prueba es de **UI real**: que
las tres superficies digan lo mismo y que las tres acciones muevan lo que dicen
solo se puede ver en pantalla.

## Ejecutar

```bash
# App de desarrollo contra una BD dedicada (nunca la de trabajo)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/operator_workspace_test \
E2E_OPERATOR_DATABASE_URL="$DATABASE_URL" \
WA_MOCK_ENABLED=true \
META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph \
OPENROUTER_BASE_URL=http://localhost:3000/api/dev/ai-mock \
pnpm dev

# En otra terminal
E2E_SECTION=025 node --env-file=.env scripts/e2e-selftest.mjs
```

El script **aborta** si la app o la BD no son locales, si la BD no se llama
`operator_workspace_test[_…]`, si los mocks están apagados o si `NODE_ENV` es
`production`. Es el mismo guard que 023/024, y existe para que un descuido no
mande WhatsApp a contactos de verdad.

## Estado al empezar

| Conversación | Estado | Dónde se ve |
|---|---|---|
| `Flujo pendiente` | `pending` | Por atender (2) + nav |
| `Flujo vencido` | `deferred` hace 30 min | Por atender (2) + Vencidos de la Agenda + nav |
| `Flujo futuro` | `deferred` en 3 días | Comprometidos (1) + Agenda |
| `Flujo espera` | `waiting_client` | solo la etiqueta |
| `Flujo soloia` | IA activa | sin etiqueta |
| `Flujo lab` | `deferred` (`is_test`) | en ninguna parte |
| `Flujo responde` | `waiting_client` | recibe un inbound real |
| `Flujo otra` (org B) | `deferred` | solo en la Agenda de B |

## El recorrido

1. **La Bandeja responde las dos preguntas.** "Por atender" = 2 (qué hago ahora),
   "Comprometidos" = 1 (qué tengo para después), nav = 1 vencido. "Por atender"
   sigue siendo el primer chip y el nuevo no se come a la cola.
2. **Coherencia de estado en la lista.** Vencido → "Por atender"; atendida →
   "Esperando respuesta"; comprometida → "Recordatorio"; la de la IA → sin
   etiqueta. El Laboratorio no aparece.
3. **Abrir NO saca.** Se abre `Flujo pendiente` y la cola sigue en 2.
4. **"Marcar atendido"** → 2 → 1, el panel pasa a "Esperando respuesta", la fila
   de la lista dice lo mismo, en BD queda `waiting_client`, **y no sale WhatsApp**.
5. **"Recordarme"** → el estado pasa a "Recordatorio", "Comprometidos" 1 → 2, la
   cola no baja más y en BD hay un `deferred` con fecha futura.
6. **La Agenda dice lo mismo que la lista**: el nuevo se lee "programado" y el
   vencido "vencido · en Por atender" — contiene la palabra del chip. Sin botón
   de enviar en ninguna parte.
7. **"Reactivar IA"** → el bloque desaparece, "Comprometidos" 2 → 1, la fila
   pierde la etiqueta, la fila de atención desaparece de la BD y el item sale de
   la Agenda.
8. **El cliente escribe de verdad** (inbound por el wa-mock) y Max **responde**
   desde el composer: la ventana de 24 h se abre, el envío sale, la cola baja
   2 → 1 y el estado queda `waiting_client`.

## Camino infeliz

- Sin sesión: `/api/reminders` → 401, el endpoint nuevo → 401, `/agenda` → login.
- Conversación de otra organización → 404 (indistinguible de inexistente).
- Conversación de la IA → 409 con un mensaje que se puede leer; del Laboratorio,
  también 409.
- `{"state":"pending"}` → 422: **el endpoint no deja fabricar un estado**, y el
  intento fallido no escribe nada.
- **La Agenda en 500**: avisa en pantalla, no rompe la vista, y al reintentar
  carga sola.

## Garantías del bloque

- `sales_follow_up_job` intacta: cero seguimientos automáticos.
- El outbox del wa-mock crece **exactamente en 1**, y es el mensaje que la persona
  escribió a mano. Ni "marcar atendida", ni "recordarme", ni "reactivar IA", ni un
  recordatorio vencido mandan nada.

## Hallazgos que dejó el E2E (arreglados en el corte)

1. **El botón "Enviar" no dice nada de la ventana de 24 h.** Está deshabilitado
   con el composer vacío por `canSubmit`, así que comprobarlo como prueba de la
   ventana daba un falso negativo. La comprobación mira el aviso real del composer
   ("La ventana de 24 horas está cerrada.") y, aparte, que con texto el botón se
   habilite.
2. La ventana se abre por SSE: el panel ya está pintado con la conversación
   anterior cuando el inbound aterriza. Se **espera** al `conversation.updated` en
   vez de leer el estado en el mismo tick.
