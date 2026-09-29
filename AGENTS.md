# Espacio Connect — AGENTS.md

Este archivo es el **punto de entrada común para cualquier agente de código**
(Codex, MiniMax, Claude Code u otro). No reemplaza la Constitución ni los specs:
define cómo recuperar contexto y cómo dejar el repositorio entendible después de cada bloque.

## 1. Orden de lectura obligatorio

Antes de modificar código:

1. `.specify/memory/constitution.md` — reglas no negociables.
2. `docs/CURRENT_STATE.md` — dónde está parado el proyecto hoy.
3. El spec activo en `specs/NNN-*/`: `spec.md` → `plan.md` → `tasks.md`.
4. Documentación de dominio relevante:
   - `docs/SALES_ORCHESTRATOR.md`
   - `docs/SALES_FOLLOW_UPS.md`
   - `docs/AUDITORIA_BASE_ESPACIO_CONNECT.md`
5. Código real y tests del área a tocar.

Para Claude Code, leer además `CLAUDE.md`.

## 2. Jerarquía de verdad

1. **Realidad ejecutable:** código, schema, migraciones y tests actuales.
2. **Norma:** Constitución.
3. **Intención de la feature activa:** spec/plan/tasks.
4. **Checkpoint global:** `docs/CURRENT_STATE.md`.
5. **Historia y contratos de dominio:** docs específicos.
6. Chats, auditorías y notas antiguas: contexto histórico solamente.

Nunca asumir que un documento viejo sigue vigente sin contrastarlo con el repo.

## 3. Separación de memoria

La memoria se divide deliberadamente:

- **Negocio / producto:** cerebro de Obsidian de Max. Ahí viven razones, precios,
  alcance, políticas comerciales, prioridades y decisiones de operación.
- **Técnica / SDD:** este repositorio. Aquí viven arquitectura, specs, contratos,
  tareas, migraciones, código, tests, verificación y estado técnico.

Si una decisión de negocio afecta un contrato técnico, el spec debe expresar la
regla necesaria para implementar sin duplicar todo el cerebro de negocio.

## 4. Contexto operativo interno

La operación propia usa una instalación con tres organizaciones aisladas:

- **Max Quispe**
- **Vende Veloz 365**
- **Espacio Veloz**

El aislamiento tenant es obligatorio. Toda tabla de dominio y toda query sensible
debe respetar `organization_id` y `scoped()`.

La documentación upstream puede describir “una instancia = un negocio” para
despliegues externos. Eso no autoriza a mezclar datos en la instancia interna ni
a diseñar una plataforma SaaS multi-cliente por anticipado.

## 5. Flujo SDD obligatorio

Para toda feature con comportamiento observable nuevo:

```text
specify → clarify → plan → tasks → analyze → implement → verify
```

Cada feature vive en `specs/NNN-nombre/`. El `tasks.md` es el estado durable:
debe permitir reanudar el trabajo después de perder por completo el contexto del chat.

Exentos: typos, formato y refactors internos sin cambio observable o de contrato.

### Antes de implementar

- leer el estado actual;
- crear/actualizar spec;
- resolver ambigüedades de producto;
- crear plan y tasks dependency-ordered;
- hacer Constitution Check;
- no empezar código mientras el comportamiento siga indefinido.

### Durante la implementación

- cambios pequeños y verificables;
- commits atómicos;
- no mezclar refactors oportunistas;
- tests cerca del comportamiento modificado;
- reutilizar abstracciones maduras antes de crear otras.

### Cierre obligatorio

Antes de declarar “hecho”:

1. marcar `tasks.md` con estado real;
2. registrar evidencia de verificación;
3. actualizar `docs/CURRENT_STATE.md` si cambió el estado global;
4. actualizar el doc de dominio si cambió su contrato;
5. dejar explícito cualquier pendiente o verificación no ejecutada;
6. si cambió una decisión de negocio, señalar que debe sincronizarse en Obsidian.

## 6. Definición de Hecho

Gate mínimo:

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Para comportamiento observable, además ejecutar self-test E2E y camino infeliz
según la Constitución y `CLAUDE.md`. No reportar “debería funcionar”.

Si E2E no pudo ejecutarse, registrar la causa y dejar el estado como pendiente.
Gates unitarios verdes no equivalen a “READY punta a punta”.

## 7. Guardrails técnicos

- Nunca exponer ni commitear secretos.
- Nunca omitir tenant scope.
- No romper idempotencia de webhooks/integraciones.
- Sandbox `is_test` nunca toca WhatsApp real.
- No duplicar el sender de WhatsApp; reutilizar las capas existentes.
- No introducir servicios externos fuera de la lista permitida por la Constitución.
- No construir billing/provisioning/SaaS, campañas masivas o infraestructura
  prematura salvo un spec aprobado que cambie explícitamente el alcance.
- Fallos de proveedores externos deben degradar de forma segura.

## 8. Áreas actuales importantes

Consultar `docs/CURRENT_STATE.md` para el detalle vigente. A fecha 2026-09-29:

- WHMCS soporta `invoice.created` y `invoice.paid`;
- Sales Orchestrator de Vende Veloz está implementado con opt-in;
- el motor durable de follow-ups está implementado;
- el último checkpoint registró gates técnicos verdes, pero el E2E completo de
  follow-ups quedó pendiente.

No reabrir módulos ya cerrados salvo bug, nueva evidencia o un nuevo spec.

## 9. Handoff al terminar una sesión

Dejar información suficiente para responder en menos de un minuto:

- objetivo trabajado;
- spec/tarea actual;
- commits;
- gates ejecutados y resultado;
- E2E ejecutado o pendiente;
- decisiones técnicas tomadas;
- archivos clave;
- siguiente paso exacto.

El repositorio debe contar la historia aunque no exista acceso al chat que produjo los cambios.
