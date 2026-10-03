# Contrato — `POST /api/lab/preview` (Prueba rápida)

> Contrato del endpoint **mínimo** que introduce el corte 2 de la feature 010.
> No redefine `/api/lab/runs` (queda intacto) ni toca el contrato de
> `/api/playbook/*`.
> La justificación de por qué este endpoint y no otro está en
> [`../research.md`](../research.md) §2.

---

## 1. Qué es y qué no es

**Es**: la forma más corta de ejecutar **un** caso ad-hoc por el **mismo**
pipeline comercial sandbox que el Laboratorio, y devolver la decisión de Jev,
el plan y el texto del writer.

**No es**:
- un segundo motor comercial (no reimplementa orquestador, Jev ni writer);
- una forma de mandar WhatsApp real;
- un reemplazo del Laboratorio (`/api/lab/runs` sigue siendo el Laboratorio
  completo);
- una forma de probar texto **sin guardar**.

La garantía de no-paralelo es estructural: el preview y el Laboratorio llaman a
la **misma** función `runSalesOrchestratorTurn` y al **mismo** helper de
sandbox extraído. Si divergieran, lo vería el test de §8.10.

## 2. Ruta y auth

```
POST /api/lab/preview
```

- `withAuth` (de `src/lib/api.ts`), igual que el resto de `/api/lab/*`.
- **`organizationId` sale siempre de `session.organizationId`.** Nunca del
  body, nunca de un parámetro. Un `versionId` de otra org no se puede pedir.
- Rol: el mismo que el resto de las superficies de admin de esta feature
  (hoy `withAuth` sin chequeo de rol adicional, igual que `/api/playbook/*` y
  `/api/lab/runs`). **No se endurece el auth en esta feature**: sería un
  cambio de política de acceso, no de UX.

## 3. Entrada

```jsonc
{
  "mode": "draft" | "published",   // por defecto: "published"
  "conversation": [                 // guion del lead, 1..N líneas
    { "from": "lead", "text": "Hola, quiero información" }
  ]
}
```

- `from` solo admite `"lead"` por ahora (el lead es quien inicia). Reserved
  para el futuro, no un contrato de dos lados.
- `conversation` es el **único** input de conversación. **No** acepta
  `crm_state`: el State lo construye `buildJevSalesState` desde la
  conversación sandbox real (`research.md` §3). Exigirlo al admin sería
  inventar un segundo camino de State.
- No acepta el documento JSON del playbook. La versión probada se resuelve en
  BD (§5). Esto es lo que hace imposible "probé algo que no publiqué".

### 3.1 Validación

Zod en el borde (constitución: todo input externo se valida):

- `mode`: enum, por defecto `"published"`.
- `conversation`: array de 1..20 objetos `{ from: literal "lead", text: string
  1..2000 }`.
- Límite de longitud total para acotar el caso (p. ej. 20 líneas) y evitar que
  una prueba se parezca a un run de producción.

## 4. Respuesta

```jsonc
{
  "ok": true,
  "playbook": {
    "mode": "draft",              // lo que realmente se ejecutó
    "version_number": 3,
    "version_id": "pbv_…",
    "schema_version": "1.0",
    "is_draft": true
  },
  "jev": {
    "next_action": "ask_more_questions",
    "needs_human_call": false,
    "real_operational_need": "…",
    "product_fit": "…",
    "motivation_to_change": "…",
    "purchase_intent": "…",
    "buying_timing": "…",
    "main_value_proposition": "…"
  },
  "plan": {
    "lane": "auto",
    "next_action": "ask_more_questions",
    "should_handoff": false,
    "stage_id": "stg_…",
    "stage_slug": "nuevo"        // o el que corresponda
  },
  "writer": {
    "text": "Claro. Te ayuda a tener alumnos, pagos y horarios…"
  },
  "turns": 1
}
```

- `jev` es la **decisión completa** del snapshot, no un resumen. Si la decisión
  no trae alguna señal, el campo va `null`; no se inventa.
- `writer.text` es el texto real que el writer produjo (mensajes `direction:
  "out"` de la conversación sandbox), no una reconstrucción.
- `turns` = líneas procesadas (el guion corta en el primer handoff, igual que
  el Laboratorio).

## 5. Resolución de la versión (el punto crítico)

```
mode = "published" → versión publicada de la org        (sin override)
mode = "draft"     → draft abierto de la org → { versionId } como override
```

- Se resuelve con la **misma** función de loader que usa el Laboratorio para su
  override, siempre con `organizationId` de la sesión.
- El `versionId` viaja al orquestador como `playbookOverride`, que solo es
  aceptado con `is_test=true` (guard **T306**).
- **No** hay forma de pasar un documento local: el endpoint no lo acepta.
- Si `mode = "draft"` y no hay draft → **error explícito** (§6), no un fallback
  silencioso a published.

## 6. Errores

| Situación | HTTP | `code` |
|---|---|---|
| No autenticado | 401 | — |
| Body inválido (Zod) | 400 | `invalid_body` |
| `mode=draft` sin draft abierto | 409 | `draft_not_found` |
| Sin versión publicada en `mode=published` | 409 | `published_not_found` |
| Org sin `pipeline_stage` abierto | 409 | `no_open_stage` |
| IA / proveedor Jev no configurado | 503 | `ai_not_configured` |
| Fallo del proveedor Jev (timeout, 5xx, formato) | 502 | `jev_failed` |
| Sin decisión producida (turno vacío) | 502 | `no_decision` |
| El escritor no produjo texto | 502 | `no_writer_output` |

Respuesta de error:

```jsonc
{ "ok": false, "code": "jev_failed", "message": "…", "detail": "…" }
```

- `message` es apto para mostrar; `detail` es diagnóstico (se sanea, no se
  filtran secretos — misma regla que `sanitizeError`).
- **Regla dura**: un fallo del proveedor **nunca** se convierte en una respuesta
  ficticia. Si Jev falla, el preview muestra el error. El `writer` no se inventa.

## 7. Sandbox: qué garantiza y por construcción

`is_test=true` en la conversación del caso es lo que activa toda la cadena. Los
guards **ya existen** en el pipeline y el preview no reimplementa ninguno:

| Garantía | Mecanismo reutilizado |
|---|---|
| Override de playbook solo en sandbox | T306, `orchestrator.ts:77-80` |
| Cero WhatsApp real | `deliverReply` devuelve antes de `sendText` cuando `isTest` (`delivery.ts:24-27`); se invoca en `orchestrator.ts:206` |
| Cero follow-ups productivos | `orchestrator.ts:212-220` |
| Versión que influyó, auditable | T308, `orchestrator.ts:138-155` |
| Aislamiento de tenant | `scoped()` en cada query + org de la sesión |
| Cero filas residuales | `finally` de cleanup, igual que el Laboratorio |

**Prerrequisito**: la org necesita un `pipeline_stage` abierto. Es el mismo
requisito del Laboratorio; si falta, se responde `no_open_stage` (§6), nunca un
resultado vacío.

## 8. Requisitos demostrables (tests)

El corte 2 no se cierra sin evidenciar:

1. `mode=published` usa la versión publicada de la org.
2. `mode=draft` usa el draft de la org.
3. Org A nunca lee draft/published de org B.
4. `is_test`/sandbox: cero llamadas al remitente real de WhatsApp.
5. Cero follow-ups productivos.
6. Devuelve `jev`, `plan` y `writer.text` con contenido real.
7. Fallo del proveedor → error (`jev_failed`), no respuesta ficticia.
8. `mode=draft` sin draft → `draft_not_found` explícito.
9. Un cambio local sin guardar **no** se usa (el endpoint no lo recibe).
10. El endpoint comparte el pipeline real con el Laboratorio: el test verifica
    que preview y `runConversation` importan el **mismo** helper de sandbox y
    que el preview invoca `runSalesOrchestratorTurn`.

## 9. Lo que este contrato NO cambia

- `/api/lab/runs`: intacto (sigue siendo batch, personas, `both`, score).
- `/api/playbook/*`: intacto.
- `runSalesOrchestratorTurn`, `evaluateJev`, `resolveSalesPlan`,
  `writeSalesReply`: **sin cambios de comportamiento**. La extracción del
  andamiaje mueve código, no lógica; `lab-pipeline-real.test.ts` debe seguir
  verde sin cambios.
- `ConfigV1Schema`, option keys, contratos Jev: intocables.
