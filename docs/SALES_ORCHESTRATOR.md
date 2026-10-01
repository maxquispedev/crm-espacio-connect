# Sales Orchestrator — contrato operativo

**Contrato vigente de lanzamiento (2026-10-01):** Feature 008 congelada para V2.
Con `SALES_PLAYBOOK_RUNTIME_ENABLED=false`, las conversaciones reales no leen ni
aplican `sales_playbook_version`: el builder usa VENDE_VELOZ_PRODUCT y
VENDE_VELOZ_COMMERCIAL_POLICY; Jev recibe JEV_SALES_QUESTIONS_V2; el writer usa
VENDE_VELOZ_OFFER e instrucciones internas. FK/snapshot de versión quedan null.
Agent Profile, resolver, lanes, handoff, follow-ups, Meta Ads y efectos CRM mantienen
su implementación. Sandbox/configuración/API/UI/datos se preservan. Reactivar la
constante restaura la lectura publicada en V2. Este contrato prevalece sobre las
notas históricas de runtime dinámico abajo.

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
    "Asistencia y sesiones",
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
    "price": "S/497",
    "kind": "pago único",
    "includes": [
      "Entender cómo trabaja la academia",
      "Definir el uso del sistema",
      "Configuración con funciones existentes",
      "Carga inicial acordada",
      "Usuarios y capacitación",
      "30 días de acompañamiento del uso real",
      "Dominio el primer año"
    ],
    "does_not_include": [
      "Digitación o migración ilimitada",
      "Desarrollos personalizados",
      "Gestión de publicidad o consultoría continua de marketing"
    ]
  },
  "subscription": {
    "price": "S/197 al mes",
    "includes_active_students": 50,
    "extra_active_student": "S/1 por alumno activo adicional desde el 51",
    "active_student_means": "Alumno con matrícula vigente. El historial no aumenta la mensualidad."
  }
}
```

`VENDE_VELOZ_OFFER` sigue existiendo como ayuda determinística del writer/CRM (no va en el State de Jev):

- moneda: PEN
- implementación: S/497 una sola vez
- mensualidad: S/197 hasta 50 alumnos activos
- desde el alumno activo 51: +S/1 por alumno activo
- jamás prometer generación de alumnos, demanda o ventas

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

Validado. Sincronizado desde `src/server/sales/questions.ts` (`JEV_SALES_QUESTIONS_V2`). Freeze local testeable: este bloque debe coincidir **exactamente** con la constante `JEV_SALES_QUESTIONS_V2`. **No reescribir. No “mejorar”. No añadir preguntas. No añadir `pause_and_wait`. No convertir en un lead score único.**

```json
{
  "next_action": {
    "type": "choice",
    "instructions": "Elige la siguiente acción comercial que el agente debe tomar, considerando el momentum del lead y la información recopilada hasta ahora.",
    "criteria": {
      "ask_more_questions": "Necesitamos más información antes de avanzar.",
      "show_operations_demo": "Vale la pena mostrar cómo Vende Veloz resuelve la operación diaria.",
      "show_online_enrollment_demo": "Vale la pena mostrar cómo Vende Veloz resuelve la inscripción online.",
      "present_price": "Tenemos suficiente evidencia para presentar el precio con confianza.",
      "schedule_call": "Lo correcto es agendar una llamada con un humano del equipo.",
      "schedule_follow_up": "Ahora no es buen momento, pero el lead sigue siendo relevante; deja un seguimiento programado.",
      "disqualify": "El lead no encaja con Vende Veloz 365; cerramos sin quemar más turnos."
    }
  },
  "real_operational_need": {
    "type": "noul",
    "instructions": "¿Existe evidencia de que esta academia tiene actualmente una necesidad operativa real que Vende Veloz 365 puede ayudar a resolver?",
    "criteria": {
      "true": "Hay síntomas operativos claros y actuales.",
      "false": "No hay señales de una necesidad operativa actual."
    }
  },
  "product_fit": {
    "type": "score",
    "instructions": "En escala 0..3, ¿qué tan bien Vende Veloz 365 encaja con el tipo de academia y el momento del lead?",
    "criteria": {
      "0": "No encaja con su realidad.",
      "1": "Encaje débil; tendría que forzar el producto.",
      "2": "Encaje razonable con ajustes.",
      "3": "Encaje natural con su operación."
    }
  },
  "motivation_to_change": {
    "type": "score",
    "instructions": "En escala 0..3, ¿qué tanta urgencia / motivación al cambio demuestra el lead en este momento?",
    "criteria": {
      "0": "No hay intención real de moverse del status quo.",
      "1": "Insatisfacción pasiva; nada concreto en el horizonte.",
      "2": "Incomodidad real; evalúa alternativas.",
      "3": "Dolor agudo; busca activamente resolver."
    }
  },
  "purchase_intent": {
    "type": "score",
    "instructions": "En escala 0..3, ¿qué tan probable es que concrete una compra de Vende Veloz 365 en este momento si le damos el siguiente paso correcto?",
    "criteria": {
      "0": "Casi seguro no compra ahora.",
      "1": "Compraría solo si el precio cambia mucho.",
      "2": "Compraría si la oferta es razonable.",
      "3": "Listo para cerrar en este turno."
    }
  },
  "buying_timing": {
    "type": "choice",
    "instructions": "Define el momento de compra más probable del lead, según lo que haya dicho explícitamente o lo que se pueda inferir.",
    "criteria": {
      "now": "Quiere/necesita decidir pronto (semanas).",
      "this_quarter": "Espera resolver este trimestre.",
      "this_year": "Planea resolver este año.",
      "exploring": "Está explorando, sin compromiso temporal.",
      "unknown": "No hay señal suficiente para inferirlo."
    }
  },
  "main_value_proposition": {
    "type": "choice",
    "instructions": "Resume en una etiqueta cuál es el valor principal que más le importa al lead (lo que activaría la decisión).",
    "criteria": {
      "operations": "Centralizar la operación diaria del negocio.",
      "enrollment": "Resolver la inscripción online.",
      "retention": "Retener y recuperar alumnos.",
      "admin_overhead": "Quitar carga administrativa al dueño.",
      "visibility": "Visibilidad en tiempo real del negocio.",
      "unspecified": "Aún no está claro o no aplica."
    }
  },
  "needs_human_call": {
    "type": "noul",
    "instructions": "¿Vale la pena pasar este lead a un humano del equipo comercial en este turno?",
    "criteria": {
      "true": "Sí, hay valor real en intervención humana ahora.",
      "false": "No, el agente puede seguir avanzando."
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

- Writer HUMAN: si el plan final es `lane=human` + handoff, redacta solo transición humana (ignora demo/pregunta/precio de Jev).
- Handoff explícito del cliente (`cliente`) sincroniza `automationLane=human` y `humanRequestedAt`; no pasa por Jev.
- Scores UI: escala Jev continua 0..4 (round + clamp), no 0..1.
- Cliente TypeSafe: retries 429/529 + timeout/red transitoria, backoff inyectable; sin loguear API key.

### 2026-09-20 — phase 13

- Auditoría final: contrato questions/product/policy alineado con `jevveloz/config/*`. State `{ product, commercial_policy, crm_state, conversation }` con speakers `lead` | `seller`; sin PII, outcomes ni `commercial_offer`.
- Flujos AUTO / AUTO_CLOSE (≠ won) / WAIT (sin fecha inventada) / HUMAN (transición + handoff) / STOP (no persigue, nunca won) y pedido explícito de persona cubiertos en unitarios. Scores UI 0..4. Cliente: retries 429/529/transient, no retry 400/401, `invalid_response` seguro.
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
- HUMAN: el writer redacta solo transición humana; pedido explícito de persona → handoff `cliente` + `automationLane=human` + `humanRequestedAt`, sin Jev.
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
