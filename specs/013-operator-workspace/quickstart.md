# Quickstart — 013 Operator Workspace

Cómo se ejecuta el bloque y cómo se **verifica en vivo**. Bootstrap: este quickstart
describe la operación; no implica que ningún corte esté implementado.

---

## 1. Requisitos del runner

- Bash/WSL **externo** al agente. Nunca lanzar el runner desde dentro de una sesión de
  mcode.
- Árbol limpio, `git`, GNU `timeout`, `tee` y utilidades shell comunes.
- `mcode` en `PATH` y autenticado (probado: **0.6.2**).
- Un commit por corte, invariable.

### Preflight del runner

El runner usa la interfaz real instalada, no flags asumidos:

- `mcode exec` (subcomando de ejecución no interactiva) — confirmado en `--help`.
- `--permission full` (política de permisos de la CLI) — existe en esta versión.
- `--prompt-mode coding`, `--output-format text`, `--cwd`.
- Un `timeout` GNU envuelve **cada corte**; sin eso, un corte puede colgarse para
  siempre.

Si una versión instalada no expone alguna de estas opciones, el runner **falla en el
preflight** con un diagnóstico; no improvisa un equivalente ni degrada a modo
interactivo.

---

## 2. Ejecutar

```bash
cd /home/max/proyectos/crm-espacio-connect
START_CUT=1 END_CUT=5 CUT_TIMEOUT=90m bash scripts/ai/run-operator-workspace-mcode.sh
```

Defaults: `START_CUT=1`, `END_CUT=8`, `CUT_TIMEOUT=90m`, `HEARTBEAT_SECONDS=25`.

Tanda recomendada: **1–5** (el bloque 013) y luego **6–8** (el bloque 014).

```bash
# Después de 1–5, revisar gates/evidencia antes de seguir:
START_CUT=6 END_CUT=8 CUT_TIMEOUT=90m bash scripts/ai/run-operator-workspace-mcode.sh
```

Cada corte abre una **sesión nueva** de mcode: sin `--continue`, sin `--session`, sin
dependencia de un chat anterior. El prompt de cada corte es autosuficiente.

Logs en `.ai/logs/operator-workspace/` (ignorados por `*.log`). Heartbeat independiente
informa corte, segundos transcurridos, nº de cambios, HEAD y archivo modificado
recientemente.

### Garantías del runner

- **fail-fast**: `set -Eeuo pipefail`; un corte fallido detiene el rango.
- **Árbol limpio** antes de empezar y antes de cada corte; si no, se detiene (68).
- **HEAD comprobado** antes y después de cada corte.
- **Exactamente un commit**: se exige que el padre del HEAD nuevo sea el HEAD previo.
  Cero commits → 70. Más de uno → 70.
- **STOP si el agente termina sin commit** o deja el árbol sucio (69).
- **Nunca** hace `reset`, `clean`, `checkout` destructivo, `stash`, `rebase` ni
  auto-revert. Un corte fallido **conserva** sus cambios.

---

## 3. Recuperación (conservando trabajo)

Ante fallo de un corte:

1. `git status --short` y `git log --oneline -5` para ver qué quedó.
2. Leer el log del corte en `.ai/logs/operator-workspace/`.
3. **No** descartar nada. Terminar **solo ese corte** en una sesión nueva e
   interactiva, hasta dejar su único commit.
4. El runner rechaza arrancar con árbol sucio: es intencional. Reanudar con
   `START_CUT=N END_CUT=N`.

Si el commit del corte ya existe, **no** reejecutarlo: verificar evidencia y reanudar en
`N+1` con el `END_CUT` adecuado. `START_CUT` no reemplaza las dependencias: cada corte
comprueba lo que dejaron los anteriores.

E2E no ejecutable por entorno → se registra **PENDIENTE** con comando y causa. El
rango terminado **no** implica READY punta a punta.

---

## 4. Operación manual de las dos conceptos

### Por atender

- Aparece en la Bandeja con su conteo: handoff de Jev, inbound nuevo durante HUMAN,
  recordatorio humano vencido.
- **Abrir la conversación NO la saca de la cola.** Atender es otra cosa.
- "Marcar atendido / Esperando respuesta" la saca: la conversación queda con la bola en
  el cliente.

### Agenda / "Recordarme"

- Solo desde una conversación en atención humana.
- Fecha/hora + nota opcional. Ejemplos válidos: jueves 10:00 · 15 diciembre 09:00 ·
  "retomar cuando abra temporada" (la persona elige la fecha).
- Vencido → vuelve a **Por atender**. El cliente escribe antes → vuelve a **Por
  atender** de inmediato.
- **Nunca** envía WhatsApp. No es un seguimiento automático.

### No confundir con el seguimiento automático 🤖

- 🤖 Automático: el lead dejó de responder y el sistema **escribe**.
  Cadencias, worker, plantillas fuera de ventana, `DORMANT`/`no_reply_exhausted`.
  Vive en `docs/SALES_FOLLOW_UPS.md`.
- 👤 Humano: Max se comprometió y el CRM lo **recuerda a Max**. No envía nada.

El automático **rechaza** actuar cuando hay handoff (`human_lane` /
`handoff_active`); el humano solo existe en ese hueco. Ver `plan.md` §5 (D-2, D-3).

---

## 5. Self-test E2E (CUT 5, y el de cada corte con UI)

Igual que el patrón de `specs/011-commercial-resources/quickstart.md`. App de pruebas
**aislada**, BD PostgreSQL **dedicada** migrada, todos los proveedores hacia mocks
locales. Nunca la BD ni el proceso productivos.

Requisitos: `postgres`/`psql`/`pg_ctl` o Docker, Chromium de Playwright, y la app
levantada. Si falta cualquiera: registrar el comando intentado y la causa, y dejar
**PENDIENTE**. No inventar resultado.

```bash
APP_BASE_URL=http://127.0.0.1:3000 \
DATABASE_URL=postgresql://local_test:local_test@127.0.0.1:5432/operator_workspace_test \
E2E_SECTION=026 WA_MOCK_ENABLED=true BOT_API_KEY=e2e-local-placeholder \
META_GRAPH_BASE_URL=http://127.0.0.1:3033/graph \
OPENROUTER_BASE_URL=http://127.0.0.1:3033 \
TYPESAFE_JEV_ENDPOINT=http://127.0.0.1:3033/jev \
pnpm --pm-on-fail=ignore test:e2e
```

- `E2E_SECTION=026` es el nombre **real** de la sección del workspace. El
  nombre propuesto era `023`, pero quedó ocupado: 023 = cola "Por atender"
  (C2), 024 = Agenda (C3), 025 = flujo operativo (C4) y **026 = verificación
  integral** (C5). Vive en `scripts/e2e-workspace-verification.mjs`, con su
  dispatch aislado en `scripts/e2e-selftest.mjs` y el guion legible en
  `tests/e2e/013-workspace-verificacion.md`.
- Los mocks son los de `src/app/api/dev/` tras el gate único de `dev-guard`: **404
  incondicional en producción**. Nunca se activan en un despliegue real.
- Cuenta fixture de pruebas, nunca credenciales productivas. La sección crea sus
  propias organizaciones por la puerta real de producto (`pnpm org:create`, que
  es la única que siembra pipeline y perfil del agente) con un slug único por
  corrida, así que convive con las de 023/024/025 sin mezclarse.
- Cero WhatsApp real. Los `is_test` del Laboratorio jamás tocan Graph (guardrail
  existente: **no "arreglarlo"**).

Camino infeliz obligatorio: sin sesión → 401/403; organización ajena → vacío/404;
`dueAt` en el pasado → 422; nota excesiva → 422; fallo de escritura → error controlado
sin estado a medias; y **spy de que ningún recordatorio humano llega al sender**.

### Suite física de PostgreSQL (opcional pero recomendada)

Si hay ejecutables, una suite opt-in para constraints/FK/UNIQUE reales de
`conversation_attention`, siguiendo el patrón de
`tests/unit/commercial-resource-postgres.test.ts` (host local y BD **dedicada**;
nunca `DATABASE_URL` como fallback). Los dobles en memoria **no** sustituyen
PostgreSQL: si no corre, se dice.

---

## 6. Gate de cada corte

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

En la práctica local de este repo, los cortes anteriores usaron
`pnpm --pm-on-fail=ignore` (sin esa opción el gestor falla antes del script con
`unable to open database file`). No cambia dependencias; es solo cómo invocar pnpm.
Los tests HTTP del sandbox pueden pedir sockets locales habilitados: si aparece
`EPERM`, reejecutar el gate completo con sockets autorizados y **registrarlo** en
`tasks.md` (precedentes: 011 C1–C4, 012).

## 7. Lo que este quickstart no promete

- Que el rango del runner implique READY punta a punta. Solo lo declara el E2E real
  ejecutado y registrado.
- Cerrar los pendientes históricos **020/021/022** ni los 4 tests PostgreSQL opt-in.
- Cualquier envío de WhatsApp. Este bloque no envía nada.
