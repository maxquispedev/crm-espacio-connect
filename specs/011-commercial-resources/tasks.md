# Tasks — 011 Commercial Resources

**Estado:** C1 implementado con gates técnicos verdes; BD real y E2E PENDIENTES.
C2 implementado con gate técnico verde / E2E PENDIENTE; C3 implementado con
gate técnico verde / E2E PENDIENTE; **pausa operativa CERRADA con OP1–OP4
cumplidos y evidencia real registrada**; C4 sin iniciar. **No READY punta a
punta**: los self-tests E2E 020/021 y los 4 tests PostgreSQL opt-in siguen
PENDIENTES (sin cambios respecto a C1–C3).
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

**Estado:** IMPLEMENTADO; gate técnico VERDE. BD real / E2E PENDIENTES.
**Commit de este bloque:** `feat(commercial): persistir recursos comerciales`.

- [x] T1111 Modelo/slots/org+media y payload de cobro validado.
- [x] T1112 Store scoped y referencia media mismo tenant.
- [x] T1113 Migración aditiva re-ejecutable y tests de persistencia/aislamiento.
  Aplicación real de migración y constraints PostgreSQL PENDIENTES (4 tests omitidos).
- [x] T1114 Gates completos; evidencia BD real o pendiente explícito.
- [x] T1115 Actualizar tasks/CURRENT_STATE/contrato, revisar diff; cierre en UN commit.

### Evidencia durable del corte — 2026-10-03

- HEAD inicial: `129ff5d11982f84aedeee170c0e2dec0684099ab` (árbol limpio).
  No commit previo del corte en git log. Commit final identificado por el subject
  anterior; su hash se obtiene con `git log -1` al cerrar, sin hash autorreferente.
- Modelo: `src/lib/db/schema.ts`, `ids.ts`; store/validación:
  `src/lib/commercial/{resources,store}.ts`; migración:
  `drizzle/0009_commercial_resources.sql`, journal idx 11. Contrato detallado:
  `contracts/resources.md` (API del store, normalización y límites físicos).
- Decisión técnica: FK compuesta org/media + UNIQUE media(org,id), ON DELETE
  NO ACTION para impedir borrado directo y permitir cascade de organización;
  índices org-first; CHECK slot/shape básico; detalle de cobro por Zod estricto.
  Upsert conserva id/createdAt; no seeds. Disco y metadata verificados tanto
  al guardar como al leer; demo perdida devuelve null, sin modificar fila.
- Constitution Check reevaluado: I/III aislamiento en store y FK; II disco/BD
  propios sin nuevos servicios; IV upsert/migración idempotentes; VI spec previo;
  VII límites documentados; VIII recursos para conversación actual. V gate verde;
  IX sin nueva superficie observable en C1, E2E histórico pendiente. Sin ambigüedad
  comercial nueva. Sin cambio de negocio que sincronizar en Obsidian.
- Tests nuevos: `commercial-resources.test.ts` (51),
  `commercial-resource-store.test.ts` (18),
  `commercial-resource-postgres.test.ts` (4 opt-in, **omitidos**).
  Los unitarios usan schema/ORM/scoped reales y ejecutor BD en memoria;
  filesystem temporal real. No equivalen a PostgreSQL.
- `pnpm --pm-on-fail=ignore exec vitest run tests/unit/commercial-*.test.ts`:
  **69 pass, 4 skipped** (en la ejecución inicial se listaron los tres archivos).
- Regresión seleccionada (media-send, send-media-kind-override, sales-orchestrator,
  sales-writer, sales-resolve-plan, sales-questions-freeze, playbook-*,
  lab-pipeline-real, lab-preview-*): **282/282**, 25 archivos.
- Gate completo ejecutado en orden:
  `pnpm --pm-on-fail=ignore typecheck && pnpm --pm-on-fail=ignore lint && pnpm --pm-on-fail=ignore build && pnpm --pm-on-fail=ignore test`:
  **exit 0**, 1006 pass / 4 skipped, 98 archivos verdes / 1 omitido.
  Lint: 0 errores, 3 warnings preexistentes (anuncio-origen y build-state).
  pnpm sin esa opción falla antes de correr scripts con `unable to open database file`;
  se usó la opción ya documentada en checkpoints previos, sin tocar package/lock.
  Gate con permiso de sockets locales para las pruebas HTTP existentes.
- Logs temporales: `/tmp/commercial-c1-{typecheck,lint,build,test,regression,e2e}.log`.
- `node --check scripts/e2e-selftest.mjs`: **exit 0**.
- Self-test E2E intentado: `pnpm --pm-on-fail=ignore test:e2e`, con overrides
  `APP_BASE_URL=http://127.0.0.1:3000`, `BOT_API_KEY=e2e-local-placeholder`,
  `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL=http://127.0.0.1:3000/api/dev/wa-mock`,
  `OPENROUTER_BASE_URL=http://127.0.0.1:3000/api/dev/ai-mock`,
  `TYPESAFE_JEV_ENDPOINT=http://127.0.0.1:3000/api/dev/jev-mock`.
  **exit 1 antes del setup, ECONNREFUSED** (primer intento sandbox EPERM;
  reintento con sockets autorizados confirmó ausencia de app). Health local 000;
  postgres/psql/pg_isready/docker no disponibles. No WhatsApp ni destinatarios reales.
- **E2E happy/unhappy PENDIENTE**, sin escenarios ejecutados. C1 no crea UI,
  endpoint ni integración runtime; no se amplió el arnés con endpoints de prueba
  fuera de alcance. El self-test de C2 validará la primera superficie observable.
- **BD PENDIENTE**: aplicar/reaplicar migración, FK/UNIQUE/CHECK físicos, borrado
  directo y cascade. La suite opt-in exige host local + BD dedicada
  `commercial_resources_test[_sufijo]`; nunca usa DATABASE_URL productivo.
  Ejecutar con `COMMERCIAL_RESOURCES_TEST_DATABASE_URL` y
  `pnpm --pm-on-fail=ignore exec vitest run tests/unit/commercial-resource-postgres.test.ts`.
- No READY punta a punta. No UI/HTTP/uploads/runtime/prompts/pago Jev ni MP4 reales.
  Siguiente paso exacto: con BD local dedicada, ejecutar la suite opt-in; después,
  en sesión independiente, reconstruir contexto y ejecutar **solo C2**.

## Corte 2 — UI Comercial / Jev → Recursos comerciales

**Estado:** IMPLEMENTADO; gate técnico VERDE. E2E UI/BD/reinicio PENDIENTES.
**Commit de cierre:** `feat(commercial): administrar demos y recursos de cobro`.

- [x] T1121 API administrativa authenticated/org de sesión y upload local.
- [x] T1122 UI mínima tres MP4 + cobro + preview privada sin modificar editor.
- [x] T1123 Validación byte/MIME/tamaño y replacement conservando anterior en fallo.
- [ ] T1124 Tests API/UI y gates completos VERDES; self-test 020 preparado e
  intentado, **E2E happy/unhappy UI real PENDIENTE**, sin escenarios ejecutados.
- [x] T1125 tasks/CURRENT_STATE/contratos/doc de operación actualizados;
  revisión diff y cierre en UN commit, sin marcar cortes futuros.

### Evidencia durable del corte — 2026-10-03

- HEAD inicial: `ceb1438eba5a32782a4401a75c77a4fc520132ef` (árbol limpio,
  guardado en `/tmp/commercial-c2-head`); log sin commit previo de C2.
  Dependencia C1 contrastada: schema/ids, migración 0009 + journal, validadores,
  store y 69 tests verdes; cuatro pruebas PostgreSQL siguen omitidas.
  Commit final identificado por el subject de cierre; hash mediante git log,
  sin hash autorreferente. Una sola implementación, sin runner anidado/deploy/push.
- API nueva: GET/PUT `/api/commercial-resources`, PUT multipart
  `/api/commercial-resources/videos/[slot]`. `withAuth` y org de sesión;
  misma política de Comercial/Jev vigente (miembros autenticados, sin nuevo
  filtro de rol). JSON/form estrictos rechazan org/paths externos. Preview
  reutiliza `/api/media/[assetId]`, con scoped/404 para assets ajenos.
- UI independiente en `agent-client.tsx` junto a `PlaybookClient`: recursos
  disponibles incluso sin playbook, tres uploads/replacements, estado/metadata
  y video privado; hasta cinco transferencias, Yape/link y Guardar cobro explícito.
  Upload no pierde cambios locales de cobro. Config/Preguntas, Guardar/Publicar,
  historial y Prueba rápida conservados; sin writes a ConfigV1/KB.
- Decisión técnica: `saveMediaFile` primero; transacción asset + upsert del
  vínculo usando executor opcional del store existente. MP4 nativo hasta
  `MEDIA_LIMITS.video.maxBytes`, MIME exacto, bytes no vacíos, boxes ISO BMFF
  delimitadas, ftyp compatible, moov/mvhd/track vide y mdat. Esto **no valida
  codec** ni garantiza aceptación de Meta; no document fallback/transcodificación.
  Nuevo asset inmutable; los históricos y lectores concurrentes permanecen.
- Compensación: fallo de disco parcial o rollback BD elimina solo archivo nuevo
  comprobado huérfano. Ante commit incierto, no borra si el asset existe; si BD
  no permite probar ausencia, conserva archivo y responde 500 controlado.
  Podría requerir limpieza posterior de ese huérfano; no GC ni borrado a ciegas.
  Mensajes de API sin rutas/secretos. Fallo reconocido antes de commit conserva
  vínculo anterior; resultado incierto invita a recargar, sin promesa falsa.
- Constitution Check reevaluado: I/III sesión/scoped/FK y preview privada;
  II PostgreSQL/MEDIA_DIR propios; IV upsert y sender/webhook intactos;
  VI spec/plan/tasks previos; VII compensación incierta documentada;
  VIII administración para producto actual; V gate verde; IX **pendiente**.
  Sin nueva decisión comercial que sincronizar en Obsidian.
- Tests nuevos: `commercial-resources-api.test.ts` **26** (handlers/withAuth,
  ORM/scoped/store/FS y preview reales, ejecutor BD/auth simulados),
  `commercial-resources-ui.test.ts` **8** (JSX real renderizado y proyección
  cobro/error). Cubren todos los slots y reemplazos, pago vacío/completo/partial,
  firma falsa/audio-only/MIME/oversized/límite exacto, disco parcial, rollback
  BD, commit incierto, BD inaccesible, concurrencia y tenants/sin sesión.
  Estos tests **no equivalen a conducir UI con Playwright ni a PostgreSQL real**.
- `pnpm --pm-on-fail=ignore exec vitest run tests/unit/commercial-*.test.ts`:
  **103 pass / 4 skipped**, 4 archivos verdes / 1 omitido.
- Regresión media-send, send-media-kind-override, sales-orchestrator, sales-writer,
  sales-resolve-plan, sales-questions-freeze, playbook-*, lab-pipeline-real,
  lab-preview-*: **282/282**, 25 archivos.
- Gate completo, en orden, exit 0:
  `pnpm --pm-on-fail=ignore typecheck && pnpm --pm-on-fail=ignore lint && pnpm --pm-on-fail=ignore build && pnpm --pm-on-fail=ignore test`.
  **1040 pass / 4 PostgreSQL skipped**, 100 archivos verdes / 1 omitido;
  lint 0 errores / 3 warnings preexistentes (anuncio-origen/build-state).
  pnpm usa la opción del checkpoint anterior por fallo del gestor fuera del
  script; sin cambios de package/lock. Gate con sockets locales autorizados
  para las pruebas HTTP existentes.
- Arnés extendido **020**, siguiente número libre: UI real Playwright,
  upload+replacement+preview reproducible de cada slot, cobro explícito y
  recarga, campos parciales y archivos inválidos, aislamiento, sin sesión,
  ConfigV1/KB intactos y cero mensajes/Graph. BD local dedicada obligatoria,
  mocks; ejecución aislada `E2E_SECTION=020` evita setup de conexión WhatsApp.
  Reinicio opcional por argv explícito del entorno de pruebas; si falta,
  imprime PENDIENTE, sin contar recarga como reinicio.
- `node --check scripts/e2e-selftest.mjs` y
  `node --check scripts/e2e-commercial-video.mjs`: **exit 0**.
- Self-test intentado: `E2E_SECTION=020 pnpm --pm-on-fail=ignore test:e2e`,
  con `APP_BASE_URL=http://127.0.0.1:3000`, DATABASE_URL local dedicado
  `commercial_resources_test_c2`, WA_MOCK_ENABLED=true, BOT_API_KEY placeholder
  y Graph/LLM/Jev hacia mocks localhost (comando completo en quickstart).
  **exit 1 antes del setup**, ECONNREFUSED 127.0.0.1:3000. Primer intento
  sandbox EPERM; reintento con sockets autorizados confirmó app ausente.
  Sin postgres/psql/pg_ctl/docker disponibles. Ninguna llamada WhatsApp real.
- Fixture H.264 sintética: generador **solo de tests**
  `scripts/e2e-commercial-video.mjs`, salida `/tmp` y ffmpeg/libx264 del entorno
  (sin dependencia nueva de app). `node scripts/e2e-commercial-video.mjs`:
  **exit 1**, ffmpeg ausente; generación/reproducción **PENDIENTES**.
  Ningún video real o sintético binario en Git. No transcodificador en runtime.
- Logs `/tmp/commercial-c2-{typecheck,lint,build,test,targeted,regression,e2e,video}.log`.
- **No READY punta a punta**. Siguiente paso exacto: provisionar app+PostgreSQL
  local dedicado+mocks+Chromium/ffmpeg, aplicar y repetir migración/suite opt-in
  de C1, ejecutar sección 020 por quickstart incluyendo reinicio administrado,
  registrar evidencia real; después reconstruir contexto en sesión nueva para
  **solo C3**. No se inició C3 ni se modificaron acciones/respuestas Jev.

## Corte 3 — Entrega automática de demos nativas

**Estado:** IMPLEMENTADO; gate técnico VERDE. E2E happy/unhappy PENDIENTE.
**Commit de cierre:** `feat(sales): entregar demos como video nativo`.

- [x] T1131 Routing puro de demos por acción y pedido vigente.
- [x] T1132 Sender media reutilizado, caption breve y origen IA compatible.
- [x] T1133 Sandbox media local, disponibilidad/fallos seguros y facts tras video.
- [ ] T1134 Tests de entrega/facts/guards y gates completos VERDES; self-test 021
  extendido e intentado, **E2E happy/unhappy PENDIENTE**, sin escenarios ejecutados.
- [x] T1135 tasks/CURRENT_STATE/contratos/docs actualizados; diff revisado y
  cierre en UN commit atómico. Hash por subject/git log, sin hash autorreferente.

### Evidencia durable del corte — 2026-10-03

- HEAD inicial limpio: `73ab8ec82bfe8bb0c2a2106c45054a837224c929`, guardado en
  `/tmp/commercial-c3-head`. Log sin C3 previo; C1/C2 contrastados con schema,
  store scoped, validación MP4, persistencia local y API/UI administrativa reales.
  Sus pendientes PostgreSQL/E2E siguen abiertos, no faltan dependencias de código.
- Archivos clave: `src/server/sales/{demo-routing,demo-resource,orchestrator,writer}.ts`,
  `src/server/ai/delivery.ts`, `src/server/inbox/send.ts`,
  `src/server/lab/sandbox-case.ts`, tests `sales-demo-*`, sender/orchestrator/writer
  y Lab/preview; `scripts/e2e-commercial-demos.mjs` y dispatch 021 del arnés existente.
- Selección pura desde turnos del prospecto: payments para pagos/saldos/voucher/deuda
  vigentes; panel para matrícula/alumnos/general; online tiene prioridad por acción
  explícita. Último tema relevante, negaciones y menciones del vendedor probados.
  Regla léxica limitada a este routing, sin decisión LLM nueva ni productos nuevos.
- Store/asset scoped + bytes locales revalidados antes del writer. Disponibilidad
  explícita; caption máximo 300 caracteres, sin enlaces ni afirmación de envío pasado.
  Sender existente inferido como video/mp4, sin texto previo ni documento. Media IA
  `origin=ai`, `aiGenerated=true` en éxito/fallo; default operador compatible.
  prepareSend conserva guard is_test/ventana y no se cancelan follow-ups como manual.
- DemoShownAt requiere media aceptada por Graph y persistida, o media+caption
  persistidos en transacción sandbox. Texto honesto por ausencia/disco perdido no
  cuenta ni programa after_demo; fallo de upload/Meta/ID/disco/persistencia/ventana
  no marca fact ni reintenta. Ventana aplica handoff vigente; HUMAN/STOP, opt-in,
  precio y follow-ups conservados. Sin payment action ni entrega de cobro.
- Sandbox copia asset/bytes y persiste video+caption antes de sender/upload/Graph;
  lectura tenant-safe proyecta caption para Lab/preview. Cleanup solo elimina copias
  marcadas de conversaciones is_test del tenant; conserva recursos fuente.
  Compensación no borra ante commit incierto. No WhatsApp ni destinatarios reales.
- Constitution Check: I/III scoped y joins tenant-safe; II almacenamiento/sender
  propios, sin servicios nuevos; IV webhook y no retry; VI spec previo; VII fallos
  seguros; VIII conversación actual. V verde; IX **E2E pendiente**. No cambia decisión
  comercial que sincronizar en Obsidian; pausa operacional del spec sigue pendiente.
- Tests nuevos routing/caption **26** y pipeline demo **17**: orquestador/resolver,
  store/FS/delivery/sender reales, mocks de estado/Jev/writer/Graph/upload y executor
  BD en memoria, **no PostgreSQL real**. Limpieza sandbox verificada:
  elimina copia propia, conserva fuente y archivo de tenant B (**17/17**). Cubren tres slots, video/caption/origen,
  fact posterior, tenants A/B, fallos y sandbox con spies cero red. Regresión
  Lab/demo de ocho archivos **123 pass**; preview/routing **46 pass** tras ajustes.
- Gate completo en orden, **exit 0**:
  `pnpm --pm-on-fail=ignore typecheck && pnpm --pm-on-fail=ignore lint && pnpm --pm-on-fail=ignore build && pnpm --pm-on-fail=ignore test`.
  **1093 pass / 4 PostgreSQL skipped**, 102 archivos verdes / 1 omitido.
  Lint 0 errores / 3 warnings previos (anuncio-origen/build-state). Sin cambios de
  package/lock. Primer gate con sandbox alcanzó types/lint/build verdes, tests HTTP
  con EPERM; repetición completa con sockets locales autorizados terminó exit 0.
- `node --check scripts/e2e-selftest.mjs` y
  `node --check scripts/e2e-commercial-demos.mjs`: **exit 0**.
- Self-test 021 preparado: app+PG dedicados+mocks HTTP, inbound/pipeline real,
  tres slots observando video+caption en outbox/hilo y fact; rechazo media y ausencia
  sin fact, preview caption sin Graph. No se considera un 2xx/snapshot como entrega.
  Comando exacto en quickstart: `E2E_SECTION=021 pnpm --pm-on-fail=ignore test:e2e`
  con APP_BASE_URL localhost:3000, BD local `commercial_resources_test_c3`,
  WA_MOCK_ENABLED=true, BOT_API_KEY placeholder y Graph/LLM/Jev localhost:3033.
  **exit 1 antes del setup: ECONNREFUSED :3000**, tras autorizar sockets; primer
  intento EPERM. App ausente; postgres/psql/pg_ctl/docker/ffmpeg no disponibles.
  Ningún escenario happy/unhappy ejecutado, ningún MP4 generado ni codec probado.
- Logs temporales `/tmp/commercial-c3-{typecheck,lint,build,test,e2e}.log`.
- **No READY punta a punta**. Próximo paso exacto: provisionar entorno local
  app+PostgreSQL dedicado+mocks+ffmpeg/Chromium, verificar pendientes C1/020 y
  ejecutar 021 según quickstart; registrar evidencia. Mantener **PAUSA tras C3**
  para verificar los tres MP4 reales en producción mediante operación autorizada,
  sin deploy en esta sesión. OP1–OP4 y C4 sin iniciar; no runner/codex anidado.

## Pausa operativa tras 1–3

- [x] OP1 Tres MP4 reales subidos desde UI, ningún binario real en Git.
- [x] OP2 Persistencia tras reinicio/redeploy observada con MEDIA_DIR persistente.
- [x] OP3 Tres videos reproducibles como nativos WhatsApp; registrar fecha,
  entorno y evidencia sin PII, destinatario autorizado y volumen mínimo.
- [x] OP4 Degradación sin asset y sandbox sin WhatsApp real verificados.

Esta comprobación no la ejecuta el runner ni autoriza despliegue automático.
No bloquear datos técnicos en defaults imaginarios; no afirmar READY sin evidencia.

### Evidencia durable de la pausa operativa — 2026-10-03

Evidencia operativa aportada por el operador, ya verificada. Esta sesión solo
registra los resultados; no repite envíos, despliegues ni pruebas productivas.

**OP1 CUMPLIDO — tres MP4 reales subidos desde la UI de Vende Veloz 365.** Los tres
slots quedaron poblados con material real mediante la pantalla Comercial / Jev →
Recursos comerciales, no por SQL ni por copia al contenedor:

| Slot | Contenido real subido |
| --- | --- |
| `demo_enrollment_panel` | matrícula y panel |
| `demo_payments_balances` | pagos y saldos |
| `demo_online_enrollment` | matrícula online |

Ningún MP4 real fue agregado a Git. Verificado de forma independiente en este
registro: `git ls-files` no devuelve ningún `.mp4`, `.mov`, `.m4v` ni `.webm`
(versionado), y `.dev-media/` sigue ignorado por `.gitignore`. El arnés de E2E
genera su fixture sintético en `/tmp` por diseño, nunca en el repositorio.

**OP2 CUMPLIDO — almacenamiento persistente corregido y verificado.** Se detectó
que producción **no tenía persistent storage configurado**, de modo que `MEDIA_DIR`
resolvía contra el sistema de archivos efímero del contenedor y todo lo escrito se
perdía en cada redeploy. Corrección aplicada y verificada, en este orden:

- Se creó un volumen persistente en Coolify montado en `/data/media`.
- Se configuró `MEDIA_DIR=/data/media`.
- Escritura verificada como usuario `vocero`.
- `persistence-test.txt` **sobrevivió a un redeploy** completo.
- Después se subió un video comercial y se recibió una imagen real por WhatsApp.
- **Ambos siguieron visibles después de otro redeploy**.

Esto confirma operacionalmente, no solo por configuración, que la media de
conversaciones y los recursos comerciales usan almacenamiento persistente. Es
además el mismo camino que ya describían `docs/playbook.md` ("MEDIA_DIR debe estar
en un volumen persistente para sobrevivir redeploy") y la guía de `.env.example`
("En Coolify: montar un persistent storage en /data/media y poner esa ruta aqui"),
que hasta ahora no se había aplicado en producción.

**OP3 CUMPLIDO — entrega nativa en WhatsApp verificada.** Entorno: producción
controlada de la organización Vende Veloz 365, con destinatario autorizado de
prueba. **No se registró teléfono ni dato PII en este repositorio.** Los tres
recursos se enviaron y reprodujeron correctamente como **video nativo de WhatsApp**:

- matrícula y panel · pagos y saldos · matrícula online.

No llegaron como enlaces ni como documentos: llegaron como video reproducido, que
es exactamente el contrato de C3 (`sendMediaMessage` con MIME `video/mp4`, sin texto
previo ni documento de respaldo). Se verificó además que el **routing por intención
funciona**: la intención elegida determina el slot, con prioridad de la acción
explícita online. Los **captions se verificaron** y posteriormente se publicó V3.

**OP4 CUMPLIDO con evidencia combinada — degradación y aislamiento de red.** La
verificación de este punto es combinada y deliberadamente no destructiva:

- La **Prueba rápida / Laboratorio se ejecutó como sandbox**, sin envío real a
  WhatsApp. La cobertura de aislamiento de Graph se registra en los tests de C3.
- Los **tests verdes del Corte 3** cubren los cuatro modos de degradación que
  exigía este punto: ausencia de asset, fallo de media, ventana/fallo sin
  `demoShownAt` marcado, y sandbox sin llamadas Graph/WhatsApp reales.
- **No se destruyó ningún recurso productivo** únicamente para provocar un fallo
  artificial.

**PENDIENTES que esta pausa NO cierra (se mantienen explícitamente):**

- **E2E 020** (happy/unhappy de UI real, upload/reemplazo, preview, cobro y
  persistencia tras reinicio) con PostgreSQL + ffmpeg/libx264 + Chromium.
- **E2E 021** (inbound → pipeline real → video+caption en outbox/hilo → fact, y
  unhappy) con PostgreSQL + ffmpeg/libx264 y el proveedor HTTP mock local.
- Los **4 tests PostgreSQL opt-in** de
  `tests/unit/commercial-resource-postgres.test.ts`, omitidos por falta de BD local
  dedicada.

**Por estos pendientes NO se declara READY punta a punta.** La pausa operativa
resuelve la verificación en producción, que es un objetivo distinto del self-test
local automatizado: complementan la evidencia, no la sustituyen.

### Hallazgo operativo — causa de la pérdida histórica de imágenes y adjuntos

- **Causa raíz**: `MEDIA_DIR` sin almacenamiento persistente. El directorio de
  media existía y la aplicación escribía correctamente en él, pero al residir en
  el sistema de archivos efímero del contenedor, **cada redeploy borraba el
  contenido**. Esto explica el síntoma histórico de imágenes y adjuntos que
  desaparecían.
- **Corrección operativa**: montar `/data/media` como persistent storage en Coolify
  y configurar `MEDIA_DIR=/data/media`, verificado según OP2.
- **Límite explícito de la afirmación**: esto **previene** nuevas pérdidas hacia
  adelante y queda verificado para archivos nuevos. **NO se afirma recuperación
  automática de los archivos históricos ya perdidos**. Su recuperación no fue
  verificada y queda fuera de este registro.

### Cierre documental de la pausa

- Único commit documental sobre C3: `docs: registrar pausa operativa de recursos comerciales`.
  Ya existía al iniciar esta sesión; se ajusta ese mismo commit sin duplicarlo.
- `git diff --check`: exit 0; revisión limitada a tasks.md y CURRENT_STATE.md.
- C4 sin iniciar; código productivo y contratos de pago sin cambios.
- Gates de aplicación y E2E no ejecutados en esta sesión documental.
- Siguiente paso, fuera de esta sesión: resolver los pendientes locales según
  quickstart.md. STOP tras verificar el único commit y el árbol limpio.

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
