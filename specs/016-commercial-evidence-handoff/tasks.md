# Tasks / handoff

- [x] Contexto, spec, clarify, plan, analyze, Constitution Check.
- [x] Conocimiento y reglas runtime/bootstrap.
- [x] Señal de evidencia writer, resolución y handoff previo a envío.
- [x] Regresión Roberto/unknown/known/contexto/errores/tenant/sandbox.
- [x] typecheck/lint/build/test.
- [x] E2E comercial happy/unhappy y compatibilidad 015.
- [x] Docs, evidencia, checkpoint y commit.

Base limpia: hotfix 015 validado. Producción no modificada en esta sesión.

## Evidencia — 2026-10-05

Base `9d35d84` (hotfix 015 validado). Commit de cierre (consultar git log):
`fix(sales): hand off unsupported commercial questions silently`.

Causa raíz en el repo: bootstrap Published omitía asistencia en core_jobs;
fallback solo tenía mención genérica. Jev no recibía KB; writer solo devolvía
text y no podía señalar insuficiencia material, por lo que el sender podía
recibir una respuesta de incertidumbre. No se inspeccionó ni reescribió la BD
productiva para afirmar su contenido. Ahora el conocimiento runtime protege
Published antiguas de Vende Veloz, y el writer responde capacidades conocidas
antes de una pregunta aun con instrucciones antiguas.

Knowledge confirmado en código del producto `clientes-vendeveloz365@c3928c6`:
AccessControl.php lookup, registerAttendance y vista access-control.blade.php.
DNI exacto / nombre / apellido, selección/confirmación, registro y consumo de
sesión si el plan no es ilimitado. Referencias precisas en spec.md. No hardware
ni biometría prometidos, ni asistencia movida de prioridad terciaria.

Unknown: regla runtime next_action/needs_human_call en Jev + commercial_evidence
en writer (fuentes producto/política/oferta/KB scoped). Resolver pequeño
commercialEvidenceHandoff convierte la señal en plan efectivo antes de persistir
pipeline/enviar. applyHandoff(commercial) existente conserva silencio y pending;
handoff_at mantiene pausa (no depende de ai_enabled=false). Snapshot conserva
propuesta Jev y commercialEvidenceReason. No follow-ups/facts de entrega en unknown.

Pruebas: regresión Roberto (Precio → S/247 → incluye → asistencia), unknown
incluso con texto de incertidumbre propuesto, known pagos/matrícula/marcación,
KB conocida, falta contexto, clasificación ausente/incorrecta, proveedor fallando,
HUMAN/UI, IA pausada, tenant, sandbox y protección de won. Tests en
sales-writer, sales-demo-delivery y sales-commercial-evidence. Freeze upstream
continúa intacto; tests del bootstrap reconocen los criterios autorizados nuevos.

E2E comercial 028: **32/32**, exit 0. App Next local, PG 18.4 en base exclusiva
`commercial_resources_test_hotfix`, proveedores HTTP mock :3033, webhook →
writer/orquestador/sender reales → outbox WhatsApp mock y mensajes del hilo.
Playwright condujo /inbox, fila Por atender y panel Atención humana. No solo SQL.
Published fixture omite asistencia deliberadamente y aun así ambos proveedores
reciben el conocimiento correcto. Camino infeliz (clasificación ausente/503)
escala silencioso. Preview sandbox unknown conserva text=null y cero Graph.

Compatibilidad 015 / demos E2E 021: **44/44**, exit 0; A–E, entrega nativa,
recurso ausente/rechazo y sandbox. Solo se actualizó su mock al nuevo contrato
de evidencia; la lógica del 015 no se modificó. Misma compatibilidad de formato
en el mock de scripts/e2e-follow-ups.mjs; ningún runtime de seguimiento tocado.

Comandos E2E (solo con app levantada y env local dedicado):

```bash
E2E_SECTION=028 LD_LIBRARY_PATH=/tmp/browser-libs/extracted/usr/lib/x86_64-linux-gnu PATH=/tmp/hotfix-bin:$PATH node --env-file=/tmp/hotfix.env scripts/e2e-selftest.mjs
E2E_SECTION=021 LD_LIBRARY_PATH=/tmp/browser-libs/extracted/usr/lib/x86_64-linux-gnu PATH=/tmp/hotfix-bin:$PATH node --env-file=/tmp/hotfix.env scripts/e2e-selftest.mjs
```

PG existente se levantó con /tmp/hotfix-pg/start-016.mjs (sin reinicializar).
App: node --env-file=/tmp/hotfix.env node_modules/next/dist/bin/next dev.
Chromium necesitó bibliotecas ya disponibles en /tmp/browser-libs; el primer
intento detectó su ausencia, se corrigió el entorno y se repitió hasta verde.
Fixtures/token/datos exclusivamente locales; sin WhatsApp, Jev ni LLM reales.
Por tanto se valida el contrato y flujo con proveedores simulados, no la
interpretación probabilística de un proveedor real ni la instalación productiva.

Gates: pnpm --pm-on-fail=ignore (launcher normal falla en este entorno, mismos
scripts sin modificar package/lock). typecheck exit 0; lint exit 0 (3 warnings
preexistentes); test exit 0: **1374 pass / 9 skipped**, 118 archivos. Build final exit 0 (advertencia CSS duration preexistente); git diff --check
exit 0. No se ejecutó el E2E general completo ni
se cerraron pendientes históricos. No despliegue ni mutación de Published real.

Constitution Check final: tenant/scoped/opt-in/dedup/is_test y sender único
conservados, sin schema/migraciones/servicios nuevos/precios/oferta/campañas/UI.
Decisión de negocio unknown → humano silencioso a sincronizar en Obsidian.
Siguiente paso exacto: desplegar el commit por el mecanismo habitual; sin
migración nueva ni republicación requerida. Luego validar interpretación de
preguntas por los proveedores reales en el Laboratorio sandbox (no es una
verificación ejecutada en esta sesión).
