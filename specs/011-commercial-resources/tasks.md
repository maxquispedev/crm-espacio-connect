# Tasks — 011 Commercial Resources

**Estado:** bootstrap SDD preparado; NINGÚN corte implementado.
Dependency order: bootstrap → C1 → C2 → C3 → pausa operativa → C4.
Un corte = sesión nueva de codex exec = objetivo único = commit atómico único.
Prompts ejecutables autocontenidos: .ai/tasks/commercial-resources/01–04.

## Bootstrap

- [x] B001 Contexto/código/runners revisados; spec y clarificaciones escritas.
- [x] B002 Plan, Constitution Check y análisis de consistencia preparados.
- [x] B003 Prompts autocontenidos y runner derivados del patrón existente.
- [x] B004 bash -n y revisión diff verdes; bootstrap preparado para su commit único.

Evidencia bootstrap: bash -n (exit 0), git diff --cached --check (exit 0),
validación estática de los cuatro prompts/mapeo/timeout/PIPESTATUS y ausencia
de resume/reset/checkout/clean ejecutables; revisión del diff staged.
Commit de cierre: `docs(ai): bootstrap commercial resources SDD and Codex runner`.
Runner NO ejecutado; gates de app/E2E de 011 NO ejecutados; cuatro cortes pendientes.

Este bootstrap no necesita ejecutar gates de app ni E2E: no modifica código
productivo. La comprobación del runner será estática; NO ejecutar pipeline.

## Corte 1 — Fundación y persistencia

**Estado:** PENDIENTE. **Commit previsto:** `feat(commercial): persistir recursos comerciales`.

- [ ] T1111 Modelo/slots/org+media y payload de cobro validado.
- [ ] T1112 Store scoped y referencia media mismo tenant.
- [ ] T1113 Migración aditiva re-ejecutable y tests de persistencia/aislamiento.
- [ ] T1114 Gates completos; evidencia BD real o pendiente explícito.
- [ ] T1115 Actualizar tasks/CURRENT_STATE/docs relevantes, revisar diff, UN commit y árbol limpio.

### Evidencia durable del corte

- HEAD inicial / commit final: pendiente.
- Archivos y decisiones técnicas: pendiente.
- Comandos/tests/gates y resultados: no ejecutados.
- E2E happy/unhappy: no ejecutado; registrar causa si no disponible.
- Pendientes y siguiente paso exacto: ejecutar solo este corte con su task.

## Corte 2 — UI Comercial / Jev → Recursos comerciales

**Estado:** PENDIENTE. **Commit previsto:** `feat(commercial): administrar demos y recursos de cobro`.

- [ ] T1121 API administrativa authenticated/org de sesión y upload local.
- [ ] T1122 UI mínima tres MP4 + cobro + preview privada sin modificar editor.
- [ ] T1123 Validación byte/MIME/tamaño y replacement conservando anterior en fallo.
- [ ] T1124 Tests API/UI, E2E UI happy/unhappy y gates completos.
- [ ] T1125 Actualizar tasks/CURRENT_STATE/docs relevantes, revisar diff, UN commit y árbol limpio.

### Evidencia durable del corte

- HEAD inicial / commit final: pendiente.
- Archivos y decisiones técnicas: pendiente.
- Comandos/tests/gates y resultados: no ejecutados.
- E2E happy/unhappy: no ejecutado; registrar causa si no disponible.
- Pendientes y siguiente paso exacto: ejecutar solo este corte con su task.

## Corte 3 — Entrega automática de demos nativas

**Estado:** PENDIENTE. **Commit previsto:** `feat(sales): entregar demos como video nativo`.

- [ ] T1131 Routing puro de demos por acción y pedido vigente.
- [ ] T1132 Sender media reutilizado, caption breve y origen IA compatible.
- [ ] T1133 Sandbox media local, disponibilidad/fallos seguros y facts tras video.
- [ ] T1134 Tests de entrega/facts/guards y E2E happy/unhappy; gates completos.
- [ ] T1135 Actualizar tasks/CURRENT_STATE/docs relevantes, revisar diff, UN commit y árbol limpio.

### Evidencia durable del corte

- HEAD inicial / commit final: pendiente.
- Archivos y decisiones técnicas: pendiente.
- Comandos/tests/gates y resultados: no ejecutados.
- E2E happy/unhappy: no ejecutado; registrar causa si no disponible.
- Pendientes y siguiente paso exacto: ejecutar solo este corte con su task.

## Pausa operativa tras 1–3

- [ ] OP1 Tres MP4 reales subidos desde UI, ningún binario real en Git.
- [ ] OP2 Persistencia tras reinicio/redeploy observada con MEDIA_DIR persistente.
- [ ] OP3 Tres videos reproducibles como nativos WhatsApp; registrar fecha,
  entorno y evidencia sin PII, destinatario autorizado y volumen mínimo.
- [ ] OP4 Degradación sin asset y sandbox sin WhatsApp real verificados.

Esta comprobación no la ejecuta el runner ni autoriza despliegue automático.
No bloquear datos técnicos en defaults imaginarios; no afirmar READY sin evidencia.

## Corte 4 — Acción explícita de instrucciones de pago

**Estado:** PENDIENTE. **Commit previsto:** `feat(sales): entregar instrucciones de pago configuradas`.

- [ ] T1141 Contrato 1.1/send_payment_instructions y V3 explícito compatible con V2/1.0.
- [ ] T1142 Actualizar normalizer/resolver/writer/orquestador/playbook/editor y Lab.
- [ ] T1143 Destinos por código solo desde recursos; fact tras entrega y handoff posterior.
- [ ] T1144 Tests compatibilidad/negativas/seguridad y E2E pago/rollback; gates completos.
- [ ] T1145 Actualizar tasks/CURRENT_STATE/docs relevantes, revisar diff, UN commit y árbol limpio.

### Evidencia durable del corte

- HEAD inicial / commit final: pendiente.
- Archivos y decisiones técnicas: pendiente.
- Comandos/tests/gates y resultados: no ejecutados.
- E2E happy/unhappy: no ejecutado; registrar causa si no disponible.
- Pendientes y siguiente paso exacto: ejecutar solo este corte con su task.

## Cierre de feature

- [ ] Todos los cortes implementados con un commit cada uno y gates verdes.
- [ ] Self-tests happy/unhappy ejecutados y evidencias registradas, sin pendientes ocultos.
- [ ] Publicación explícita 1.1 documentada; rollback 1.0 comprobado.
- [ ] Estado global y contratos actualizados; decisión de pago señalada para Obsidian.

Fin del pipeline significa rango ejecutado, no readiness funcional automática.
