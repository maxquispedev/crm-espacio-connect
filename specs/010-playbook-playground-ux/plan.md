# Plan — Feature 010 Playbook Playground UX

>Bootstrap documental de `specs/010-playbook-playground-ux`. Cero código
>productivo tocado. El detalle de la decisión de arquitectura está en
`research.md`; aquí está **cómo** se ejecuta en 2 cortes.

## 1. Qué resuelve ya la feature 009 (NO reconstruir)

009 ya dejó, y 010 reutiliza tal cual:

- editor JSON técnico con `JsonEditor` + `FormatButton` y error de parseo con
  línea/columna;
- proyección `Config` ↔ `Preguntas Jev` sobre un mismo documento;
- draft/publicado, versionado, comentarios, rollback, historial;
- validación server-side (Zod + `assertJevProtectedKeys`) y publicación con
  comentario obligatorio;
- runtime publicado activo en producción (interruptor 009, corte 3);
- Laboratorio con el pipeline comercial real en sandbox.

010 **no reimplementa** nada de esto. Lo que hace es (a) invertir el bug de la
action bar, (b) quitar el ruido de la pantalla, y (c) añadir un camino de
prueba ad-hoc que reutilice el pipeline del Laboratorio.

## 2. Corte 1 — estrategia

### 2.1 El arreglo, aislado y verificable

El cambio funcional de Corte 1 es **una línea** (`playbook-draft-editor.tsx:150`)
más su `title`. Se hace primero, solo, con sus tests, para que el resto del
refactor visual no pueda ser culpado si algo falla.

```
disabled={busy || !dirty}                       // hoy
disabled={busy || dirty || anySyntaxError}      // C1-1
```

`anySyntaxError` ya existe en el scope (línea 77); no hace falta estado nuevo.
Y **no** se toca el `onPublish` ni se guarda nada automáticamente.

### 2.2 Qué se borra y qué se conserva

| Pieza actual | Decisión |
|---|---|
| `VersionState` (`:346`) | Se elimina como card; su información vive en la cabecera |
| CTA "Abrir el Laboratorio" (`:349-364`) | Se reduce a un enlace pequeño |
| `PlaybookPublishedCard` (`:373-388`) | Se elimina del camino principal (precio y pills salen) |
| `Refetch` / `Ver historial` / `Crear draft` (`:321-342`) | Se sustituyen por la cabecera compacta + `[Historial]` + "Editar publicada" |
| Estado vacío (`:268-304`) | Se conserva el caso, se reescribe el copy |
| Historial inline (`:470-477`) | Pasa a modal |
| `JsonEditor`, `FormatButton`, `Modal`, `NoticeBanner` | **Se conservan** |
| Callbacks `onValidate`/`onSave`/`onPublish`/`onDiscard`/`onDelete` | **Se conservan** |
| `PlaybookVersionsList` | **Se conserva**, dentro del modal |
| 5 botones + explicación (`:124-172`) | Action bar de 3 + secundarias |

Ninguna pieza se "reescribe" sin destino: cada botón que desaparece tiene un
reemplazo en la cabecera, la action bar o el modal. La simplificación no puede
costar una capacidad.

### 2.3 Tabs sin perder estado

Los dos documentos viven en el estado del padre (`state`, `jevState` en
`PlaybookDraftEditor`), y el guardado reensambla el documento completo
(`playbook-client.tsx:411-414`). Montar solo el editor activo **no pierde
estado**: el estado no está en el subárbol que se desmonta. El `key={draft.id}`
existente (`playbook-client.tsx:395`) se conserva porque es lo que evita que un
refetch pise lo que el admin escribe.

### 2.4 Copy que cambia (y por qué)

- "Crear draft desde esta versión" / "Crear draft" → **"Editar publicada"**:
  la acción real es la misma (`createDraft` sobre la publicada); lo que cambia
  es que el admin no debería leer una operación de versionado.
- "Sales Playbook" como `<h3>` → se elimina: la pestaña ya dice
  `Comercial / Jev` (`agent-client.tsx:19`) y la segunda cabecera es
  redundante.

## 3. Corte 2 — estrategia

### 3.1 No hay motor nuevo: se extrae el andamiaje

`POST /api/lab/runs` no acepta input ad-hoc (`research.md` §2.1) y
`runSalesOrchestratorTurn` devuelve `void` sobre filas reales (§2.2). El plan es
el **Diseño A** de `research.md` §2.5:

```
src/server/lab/sandbox-case.ts   (NUEVO, extraído de runner.ts:410-444)
  createSandboxSalesCase({ organizationId, ... })  →  { contactId, leadId, conversationId }
  cleanupSandboxCase({ organizationId, contactId, conversationId })

runConversation (runner.ts)  ──usa──▶  sandbox-case.ts     (sin cambio de comportamiento)
POST /api/lab/preview       ──usa──▶  sandbox-case.ts
                                   ──▶ runSalesOrchestratorTurn   ← MISMA función que el Lab
```

La prueba de que no es una implementación paralela es **estructural**: el
preview y el Laboratorio llaman a la misma función exportada del mismo módulo.
Si mañana divergen, es porque alguien duplicó código, y el test lo delata.

### 3.2 Extracción sin regresión

La regla de refactor segura aquí: **el andamiaje se mueve, no se reescribe.**
`runConversation` conserva su bucle, su orden y sus resultados. Tras la
extracción, `tests/unit/lab-pipeline-real.test.ts` debe seguir verde sin
cambios: es la prueba de que el Laboratorio no se movió. Si hay que tocar ese
test, es señal de que el movimiento cambió comportamiento — para eso está.

### 3.3 Respuesta: leer, no esperar

Como el orquestador devuelve `void`, el preview lee (dentro de la misma vida
del caso, **antes** del `finally` de limpieza):

- `lead.lastJevDecision` → `decision` completa + `plan` + versión de playbook
  (`research.md` §2.3);
- mensajes `direction: "out"` de la conversación → texto del writer.

El helper devuelve el snapshot crudo y cada consumidor proyecta lo suyo: el
Laboratorio se queda con sus 3 escalares, la preview con todo. Sin tocar el
contrato del Lab.

### 3.4 Aislamiento de tenant

La org sale **siempre** de `session.organizationId`, nunca del body. El draft se
resuelve con la función de loader de la org (misma que usa el Lab para el
override) y el override se pasa como `versionId` ya resuelto server-side. El
cliente **no** puede pedir una versión de otra org. El `scoped()` se mantiene en
cada query del camino, y la proyección del snapshot también va scopeada por
`organizationId`.

### 3.5 Semántica Guardar → Probar Draft

El endpoint **no acepta el documento local**. La versión probada se resuelve
desde BD, así que lo probado es exactamente lo publicable. Si hay `dirty`, la UI
lo dice antes de ejecutar. Esto hace imposible la divergencia "probé algo que no
publiqué" sin que el admin lo hayaGuardado antes.

### 3.6 `/lab` se queda

No se toca `/api/lab/runs` ni la UI del Laboratorio. 010 solo le extrae el
andamiaje compartido y le añade un hermano. La prueba rápida responde a
"cambié una instrucción → ¿qué haría ahora?"; el Laboratorio sigue respondiendo
a " ¿qué tan bien lo hace el agente, y contra qué outcomes?".

## 4. Strategy Matrix

| Pieza | ¿Existe? | ¿Se reutiliza? | Acción |
|---|---|---|---|
| Editor JSON técnico | Sí (009) | Sí | Se reorganiza en tabs, no se reescribe |
| `Modal`, `NoticeBanner`, callbacks | Sí | Sí | Intactos |
| Historial + rollback | Sí | Sí | Cambia de sitio, no de API |
| Publicación server-side | Sí | Sí | Intacta; solo se corrige el `disabled` |
| Pipeline comercial sandbox | Sí (Lab) | Sí | Se extrae el andamiaje y se comparte |
| `runSalesOrchestratorTurn` | Sí | Sí | El preview la invoca tal cual |
| Primitiva ad-hoc | **No** | — | Se crea el endpoint mínimo |
| Motor comercial nuevo | — | — | **Prohibido** |
| Monaco / deps nuevas | — | — | **Prohibido** |

## 5. Constitution Check

| Principio | Cumplimiento en 010 |
|---|---|
| **I · Seguridad** | Sin secretos nuevos. Preview y `Comercial / Jev` autenticados con `withAuth`; la org viene de la sesión. Un fallo de proveedor se muestra como error, nunca como texto inventado. |
| **II · Soberanía** | Cero dependencias nuevas. El preview usa el proveedor LLM ya configurado (Jev) y nada más: sin WhatsApp real, sin servicios externos, sin colas. |
| **III · Multi-tenancy** | `organization_id` en toda fila nueva del sandbox; `scoped()` en cada query; el `versionId` del draft se resuelve server-side contra la org de la sesión. |
| **IV · Idempotencia** | El caso sandbox se limpia en `finally`. Guardar/Publicar no cambia de semántica: sigue publicando el draft persistido. El bug de Publicar se corrige hacia el estado *más* seguro (nunca publicar `dirty`). |
| **V · Contrato Jev** | Intocable. El preview ejecuta el mismo `evaluateJev` con el mismo set de preguntas; el cliente no toca option keys ni `next_action`. |
| **Sandbox del Lab** | Se respeta y se extiende: `is_test=true` garantiza que el sender real lance excepción si alguien intenta usarlo. El preview no lo evita, lo que hace es no ser un camino de producción. |
| **YAGNI** | Sin plataforma de workflows, sin Monaco, sin abstracciones genéricas, sin refactors oportunistas. 2 cortes. |

**Veredicto**: conforme. No hay excepción que pedir a la Constitución.

## 6. Riesgos técnicos y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| El refactor visual rompe el guardado | El servidor revalida; los tests de C1-1 fijan los estados; 009 E2E (016/017) sigue verde. |
| Bajar a tabs pierde texto escrito | El estado vive en el padre; el guardado reensambla el documento completo. Test explícito: escribir en ambos, cambiar de tab, guardar, comprobar que el documento llegó íntegro. |
| La extracción del andamiaje altera el Lab | El andamiaje se mueve, no se reescribe; `lab-pipeline-real.test.ts` verde sin cambios. |
| El preview devuelve un turno vacío | `buildJevSalesState` hace `return` temprano sin lead; el endpoint debe distinguir "sin stage abierto" / "sin decisión" de un resultado vacío y reportarlo como error explícito. |
| Fuga de filas sandbox | `finally` con cleanup + verificación en el test de cero efectos residuales. |
| El preview divergiría de lo publicado | El endpoint no acepta JSON local; resuelve la versión desde BD. |
| Que "simplificar" se lea como perder alcance | Cada pieza eliminada tiene reemplazo; la sección de alcance del spec lista las equivalencias. |

## 7. Definition of Done técnica

Por corte:

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Más, para lo observable, el **self-test E2E** (`pnpm test:e2e` con
`WA_MOCK_ENABLED=true`). Extender el arnés, no dejar solo el `.md`:

- **Sección 018** (Corte 1): ciclo completo en la UI real + camino infeliz de
  JSON inválido + la regla Publicar por estado.
- **Sección 019** (Corte 2): preview Published y Draft, aislamiento de org,
  cero efectos, y los dos caminos infelices.

Regla de honestidad: **no declarar E2E si no se ejecutó.** Si el arnés no está
disponible, el corte queda con el gate técnico y su estado en `tasks.md` lo
dice.

## 8. Orden de commits

```bash
# este commit (bootstrap)
docs(ai): bootstrap playbook playground UX SDD

# corte 1
refactor(playbook): simplificar Comercial Jev

# corte 2
feat(playbook): añadir prueba rápida sandbox
```

Un commit por corte, árbol limpio entre cortes, sin push.
