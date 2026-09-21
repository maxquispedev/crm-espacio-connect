# Sales Orchestrator — contrato operativo

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

Congelado. Jamás prometer generación de alumnos, demanda o ventas.

```json
{
  "name": "Vende Veloz 365",
  "purpose": "centralizar la operación diaria de una academia deportiva",
  "positioning": "Vende Veloz ayuda a organizar alumnos, matrículas, pagos, ventas, horarios y asistencia desde un solo sistema. Puede comenzar con procesos manuales y activar automatizaciones posteriormente. No genera demanda ni nuevos alumnos por sí solo.",
  "capabilities": [
    "alumnos y apoderados",
    "matrículas",
    "pagos",
    "ventas",
    "saldos pendientes",
    "horarios",
    "cupos",
    "asistencia",
    "renovaciones",
    "caja",
    "matrícula online opcional",
    "pagos online opcionales"
  ]
}
```

Oferta comercial actual:

- implementación: S/497 una sola vez
- mensualidad: S/197 hasta 50 alumnos activos
- desde el alumno activo 51: +S/1 por alumno activo
- la implementación busca adopción real e incluye configuración del flujo acordado, carga de datos acordada, usuarios, capacitación, primeras operaciones reales y acompañamiento inicial
- jamás prometer generación de alumnos, demanda o ventas

---

## 6. Política comercial

Congelada.

```json
{
  "default_channel": "WhatsApp",
  "goal": "avanzar comercialmente sin convertir el chat en una encuesta",
  "human_call": "solo cuando exista complejidad, múltiples decisores, integraciones, varias sedes, necesidades especiales o solicitud explícita",
  "future_interest": "si el prospecto tiene interés real pero indicó una temporada o fecha futura, no presionar el cierre inmediato; programar seguimiento",
  "disqualification": "si está satisfecho con su solución actual y no existe necesidad ni motivación concreta de cambio, no seguir preguntando solo para encontrar un problema"
}
```

---

## 7. Jev V2 — contrato de preguntas

Validado. **No reescribir. No “mejorar”. No añadir preguntas. No añadir `pause_and_wait`. No convertir en un lead score único.**

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
      "Muy alta: expresa claramente intención de contratar, pagar, comenzar o coordinar inmediatamente la implementación."
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
      "present_price": "El prospecto entiende el valor relevante, existe suficiente contexto y muestra interés concreto para presentar la propuesta económica.",
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

Incluye:

1. producto (§5)
2. política comercial (§6)
3. hechos durables del CRM (§3) — solo los ya conocidos
4. conversación real, cronológica (`direction` in → lead, out → seller; texto; sin duplicar la misma evidencia en muchos campos)

No incluir:

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
