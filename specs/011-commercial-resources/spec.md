# Feature 011 — Recursos comerciales de Jev

**Fecha:** 2026-10-03. **Estado:** SDD preparado; cuatro cortes SIN IMPLEMENTAR.
**Base auditada:** `af3ba71`. Predecesoras: 008, 009 y 010.
Este bootstrap solo prepara documentos, prompts y runner. No contiene videos,
migraciones ni cambios de comportamiento productivo.

## Objetivo y separación de responsabilidades

El administrador configura material entregable desde **Comercial / Jev → Recursos
comerciales**. Jev decide la acción comercial; el CRM selecciona y entrega el
recurso del tenant; el writer redacta texto breve. Knowledge Base conserva
conocimiento factual general. Recursos contiene demos y destinos de cobro:
no copiar su contenido a KB ni usar KB como fuente alternativa de cuentas o demos.
El playbook sigue guardando estrategia e instrucciones, no binarios ni cuentas.

Una organización, un conjunto de recursos para el producto actual. Sin productos,
campañas, DAM, carpetas, etiquetas, búsqueda multimedia ni billing genéricos.

## Historias y criterios por corte

### Corte 1 — Fundación y persistencia

- Modelo con `organization_id NOT NULL`, FK a organización, índices org-first,
  unicidad `(organization_id, slot)` y acceso mediante `scoped()`.
- Slots cerrados y estables:

| Slot | Archivo que el operador subirá después |
|---|---|
| `demo_enrollment_panel` | `demo-matricula-panel.mp4` |
| `demo_payments_balances` | `demo-pagos-saldos.mp4` |
| `demo_online_enrollment` | `demo-matricula-online.mp4` |

- Cada video referencia un `media_asset` del MISMO tenant; ese asset conserva
  metadata y binario en `MEDIA_DIR`. No nueva capa de almacenamiento.
- Preparar configuración opcional de transferencia (hasta cinco cuentas), Yape
  y link de pago según `contracts/resources.md`. Vacía significa no configurada.
- Migración aditiva re-ejecutable, validadores y store; sin UI, endpoints públicos
  nuevos, envío, cambios de prompts/acciones ni comportamiento de Jev.
- No sembrar cuentas, URLs ni videos; no importar ni commitear los MP4 reales.

### Corte 2 — Operación mínima desde la UI

- Sección Recursos comerciales dentro de Comercial / Jev, sin reconstruir el
  editor Config/Preguntas, Publicar/Guardar, historial ni Prueba rápida.
- Tres filas con slot, estado, nombre/tamaño y subir/reemplazar MP4; preview
  autenticada por la ruta media existente. Sin requisito de nombre exacto:
  el slot identifica el propósito, el archivo es reemplazable.
- Transferencias, Yape opcional y link HTTPS opcional configurables mediante
  campos mínimos y guardado explícito. No secretos/API keys/credenciales bancarias.
- Cargar localmente sin conversación ni credenciales WhatsApp y SIN llamar Graph.
  Reiniciar la app conserva configuración y archivos en el volumen persistente.
- Validación servidor: MP4 real no vacío, MIME `video/mp4`, tamaño no superior
  al límite nativo existente (hoy 16 MiB). Rechazar formatos falsos/oversized:
  no fallback a documento, no transcodificación. Compatibilidad de codecs se
  comprueba con el archivo real durante verificación; no prometer validarla solo
  leyendo extensión/MIME. UI explica preparar MP4 compatible si Meta lo rechaza.
- Reemplazo publica la referencia nueva solo cuando disco+BD estén listos;
  un fallo conserva el recurso anterior. No borrar assets usados por mensajes.
- Tenant y autorización según patrón de configuración autenticada vigente;
  org sale de sesión, nunca del body. Errores claros sin rutas ni secretos.
- Hasta cerrar este corte Jev sigue respondiendo como antes.

### Corte 3 — Entrega de demos

| Acción comercial | Tema vigente del prospecto | Slot |
|---|---|---|
| `show_operations_demo` | pagos, saldos, voucher, deuda | `demo_payments_balances` |
| `show_operations_demo` | matrícula, alumnos, operación general, “muéstrame cómo funciona” | `demo_enrollment_panel` |
| `show_online_enrollment_demo` | matrícula online | `demo_online_enrollment` |

- La acción explícita online gana; dentro de operations el pedido vigente de
  pagos gana sobre el genérico. Usar mensajes del prospecto, no menciones del
  vendedor ni un tema antiguo superado; sin nueva llamada a LLM para routing.
- Entregar **un video nativo con caption breve** mediante `sendMediaMessage()`.
  El caption es el texto breve: evita enviar un texto separado antes del video
  y el éxito parcial texto sí/video no. Sin links externos ni documento disfrazado.
- El writer conoce disponibilidad; nunca dice “te envié” si no hay recurso.
  Ausente/inválido/disco perdido: respuesta honesta breve sin inventar enlace,
  no usar otro slot como sustituto silencioso, no registrar demo mostrada.
- `demoShownAt` solo tras completar la entrega correspondiente. Para este contrato
  completar = Graph acepta `/messages` con ID y el sender persiste outbound;
  no significa leído ni reproducido, ni espera un receipt futuro. Fallo upload,
  Meta, persistencia o ventana cerrada no cuenta como demo. No repetir envío
  automáticamente tras error de resultado incierto; mantener dedup inbound actual.
- Conservar precedencia HUMAN/STOP, ventana 24h y opt-in; HUMAN no envía demo.
- Media IA persiste `origin=ai`, `aiGenerated=true` tanto en éxito como fallo;
  no cancelar follow-ups como si fuera respuesta manual. Adaptar el sender
  mínimamente con default de operador compatible; no crear otro sender.
- Sandbox persiste video+caption y resultado simulado solo en filas de prueba,
  antes de cualquier llamada a sender/Graph/upload. Puede actualizar facts del
  caso sandbox tras persistir; jamás facts de leads productivos. Lab y preview
  siguen mostrando caption aunque `message.text` sea null en media real.
- No introducir instrucciones de pago todavía.

### Corte 4 — Instrucciones de pago explícitas

- Nueva acción contractual **`send_payment_instructions`**, distinta de
  `schedule_call`. Jev la elige ante confirmación explícita de querer pagar;
  preguntar precio, hablar de saldos de alumnos o un voucher de demo NO basta.
- Actualizar contrato, normalización, resolver, writer, preguntas, playbook y
  editor, expected outcomes de Lab, mocks y tests donde corresponda.
- Compatibilidad explícita de 1.0 (siete acciones) y nuevo 1.1 (ocho); no invalidar
  Published/drafts/archivadas, ni alterar/publicar automáticamente estrategias.
  Detalle obligatorio en `contracts/payment-action.md`.
- Entregar exclusivamente datos configurados del tenant. Render de cuentas,
  Yape y URLs controlado por código desde recursos validados; el LLM no genera
  ni reescribe esos destinos. KB, perfil, transcript e instrucciones editables
  no pueden introducir otros destinos. Mostrar todos los métodos completos
  configurados en orden transferencia → Yape → link; omitir no configurados.
- Sin métodos: respuesta honesta y handoff humano, nunca cuentas/URLs inventadas.
- `paymentInstructionsSentAt` solo después de enviar instrucciones reales
  configuradas (o persistencia simulada del sandbox). No marcar por decisión,
  ausencia de recursos, transición humana ni envío fallido.
- Camino estándar: instrucciones primero y después handoff comercial para
  confirmar pago/implementar; no marcar `won`, activar servicio, verificar voucher,
  cobrar ni confirmar recepción de dinero. Petición de humano/complejidad clara
  conserva prioridad HUMAN y transición sin instrucciones automáticas.
- Handoff se conserva también ante falta de métodos o fallo seguro de envío;
  no dejar automatización de cobro persiguiendo al prospecto.

## Clarificaciones y decisiones del bootstrap

Decisiones técnicas revisables: un recurso por slot/tenant; cambios de recursos
son independientes de draft/publish y aplican al próximo turno; un caption por
video; entrega significa aceptación del sender, no reproducción; acción 1.1
opt-in por publicación del administrador. No valores de cobro reales disponibles:
se cargarán desde UI, sin bloquear la implementación ni inventar defaults.
La selección toma el pedido vigente, con casos de cambio de tema/negación en tests.

El usuario solicita ejecutar primero 1–3 y verificar los videos en producción
antes de 4. El runner permite esa pausa; no despliega ni verifica producción
por su cuenta. La decisión comercial de nueva acción/paso a implementación debe
sincronizarse en Obsidian al cerrar 4, sin duplicar el cerebro en este repo.

## Fuera de alcance y verificación

Sin videos en Git, migración de contenido KB automática, servicios externos
nuevos, DAM, billing/provisioning, campañas masivas, múltiples productos,
refactors generales, nuevo motor de Jev, sender ni laboratorio.

Por corte: tests relevantes y `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
Cortes 2–4 requieren self-test E2E happy/unhappy con app+BD+mocks; UI real por
Playwright en 2, y observar outbound nativo/efectos en 3–4. Si no puede correrse,
registrar causa y estado PENDIENTE; implementación con gates verdes no es READY
punta a punta. No incorporar videos reales como fixtures: generar bytes mínimos
para unit tests y MP4 sintético compatible en volumen/temporal para E2E.
