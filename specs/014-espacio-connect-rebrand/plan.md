# Plan — 014 Espacio Connect: rebrand + rediseño

Cómo se ejecuta `spec.md` con la menor cantidad de riesgo. Decisiones verificadas
contra el repo a 2026-10-04 (HEAD `ef83302262f9b147ded271ba4d1d5b323f88e344`) y
**después** de los Cortes 1–5 de `specs/013-operator-workspace`.

---

## 1. Constitution Check

| Principio | Evaluación |
|---|---|
| I Seguridad | El nombre de marca no es secreto. Los tokens de access de credenciales siguen mostrando solo los últimos 4; el rebrand no toca ese contrato. No se añaden secretos ni variables. |
| II Soberanía | **Sin dependencias nuevas.** Sin librerías UI, sin fuentes, sin servicios. El nombre de marca es texto. |
| III Multi-tenancy | El branding es **por organización** (`normalizeBranding`, `DEFAULT_BRANDING` es solo el fallback). Cambiar el fallback no cambia ni saltarse el aislamiento. Nada de este bloque altera queries. |
| IV Idempotencia | Sin webhooks ni integraciones. No aplica. |
| V Calidad verificable | Gate completo en cada corte; `tests/unit/branding.test.ts` es la red de seguridad del rebrand. Lo no ejecutable se marca pendiente. |
| VI Specs antes de código | Este spec/plan/tasks preceden a CUT 6. |
| VII Trazabilidad | La auditoría `rg -n -i 'vocero'` se **graba** en `tasks.md` con la decisión por categoría. Las referencias inevitables se documentan con su razón. |
| VIII Foco vertical | Pulir la herramienta con la que se atiende un negocio. Sin añadir alcance. |
| IX Verificación en vivo | El rediseño es comportamiento observable: CUT 7/8 ejecutan E2E con UI real (Playwright) para la jerarquía, empty states y responsive. |

**Sin violaciones.** No hay excepción que justificar.

---

## 2. Estado real verificado (auditoría de marca)

`rg -i 'vocero'` a 2026-10-04: **~203 ocurrencias en 54 ficheros**. No es un replace
masivo: es una **auditoría por categoría**. Estas son las categorías reales que
aparecieron:

| Categoría | Ficheros de ejemplo | Decisión esperada |
|---|---|---|
| **Marca visible / UI** | `src/lib/branding.ts` (`DEFAULT_BRANDING.name = "Vocero"`), `src/components/settings/branding-client.tsx`, `src/app/(app)/layout.tsx` (título), `src/components/app-nav.tsx`, `src/components/notifications/desktop.ts` | **Renombrar a Espacio Connect.** Es exactamente el objetivo. |
| **Metadata / títulos** | layout raíz, `package.json` `description` | Renombrar el texto visible. `package.json` `name` es identificador técnico: NO renombrar sin justificación (riesgo bajo el nombre de paquete; ver §5). |
| **README / instalación** | `README.md`, `INSTALL-IA.md`, `docs/VENDEVELOZ_LAUNCH_CHECKLIST.md` | Renombrar la marca; conservar instrucciones técnicas. |
| **Demo copy** | `scripts/e2e-*.mjs`, seeds, textos de demo | Renombrar lo que el usuario ve. |
| **Depuración / claves de soporte** | `src/lib/auth/index.ts`, `src/lib/db/index.ts`, `src/server/events/bus.ts`, `src/lib/rate-limit.ts`, `src/server/sales/follow-ups/worker.ts` | Son comentarios/logs. Renombrar solo menciones de la marca en copy; **no** identifiers. |
| **Migraciones históricas** | `drizzle/0006_*.sql`, `drizzle/0007_*.sql` | **NO tocar.** Un jáxel aplicado no se reescribe. |
| **Specs cerrados** | `specs/001-vocero-core/**`, `specs/002-*`, `specs/007-meta-capi/*` | **NO tocar** (trazabilidad). El nombre de carpeta `001-vocero-core` se conserva como historia. |
| **Constitución** | `.specify/memory/constitution.md` | Es norma ratificada con historial de versiones. Renombrar la marca **exige enmienda** (procedimiento de enmienda). **No** se toca aquí; se señala como pendiente de Ratificado. |
| **Ficheros de test / fixtures** | `tests/unit/branding.test.ts`, `tests/e2e/us-bot-api.md`, cuentas `@vocero.test` | Textos de copy: renombrar. Cuentas fixture de test: pueden quedar (no son marca visible); si se renombran, actualizar arnés. Decisión explícita en `tasks.md`. |

**Conclusión de la auditoría:** la marca visible es una **capa fina** (branding,
títulos, docs, copy de demo). La gran mayoría de las 203 ocurrencias son comentarios,
migraciones o historia que **se conservan**. Esto confirma que no es un replace ciego.

> Nota: la auditoría real con `rg` la ejecuta el corte 6 y graba su salida en
> `tasks.md`. Este plan la pre-clasifica para que la sesión no invente categorías.

---

## 3. Sistema de diseño (para no reinventar)

- Tailwind con tema oscuro propio; acento por defecto `#25D366` (CLAUDE.md) /
  branding default `#3f5972` (Atlas) — el acento lo resuelve la organización.
- Tokens: `bg-secondary`, `text-text-3`, `bg-white/20` y familia equivalente; se
  **reutilizan**, no se redefinen.
- Componentes existentes reutilizables: `ContactAvatar`, `cn`, `formatPhone`,
  `formatTime`, `formatBytes`, `previewText`, `mediaLabel`, `formatAttachStatus`
  (`src/components/inbox/helpers.ts`).
- Iconografía: `lucide-react` ya presente (`Inbox`, `Kanban`, `Users`, `Sparkles`,
  `FlaskConical`, `Settings`, `PanelRight`...).
- Responsive: el layout ya es responsive de base; CUT 8 lo verifica, no lo
  inventa.

**Regla de este bloque:** no se añade un solo componente de librería. Si algo no se
puede resolver con tokens + componentes existentes + `lucide-react`, se justifica en
`tasks.md` o no se hace.

---

## 4. Plan por corte

### CUT 6 — Rebrand

1. `rg -n -i 'vocero' .` → inventario por categoría (§2).
2. Cambiar la **marca visible**: `DEFAULT_BRANDING.name` → `"Espacio Connect"`,
   títulos/metadata, copy de demo, README, instalación, docs vigentes.
3. **No** tocar migraciones, specs cerrados, constitución ni identifiers técnicos.
4. Cada cambio va con su test o su verificación; `pnpm test` debe seguir verde
   (incluido `branding.test.ts`, ajustando expectativas **solo** de marca visible).
5. Grabar en `tasks.md`: categorías cambiadas, categorías conservadas y **por qué**,
   y la lista de referencias inevitables con su razón.

### CUT 7 — Rediseño práctico

Por el orden de prioridad del spec:

1. **Shell / sidebar / header** (`src/app/(app)/layout.tsx`, `app-nav.tsx`): jerarquía
   de navegación, Badge de "Por atender"/Agenda, respiración visual, acento.
2. **Bandeja** (`inbox-client.tsx`, `conversation-list.tsx`, `message-thread.tsx`):
   lo urgente arriba; "Por atender" como primera opción; estados legibles; chips
   consistentes.
3. **Tarjetas / estado operativo** (`contact-panel.tsx`, tarjetas de la lista): el
   estado humano/IA se lee de un vistazo; lo secundario subordinado.
4. **Pipeline** (`pipeline-client.tsx`): etapas comerciales claras, sin etapas
   operativas falsas; etiqueta de estado legible.
5. **Consistencia** (labels, spacing, badges, empty states) en el resto.

Reglas: reutilizar tokens; no cambiar contratos de datos ni endpoints; no tocar
`013` (los datos de atención ya son los de 013); no tocar el motor de follow-ups.
Cada paso visible se acompaña de su verificación visual/E2E.

### CUT 8 — Polish y regresión

- Responsive (escritorio primero, móvil razonable).
- Accesibilidad básica: foco visible, `aria` en acciones nuevas, contraste de los
  estados nuevos, navegación por teclado.
- Empty/loading/error en Agenda, "Por atender" y estados nuevos.
- Regresión Inbox/Pipeline/Contactos/Agente (suite unitaria + E2E UI).
- Docs finales, `CURRENT_STATE`, `tasks.md` de 013 y 014, pendientes honestos.

---

## 5. Decisiones y alternativas descartadas

### D-1 — No renombrar `package.json` name

`"name": "vocero-crm"` es un identificador técnico. Renombrarlo no cambia la marca
visible y sí puede afectar a referencias de build/despliegue. Se cambia la
`description` (texto visible) y se deja el `name`, o se renombra **solo** si el corte
6 demuestra que nada lo referencia. Fuera del objetivo de marca.

### D-2 — No tocar la constitución en este bloque

`.specify/memory/constitution.md` es norma ratificada con historial (v1.3.0) y un
procedimiento de enmienda propio. Renombrar la marca ahí **exige** una enmienda
formal con Sync Impact Report, aprobada por el responsable. Este bloque **señala** el
cambio de nombre como enmienda pendiente; no la aplica de paso. Es una decisión de
gobernanza, no de copy.

### D-3 — No renombrar specs cerrados ni migraciones

Son historia y trazabilidad. Renombrarlos rompe el rastro de decisiones anteriores sin
beneficio operativo. Se conservan; la marca vigente vive en la documentación
actual, que es la que se actualiza.

### D-4 — Sin dashboard nuevo

El spec lo prohíbe explícitamente. La jerarquía se trabaja sobre las pantallas
existentes. Un dashboard añadiría superficie que mantener sin que este bloque la tape.

### D-5 — Sin librería UI nueva

`shadcn`, Radix u otra capa se rechaza: el repo ya tiene tokens, `cn` y `lucide-react`
suficientes, y añadir una dependencia contradice el Principio II en spirit (más
superficie, más riesgo de rendimiento) sin necesidad.

### D-6 — El rediseño no reescribe contratos

CUT 7 es visual/estructural. No cambia DTOs, endpoints ni la lógica de 013. Si un
cambio visual exige tocar un contrato, seSplit: el cambio de contrato es un spec
nuevo.

---

## 6. Verificación

| Nivel | Qué |
|---|---|
| Unitario | `branding.test.ts` verde; consistencia de labels si hay helpers de copy. |
| Regresión | Suite completa (`pnpm test`) verde; sin expectativas modificadas fuera de la marca visible justificada. |
| Gate | `pnpm typecheck && pnpm lint && pnpm build && pnpm test`. |
| E2E | CUT 7/8: UI real con Playwright — jerarquía, empty states, responsive, a11y básica, y no-regresión del workspace de 013. |
| Marca | `rg -n -i 'vocero'` final: solo sobreviven categorías justificadas y documentadas. |

Los pendientes históricos 020/021/022 y tests PG no se cierran aquí.

---

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Replace ciego rompe migraciones/historia | Auditoría por categoría; el corte 6 decide fichero a fichero y graba la decisión. |
| Enmienda constitucional colateral | La constitución no se toca (D-2); se documenta como pendiente. |
| Rediseño degrada rendimiento | Sin librería nueva, sin fetching extra, tokens reutilizados; E2E mide el flujo real de la UI, no el estilo. |
| Pulido que rompe 013 | Cada corte 7/8 re-ejecuta la regresión de Inbox y la del workspace. |
| `package.json`/Docker con marca vieja | Se documenta la razón de conservarlos (D-1) o se cambian si no hay riesgo probado. |
