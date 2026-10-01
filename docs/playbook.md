# Sales Playbook — guía del dueño

> Guía operativa para editar, publicar y poner a prueba la estrategia comercial
> del CRM. Escribida para el dueño del negocio, no como referencia de API. El
> detalle técnico vive en `specs/008-sales-playbook/` y el contrato del motor en
> [`SALES_ORCHESTRATOR.md`](./SALES_ORCHESTRATOR.md).

---

## Qué es el playbook y por qué existe

El playbook es **tu estrategia comercial escrita**: qué vendes, a quién, cómo es la
oferta, qué política sigue el agente, qué le preguntas a Jev y cómo debe redactar el
writer cada respuesta.

Hasta ahora esa estrategia vivía congelada dentro del código (`VENDE_VELOZ_*` y
`JEV_SALES_QUESTIONS_V2`), así que cualquier ajuste —un precio nuevo, una prioridad
que sube, una pregunta distinta— exigía un **redeploy**. Y una estrategia comercial
es iterativa por naturaleza: producción → conversaciones → evidencia → aprendizaje →
cambio → prueba → publicación. Ahora el playbook es **durable, versionado y editable
desde la UI, sin redeploy**: tocar tu estrategia ya no implica tocar el motor.

El sistema quedó partido en tres capas:

| Capa | Qué es | Qué decide |
|---|---|---|
| **Motor** | Código: resolver determinístico, lanes, writer, follow-ups, envío. | El **cómo** decidir y redactar. |
| **Playbook** | Configuración versionada en base de datos, por organización. | El **qué** decir y ofrecer. Es lo que editas tú. |
| **Knowledge base** | Los hechos concretos de tu negocio. | Referencia factual. Jev **no** decide con ella. |

Reglas que nunca cambian: el runtime **siempre** consume una versión
**publicada**; el motor no se modifica desde el editor (no se crean lanes, ni
acciones comerciales, ni efectos nuevos en el pipeline); y cada cambio tuyo es
una **versión nueva**, nunca una edición sobrescrita.

---

## Cómo crear un draft

Todo el editor vive en la pestaña **Sales Playbook**, en la pantalla de
configuración del agente.

1. Abre esa pestaña. Verás la tarjeta de la versión publicada en vigor.
2. Pulsa **Crear draft desde esta versión**. El borrador arranca como copia
   exacta de lo que está publicado hoy.
3. Edita lo que necesites y guarda.
4. Cuando estés conforme, publica (sección siguiente).

Reglas del borrador:

- **Solo puede haber un draft abierto a la vez.** Si ya tienes uno, el botón
  aparece deshabilitado y la interfaz te avisa; un reintento responde con un
  conflicto (409), nunca con dos borradores.
- El draft es **plenamente editable** y se puede **eliminar** si cambias de
  opinión.
- **Nada de lo que hagas en el draft afecta a producción.** Los clientes reales
  siguen viendo la estrategia publicada.
- Si tu organización aún no tiene ninguna versión publicada, no hay punto de
  partida del cual copiar. La siembra la hace el sistema al arrancar; si falta,
  es un problema de despliegue y le toca al administrador.

---

## Cómo publicar

Publicar es el momento en que el borrador deja de ser una intención y pasa a ser la
estrategia en vigor.

1. Con el borrador guardado, pulsa **Publicar**.
2. Se abre una ventana que te recuerda qué versión va a quedar archivada y te pide
   un **Comentario** obligatorio (mínimo 3 caracteres).
3. Escribe qué cambiaste y por qué. Ejemplos útiles: "Sube el precio de la
   mensualidad a S/210", "Prioridad 1 pasa a matrícula online".
4. Confirma. A partir de ese momento el borrador es la versión publicada.

Qué pasa exactamente al publicar:

| Efecto | Detalle |
|---|---|
| La publicada anterior pasa a `archived` | Automático, dentro de la **misma transacción**. Nunca queda más de una versión en vigor. |
| El borrador pasa a `published` | Es la que el runtime va a leer. |
| Toma efecto en el **siguiente turno** | No hay caché en el motor: la publicada se lee de la base en cada turno. No necesitas reiniciar nada. |
| La publicada queda **inmutable** | Si quieres cambiar algo, creas un draft nuevo a partir de ella. |

El comentario es **obligatorio y no es un adorno**: es tu registro de auditoría.
Cuando mires una conversación antigua, verás qué versión del playbook estaba en vigor
y por qué se publicó.

---

## Cómo hacer rollback

El rollback es tu salida rápida cuando algo publicado sale mal.

1. Pulsa **Ver historial** en el editor del playbook.
2. En el **Historial de versiones**, localiza la versión que quieres recuperar. Solo
   las versiones archivadas que no son la actual ofrecen la acción **Rollback a V{n}**.
3. Pulsa **Rollback a V{n}**, escribe el **Comentario** obligatorio (por qué
   reviertes) y confirma.

Lo que hace el rollback, y lo que **no** hace:

- **Republica** el contenido de esa versión como la nueva versión en vigor. No "borra"
  lo que pasó: la versión que estaba publicada pasa a `archived`, como en cualquier
  publicación.
- **No edita el historial.** El contenido de una versión nunca cambia, sea publicada,
  archivada o republicada: V3 seguirá siendo V3 para siempre.
- Como en la publicación, toma efecto en el **siguiente turno**.

Es la misma operación que "publicar otra vez una versión vieja", con la diferencia de
que no reconstruyes el borrador a mano.

---

## Cómo funciona el fallback

Hay un caso en el que el motor funciona sin que hayas publicado nada: una
organización **sin playbook publicado**. Entonces recurre a los valores congelados que
siguen en el código (`VENDE_VELOZ_*` y `JEV_SALES_QUESTIONS_V2`, conservados como
`DEFAULTS_ONLY` precisamente para esto y para las pruebas). Las conversaciones siguen
respondiendo: el negocio no se detiene. Pero ese camino **deja rastro**:

- En los logs del servidor aparece un aviso, **una vez por proceso**, del estilo de
  `sin playbook publicado en org=...; fallback a VENDE_VELOZ_*`.
- Cada decisión tomada bajo el fallback queda registrada con
  `playbook_version_id = null`. En el panel de venta y en el Laboratorio verás esa
  conversación marcada **sin playbook**.

**El fallback es una red de seguridad, no un modo de operación normal.** Si lo estás
viendo, significa que todavía no publicaste tu primera versión. La solución es una
sola: publica una versión.

---

## Qué hace el editor Jev (tres clases)

Las preguntas que el agente hace para entender al cliente no son todas iguales. El
editor las agrupa en tres clases, cada una con un candado distinto (lo verás con una
insignia junto a la pregunta).

### 🔒 `engine-required` — el contrato del motor

Dos preguntas, y el motor **no puede funcionar sin ellas**:

- **`next_action`**: las 7 opciones de acción comercial (`ask_more_questions`,
  `show_operations_demo`, `show_online_enrollment_demo`, `present_price`,
  `schedule_call`, `schedule_follow_up`, `disqualify`).
- **`needs_human_call`**: sí/no, "¿vale la pena pasar esto a un humano?".

No se pueden renombrar, cambiar de tipo, desactivar ni eliminar. Solo puedes editar
las **descripciones** (las instrucciones y el significado de cada opción). Las
**claves** de las opciones son fijas: el motor las reconoce por nombre.

### 📊 `known signal` — señales comerciales que el motor reconoce

Seis señales que el motor sabe interpretar: `real_operational_need` (¿hay necesidad
operativa real?), `product_fit` (qué tan bien encaja tu producto),
`motivation_to_change` (qué tanta urgencia tiene a cambiar), `purchase_intent` (qué tan
cerca está de comprar), `buying_timing` (cuándo probablemente compre) y
`main_value_proposition` (qué valor le importa más).

Su clave y su tipo están fijos, y en las que son de opción también lo están las claves
de opción. Lo que **sí** puedes hacer es editar las descripciones y **activar o
desactivar** la pregunta. Desactivar una de estas es **seguro**: el motor tiene un plan
B documentado para cada una.

| Señal desactivada | Qué hace el motor |
|---|---|
| `buying_timing` | La trata como `unknown`; el writer simplemente omite la línea de timing. |
| `main_value_proposition` | El writer sigue redactando, sin un ángulo específico. |
| Las otras cuatro | Se guardan y se muestran, pero no influyen en la decisión del turno. |

En ningún caso desactivar una señal rompe al motor.

### ➕ `analytical/custom` — preguntas tuyas

Estas las creas tú, libremente. El motor **no las usa para decidir** nada: nunca
cambian una lane, un handoff o una acción comercial. Se conservan en la decisión del
turno (`signals`) para analizarlas después. Como no están en el contrato, tienes
libertad total: crearlas, desactivarlas, renombrarlas, duplicarlas y eliminarlas.

> **Sé honesto contigo mismo sobre esto en V1:** las preguntas analíticas sirven
> para **medir**, no para **gobernar**. No esperes que añadir una pregunta propia
> cambie una decisión comercial. Si lo que quieres es cambiar cómo decide el motor,
> eso se cambia en el playbook publicado, no con preguntas nuevas.

---

## Cómo correr el laboratorio comercial

El Laboratorio es tu banco de pruebas: antes de publicar un cambio relevante,
lo pruebas. Elige en qué versión quieres correr la evaluación (selector
**Playbook**) y pulsa **Correr evaluación**.

| Modo | Qué corre |
|---|---|
| **Publicada** (por defecto) | La versión en vigor. Es el modo normal. |
| **Borrador** | El draft abierto, **sin publicarlo**. |
| **Publicada + Borrador** | Ambas en paralelo, con informe lado a lado. |
| **Versión archivada…** | Una versión concreta del historial (te pide su identificador). |
| **Agente clásico (legacy)** | La cohorte vieja de agente genérico, sin pipeline comercial. |

**Publicada + Borrador** lanza dos corridas a la vez; el candado de concurrencia es
**por organización y por modo**, así que no se pisan. Y cada corrida guarda **qué
versión del playbook atendió cada caso**, por lo que la comparación es auditable: no
comparas "corrida A" vs "corrida B" a ciegas, comparas dos versiones identificadas.

Cada caso usa un contacto archivado y un lead nuevos, independientes también
entre Publicada y Borrador. Las respuestas se guardan localmente para que el
siguiente turno vea el historial completo. Al terminar (incluso si falla el
juez), se eliminan contacto, lead, conversación y mensajes temporales; el
informe conserva transcript, versión, outcomes y veredicto. Si la organización
no tiene una etapa abierta, la corrida falla explícitamente. Los contactos
archivados tampoco aparecen en el Pipeline operativo.

### Declarar lo esperado (a mano)

El informe te muestra, por caso, el resultado real (qué decidió el motor) al lado
del **esperado**. Y aquí está la parte importante: **el esperado lo declaras tú, a
mano**, con los desplegables de `next_action`, `lane` y `handoff`.

| Marca | Significado |
|---|---|
| ✅ | Coincide con lo que declaraste. |
| ❌ | Difiere de lo que declaraste. |
| — | No declaraste expectativa para ese campo. El resultado observado se muestra igualmente a la derecha; si falta, ese lado también muestra —. |

> **Por qué el editor nunca autocompleta el esperado con lo observado:** sería una
> comparación tautológica. Si el sistema llenara "esperado" con lo que el motor hizo,
> siempre coincidiría y no diría nada. El valor está en que **tú** digas "esta
> conversación debería haber escalado a humano", y el laboratorio te diga si el motor
> está de acuerdo. Si declaras el esperado copiando el resultado, no estás probando
> nada.

### El Laboratorio es un sandbox (cero efectos reales)

Las corridas usan conversaciones marcadas como prueba, con garantías duras: **cero
envíos a WhatsApp real** (ningún mensaje sale a un cliente de verdad), **cero eventos
CAPI** (tracking de conversiones) y **cero seguimientos programados** (la tabla de
trabajos de follow-up queda vacía para esa corrida). Puedes correr tantas evaluaciones
como quieras sin ensuciar la operación.

---

## Cómo guardar una conversación como caso (PII minimizada)

Cuando una conversación real salga bien (o mal) y te interese conservarla como
caso de evaluación, puedes guardarla desde la bandeja de entrada. En el panel
lateral de la conversación, al final, hay una sección **Laboratorio comercial**
con el botón **Guardar conversación como caso**.

Ese botón pide una **confirmación explícita** antes de guardar nada, y esa ventana te
dice exactamente qué se guarda y qué no. No es un "sí/no" genérico: es una decisión
sobre datos de un cliente real, y por eso el texto la explica.

La promesa es fuerte y es literal. Lo que se guarda:

| Se guarda | Detalle |
|---|---|
| `transcript` | Solo **texto**, con su rol (`cliente` / `agente`). Ni adjuntos, ni imágenes, ni audio, ni enlaces a archivos. |
| `playbook_version_id` y `playbook_schema_version` | Qué estrategia estaba en vigor al guardarla. |
| `expected_next_action`, `expected_lane`, `expected_handoff` | Los resultados esperados, que editas después. |
| Metadata no identificante | `turns_approx`, `chars_total`, `detected_language` (turnos aproximados, total de caracteres e idioma detectado). |

Lo que **jamás** se guarda: `lead_id`, `contact_id`, `conversation_id`, `phone`,
`email`, `wa_identity`, `ctwa_clid`, `source_id`, `source_url`, identificadores de
Meta, ni ninguna combinación de campos que te permita volver a encontrar el cliente,
el contacto o la conversación original.

Por qué es a prueba de fugas:

1. **Es estructural.** La tabla donde vive el caso no tiene ninguna columna de
   identidad. No es que "no la rellenamos": es que la tabla no la tiene, así que no
   se puede filtrar ni por error.
2. **El texto mismo va saneado.** El contenido de los mensajes pasa por un filtro que
   sustituye los datos identificantes por marcas neutras: teléfonos → `[telefono]`,
   correos → `[email]`, enlaces → `[enlace]`, identificadores de plataforma → `[id]`.

   Esto importa por una razón concreta: **muchos clientes escriben su propio número
   dentro de un mensaje** ("escríbeme al 51 999 888 777"). Sin ese filtro, el caso
   guardado apuntaría derechito a la identidad real del lead. Con él, conserva el
   valor de evaluación sin el dato.
3. **El `conversation_id` se usa solo para leer.** Se abre la conversación con tu
   sesión para extraer los turnos, pero ese identificador **nunca** se escribe dentro
   del caso.

Requisitos y siguientes pasos:

- **Necesitas el Sales Orchestrator encendido.** Si está apagado, el botón aparece
  deshabilitado y te lo recuerda; si se intentara de todos modos, la acción responde
  con un conflicto (409) y no guarda nada. Tiene sentido: un caso comercial solo
  sirve si el pipeline comercial es el que lo evaluará.
- Solo se guardan mensajes **de texto**. Si una conversación no tiene texto guardable,
  no hay caso que crear.
- **Después**, ve al Laboratorio y edita los resultados esperados de ese caso, igual
  que con cualquier otro: a mano, nunca copiando lo que el motor hizo.

---

## Cómo migrar desde el hardcode antiguo

**No tienes que hacer nada.** Si tienes el Sales Orchestrator encendido, la migración
ya ocurrió. Al arrancar el sistema, cada organización con Sales Orchestrator
habilitado recibe automáticamente una primera versión del playbook, sembrada con el
contenido que ya tenías congelado en el código: no tienes que importarlo ni
configurarlo a mano.

- En cuanto esa versión está publicada, el motor la lee: **lo que hoy corre en tus
  conversaciones es tu playbook, no el hardcode.**
- Los valores antiguos (`VENDE_VELOZ_*` y `JEV_SALES_QUESTIONS_V2`) **siguen en el
  código** como `DEFAULTS_ONLY`: se usan en las pruebas y como respaldo documentado
  si faltara una versión publicada. **No se borraron.**

Para ver tu versión sembrada: abre la pestaña **Sales Playbook**. Ahí verás la
versión publicada en vigor y su historial.

---

## Riesgos conocidos

Conviene que los tengas en la cabeza, no escondidos:

- **Publicar cambia la producción en el siguiente turno.** No hay ventana de prueba ni
  despliegue gradual. Publica solo lo que ya probaste en el Laboratorio; si no estás
  seguro, déjalo como borrador y pruébalo primero.
- **El motor lee la base en cada turno, a propósito.** No hay caché en memoria. Al
  volumen actual eso es más barato y simple que mantener una caché coherente; si
  algún día las métricas lo exigen, sería una optimización futura. Hoy no es un
  problema.
- **Solo hay un playbook por organización en V1.** No existen campañas múltiples ni
  elegir un playbook distinto por conversación. Esa capacidad está reservada a nivel
  de modelo, pero **no está construida**: no la busques en la interfaz.
- **Un rollback a una versión con formato desconocido se rechaza.** Si una versión se
  guardó con un `schema_version` que el motor no reconoce, el sistema la rechaza con
  un error claro en vez de publicarla a ciegas. Hoy no hay migrador automático de
  versiones antiguas; la salida es crear un draft nuevo con el formato actual.
- **El fallback es visible precisamente para que no se te olvide.** Si ves el aviso de
  "sin playbook publicado", significa que nadie publicó una versión todavía. No es un
  error de la plataforma: es una señal de que falta dar el paso.
- **Los resultados esperados están tipados contra catálogos cerrados.** Las 7 acciones
  de `next_action` y las 5 lanes son listas cerradas en el editor. Es deliberado:
  garantiza que una expectativa con un typo no se pueda guardar (y que luego
  compararía mal sin explicación).
