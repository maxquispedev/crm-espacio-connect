# Plan — 011 Commercial Resources

**Estado:** diseño/análisis preparados; implementación no iniciada.
Leer primero spec.md, luego este plan, tasks.md y contratos. Código actual manda.

## Reutilización y evidencia

| Necesidad | Infraestructura vigente | Adaptación prevista |
|---|---|---|
| Binarios durables | `src/server/whatsapp/media.ts`: save/read/deleteMediaFile, MEDIA_DIR | Reutilizar; upload administrativo solo local |
| Metadata | `src/lib/db/schema.ts`: mediaAsset, sin dependencia de conversación | Referencia tenant-safe desde recursos |
| Preview privada | `src/app/api/media/[assetId]/route.ts` | Reutilizar sesión + scoped + 404 cross-tenant |
| Envío nativo | `src/server/inbox/send.ts`: sendMediaMessage, prepareSend | Añadir origen IA compatible en corte 3 |
| Entrega sandbox | `src/server/ai/delivery.ts`: deliverReply | Extensión mínima media local, sin segundo sender |
| Decisión y facts | `src/server/sales/orchestrator.ts`, resolve-plan.ts | Separar éxito de video del mero texto |
| Texto | `src/server/sales/writer.ts` | Disponibilidad/demo caption; pago controlado por código |
| Estrategia | `src/lib/sales/playbook/*` | Recursos fuera de versiones; 1.1 en corte 4 |
| UI | agent-client.tsx y playbook/playbook-client.tsx | Sección mínima en Comercial / Jev |
| KB factual | kbEntry, `/api/kb`, renderKb | Sin duplicación ni fallback de destinos |
| Pruebas | tests/unit/media-send, sales-orchestrator, sales-writer, playbook-* | Extender suites y arnés E2E existentes |

Detalles del estado auditado y riesgos: research.md. No copiar prohibiciones
históricas de 008–010 que impedirían el alcance explícitamente autorizado de 011.

## Diseño por dependencias

1. **Fundación:** tabla `commercial_resource` con slots cerrados y payload tipado;
   contratos Zod compartidos donde haga falta, store tenant-scoped y migración
   según mecanismo real de `drizzle/` (elegir siguiente número disponible;
   011 es número de feature, no forzar número de migración).
   Referencia de video validada contra media del mismo tenant antes de escribir;
   preferir FK compuesta org/id si encaja con schema/migración; en todo caso
   demostrar rechazo cross-tenant en store y lecturas. No HTTP/UI/runtime.
2. **UI/API:** endpoints dedicados `/api/commercial-resources` y
   `/api/commercial-resources/videos/[slot]`, mínimos según contrato. Reusar
   storage, validación nativa y lectura privada; no reutilizar endpoint de envío
   del inbox para subir porque envía WhatsApp y exige conversación. Nuevo asset
   inmutable por reemplazo, compensación de escritura parcial, referencias
   actualizadas atómicamente. Mantener assets anteriores que puedan tener lectores
   concurrentes/mensajes; GC genérico fuera de alcance.
3. **Demos:** helper puro de selección por acción+pedido vigente; lectura scoped
   del recurso y bytes; writer informado de disponibilidad; entrega caption+video
   por sender existente o persistencia sandbox; facts y scheduling solo tras
   resultado correspondiente. Guard media IA evita cancelación de follow-ups
   manuales. Respuesta segura si falla sin segundo envío automático incierto.
4. **Pago:** evolución contractual 1.1 según contracts/payment-action.md;
   preguntas Jev para elegir acción explícita, normalizer/resolver/writer/editor
   compatibles; destinos renderizados por código; entrega primero y fact/handoff
   después. Preservar escalación prioritaria, opt-in, dedup y guards actuales.

## Constitution Check — antes y después del diseño

| Principio | Resultado y evidencia de diseño |
|---|---|
| I Seguridad | PASA: auth/session, sin secretos ni rutas públicas, links no ejecutados |
| II Soberanía | PASA: PostgreSQL + MEDIA_DIR + adaptador Meta existente; guardar link no integra billing |
| III Tenant | PASA: org NOT NULL, índices org-first, scoped y vínculo media propio |
| IV Idempotencia | PASA: unicidad slots y upserts; dedup inbound intacto, sin reintentos de envío ciegos |
| V Calidad | PASA diseño: gates + tests + evidencia durable; todavía NO ejecutados para feature |
| VI Spec previo | PASA: documentos antes de cuatro commits de implementación |
| VII Trazabilidad | PASA: clarificaciones explícitas y research con compatibilidad |
| VIII Foco | PASA: demos/cobro para conversación actual, sin productos/DAM/billing |
| IX En vivo | PASA diseño: self-test happy/unhappy por corte observable; ejecución pendiente |

Sin violaciones ni excepciones constitucionales. Reevaluar en cada corte.

## Análisis de consistencia (fase analyze)

- C1 define datos que C2 administra; C3 usa únicamente videos; C4 usa cobro.
- C1/C2 no alteran respuestas Jev; C3 conserva siete acciones; C4 introduce octava.
- Riesgo crítico: extender catálogo global sin compatibilidad hace inválida
  cualquier Published 1.0. Resolver por versión, no relajar keys arbitrariamente.
- Riesgo crítico: media actual origin=operator cancela seguimientos; default
  compatible + tests de ambos orígenes es parte de C3, no refactor general.
- Riesgo crítico: `demoShownAt` actual prueba solo éxito de texto; nuevo gate
  requiere video enviado/simulado y jamás fallback textual.
- MEDIA_DIR y MP4 deben sobrevivir redeploy; no confiar en Graph como storage.
- No existe verificación productiva en bootstrap. La pausa 1–3 permite observar
  los tres videos reales antes de habilitar la acción de pago en una Published 1.1.

## Loop y cierre

Un corte = una sesión NUEVA de `codex exec` = un objetivo = UN commit.
No resume/fork/continuidad. Ejecutar desde Bash/WSL raíz, fuera de Codex.
Runner derivado de los tres runners existentes, con GNU timeout, tee y heartbeat,
START_CUT/END_CUT y checks de árbol/HEAD. Comandos y recuperación: quickstart.md.
Cada sesión actualiza tasks y CURRENT_STATE, docs de dominio si cambia contrato,
revisa diff, commitea una vez y se detiene. Nunca deploy automático.
