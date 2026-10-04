# Tasks — 014 Espacio Connect: rebrand + rediseño

**Estado durable de este spec.** Arranca **después** de que
`specs/013-operator-workspace/tasks.md` tenga los Cortes 1–5 cerrados. El rediseño se
aplica sobre el workspace operativo; si la Agenda o "Por atender" no existen, este
bloque se detiene con diagnóstico (no inventa la base).

Commit de arranque de este bloque: el bootstrap de 013/014.

Spec activo: `spec.md` · `plan.md` · este archivo.
Runner: `scripts/ai/run-operator-workspace-mcode.sh` (sesión mcode nueva por corte).
Prompts de corte: `.ai/tasks/operator-workspace/06..08`.

---

## Mapa de cortes

| Corte | Objetivo | Commit objetivo | Sesión |
|---|---|---|---|
| CUT 6 | Rebrand Espacio Connect | `chore(brand): consolidar Espacio Connect` | `06-cut6-rebrand.md` |
| CUT 7 | Rediseño práctico | `refactor(ui): simplificar experiencia de Espacio Connect` | `07-cut7-redesign.md` |
| CUT 8 | Polish y regresión final | `test(ui): cerrar workspace de Espacio Connect` | `08-cut8-polish-regression.md` |

---

## CUT 6 — Rebrand Espacio Connect

- [ ] T601 Inventario real con `rg -n -i 'vocero' .`, grabado en este archivo
- [ ] T602 Clasificar cada categoría (marca visible / metadata / docs / demo copy /
      comentarios / migraciones / specs cerrados / constitución / identificadores)
- [ ] T603 `DEFAULT_BRANDING.name` → Espacio Connect; white-label por org intacto
- [ ] T604 Títulos y `metadata` de la app
- [ ] T605 Copy de demo y textos visibles
- [ ] T606 README vigente e instalación vigente
- [ ] T607 Docs operativas vigentes
- [ ] T608 `branding.test.ts` verde (ajuste de expectativa **solo** de marca visible,
      justificado)
- [ ] T609 Migraciones, specs cerrados y constitución **intactos**
- [ ] T610 Referencias inevitables documentadas con su razón
- [ ] T611 Enmienda de marca en la constitución registrada como **pendiente formal**
- [ ] T612 Gate completo
- [ ] T613 Evidencia, un commit, árbol limpio

### Registro de la auditoría (se completa en CUT 6)

| Categoría | Ficheros | Decisión | Razón |
|---|---|---|---|
| Marca visible | `src/lib/branding.ts`, `components/settings/branding-client.tsx`, layout | *pendiente* | *pendiente* |
| Metadata/títulos | layout raíz, `package.json` description | *pendiente* | *pendiente* |
| README / instalación | `README.md`, `INSTALL-IA.md` | *pendiente* | *pendiente* |
| Docs vigentes | `docs/*` | *pendiente* | *pendiente* |
| Demo copy | `scripts/e2e-*.mjs`, seeds | *pendiente* | *pendiente* |
| Comentarios / logs | `src/lib/auth`, `src/lib/db`, `events/bus`, `rate-limit`, `worker` | *pendiente* | *pendiente* |
| Migraciones | `drizzle/0006_*`, `drizzle/0007_*` | conservar | script ya aplicado; reescribirlo rompe trazabilidad |
| Specs cerrados | `specs/001-vocero-core/**`, `002`, `007` | conservar | trazabilidad histórica |
| Constitución | `.specify/memory/constitution.md` | conservar | norma ratificada; exige enmienda formal (plan D-2) |
| Identificadores | `package.json` name, Docker/compose | *pendiente* | *pendiente* |
| Fixtures de test | `tests/**`, cuentas `@*.test` | *pendiente* | *pendiente* |

## CUT 7 — Rediseño práctico

- [ ] T701 Shell / sidebar / header: jerarquía, respiración, acento
- [ ] T702 Nav: "Por atender" y Agenda visibles con conteos
- [ ] T703 Bandeja: lo urgente arriba; "Por atender" como primera opción
- [ ] T704 Tarjetas de conversación y panel: estado humano/IA legible de un vistazo
- [ ] T705 Pipeline: etapas comerciales claras, sin etapas operativas falsas
- [ ] T706 Consistencia de labels, spacing, badges
- [ ] T707 Empty states de las superficies nuevas y existentes tocadas
- [ ] T708 Sin librería UI nueva; tokens y componentes reutilizados
- [ ] T709 Sin cambios de contrato (DTOs, endpoints, lógica de 013)
- [ ] T710 Gate + E2E de UI (o PENDIENTE con causa)
- [ ] T711 Evidencia, un commit, árbol limpio

## CUT 8 — Polish y regresión final

- [ ] T801 Responsive razonable (escritorio primero)
- [ ] T802 Accesibilidad básica: foco visible, `aria`, contraste, teclado
- [ ] T803 Empty / loading / error states completos
- [ ] T804 Regresión Inbox
- [ ] T805 Regresión Pipeline
- [ ] T806 Regresión Contactos
- [ ] T807 Regresión Agente
- [ ] T808 E2E actualizado y ejecutado (o PENDIENTE con causa)
- [ ] T809 `docs/CURRENT_STATE.md` final
- [ ] T810 `specs/013-operator-workspace/tasks.md` actualizado
- [ ] T811 `specs/014-espacio-connect-rebrand/tasks.md` actualizado
- [ ] T812 Pendientes honestos; sin "READY" sin evidencia
- [ ] T813 Gate completo final
- [ ] T814 Un commit, árbol limpio

---

## Evidencia

_(Sin evidencia todavía. Este bloque es bootstrap: ningún corte implementado.)_

Bootstrap 2026-10-04: creados `spec.md`, `plan.md` y `tasks.md` de este spec, más los
prompts `.ai/tasks/operator-workspace/06..08` y el runner compartido
`scripts/ai/run-operator-workspace-mcode.sh`. **Cero código funcional de 014 en este
commit.** CUT 6 no iniciado y **depende** de los Cortes 1–5 de 013 cerrados.
