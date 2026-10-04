# 014 — Espacio Connect: rebrand + rediseño práctico

Fecha: 2026-10-04. Alcance autorizado: consolidar la marca **Espacio Connect** y
volver el CRM más claro, compacto y agradable para la operación diaria.

Este spec depende de `specs/013-operator-workspace` (Cortes 1–5). El rediseño se
aplica **sobre** el workspace operativo ya construido: si la Agenda o "Por atender"
no existen, este bloque no tiene sobre qué trabajar.

---

## 1. Problema observable

- La marca visible del producto sigue diciendo **Vocero** en el nombre por defecto del
  branding, README, metadatos, textos de demo e instalación. El producto ya se opera
  como Espacio Connect.
- La interfaz se siente como un panel técnico: mucha densidad de estados internos,
  etiquetas técnicas y acciones poco obvias. Falta jerarquía visual entre
  "esto es lo que tengo que hacer ahora" y el resto de información.

La auditoría base es `docs/AUDITORIA_BASE_ESPACIO_CONNECT.md`; el detalle técnico de
este bloque vive aquí.

---

## 2. Decisiones de producto congeladas

- La marca visible y la documentación vigente son **Espacio Connect**. **EV Connect**
  solo donde ya tenga sentido visual (espacios cortos: badge, favicon, textos donde
  quepa).
- **No** se renombran identificadores técnicos con riesgo (nombres de paquete,
  claves de env, columnas, rutas, `package.json` name) sin justificación explícita.
  Un rebrand no es un cambio de infraestructura.
- **No** se reescribe la historia: specs cerrados, migraciones y trazabilidad previa se
  conservan cuando no hay necesidad.
- El rediseño **no** reinventa el frontend: reutiliza componentes, tokens y patrones
  existentes; sin librerías UI nuevas salvo justificación explícita.
- **No** se agrega un dashboard nuevo. La jerarquía se trabaja sobre las pantallas que
  ya existen.

---

## 3. Requisitos

### CUT 6 — Rebrand Espacio Connect

- **FR-6.1** Se audita localmente con `rg -n -i 'vocero' .` y se registra el resultado
  (fichero, categoría, decisión).
- **FR-6.2** La marca visible (UI, `metadata`/títulos, textos visibles, copy de demo)
  dice Espacio Connect.
- **FR-6.3** La documentación vigente (README, instalación, docs operativas) dice
  Espacio Connect.
- **FR-6.4** `DEFAULT_BRANDING.name` y el nombre por defecto de la app dicen Espacio
  Connect; el white-label por organización sigue funcionando.
- **FR-6.5** **No** hay replace ciego. Cada categoría se decide explícitamente.
- **FR-6.6** No se rompen migraciones históricas, identificadores de riesgo técnico ni
  trazabilidad de specs cerrados.
- **FR-6.7** Toda referencia inevitable que sobreviva queda **documentada con su
  razón** en `docs/` y en `tasks.md`.
- **FR-6.8** Los tests de branding existentes (`tests/unit/branding.test.ts`) siguen
  verdes; si una expectativa product-facing cambia, se actualiza de forma explícita y
  se justifica.

### CUT 7 — Rediseño práctico

- **FR-7.1** Práctico antes que decorativo; menos sensación de "panel técnico".
- **FR-7.2** Jerarquía clara: acciones principales obvias, información secundaria
  visualmente subordinada.
- **FR-7.3** Densidad razonable para escritorio, consistente con el dark mode actual.
- **FR-7.4** Sin librerías UI nuevas; reutiliza componentes y tokens existentes.
- **FR-7.5** Sin degradar rendimiento (sin listas masivas de re-render, sin cargar datos
  que no se usan).
- **FR-7.6** Prioridad visual: 1) shell/sidebar/header, 2) Bandeja, 3) tarjetas/estado
  operativo, 4) Pipeline, 5) consistencia de labels, spacing, badges y empty states.
- **FR-7.7** El resultado hace muy evidentes **Por atender**, **Agenda**, el estado
  humano/IA y el pipeline comercial.
- **FR-7.8** No se introduce un dashboard nuevo.

### CUT 8 — Polish y regresión final

- **FR-8.1** Responsive razonable.
- **FR-8.2** Accesibilidad básica (foco visible, labels, contraste, navegación por
  teclado en las acciones nuevas).
- **FR-8.3** Empty/loading/error states presentes en las superficies nuevas.
- **FR-8.4** Regresión de Inbox / Pipeline / Contactos / Agente.
- **FR-8.5** E2E actualizado y ejecutado (o PENDIENTE con causa).
- **FR-8.6** Docs finales, `docs/CURRENT_STATE.md` y `tasks.md` de **ambos** specs
  actualizados.
- **FR-8.7** Pendientes honestos: nada de "READY" sin evidencia.

---

## 4. No objetivos

- Cambiar la arquitectura del frontend, el router o el sistema de estilos.
- Rediseñar desde cero: es un bloque de pulición, no una reescritura.
- Añadir dependencias de UI.
- Tocar el comportamiento de negocio introducido por 013 o el motor de follow-ups.
- Rehacer la identidad de marca (logo, paleta) más allá del nombre y, si ya tiene
  sentido visual, EV Connect.
- Corregir pendientes técnicos históricos de otros specs (020/021/022, tests PG) como
  parte de este bloque; se registran, no se absorben.

---

## 5. Aceptación del bloque

| Corte | Commit objetivo |
|---|---|
| 6 | `chore(brand): consolidar Espacio Connect` |
| 7 | `refactor(ui): simplificar experiencia de Espacio Connect` |
| 8 | `test(ui): cerrar workspace de Espacio Connect` |

Cierre: gate completo en verde y self-test E2E de comportamiento ejecutado (o
PENDIENTE con causa). El árbol queda limpio y `docs/CURRENT_STATE.md` refleja el
estado real de **los dos specs**.
