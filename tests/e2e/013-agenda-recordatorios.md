# 013 C3 — Agenda de recordatorios humanos (guion E2E automatizado)

Estado: **AUTOMATIZADO**. Se conduce con
`E2E_SECTION=024 node scripts/e2e-selftest.mjs` (49 checks). Este documento
explica qué se verifica y por qué; el arnés es `scripts/e2e-operator-agenda.mjs`.

## Requisitos (aislados, como en 023)

- BD dedicada llamada `operator_workspace_test` (el guion RECHAZA correr contra
  otra: no toca `is_test` ni números productivos).
- App en desarrollo con `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` y
  `OPENROUTER_BASE_URL` apuntando a los mocks locales. Ojo: los mocks se apagan
  en producción por diseño (`isMockEnabled()` exige `NODE_ENV !== production`),
  así que la app debe correr en modo desarrollo, no con `next start`.

```bash
E2E_SECTION=024 APP_BASE_URL=http://localhost:3100 \
  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/operator_workspace_test \
  node --env-file=.env scripts/e2e-selftest.mjs
```

## 1. La Agenda agrupa (por API y por pantalla)

Cinco grupos siempre presentes: **Vencidos, Hoy, Mañana, Esta semana, Más
adelante**. El guion afirma que un `deferred` vencido cae en "Vencidos", que uno
futuro no, que el Laboratorio (`is_test`) no aparece, y que un `pending` —que sí
está en "Por atender"— tampoco es Agenda: son superficies distintas.

## 2. Programar desde la UI

Se abre la Bandeja con `?contact=…` de una conversación en atención humana, se
pulsa "Recordarme", se elige fecha/hora y se guarda. Después:

- el panel muestra la fecha y ofrece "Cancelar";
- el chip "Por atender" baja de 2 a 1 **sin recargar a mano** (el POST publica
  `conversation.updated` y el cliente se refresca);
- el recordatorio aparece en la Agenda, en su grupo.

## 3. Vencido vuelve a "Por atender" (sin proceso ni worker)

El guion mueve `due_at` al pasado por SQL y recarga. El chip vuelve a 2 y el
item pasa a "Vencidos" marcado como *vencido · en Por atender*. Esto es la
prueba de que vencer es una **derivación de lectura**: no hay cron, ni worker,
ni cola que disparate nada.

## 4. El cliente escribe antes → vuelve de inmediato

Se inyecta un inbound real por el wa-mock. El hilo `deferred` se convierte en
`pending` y sale de la Agenda: la pelota vuelve a la persona, sin que el
recordatorio se "dispare".

## 5. Cancelar

Desde la Agenda, por fila y por nombre. El item desaparece de pantalla y la fila
desaparece de `conversation_attention`. Cancelar **no** es responder: no manda
nada.

## 6. Camino infeliz

Por API: fecha pasada (422 `due_in_past`), nota de 281 caracteres (422), nota
vacía (422, no un `null` silencioso), body con `organizationId` (422), organización
ajena (404), conversación de la IA (409), Laboratorio (409), cancelar trabajo
humano vivo (409), cancelar sin recordatorio (404), sin sesión (401).

Por UI: guardar sin fecha muestra el error sin romper el panel; y `/agenda` sin
sesión devuelve al login en vez de la vista.

## 7. La garantía del corte

Al final del guion se leen dos cosas y tienen que estar como al empezar:

- el **outbox del wa-mock**: cero WhatsApp enviados por el camino de la Agenda;
- **`sales_follow_up_job`**: cero seguimientos automáticos encolados.

Además, la vista se comprueba con `getByRole("button", { name: /Enviar/i }) === 0`:
la Agenda no ofrece ninguna acción de envío.

## Notas de fixture (por qué es fácil que fallen)

- El `phone_number_id` del mock debe ser **único por corrida**: el webhook
  resuelve la organización tomando la primera fila que coincide, así que un PN
  fijo hace que el inbound acabe en la organización de una corrida anterior.
- El teléfono del contacto inbound también: `wa_identity` es UNIQUE solo por
  organización, y `normalizeMx` solo reescribe los números de 13 dígitos.
- Para pasar un recordatorio a "vencido" hay que mover `state` y `due_at` juntos:
  el CHECK de coherencia exige `due_at` si y solo si `state = 'deferred'`.
