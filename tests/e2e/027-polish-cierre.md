# 027 — Cierre del workspace: pulido y regresión (014 C8)

**Estado: EJECUTADO — 53/53 checks OK, 0 fallos.**
Comando: `E2E_SECTION=027 node --env-file=.env.cut8 scripts/e2e-selftest.mjs`
Script: `scripts/e2e-cut8-polish.mjs` · dispatch en `scripts/e2e-selftest.mjs`.

Este guion no se ejecuta a mano: `pnpm test:e2e` lo conduce contra la app real y
sale distinto de cero si algo falla. Está aquí para que se pueda leer qué se
comprueba y por qué.

## Las precondiciones que importan

- App de pruebas en `localhost`, `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` y
  `OPENROUTER_BASE_URL` apuntando a los mocks de `src/app/api/dev/`.
- PostgreSQL **dedicado** cuyo nombre case `operator_workspace_test`: el script
  aborta si no es local, si es `NODE_ENV=production` o si no es una BD dedicada.
- Cero WhatsApp real. `is_test` del Laboratorio nunca toca Graph.

## Qué comprueba, y por qué

### 1 · Escritorio primero: el rediseño sigue en pie (regresión de 013/014)

| Check | Por qué |
|---|---|
| El enlace del nav pinta un anillo de foco real | Antes el anillo solo existía en `Button`/`Input`/`Textarea`; el resto heredaba el del navegador, que se recorta dentro de un `overflow` |
| El chip "Por atender" pinta un anillo de foco real | Ídem: es un `<button>` crudo |
| El anillo va dentro de la caja (`outline-offset` negativo) | Si fuera por fuera, el primer ancestro con `overflow` —el `overflow-y-auto` de la lista— se lo comería |
| "Por atender" cuenta 1 | Regresión del conteo de 013 C2/C4 |
| La fila conserva la marca roja de trabajo | Regresión de 014 C7 |
| El panel ofrece las tres acciones | Regresión de 013 C4 |

### 2 · Las tres acciones de 013, con teclado y sin que su resultado sea mudo

| Check | Por qué |
|---|---|
| Al abrir "Recordarme" el foco cae en la fecha | Antes el formulario se desplegaba y el foco se quedaba en el botón: había que recorrer el panel a ciegas |
| "Elegir fecha" declara que lo abrió / lo cerró | `aria-expanded`, sin el cual no hay forma de saber si el formulario está desplegado |
| "Marcar atendido" anuncia que salió bien, como `role="status"` | La acción es asíncrona y no mueve el foco: sin región viva pasaba desapercibida |
| Sale de "Por atender" al marcar atendida | Regresión de 013 C4 (con espera, no lectura en el mismo tick) |

### 3 · "Reactivar IA" deja de fallar en silencio

Es el defecto que los cortes 1–7 dejaron: el resultado del `PATCH` se
descartaba, así que si fallaba el botón se quedaba pulsado, no pasaba nada y no
se decía nada.

| Check | Por qué |
|---|---|
| "Reactivar IA" que falla lo dice | El aviso tiene que existir |
| … con el mensaje del servidor | No un texto genérico que no dice qué hacer |
| … y lo anuncia como `role="alert"` | Un error interrumpe; un éxito no |
| … y la conversación sigue siendo del humano | El fallo no se disfraza de éxito |
| "Reactivar IA" saca el bloque de atención humana | Al reactivar, la IA vuelve a ser la dueña: que el bloque desaparezca es lo correcto |
| … y la IA manda de verdad en la base | `handoff_at IS NULL` **y** `ai_enabled`: la garantía de 013 se comprueba en los datos, no en un texto que ya no está en pantalla |

### 4 · La Bandeja rota se dice, y no para siempre

Antes, si `/api/conversations` fallaba, `conversations` se quedaba en `null` y
la lista pintaba **"Cargando…" para siempre**: una espera que nunca termina.

| Check | Por qué |
|---|---|
| La Bandeja rota dice que se rompió | El estado deja de ser eterno |
| … y ofrece reintentar | Un fallo sin salida es un callejón |
| … y no se hace pasar por una bandeja vacía | Distingue "no hay nada" de "no he podido mirar" |
| Reintentar recupera la lista | La salida funciona de verdad |

### 5 · El Pipeline deja de mentir sobre el negocio

Antes, si `/api/pipeline/board` fallaba, `stages` se quedaba en `[]` y la
pantalla decía **"Este pipeline todavía no tiene etapas"** y ofrecía "Gestionar
etapas": un hecho falso sobre el negocio, con una acción que no lo arreglaba.

| Check | Por qué |
|---|---|
| El Pipeline caído dice que se cayó | |
| … y NO afirma que no tengas etapas | La regresión de este corte |
| Vuelve a pintar la pantalla al reintentar | Y el aviso desaparece |

### 6 · La Agenda vacía no es un hueco

| Check | Por qué |
|---|---|
| La Agenda vacía no es un hueco: lo dice | FR-8.3 |
| … explica qué es y qué hacer | Cita la ruta exacta: conversación en atención humana → "Recordarme" |
| … y los cinco grupos siguen explicando la estructura | 013 C3 lo decidió así, con test, y no se toca aquí |

### 7 · Móvil (viewport de 375 px)

| Check | Por qué |
|---|---|
| El nav se puede abrir / arranca cerrado / declara el estado | `aria-expanded` |
| Al abrirlo entra en pantalla y hay un velo que lo cierra | El cajón tiene salida sin teclado |
| El cajón es usable: deja sitio al contenido | No se come los 375 px |
| Escape cierra el cajón | Quien navega solo con teclado necesita salir sin puntero |
| … y devuelve el foco al botón que lo abrió | Si no, el teclado se queda sin salida visible |
| Navegar también cierra el cajón | Un cajón que sobrevive al clic parece un bug |
| La lista ocupa la pantalla entera | Antes la Bandeja pedía 360 px de lista + 224 px de nav |
| Al abrir una conversación, el hilo sustituye a la lista | Maestro/detalle |
| El hilo ofrece un "atrás", con nombre accesible | Y en escritorio **no** aparece: no hay a dónde volver |
| El panel de detalles ocupa la pantalla, no 320 px | Y cerrar los detalles devuelve al hilo: no deja atrapado |
| En escritorio el "atrás" no aparece | El mismo recorrido, en dos formas |

### 8 · Las garantías del bloque, una vez más

| Check | Por qué |
|---|---|
| `sales_follow_up_job` intacta | Cero seguimientos automáticos |
| El outbox **no** creció | Ni "Marcar atendido" ni "Recordarme" mandan WhatsApp |

## Un defecto que este guion encontró mientras se escribía

Al ejecutar el recorrido móvil, "abrir los detalles" no existía: `panelOpen`
nace en `true`, así que el botón solo se pintaba con `!panelOpen`, y en un móvil
la conversación se abría **sin ninguna manera de llegar a los detalles**. El
arreglo está en `inbox-client.tsx` (el botón cubre los dos casos y se oculta solo
en escritorio con `md:hidden`), y los checks "el panel de detalles ocupa la
pantalla" y "cerrar los detalles devuelve al hilo" lo cubren.

Este es el motivo por el que la Constitución V exige probar en comportamiento y
no solo el gate: `pnpm typecheck && pnpm lint && pnpm build && pnpm test` estaba
verde con ese callejón sin salida en el código.
