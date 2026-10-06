# Contrato vigente — spec 017 (2026-10-05)

Esta sección actualiza los contratos de entrega descritos en checkpoints
históricos: obtener un `wamid` de Graph significa **pending**, no entrega
comercial confirmada. Mensaje y ledger se persisten antes del request; receipts
`sent`/`delivered`/`read` se reconcilian aun si llegan antes de la respuesta Graph.
La primera confirmación aplica facts y scheduling en una transacción tenant-scoped;
duplicados y estados exitosos fuera de orden no repiten efectos. `failed` es
terminal: invalida efectos/jobs ligados a ese mensaje, conserva facts anteriores
independientes y deja atención humana segura sin retry automático ni LOST.
Pago multipart necesita confirmar todas las partes; se conserva su handoff
comercial intencional, sin autorizar callbacks obsoletos de otros turnos.

Audio, imagen, video, documento, sticker y ubicación sin interpretación fiable
persisten inbound/asset y cancelan seguimientos, pero no consultan Jev/writer ni
responden: handoff silencioso `unsupported_media`. Caption no equivale a interpretar
el archivo. Historial opaco tampoco se presenta al modelo como contenido entendido.
Cada turno captura el inbound vigente y lo revalida antes de efectos, writer/sender,
facts y cambios de pipeline. Inbound nuevo, pausa o respuesta manual invalidan
su autorización; esto aplica también a legacy y facts locales de sandbox.

Una reserva durable UNIQUE por organización/conversación/slot precede al envío
automático de demo. Repetir el slot pendiente, fallido o incierto no reenvía video;
`duplicate_demo` solicita revisión humana silenciosa. Slots distintos y envío manual
conservan sus reglas. BSUID usa `recipient` escalar; teléfono usa `to` normalizado.
La abstracción compartida sirve texto/media/plantillas/follow-ups; authentication
requiere teléfono. No usar BSUID como `to` ni fabricar teléfonos.

Confirmación tardía puede registrar entrega sin reabrir 24h; inbound/manual/handoff
obsoleto no crea seguimientos. Sandbox no toca Graph. Published, precios, Agenda,
atribución y aislamiento tenant conservan sus contratos. Antes de desplegar este
código se requiere migración **0011**; no hay backfill ficticio de entregas/reservas
históricas. Evidencia reproducible: `specs/017-production-messaging-safety/integration-evidence.md`.
La decisión de media opaca → humano silencioso queda pendiente de sincronizar en
Obsidian; este corte no escribe en el cerebro de negocio.

---

## Hotfix 015 — evidencia y routing de demos (2026-10-05)

Un saludo/pedido genérico de información es curiosidad, no necesidad. El anuncio
aporta contexto y tema, nunca prueba del problema. Demo requiere necesidad
expresada o petición explícita de ver funcionamiento. Se refuerza la política
que viaja a Jev en runtime, también con Published previas, sin mutar sus filas.

El guard reconoce solamente historiales de curiosidad inequívoca del lead, ignora
vendedor/anuncio/scores y degrada las dos acciones demo a `ask_more_questions`
si no hay facts durables de demo/precio/pago/humano. Textos desconocidos o
concretos quedan a Jev; una petición explícita permite demo incluso con score
bajo. No es un clasificador adicional de necesidades. Los facts de avance
conservan conversaciones con contexto recortado; no se inventa un nuevo fact de
necesidad. Prioridad HUMAN intacta. Snapshot conserva `decision` original,
`plan.nextAction` efectivo y `plan.demoGuardReason`; UI prefiere plan efectivo,
sin atribuirle confianza del score original cuando la acción cambió.

Routing: tema específico reciente del lead > headline/body de `ad_context` >
panel general. Solicitud genérica de ver el sistema conserva tema previo/ad;
matrícula explícita más reciente gana al anuncio de pagos. Acción online conserva
su slot propio. Sin IDs de anuncios. Writer recibe contexto; ante opener genérico
usa beneficio breve + UNA pregunta controlados; demás turnos conservan redacción
LLM. Entrega/facts/sender/tenant/sandbox siguen el contrato existente.

Evidencia E2E comercial 021: **44/44** checks sobre app/PG reales con proveedores
mock, incluidos A–E y unhappy paths. Detalle: spec 015/tasks.md. No desplegado.

---

# Sales Orchestrator — contrato operativo

**Contrato vigente (2026-10-03, corte 3 del spec 009):** el runtime
**PUBLICADO está ENCENDIDO en producción**.
`SALES_PLAYBOOK_RUNTIME_ENABLED = true` (`src/server/sales/build-state.ts:37`).

Qué significa eso en un turno real:

- El builder (`buildJevSalesState`) consulta la versión **Published** de la
  organización en cada turno, **sin cache** (ni TTL ni memoización: ver
  `src/lib/sales/playbook/loader.ts`). Publicar o rollbackear surte efecto en el
  **siguiente turno, sin redeploy**.
- La Published alimenta de verdad el pipeline: `product` y `commercial_policy`
  van al state que evalúa Jev; `offer` y `writer` van al writer; `jev_questions`
  es el set de preguntas que se le manda a Jev.
- El mapeo es **explícito**, no un spread: `ConfigV1.product` y
  `ConfigV1.commercial_policy` se convierten a la forma snake_case que consume
  Jev (`toStateProduct` / `toStatePolicy`). Esto se corrigió en el corte 3
  porque el spread anterior perdía 6 de las 9 claves de política en silencio y
  arrastraba los bloques `implementation`/`subscription` hardcodeados de Vende
  Veloz hacia organizaciones con playbook de otro negocio.
- **Un draft NUNCA afecta producción**: el loader del turno solo pide
  `status='published'`. `getDraftConfigForOrg` se usa únicamente en el
  Laboratorio.
- **Auditoría**: cuando el turno usa la Published, el lead guarda
  `last_jev_playbook_version_id`, `last_jev_playbook_schema_version`, y dentro
  de `last_jev_decision` las claves `playbook_version_id`,
  `playbook_schema_version` y `playbook_version_number`.
- **Degradación**: sin Published, o con una Published que ya no cumple
  `ConfigV1`, el turno cae al baseline hardcodeado (`VENDE_VELOZ_*`,
  `JEV_SALES_QUESTIONS_V2`), emite un `console.warn` observable una vez por
  proceso y por organización, y **no tumba**. En ese caso la auditoría queda en
  `null`, que es la señal de "este turno se decidió con el fallback".
- El **override por versión** (`playbookOverride`) sigue siendo exclusivo de
  sandbox: solo se acepta con `conversation.is_test = true` (guard T306 en
  `src/server/sales/orchestrator.ts`); fuera de `is_test` lanza
  `playbook_override_forbidden_in_production`.
- Todo es **tenant-safe**: cada lectura del playbook pasa por `scoped()` con el
  `organizationId` de la conversación, incluido `getConfigByVersionId`.

**Reversibilidad**: volver la constante a `false` devuelve el producto, la
política, las preguntas, la oferta y el writer a los defaults hardcodeados, que
quedan como **fallback**. Es un cambio de una línea; no hay que tocar nada más.
Lo que el administrador publique sigue siendo la fuente de verdad del turno.

**Precondición operativa**: con el motor encendido, la organización debe tener
una **Published** con el baseline comercial vigente; si no, todo cae al
fallback (seguro, pero no lo que se quiere). El paso de publicarla desde la UI
está en `docs/playbook.md`.

Fuente durable de contexto para los siguientes commits.
No es spec de implementación: congela decisiones. El código funcional aún no cambia.

Anclas actuales del CRM (no modificar en este phase):

- Ingesta: `src/server/inbox/ingest.ts` persiste el mensaje, llama `onLeadActivity`, luego `maybeRunAgentTurn`.
- Agente legacy: `src/server/ai/pipeline.ts` → `chatJson(AgentAction)` puede `reply` / `update_lead` / `move_stage` / `handoff`.
- Acciones: `src/server/ai/actions.ts`. Prompt decisor: `src/server/ai/prompts.ts`.
- Pipeline sembrado (`src/server/auth/on-signup.ts`): Nuevo → En conversación → Interesado → Cliente (`won`) → Perdido (`lost`).
- Opt-in del agente actual: `agent_profile.enabled` (default OFF). Handoff durable: `conversation.handoff_at` / `handoff_reason`.
- UI de etapa/notas/IA: `src/components/inbox/contact-panel.tsx`.
- LLM writer futuro: reutilizar `src/lib/ai` (`chatJson`). Jev es otro adaptador.
- `.env.example` hoy no tiene TypeSafe/Jev.

---

## 1. Objetivo

Capa comercial automática para **Vende Veloz 365**, opt-in por organización.

Este documento describe la implementación V1 concreta de Vende Veloz. A
2026-09-29 **no debe reinterpretarse como un contrato único para futuras
campañas**: el motor contiene piezas reutilizables, pero producto, preguntas,
política, oferta y writer siguen congelados para este funnel.

```
mensaje WhatsApp
  → CRM persiste el mensaje
  → CRM construye estado comercial
  → Jev evalúa el estado
  → código determinístico decide lane/efectos
  → GPT/OpenRouter redacta cómo responder dentro de esa decisión
  → CRM ejecuta respuesta/estado/handoff
```

Separación obligatoria:

| Rol | Decide |
|---|---|
| Jev | qué está ocurriendo / qué acción comercial corresponde |
| Código CRM | estado durable, reglas, transiciones, efectos |
| GPT/OpenRouter | cómo decirlo (redacción) |

- GPT **no** decide libremente pipeline, lane ni handoff cuando Sales Orchestrator está activo.
- El agente legacy (`runAgentTurn` + `AgentAction`) sigue funcionando cuando el orchestrator está OFF.

Punto de enganche previsto: ramificar en `maybeRunAgentTurn` / `runAgentTurn`. No sustituir el pipeline legacy.

---

## 2. Lanes vs pipeline

**Pipeline** = etapa comercial. **Lane** = quién/qué atiende al lead.
No son lo mismo. Mover lane no implica mover pipeline, y viceversa.

Pipeline existente (no reemplazar):

`Nuevo → En conversación → Interesado → Cliente → Perdido`

Lanes:

| Lane | Semántica |
|---|---|
| `AUTO` | Conversación comercial normal, automática. |
| `AUTO_CLOSE` | Fase avanzada (precio/cierre) todavía manejable automáticamente. |
| `WAIT` | Interés real; no presionar ahora; espera de seguimiento. |
| `HUMAN` | Requiere intervención humana. |
| `STOP` | No hay motivo comercial para seguir persiguiendo. |

---

## 3. Estado comercial durable

El CRM debe recordar esto sin pedirle a Jev que lo redescubra. Nombres físicos: camelCase TS / snake_case SQL, al estilo del repo. Semántica congelada:

| Semántica | Uso |
|---|---|
| `automation_lane` | Lane actual (`AUTO` \| `AUTO_CLOSE` \| `WAIT` \| `HUMAN` \| `STOP`) |
| `demo_shown_at` | Cuándo se mostró demo |
| `price_presented_at` | Cuándo se presentó precio |
| `payment_instructions_sent_at` | Cuándo se enviaron instrucciones de pago |
| `human_requested_at` | Cuándo se pidió / decidió humano |
| `next_follow_up_at` | Próximo seguimiento |
| `follow_up_count` | Cuántos seguimientos ya se hicieron |
| `follow_up_reason` | Por qué se espera |
| `last_jev_evaluated_at` | Última evaluación Jev |
| `last_jev_decision` / snapshot | Respuesta cruda + decisión resuelta |
| `last_jev_error` | Último fallo Jev, si aplica |

Candidato natural de persistencia: el `lead` (1:1 con contacto). Schema todavía no se toca.

---

## 4. Activación por organización

Opt-in por organización/perfil. **Default: OFF.**

- OFF → ruta legacy (`scheduleAgentTurn` / `runAgentTurn`).
- ON → ruta nueva: construir state → Jev → resolver → writer → efectos CRM.

No puede secuestrar otras organizaciones. Flag distinto de `agent_profile.enabled` (ese sigue gobernando el agente legacy). Candidato: campo nuevo en `agent_profile`.

Siguen vigentes: `conversation.ai_enabled`, `handoff_at`, sandbox `is_test`, ventana 24 h, coalesce del agente.

---

## 5. Producto — Vende Veloz 365

Congelado. Sincronizado desde `jevveloz/config/product.json` (referencia validada). Freeze local testeable: este bloque. Jamás prometer generación de alumnos, demanda o ventas.

```json
{
  "name": "Vende Veloz 365",
  "one_liner": "Sistema web para academias deportivas en Perú. Centraliza la operación diaria; no es un CRM de ventas ni una agencia de marketing.",
  "who_it_is_for": [
    "Academias y escuelas de natación, karate, running, fútbol, baile, artes marciales y disciplinas similares",
    "Negocios que trabajan con alumnos, apoderados, planes, horarios, cupos y cobros recurrentes"
  ],
  "core_jobs": [
    "Alumnos y apoderados",
    "Matrículas",
    "Disciplinas y actividades",
    "Horarios y cupos",
    "Pagos, ventas, saldos y caja",
    "Control de asistencia: registro de asistencia de alumnos y control/consumo de sesiones cuando corresponda. Búsqueda por DNI, nombre o apellido y confirmación del registro.",
    "Renovaciones",
    "Promociones, cupones, productos e inventario",
    "Matrícula online opcional"
  ],
  "not_the_product": [
    "No genera alumnos por sí solo ni gestiona pauta publicitaria",
    "No es un CRM genérico de pipeline de ventas",
    "No es una app de socios de gimnasio ni un ERP contable",
    "No retiene fondos ni cobra comisión por venta"
  ],
  "how_it_starts": "El equipo puede registrar alumnos, matrículas y cobros desde el primer día. La web de matrícula y los pagos automáticos son opcionales.",
  "implementation": {
    "price": "Incluida, sin costo de implementación",
    "kind": "incluida; el primer mes se paga por adelantado",
    "includes": [
      "Entender cómo trabaja la academia",
      "Definir el uso del sistema",
      "Configuración con funciones existentes",
      "Carga inicial acordada",
      "Usuarios y capacitación",
      "Primer mes pagado por adelantado",
      "Sin permanencia obligatoria",
      "30 días de acompañamiento del uso real",
      "Dominio .com del primer año cuando la academia lo necesita; si ya tiene uno, se conecta el existente"
    ],
    "does_not_include": [
      "Digitación o migración ilimitada",
      "Desarrollos personalizados",
      "Gestión de publicidad o consultoría continua de marketing",
      "Renovación del dominio desde el segundo año, que se cotiza aparte y no se usa como argumento de venta"
    ]
  },
  "subscription": {
    "price": "S/247 al mes",
    "includes_active_students": 50,
    "extra_active_student": "S/1 por alumno activo adicional desde el 51",
    "active_student_means": "Alumno con matrícula vigente. El historial no aumenta la mensualidad."
  }
}
```

`VENDE_VELOZ_OFFER` sigue existiendo como ayuda determinística del writer/CRM (no va en el State de Jev):

- moneda: PEN
- implementación: **incluida, sin costo de setup** (no hay fee por adelantado)
- primer mes: pagado por adelantado
- mensualidad: S/247 hasta 50 alumnos activos
- desde el alumno activo 51: +S/1 por alumno activo
- permanencia: no obligatoria
- dominio `.com` del primer año incluido cuando la academia lo necesita; si ya
  tiene uno, se conecta el existente
- renovación del dominio: desde el 2º año se cobra **aparte** y **no encabeza el
  pitch**
- jamás prometer generación de alumnos, demanda o ventas, ni que la renovación
  del dominio esté incluida
- objetivo de la primera cohorte: **aprendizaje** de compra, adopción, uso y
  retención — no maximizar margen

---

## 6. Política comercial

Congelada. Sincronizada desde `jevveloz/config/commercial-policy.json` (referencia validada). Freeze local testeable: este bloque.

```json
{
  "default_channel": "WhatsApp",
  "goal": "Avanzar comercialmente de forma automática todo lo posible y reservar la intervención humana para los casos donde aporte valor real.",
  "automation_first": "El agente puede obtener contexto, explicar el producto, mostrar demos o videos, presentar precio, resolver preguntas estándar, hacer seguimiento e intentar cerrar sin intervención humana.",
  "auto_close": "Si el prospecto quiere avanzar y el caso es estándar, sin complejidad especial, el agente puede continuar hasta instrucciones de pago e implementación.",
  "human_handoff": "Escalar a humano cuando exista complejidad, integraciones o API, múltiples sedes o decisores, negociación u objeciones importantes, necesidades especiales o una solicitud explícita de conversación humana.",
  "future_interest": "Si existe interés real pero la implementación corresponde a una temporada o fecha futura, programar seguimiento automático cerca de ese momento.",
  "no_response": "Los leads que no responden deben recibir una secuencia limitada de seguimientos automáticos. Si no reaccionan, dejar de perseguirlos sin intervención humana.",
  "disqualification": "Si no existe encaje, necesidad relevante o el prospecto busca algo que Vende Veloz no ofrece, cerrar el flujo sin intervención humana.",
  "evidence_rule": "Las afirmaciones del vendedor sobre posibles problemas o beneficios no prueban que el prospecto tenga esa necesidad. Priorizar lo expresado por el prospecto y los datos objetivos de su operación."
}
```

---

## 7. Jev V2 — contrato de preguntas

Fuente de verdad: `maxquispedev/jevveloz/config/questions-v2.json`, blob
`fe3e075ca43aec8f82e5bc34eb677ae6dcf82b68` (2026-10-02). Copia independiente
en `tests/fixtures/jev-questions-v2.json`. El freeze compara fuente, código y
este bloque. `score.criteria` es array ordenado de strings; `choice.criteria`
es Record<string,string>; `noul.criteria` conserva true/false. No inventar
escalas ni opciones. Las ocho preguntas se restauran literalmente del upstream.

```json
{
  "real_operational_need": {
    "type": "noul",
    "instructions": "¿Existe evidencia de que esta academia tiene actualmente una necesidad operativa real que Vende Veloz 365 puede ayudar a resolver?",
    "criteria": {
      "true": "Existen procesos manuales, información dispersa, falta de control, dependencia excesiva de WhatsApp, Excel o papel, dificultad para consultar la operación o una necesidad concreta relacionada con alumnos, pagos, ventas, horarios, asistencia, matrículas u otras capacidades existentes del producto.",
      "false": "La operación relevante ya está adecuadamente resuelta o no existe evidencia de una necesidad operativa actual."
    }
  },
  "product_fit": {
    "type": "score",
    "instructions": "Evalúa qué tan bien las capacidades de Vende Veloz 365 corresponden objetivamente con el tipo de operación de esta academia. Evalúa únicamente compatibilidad funcional, independientemente de si actualmente quiere cambiar de sistema o comprar.",
    "criteria": [
      "Sin encaje: las capacidades del producto prácticamente no corresponden con la operación de la academia.",
      "Encaje débil: algunas capacidades podrían servir, pero existe poca correspondencia.",
      "Encaje moderado: varias capacidades son aplicables a la operación.",
      "Encaje fuerte: el producto corresponde claramente con gran parte de la operación de la academia.",
      "Encaje muy fuerte: las capacidades del producto corresponden ampliamente con la forma en que opera la academia."
    ]
  },
  "motivation_to_change": {
    "type": "score",
    "instructions": "Evalúa si existe una razón concreta para que la academia cambie, mejore o reorganice su forma actual de trabajar.",
    "criteria": [
      "Ninguna: está satisfecha con su situación actual y no expresa ningún motivo para cambiar.",
      "Débil: existe curiosidad o alguna molestia menor, pero no una razón clara para cambiar.",
      "Moderada: reconoce una limitación concreta y está explorando alternativas.",
      "Alta: existe un problema importante que quiere resolver y está buscando activamente una alternativa.",
      "Muy alta: necesita cambiar pronto y está evaluando activamente cómo implementar una nueva solución."
    ]
  },
  "purchase_intent": {
    "type": "score",
    "instructions": "Evalúa el nivel actual de intención comercial del lead basándote únicamente en lo que ha expresado o hecho dentro de la conversación. Diferencia curiosidad, evaluación e intención concreta de avanzar.",
    "criteria": [
      "Muy baja: curiosidad general sin señales de evaluación real.",
      "Baja: solicita información, pero no muestra señales claras de considerar una implementación.",
      "Media: está evaluando activamente cómo funcionaría para su academia.",
      "Alta: muestra señales concretas como preguntar precio, pedir una demostración, proponer horarios, involucrar a un decisor o expresar que quiere implementar.",
      "Muy alta: expresa claramente intención de contratar, pagar, comenzar o coordinar la implementación."
    ]
  },
  "buying_timing": {
    "type": "choice",
    "instructions": "Determina exclusivamente el horizonte temporal de compra o implementación. No uses como evidencia las fechas u horarios para llamadas, demos, reuniones o seguimientos comerciales. Que un prospecto quiera reunirse hoy, mañana o la próxima semana no significa que quiera implementar en ese plazo. Si solo se conoce cuándo quiere conversar pero no cuándo quiere implementar, elige unknown.",
    "criteria": {
      "now": "El prospecto expresa explícitamente que quiere contratar, comenzar, implementar o resolverlo ahora o en los próximos días.",
      "soon": "El prospecto expresa explícitamente que quiere implementar dentro de las próximas semanas o pocos meses, pero no inmediatamente.",
      "future_season": "El prospecto indica explícitamente una temporada, apertura, campaña, mes o fecha futura para la que necesita tener implementada la solución.",
      "unknown": "Existe interés o necesidad, pero todavía no ha indicado cuándo quiere implementar. También aplica cuando únicamente ha indicado cuándo desea tener una llamada, reunión o demostración.",
      "no_current_plan": "El prospecto deja claro que solo está curioseando, informándose o evaluando y que actualmente no tiene ningún plan concreto de implementación."
    }
  },
  "main_value_proposition": {
    "type": "choice",
    "instructions": "Determina cuál es el ángulo de valor más relevante para continuar comercialmente con este prospecto en este momento. Elige según la necesidad expresada o inferida del contexto. No prometas generación de demanda, ventas ni nuevos alumnos.",
    "criteria": {
      "operational_control": "El principal valor es centralizar alumnos, pagos, ventas, saldos, horarios, asistencia y la operación diaria.",
      "reduce_whatsapp_dependency": "El principal problema es depender demasiado de WhatsApp para consultas, matrículas, seguimiento, pagos o coordinación.",
      "online_enrollment": "El prospecto ha expresado específicamente una necesidad relacionada con matrícula online, recepción de inscripciones o automatización de ese proceso.",
      "reduce_manual_work": "El principal valor es reducir tareas repetitivas, duplicidad de registro o trabajo administrativo manual.",
      "no_relevant_value_now": "El producto puede corresponder al tipo de academia, pero actualmente no existe una necesidad, motivación de cambio o problema concreto que justifique continuar comercialmente."
    }
  },
  "next_action": {
    "type": "choice",
    "instructions": "Decide la siguiente acción comercial. El objetivo es avanzar leads con una necesidad real sin convertir la conversación en una encuesta, sin forzar llamadas innecesarias y sin perseguir prospectos sin intención. No hagas preguntas adicionales solamente porque podría existir un problema no mencionado.",
    "criteria": {
      "ask_more_questions": "Existe una señal concreta de necesidad o interés, pero falta una información esencial para saber qué mostrar o cómo encaja Vende Veloz.",
      "show_operations_demo": "Existe una necesidad operativa identificada y conviene mostrar brevemente cómo Vende Veloz centraliza alumnos, pagos, ventas y operación diaria.",
      "show_online_enrollment_demo": "El prospecto ha expresado específicamente una necesidad relacionada con matrícula online, inscripciones o automatización de ese proceso.",
      "present_price": "El prospecto ya entiende el valor relevante, existe suficiente contexto y muestra interés concreto para presentar la propuesta económica.",
      "schedule_call": "Existe interés real, pero la complejidad de la operación, múltiples sedes, múltiples decisores, integraciones, API, necesidades especiales o una solicitud explícita hacen recomendable una conversación humana.",
      "schedule_follow_up": "Existe buen encaje e interés, pero el prospecto ha indicado que la necesidad corresponde a una temporada, apertura o fecha futura. Registrar el interés y retomar cerca del momento adecuado.",
      "disqualify": "El prospecto no presenta una necesidad relevante, está satisfecho con su solución actual, no muestra motivación de cambio o no existe un motivo comercial concreto para continuar."
    }
  },
  "needs_human_call": {
    "type": "noul",
    "instructions": "¿Existe una razón clara por la que este prospecto necesite una llamada humana antes de poder continuar o cerrar razonablemente por WhatsApp?",
    "criteria": {
      "true": "La operación es compleja, existen múltiples sedes o decisores, requiere API, integraciones o desarrollos especiales, hay necesidades difíciles de resolver por chat o el prospecto solicita explícitamente una reunión.",
      "false": "La conversación puede continuar, mostrar el producto, presentar precio y potencialmente cerrar razonablemente por WhatsApp."
    }
  }
}
```

---

## 8. State que se envía a Jev

El CRM construye el state. No hay resumen LLM previo.

Shape productivo (filosofía del harness validado; `jevveloz/config/*` es la referencia):

```json
{
  "product": {},
  "commercial_policy": {},
  "crm_state": {},
  "conversation": [
    { "from": "lead", "text": "..." },
    { "from": "seller", "text": "..." }
  ]
}
```

Incluye:

1. `product` — §5 (`VENDE_VELOZ_PRODUCT`)
2. `commercial_policy` — §6 (`VENDE_VELOZ_COMMERCIAL_POLICY`)
3. `crm_state` — hechos durables del CRM (§3), solo los ya conocidos
4. `conversation` — hilo real, cronológico. Speakers: `lead` | `seller` (`direction` in → `lead`, out → `seller`). Texto; sin duplicar la misma evidencia en muchos campos.

No incluir:

- `commercial_offer` (`VENDE_VELOZ_OFFER` es ayuda del writer/CRM; el precio canónico ya vive en `product`)
- teléfono, email u otro PII innecesario (`phone` es opcional en este CRM; `wa_identity` no va al state)
- `metadata` / `actual_outcome` / resultados futuros
- decisiones del writer o del resolver como si fueran hechos del lead

---

## 9. Resolver determinístico inicial

Función pura y testeable. Prioridad:

1. `next_action = disqualify` → `STOP`
2. `next_action = schedule_call` → `HUMAN`
3. `needs_human_call` claramente positivo puede → `HUMAN`
4. `next_action = schedule_follow_up` → `WAIT`
5. `next_action = present_price` → `AUTO_CLOSE`
6. si ya hay `price_presented_at` o `payment_instructions_sent_at` y no aplica una condición superior → `AUTO_CLOSE`
7. resto → `AUTO`

Umbral numérico de “claramente positivo” en noul: se fija al implementar, no aquí.
`next_action` restantes (`ask_more_questions`, demos) caen en `AUTO` salvo que una regla superior gane.

El resolver elige lane/efectos. El writer no los veta.

---

## 10. Fallos de Jev

Si Jev falla:

- no inventar una decisión
- no cambiar lane/pipeline a ciegas
- no permitir que el GPT writer se convierta otra vez en decisor
- degradar de forma segura

Estrategia exacta: commit posterior. Hasta entonces, persistir `last_jev_error` y no avanzar efectos comerciales.

---

## 11. Transport TypeSafe / Jev

Aislar detrás de un cliente/adaptador. No llamar TypeSafe desde `pipeline.ts`.

Observado en el harness de evaluación (no copiar código; no hay artefactos `results/` que prueben el path en este workspace):

- POST JSON `{ model, state, questions }`
- `Authorization: Bearer …`
- cuerpo de éxito tratado como objeto JSON; el harness lee `answers` por clave de pregunta y opcionalmente `model` / `usage`
- header `x-typesafe-request-id`
- tipos de respuesta esperados por el harness: `noul` (`noul: number`), `choice` (`choice` + `probabilities` + `confidence`), `score` (`score` + `legend` + `probabilities` + `confidence`)

Decisiones para el CRM:

- **No** hardcodear `/v1/systemone` como path canónico.
- El **endpoint completo** (URL) es configurable por env.
- Persistir el snapshot crudo (`last_jev_decision`).
- No inventar response schema extra. Parsear `answers` solo contra el contrato de §7, con degradación §10 si falta o no valida.
- Secretos: mismo patrón del repo (`.env` + `.env.example` con placeholder; jamás al cliente ni a logs). Constitución II: TypeSafe es una dependencia de runtime nueva; se declara al implementar, no ahora.

---

## 12. Writer GPT

Cuando el orchestrator está ON, OpenRouter **solo** recibe la decisión ya tomada (lane + `next_action` + hechos) y devuelve texto.
No usa `AgentAction.move_stage` / `handoff` como palanca libre.
Ejecución: `src/server/inbox/send.ts` (guard sandbox + ventana 24 h). Conversaciones `is_test` no tocan Graph.

---

## Implementation log

### 2026-09-20 — phase 01

- Documento/contrato creado. Código funcional todavía sin modificar.
- Decisiones: lanes ≠ pipeline; Jev V2 congelado; resolver puro; TypeSafe vía env de endpoint completo; default OFF por org.
- TODO inmediato: schema del estado durable + flag opt-in en `agent_profile`.

### 2026-09-20 — phase 02

- Estado durable añadido en `lead` (`automation_lane`, timestamps comerciales, follow-up, snapshot/error Jev).
- Flag opt-in `sales_orchestrator_enabled` en `agent_profile` (default false).
- Migración `drizzle/0004_graceful_puma.sql`. Motivo de handoff `commercial` tipado. Todavía sin Jev runtime.
- TODO inmediato: adaptador TypeSafe + env del endpoint.

### 2026-09-20 — phase 03

- Contrato tipado en `src/server/sales/`: `JEV_SALES_QUESTIONS_V2`, producto, política, oferta, `SalesDecision`, state Jev.
- Frontera: raw TypeSafe → normalizer → `SalesDecision`. Todavía sin HTTP, resolver ni writer.
- TODO inmediato: adaptador TypeSafe (endpoint por env) + normalizer.

### 2026-09-20 — phase 04

- Cliente HTTP aislado (`src/server/sales/client.ts`) + `normalizeJevResponse`. Endpoint canónico: `TYPESAFE_JEV_ENDPOINT` (URL completa; no se hardcodea `/v1/systemone`).
- Env: `TYPESAFE_API_KEY`, `TYPESAFE_JEV_ENDPOINT`, `JEV_MODEL`. Todavía sin wire a WhatsApp ni resolver.
- TODO inmediato: state builder + resolver de lanes.

### 2026-09-20 — phase 05

- `buildJevSalesState` arma product/policy/offer + `crm_state` durable + hilo cronológico (sin PII). Sin lead: degrada, no lanza.
- Contexto: fetch 200 recientes, recorte 80 turnos / 24k chars desde lo más reciente. Devuelve `persist` (leadId) sin escribir BD.
- TODO inmediato: resolver de lanes + wire al turno.

### 2026-09-20 — phase 06

- `resolveSalesPlan` puro: prioridad disqualify→STOP, schedule_call→HUMAN, noul≥`NEEDS_HUMAN_CALL_THRESHOLD` (0.70)→HUMAN, follow-up→WAIT, precio/cierre→AUTO_CLOSE, demos/preguntas→AUTO. Sin IDs de etapa; nunca `won`.
- No marca demo/precio/pago (post-entrega). No infiere `humanRequestedAt`. Caso desconocido: mantiene lane, no transiciona.
- TODO inmediato: efectos CRM + writer + wire al turno.

### 2026-09-20 — phase 07

- Writer `writeSalesReply`: `chatJson` + Zod `{ text }`. Sin move_stage/handoff/lane. Precio solo de `VENDE_VELOZ_OFFER`. Sin URLs inventadas.
- Si el plan no pide reply → `text: null` sin LLM. Fallo del proveedor: error tipado, sin fallback comercial.
- TODO inmediato: efectos CRM + wire al turno.

### 2026-09-20 — phase 08

- Integrado en `runAgentTurn`: flag OFF = legacy; ON = `runSalesOrchestratorTurn` (una ruta por turno).
- Jev fail: `last_jev_error`, lane intacta, sin writer decisor ni reply automática. Writer fail: no revierte decisión; HUMAN igual hace handoff `commercial`.
- Hechos demo/precio solo post-envío. STOP no persigue de nuevo si ya era STOP. WAIT no inventa `next_follow_up_at`. Nunca `kind=won`. Lost por `kind=lost`.
- TODO inmediato: follow-up worker + UI del flag. → hecho en `docs/SALES_FOLLOW_UPS.md` (phases 15–21).

### 2026-09-20 — phase 09

- UI mínima: flag `Sales Orchestrator (Jev)` en `/agent` (opt-in org; `jevConfigured` sin secretos). Panel **Venta** en contacto (lane, snapshot operativo, hechos). Señal corta de lane en tarjetas del pipeline si no es `auto`.
- APIs: profile lee/escribe `salesOrchestratorEnabled`; contact y board devuelven el estado mínimo. Handoff `commercial` reutiliza el banner existente. STOP solo se indica, no se oculta.
- TODO inmediato: follow-up worker. → hecho en `docs/SALES_FOLLOW_UPS.md`.

### 2026-09-20 — phase 10

- Auditoría v1 + cobertura unitaria (freeze §5–7, normalizer, resolver, writer, client, builder, orchestrator, opt-in, serialize UI). Sin features nuevas ni worker de follow-up.
- Gates: `pnpm typecheck` · `pnpm lint` · `pnpm build` · `pnpm test` — verde (360 tests). E2E no corrido: app local no estaba viva (`/api/health` inalcanzable). Live Jev: **pending** (`TYPESAFE_*` / `JEV_MODEL` ausentes en `.env` de este repo).
- Limitación real restante en V1 del Orchestrator: WAIT no inventa fecha; el motor de follow-ups (documento aparte) cubre `scheduled_wait` manual.

### 2026-09-20 — phase 11

- Contrato Jev alineado con `jevveloz/config/*` (questions-v2, product, commercial-policy). Freeze local: este documento.
- State enviado a Jev: `{ product, commercial_policy, crm_state, conversation }`. Speakers `lead` | `seller`. Sin `commercial_offer`.
- `VENDE_VELOZ_OFFER` permanece como ayuda determinística del writer/CRM.

### 2026-09-20 — phase 12

- Writer HUMAN (semántica actualizada por spec 012): si el plan final es `lane=human` + handoff, devuelve `text=null` sin LLM ni outbound artificial (ignora demo/pregunta/precio de Jev); aplica handoff interno silencioso.
- Handoff explícito del cliente (`cliente`) sincroniza `automationLane=human` y `humanRequestedAt`; no pasa por Jev.
- Scores UI: escala Jev continua 0..4 (round + clamp), no 0..1.
- Cliente TypeSafe: retries 429/529 + timeout/red transitoria, backoff inyectable; sin loguear API key.

### 2026-09-20 — phase 13

- Auditoría final: contrato questions/product/policy alineado con `jevveloz/config/*`. State `{ product, commercial_policy, crm_state, conversation }` con speakers `lead` | `seller`; sin PII, outcomes ni `commercial_offer`.
- Flujos (semántica HUMAN actualizada por spec 012) AUTO / AUTO_CLOSE (≠ won) / WAIT (sin fecha inventada) / HUMAN (sin outbound artificial + handoff interno) / STOP (no persigue, nunca won) y pedido explícito de persona cubiertos en unitarios. Scores UI 0..4. Cliente: retries 429/529/transient, no retry 400/401, `invalid_response` seguro.
- Gates: `pnpm typecheck` · `pnpm lint` · `pnpm test` (382) · `pnpm build` — verde.
- E2E: no corrido — `GET http://localhost:3000/api/health` connection refused; Docker daemon no disponible (no se levantó Postgres/app; nada en `:3000` ni `:5432`).
- Live Jev smoke: **pending** (`TYPESAFE_API_KEY` / `TYPESAFE_JEV_ENDPOINT` / `JEV_MODEL` ausentes en `.env` de este repo).

---

## V1 status

**READY** para congelar antes de follow-ups.

Gates de esta auditoría: typecheck / lint / test / build — verde (382 tests).

E2E del repo (`pnpm test:e2e`) no se ejecutó: la app local no estaba viva y no hubo Docker para levantarla. No bloquea el freeze de código V1.

Live Jev: **pending** hasta configurar `TYPESAFE_*` y `JEV_MODEL` en el `.env` de este CRM.

Implementado:

- Opt-in por organización (`agent_profile.sales_orchestrator_enabled`, default OFF). OFF = agente legacy.
- State builder tenant-safe → cliente TypeSafe (URL completa por env, retries 429/529/timeout) → resolver de lanes → writer GPT → efectos CRM (lane, pipeline lost-only, handoff `commercial`, demo/precio post-entrega).
- HUMAN: el writer devuelve `text=null` determinísticamente; el handoff es interno y silencioso; pedido explícito de persona → handoff `cliente` + `automationLane=human` + `humanRequestedAt`, sin Jev.
- UI: flag en `/agent`, panel Venta en contacto, scores en escala Jev 0..4, señal de lane en pipeline.
- Sandbox `is_test` no llama a Meta. Fallo Jev no inventa decisión. GPT no decide pipeline/handoff cuando el orchestrator está ON.

Cómo activar:

1. Configurar env de TypeSafe/Jev y OpenRouter; reiniciar.
2. En `/agent`, encender **Sales Orchestrator (Jev)** para esa organización.
3. El agente global (`enabled`) sigue siendo necesario en conversaciones reales.

Variables env requeridas para que funcione (además de las del CRM):

- `TYPESAFE_API_KEY`
- `TYPESAFE_JEV_ENDPOINT` (URL completa del POST; no hay path hardcodeado)
- `JEV_MODEL`
- `OPENROUTER_API_TOKEN` + `OPENROUTER_MODEL` (writer)

No bloquean el Orchestrator V1 (ver `docs/SALES_FOLLOW_UPS.md` para el motor ya implementado):

- campañas / analytics / atribución
- payment workflow completo
- nuevas preguntas Jev
- lead score global

### 2026-09-20 — phase 14

- Constitución actualizada para reconocer TypeSafe/Jev como dependencia runtime opcional permitida.
- Sales Orchestrator V1 queda congelado/cerrado.
- Próximo bloque independiente: motor de follow-ups. → cerrado: `docs/SALES_FOLLOW_UPS.md`.



---

## 13. Checkpoint 2026-09-29 — evolución futura por campaña (DEFERRED)

### Estado técnico actual

La integración ya separa correctamente responsabilidades:

- **Jev** interpreta el state comercial y devuelve una decisión estructurada;
- **CRM** conserva estado durable y ejecuta lanes, pipeline, handoff y follow-ups;
- **writer OpenRouter-compatible** redacta dentro de una decisión ya resuelta.

Son ampliamente reutilizables:

- cliente Jev / TypeSafe;
- normalizer y contrato de decisión;
- estado durable del lead;
- lanes;
- resolver determinístico;
- handoff;
- infraestructura de follow-ups.

El acoplamiento que queda hoy es deliberado y pertenece al funnel Vende Veloz:

- `VENDE_VELOZ_PRODUCT`;
- `VENDE_VELOZ_COMMERCIAL_POLICY`;
- `VENDE_VELOZ_OFFER`;
- `JEV_SALES_QUESTIONS_V2`;
- imports directos en `build-state.ts`;
- prompt/reglas concretas de `writer.ts`;
- acciones/semántica diseñadas alrededor del funnel actual.

### Decisión

**No hacer ahora un refactor genérico.** La prioridad es operar Vende Veloz y
validar el funnel real.

La siguiente campaña distinta que requiera Jev será el trigger para abrir un
nuevo spec SDD. La unidad de configuración deberá ser **la campaña / estrategia
comercial**, no simplemente la organización.

Ejemplo: una misma organización Espacio Veloz podría tener campañas separadas de
correo corporativo, hosting y automatización con criterios comerciales distintos.

### Dirección candidata del futuro spec

Un **Campaign Playbook** deberá poder variar, como mínimo:

1. **Product / Offer Context** — producto, propuesta y condiciones reales;
2. **Jev Evaluation Questions** — qué señales debe interpretar Jev;
3. **Lead Management Policy** — cómo se autogestiona/posiciona el lead;
4. **Human Handoff Policy** — cuándo interviene una persona;
5. **Writer Policy** — tono, claims, recursos, oferta y forma de contestar;
6. **Follow-up Policy** — cuándo y cuánto seguir.

No definir todavía tablas, IDs, versionado, CRUD, atribución ni router de
campañas. Esas decisiones deben salir de la segunda campaña real, no de
abstracción anticipada.

### Invariantes que deben sobrevivir a la futura generalización

- Jev interpreta; **no ejecuta efectos**.
- El CRM decide y persiste lane, pipeline, follow-ups y handoff.
- El writer redacta; **no recupera autoridad comercial**.
- El aislamiento tenant sigue siendo obligatorio.
- Las reglas de una campaña no pueden contaminar otra.
- Vende Veloz debe seguir pasando como baseline/regresión.
- Orchestrator OFF conserva la ruta legacy.

### Punto exacto para continuar más adelante

Cuando exista la siguiente campaña:

1. leer `docs/CURRENT_STATE.md` y este documento;
2. documentar diferencias reales respecto a Vende Veloz;
3. abrir el siguiente spec SDD;
4. extraer solo las dimensiones demostradas por ese segundo caso;
5. reutilizar el núcleo actual y evitar una reescritura.

## Hotfix del Laboratorio de Feature 008 — 2026-10-01

Una corrida productiva Draft reveló que faltaba el lead sandbox y el writer
no persistía sus respuestas. El runner ahora crea por caso un contacto
archivado único (`lab:<runId>:<testCaseId>`) y un lead nuevo vía gateway en
la primera etapa open del tenant (sin etapa, error explícito). El orquestador
llama a `deliverReply` también con `is_test=true`: persiste outbound local y
actualiza facts de demo/precio, sin WhatsApp real. Follow-ups siguen suprimidos
y CAPI conserva su guard sandbox. Transcript y outcomes se copian al caso
durable antes del juez; finalmente se borra el contacto por cascada, sin
borrar `agent_test_case` (su FK de conversación queda null). Pipeline excluye
contactos archivados reales y sintéticos. No cambia la estrategia comercial.

## Demos nativas — spec 011, corte 3 (2026-10-03)

Cuando el plan permite demo (sin HUMAN/STOP/handoff), el CRM selecciona recurso
por pedido vigente del prospecto: operations → payments para pagos/saldos/
voucher/deuda; operations general/matrícula/alumnos → panel; acción online →
online con prioridad explícita. Solo recursos del tenant y bytes MP4 locales,
sin link de KB ni sustitución de slot. Writer informado de disponibilidad;
un video nativo + caption breve por sendMediaMessage, sin texto previo.

`demoShownAt` ya no prueba entrega de texto: requiere sender aceptado por Graph
con ID y outbound persistido, o media+caption persistidos en sandbox. Ausencia,
disco perdido, ventana, upload/Meta/persistencia fallando y fallback textual
no cuentan ni programan after_demo. No retry ciego ni segundo envío incierto.
Media IA usa origin=ai/aiGenerated=true también en failed; no cancela follow-ups
como respuesta manual. Sender operador y guards se conservan.

Lab y preview leen caption cuando message.text=null. Sandbox persiste local
sin sender/upload/Graph, y limpia copias por marcador propio sin borrar recursos.
Siete acciones 1.0, precio, opt-in y HUMAN/STOP conservados. E2E 021 PENDIENTE
por entorno; el gate técnico no equivale a READY punta a punta. Tras este corte,
pausa para verificar los tres MP4 reales antes de C4; no deploy automático.


## Extensión de pago opt-in — spec 011, corte 4 (2026-10-04)

El contrato 1.0 y V2 canónica/fixture/hash/§7 conservan sus siete acciones.
Config 1.1 exige ocho criterios y el writer `send_payment_instructions`.
`payment-extension.ts` deriva V3 de V2, sin mutarla; el upgrade explícito del
draft preserva la estrategia editada. Loader/store validan por discriminante;
normalizer admite solo las opciones del set activo. Sin Published válida sigue
fallback V2. Ninguna fila histórica se migra ni reescribe automáticamente.
Publicación/rollback mantienen su flujo; operación descrita en docs/playbook.md.

El resolver separa `paymentDeliveryAuthorized` del handoff commercial posterior.
Disqualify y petición humana/complejidad clara conservan prioridad. La rama de
pago autorizada evita el LLM y renderiza únicamente recursos scoped validados,
en orden transferencia/Yape/link, sin truncar destinos. Fact tras completar
todas las partes; ausencia, error o entrega parcial no lo marcan. Siempre
handoff posterior, sin nuevos follow-ups, won, cobro o activación. Sandbox
persiste localmente antes de cualquier sender/Graph; jamás WhatsApp real.

Gates técnicos y tests documentados en tasks.md. E2E 022 preparado, ejecución
happy/unhappy y UI pendiente por ausencia de app/PG local. No READY punta a
punta ni interpretación real de intención por Jev verificada con mocks.
Sincronización de la decisión comercial en Obsidian pendiente.

## Handoff humano silencioso — spec 012 (2026-10-04)

El escalamiento nunca se anuncia al prospecto. HUMAN puro, incluido schedule_call,
no genera mensaje de transición: writeSalesReply devuelve `{ ok: true, text: null }`
sin LLM, incluso con instrucciones antiguas del playbook. El orquestador omite
outbound y conserva applyHandoff, lane y motivos. No cambia cuándo decide escalar.

Pago autorizado entrega primero los destinos configurados y el CTA de comprobante,
y después hace handoff interno silencioso. Encabezado: «Estos son los medios de
pago:». Cierre: «Cuando realices el pago, envíanos el comprobante por aquí para
confirmarlo y continuar con la implementación.» Sin recursos: «En este momento
no tengo los medios de pago disponibles por aquí.» La protección contra cobro,
won, voucher validado o activación permanece en lógica interna, sin disclaimer
customer-facing. HUMAN prioritario conserva precedencia sin entregar pago ni demo.
No publicación ni reescritura del playbook productivo. Evidencia en tasks del 012;
decisión comercial a sincronizar en Obsidian.

## Evidencia comercial — spec 016 (2026-10-05)

El bootstrap omitía asistencia en core_jobs, aunque el fallback mencionaba
«Asistencia y sesiones». Ahora ambos y el refuerzo runtime para Published
anteriores de **Vende Veloz 365** incluyen registro de asistencia de alumnos,
control/consumo de sesiones y búsqueda por DNI, nombre o apellido con
confirmación del registro. Prioridad terciaria intacta. Fuente ejecutable:
`clientes-vendeveloz365@c3928c6`, `app/Filament/Pages/AccessControl.php`:
lookup (90–116), registerAttendance (147–207), y vista access-control.blade.php
(27–42). La sesión se consume en planes no ilimitados; no prometer biometría,
QR ni hardware. No se modificó el producto ni su repositorio.

Jev recibe la KB comercial del tenant en `state.commercial_knowledge` (solo
pregunta/respuesta/contenido, sin IDs ni metadata). Las instrucciones runtime
refuerzan next_action/needs_human_call sin cambiar tipos/opciones ni la fixture
upstream. Capacidad documentada → respuesta normal; falta contexto de academia
→ ask_more_questions; pregunta material sin evidencia → schedule_call/HUMAN.
El bloque de oferta continúa exclusivo del writer/CRM; no se modifican precios.

El writer comprueba fuentes completas antes de redactar y devuelve
`commercial_evidence: supported | context_needed | unknown`. No ejecuta efectos.
Unknown suprime text aunque el proveedor incluya uno; clasificación ausente
falla cerrado a unknown. Formato inválido/fallo de writer → atención humana
sin texto de error al prospecto. Sin regex de frases ni motor comercial nuevo.
Los mensajes determinísticos existentes (opener/pago) conservan su camino;
HUMAN puro sigue omitiendo el LLM. La ruta legacy y follow-up writer no cambian.

El CRM convierte unknown en plan schedule_call/HUMAN **antes de persistir
pipeline y antes de enviar texto/media**. Audita la propuesta Jev original y
`plan.commercialEvidenceReason` (`unknown` / `writer_unavailable`). Reutiliza
applyHandoff(commercial): handoff_at pausa IA y marca la atención pending en
conversaciones reales. No outbound ni facts de entrega ni nuevos follow-ups.
Sandbox conserva silencio y no crea atención operativa ni toca Graph.
La UI ya muestra Por atender / Atención humana; no se modificó.

Evidencia y comandos finales en `specs/016-commercial-evidence-handoff/tasks.md`.
No mutación automática de Published ni deploy. Política comercial nueva de
unknown → humano silencioso debe sincronizarse en Obsidian.
