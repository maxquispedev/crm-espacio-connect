# Research — 011 (base af3ba71, 2026-10-03)

Lectura previa: AGENTS completo, CURRENT_STATE, Constitución 1.3.0, specs
008/009/010, sus planes/tareas, runners sales-playbook/runtime-admin/playground-ux,
media.ts, send.ts, delivery.ts, orchestrator.ts, writer.ts, resolver, schema,
constants, loader, UI Comercial/Jev, KB y suites media/sales/playbook.

## Hallazgos ejecutables

- `media_asset` lleva org, kind, mime, fileSize, fileName, storagePath y estado;
  no exige conversación. `saveMediaFile` escribe en MEDIA_DIR/org/assetId,
  y `/api/media/[assetId]` autentica y scopea; no necesitamos S3 ni nuevas URLs.
- La subida de `/api/conversations/[id]/messages/media` envía: no sirve para
  administración de recursos. Nueva ruta administrativa reutiliza funciones
  locales, nunca uploadGraphMedia en C2.
- `MEDIA_LIMITS.video` es 16*1024*1024 y acepta mp4/3gpp; recursos de esta feature
  se restringen a MP4. validateOutgoing admite degradar a documento con override:
  eso NO corresponde a demos nativas. Tamaño y codec de videos reales desconocidos.
- sendMediaMessage recibe bytes+caption, crea copia saliente y llama upload+Graph;
  devuelve messageId tras aceptación/persistencia, no receipt de entrega al móvil.
  Persiste origin=operator y no aiGenerated: sin adaptación mínima cancelaría
  follow-ups manuales. Conservar default para el composer y marcar IA explícita.
- deliverReply simula solo texto. Orchestrator llama persistDeliveryFacts tras
  deliverReply; marca demoShownAt aunque no exista video. Hay que gobernarlo por
  éxito de entrega media, conservando pricePresentedAt y guards de handoff.
- Sandbox Lab y quick preview comparten sandbox-case y runSalesOrchestratorTurn;
  incluir caption al leer mensajes media para mantener respuesta legible.
- KB: kbEntry qa/block y loadKb/renderKb. Writer hoy indica usar recurso de KB
  para demo. C3 retira esa dependencia de demos; C4 no toma destinos de KB.
- ConfigV1 literal 1.0 y siete keys exactas, writer siete campos requeridos;
  loader reconstruye columnas JSON y valida; UI/API/Lab también fijan catálogos.
  Extender solo NEXT_ACTION_OPTION_KEYS rompería Published y rollback viejos.
- `questions.ts`, fixture `jev-questions-v2.json` y doc §7 están hash-frozen
  a blob canónico upstream. Conservar V2 intacta; extensión explícita V3 para 1.1
  y pruebas nuevas independientes, sin debilitar freeze para conseguir verde.
- Runtime Published está activo por 009; títulos viejos de specs y comentarios
  de orchestrator no reflejan todo el estado. Código y latest CURRENT_STATE mandan.

## Runner

Los tres runners usan TASK_PLAN, funciones heartbeat/run_cut, árbol limpio,
tee+pipefail y checks de exit/HEAD. Reutilizar ese diseño; sustituir mcode por
Codex, timeout externo, incluir END_CUT y logs por ejecución.
`codex exec --help` local confirma --cd y --approve-for-me; esta instalación
no lista --full-auto. Detectar soporte en preflight: preferir --full-auto donde
exista; en esta versión usar --approve-for-me (workspace-write/revisión automática),
sin bypass ni resume. No lanzar exec durante bootstrap. `*.log` ya está ignorado.
