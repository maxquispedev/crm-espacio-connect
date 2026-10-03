# CUT 2 — Baseline comercial vigente

## Lee obligatoriamente, en este orden

- `AGENTS.md`
- `.specify/memory/constitution.md`
- `docs/CURRENT_STATE.md`
- `specs/009-playbook-runtime-admin/spec.md`
- `specs/009-playbook-runtime-admin/plan.md` (sobre todo **§4** y **§5**)
- `specs/009-playbook-runtime-admin/tasks.md`
- `specs/009-playbook-runtime-admin/research.md` (DV-6, DV-7, DV-8, DV-9)
- `docs/SALES_ORCHESTRATOR.md` (§5, §6, §7 y el bloque de oferta)
- `docs/playbook.md`
- `src/server/sales/vende-veloz.ts` · `src/lib/sales/playbook/v1.ts` ·
  `src/server/sales/questions.ts` · `src/server/sales/writer.ts`
- `tests/unit/sales-questions-freeze.test.ts` ·
  `tests/unit/sales-launch-hardcoded.test.ts` · `tests/unit/sales-writer.test.ts`

## Antes de escribir código, inspecciona la realidad

```bash
grep -n "497\|197\|S/" src/server/sales/vende-veloz.ts src/lib/sales/playbook/v1.ts
grep -n "SALES_PLAYBOOK_RUNTIME_ENABLED" -r src tests
grep -rn "497\|197" tests/unit/ docs/ | grep -v lab-case-from-conversation
sed -n '200,220p' src/server/sales/writer.ts
```

- [x] **Usa el revisor de código** sobre el impacto del cambio de precio: qué
  archivos, tests y docs están acoplados. El freeze test ata tres representaciones.
- [x] Verifica en el código qué campos de `ConfigV1` pueden representar
  "primer mes adelantado", "sin permanencia" y "renovación de dominio aparte".
- [x] Comprueba el render real de `offerBlock` con `setup = 0`.

## Objetivo único

Sincronizar el **fallback técnico** y el **bootstrap** con la decisión comercial
vigente de la primera cohorte, dejando todo listo **antes** de encender el
runtime.

> **El runtime productivo debe SEGUIR APAGADO durante todo este corte.**
> `SALES_PLAYBOOK_RUNTIME_ENABLED` se queda en `false` y un test lo verifica.

## Decisión comercial de referencia

| Concepto | Valor |
|---|---|
| setup | **0** (sin fee obligatorio de implementación) |
| monthlyBase | **S/247/mes** |
| alumnos activos incluidos | **50** |
| alumno activo adicional (desde el 51) | **+S/1** |
| implementación asistida | **incluida** |
| primer mes | **pagado por adelantado** |
| permanencia | **no obligatoria** |
| dominio `.com` | primer año incluido **cuando el cliente lo necesita** |
| si ya tiene dominio | se conecta el existente |
| renovación del dominio | desde el 2º año, **se cobra aparte y NO lidera el pitch** |
| objetivo actual | **aprendizaje** de compra/adopción/uso/retención, no maximizar margen |

La fuente de verdad es Cerebro Max. Aquí va **solo el contrato técnico y el
fallback**: no copies la memoria comercial completa al repo.

## Tareas

1. **T921 — `VENDE_VELOZ_OFFER`** (`src/server/sales/vende-veloz.ts`):
   `setup: 497 → 0`, `monthlyBase: 197 → 247`. Revisa que `implementation`,
   `neverPromise` y cualquier texto de precio en el mismo archivo reflejen
   "implementación asistida incluida" y la renovación de dominio aparte.

2. **T922 — `VENDE_VELOZ_PLAYBOOK_V1`** (`src/lib/sales/playbook/v1.ts`):
   - `offer.setup = 0`, `offer.monthlyBase = 247`, `includedActiveStudents = 50`,
     `extraPerActiveStudent = 1`.
   - `offer.implementation.purpose` y `includes`: implementación asistida
     incluida, primer mes adelantado, sin permanencia obligatoria, dominio del
     primer año cuando aplica.
   - `offer.neverPromise`: renovación del dominio desde el segundo año se cobra
     aparte y no se lidera; nunca prometer generación de alumnos ni demanda.
   - `commercial_policy.goal`: objetivo de **aprendizaje**, no de margen.
   - `writer.present_price`: S/247, 50 incluidos, +S/1 desde el 51, sin
     permanencia, primer mes adelantado, sin briefings de contrato.
   - `handoff` y `urgency_rules`: handoff ante avance comercial genuino o
     solicitud explícita; no exigir cierre autónomo.
   - `priorities` y `prohibitions`: coherentes con filtrar tráfico.
   - **`jev_questions`: cambia SOLO los textos de `instructions`.** Los
     `criteria` deben quedar **idénticos** a
     `tests/fixtures/jev-questions-v2.json` — el freeze test lo asserta.
   - **Estrategia Jev V1**: filtrar tráfico; la **intención comercial pesa más que
     el tamaño por sí solo**; contexto mínimo, **nunca una encuesta**; handoff
     humano ante avance genuino o petición explícita; no se exige cierre
     autónomo end-to-end en esta fase.

3. **T923 — La rama del writer (DV-7).** `offerBlock` en
   `src/server/sales/writer.ts` renderiza hoy
   `` `- Implementación: S/${offer.setup} una sola vez.` `` de forma
   incondicional. Con `setup = 0` eso produce **"S/0 una sola vez"**, un precio
   falso que llega al lead. Añade la rama mínima: si `setup === 0`, omite la
   línea y declara la implementación como incluida. **Con test** en
   `tests/unit/sales-writer.test.ts`.

4. **T924 — Tests del baseline.** Demuestra explícitamente:
   - `ConfigV1` actual **parsea** sin errores.
   - El bootstrap nuevo refleja **S/247**, **setup 0**, **50 incluidos**, **+S/1**.
   - **Writer y política** correctos (incluida la ausencia de "S/0").
   - Los **contratos Jev siguen válidos** (criterios, option keys, tipos).
   - El **fallback y una Published pueden representar la misma estrategia** sin
     romperse.

5. **T925 — Regresión de freeze.** Reforzar/crear el test que verifica que
   `SALES_PLAYBOOK_RUNTIME_ENABLED` **sigue en `false`**. Este corte **no**
   enciende nada.

6. **T926 — Lockstep de test y docs** (mismo commit):
   - `tests/unit/sales-questions-freeze.test.ts`: aserciones `497`/`197` → `0`/`247`.
   - `tests/unit/sales-writer.test.ts`: título del caso y aserciones.
   - `docs/SALES_ORCHESTRATOR.md`: bloque de oferta (`implementation.price`,
     `subscription.price`), la lista de precios legendada, y §5/§6 si cambian
     producto o política.
   - **NO tocar** `tests/unit/lab-case-from-conversation.test.ts`: sus cadenas
     `S/497`/`S/197` son **PII anonimizada de prueba**, no contrato comercial.
   - Si necesitas tocar `src/server/sales/questions.ts`, es excepcional: documenta
     el motivo en `tasks.md` y actualiza fixture **y** doc §7 en el mismo commit.
     Preferentemente **no** lo toques.

7. **T927 — Paso operativo documentado.** Deja escrito, en `docs/playbook.md` y
   `docs/CURRENT_STATE.md`, el paso que falta entre este corte y el 3:

   > Antes de ejecutar el corte 3, crear/actualizar y **publicar** desde la UI
   > una versión con este baseline comercial.

## Restricciones

- **NO** actives `SALES_PLAYBOOK_RUNTIME_ENABLED`. Ni siquiera "temporalmente
  para probar".
- **NO** amplíes `ConfigV1Schema` porque las frases nuevas no quepan: caben en
  `implementation`, `neverPromise`, `goal` y `writer.present_price`. Solo cambia
  el schema con una necesidad **ejecutable**, documentada y con tests.
- **NO** cambies option keys contractuales de Jev, ni los `criteria` de
  `v1.ts`.
- **NO** toques sender, webhook, CAPI, follow-ups ni el Laboratorio.
- **NO** añadas dependencias.
- El estilo del writer se preserva: WhatsApp natural, breve, una idea por turno,
  normalmente una pregunta, responder primero al mensaje actual, sin catálogo de
  funcionalidades; "más información" = beneficio corto + pregunta contextual
  sencilla.

## Gates

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Máximo **2 iteraciones autónomas** de corrección si un gate falla por código.

## Cierre

- [x] Marca `T921`..`T927` en `tasks.md` con **evidencia real**.
- [x] Deja documentado el paso de publicar antes del corte 3.
- [x] **Un solo commit**:
      `feat(playbook): sincronizar baseline comercial Vende Veloz`
- [x] Working tree limpio.

**STOP después de este corte. NO empieces el corte 3.**

Si el runner te relanza por un fallo previo, **no resetees nada**: termina
**este mismo** corte, corre los gates, deja **un** commit y árbol limpio.
