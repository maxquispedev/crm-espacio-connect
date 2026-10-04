# Corte 3 — Agenda y programación humana

Objetivo único del corte 3 del spec `013-operator-workspace`. Commit previsto:
`feat(inbox): añadir agenda de recordatorios humanos`.

## Reconstruir contexto — obligatorio antes de modificar

Sesión NUEVA e independiente de `mcode exec`, desde la raíz del repo. No dependas del
chat, de otra sesión ni de resume. Un corte = un objetivo = un commit.

1. Lee **completo**: `AGENTS.md`, `.specify/memory/constitution.md`,
   `docs/CURRENT_STATE.md` y `CLAUDE.md`.
2. Lee `specs/013-operator-workspace/spec.md` → `plan.md` → `tasks.md` →
   `quickstart.md`. El spec manda, en especial `spec.md` §2.3 (recordatorio humano ≠
   seguimiento automático) y `plan.md` §5 (D-2, D-3, D-5).
3. **Depende de los cortes 1 y 2 cerrados.** Confirma con `git log` que existen
   `feat(inbox): persistir atención y recordatorios humanos` y
   `feat(inbox): añadir cola por atender`, y lee la evidencia en el `tasks.md` de 013.
   Si falta algo, **STOP** con diagnóstico: no implementes cortes anteriores.
4. Lee lo que dejaron: `src/server/inbox/attention.ts` (en especial
   `scheduleHumanReminder`), el DTO con `attention`, la Bandarja con "Por atender", y
   los tests nuevos.
5. Contexto de follow-ups automáticos (para NO duplicarlo):
   `src/server/sales/follow-ups/{store,policy,worker,writer}.ts`, el worker en
   `src/instrumentation-node.ts`, `docs/SALES_FOLLOW_UPS.md` y el endpoint existente
   `src/app/api/pipeline/leads/[id]/follow-up/route.ts` (que **rechaza**
   `human_lane`/`handoff_active`). Ese rechazo es la prueba de que son dos mecanismos.
6. Patrones de API a copiar: `withAuth`, `parseBody`, `apiError` de `src/lib/api.ts`;
   Zod estricto sin `organizationId` en el body; un endpoint de referencia de lectura
   filtrada por sesión.
7. Comprueba `git status --short` limpio, guarda el HEAD inicial y revisa `git log`.
   Nunca `reset`/`checkout`/`clean`/`stash`/`rebase`.

Código y tests reales > documentos históricos. Reevalúa el Constitution Check. Ante
ambigüedad bloqueante, para y reporta.

## Trabajo autorizado y límites

- Store de consulta con los buckets de `plan.md` §4.2: `overdue`, `today`, `tomorrow`,
  `week`, `later`. **Calculados en el servidor** para que cliente y servidor no
  discrepen del reloj.
- Endpoints mínimos de `plan.md` §4.2: `GET /api/reminders`,
  `POST /api/reminders`, `DELETE /api/reminders/[conversationId]`. Entrada estricta con
  Zod: `dueAt` **futura** (error explícito 422 si es pasado), `note` opcional recortada
  con longitud máxima. La organización sale **siempre** de la sesión.
- Acción **"Recordarme"** en una conversación en atención humana: fecha/hora + nota
  opcional. Acepta fechas concretas y compromisos abiertos resueltos por la persona a
  una fecha concreta. Sin parsing automático de texto libre.
- Vista **Agenda** con los cinco grupos, mostrando contacto, fecha/hora, nota/razón y
  estado, y con acción para abrir la conversación y para cancelar.
- Cumplir `spec.md` §3.2 pasos 6–9: recordatorio futuro → sale de Por atender y entra
  en Agenda; vencido → vuelve a Por atender **sin proceso ni worker**; cliente escribe
  antes → vuelve a Por atender de inmediato; dopo de atender se puede programar el
  siguiente; y se puede cancelar explícitamente.

**Prohibido**:

- **Enviar WhatsApp desde un recordatorio humano.** Ninguna llamada a Graph, sender,
  plantillas o al worker de follow-ups, en ningún camino, ni "solo si está dentro de
  ventana". Vencido significa "vuelve a la cola humana", nunca "mándale un mensaje".
- Reutilizar `sales_follow_up_job` o `lead.nextFollowUpAt` como recordatorio humano
  (`plan.md` §5).
- Tocar `src/server/sales/follow-ups/**`, cadencias, worker, seeding o los errores
  `human_lane`/`handoff_active`.
- Implementar plantillas WhatsApp: **fuera de este bloque** por decisión de producto.
- Cambiar el pipeline, crear etapas operativas, o meter la Agenda dentro de la lista de
  la Bandeja (es superficie propia).
- Mover el bucketing al cliente si el servidor ya lo calcula, o al revés.
- Dependencias externas, secretos, refactors oportunistas.

## Tests obligatorios

- Buckets con reloj inyectable: vencido, hoy, mañana, esta semana, más adelante;
  límites (23:59, medianoche, cambio de día, fin de semana).
- Zona horaria: timestamps UTC en BD, agrupación por fecha local del operador
  (mismo criterio del hotfix de `claimDueJobs` en `docs/SALES_FOLLOW_UPS.md`).
- `dueAt` en el pasado → 422; `note` excesiva/vacía → 422; body con `organizationId`
  → rechazado; org ajena → vacío/404; sin sesión → 401/403.
- Aislamiento tenant A/B en listar, programar y cancelar.
- Ciclo completo: programar → fuera de Por atender → vencido → en Por atender; inbound
  antes → en Por atender inmediato; cancelar.
- Programar un segundo recordatorio tras atender el primero, sin compromisos
  ambiguos acumulados.
- **Spy que falle si el camino de la Agenda llega al sender/Graph.** Es un requisito
  de seguridad del producto, no un extra.
- Sandbox `is_test` del Laboratorio: sin efecto en la atención y **cero** Graph.

## Gates y evidencia obligatorios

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

UI observable: ejecuta el self-test E2E con app + PostgreSQL + mocks y **UI real
(Playwright)**: programar un recordatorio desde la UI, verlo en su bucket, comprobar
que sale de "Por atender", comprobar que vence y vuelve, comprobar que el cliente
escribe antes y vuelve a "Por atender", cancelar, y el camino infeliz completo. Itera
diagnóstico/fix/verificación dentro del corte. Si el entorno no lo permite, registra
comando, causa exacta y **PENDIENTE** en `tasks.md` y `CURRENT_STATE`; puedes commitear
con gates técnicos verdes, pero **no** marcar E2E cumplido ni declarar READY.

Nunca uses `is_test` contra WhatsApp real ni contactes destinatarios productivos.

## Cierre de esta sesión

1. `specs/013-operator-workspace/tasks.md` SOLO con el estado real de este corte.
2. `docs/CURRENT_STATE.md` con objetivo, cambios, decisiones, evidencia, archivos clave
   y siguiente paso exacto.
3. `docs/SALES_FOLLOW_UPS.md`: **añade** una nota breve y explícita de que existe un
   mecanismo **humano** distinto, sin alterar ninguna regla del motor automático.
   Señala la decisión de producto para sincronizar en Obsidian.
4. `git diff`, `git diff --check` y `git diff --cached`; staging de ficheros concretos.
5. **EXACTAMENTE UN commit atómico** con implementación + tests + docs. Sin `amend`,
   `merge`, `rebase`, `push` ni deploy.
6. Verifica HEAD distinto, un solo commit desde el HEAD inicial y árbol limpio.
   Reporta hash, gates y estado E2E honesto.
