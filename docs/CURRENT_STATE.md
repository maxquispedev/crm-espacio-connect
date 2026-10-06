# Checkpoint 2026-10-06 — Spec 017: seguridad de mensajería productiva

**Los siete incidentes están implementados, integrated y verificados en vivo.
Gates verdes. E2E 029 55/55.** Cero proveedores reales, cero WhatsApp real,
cero deploy, cero push.

Récord durable: `specs/017-production-messaging-safety/` (spec, plan, tasks e
`integration-evidence.md` con el entorno exacto y los límites).

**El contrato que cambia de fondo.** Un `wamid` de Graph significa **pending**, no
entrega comercial. Mensaje y ledger se persisten *antes* del request; el primer
status exitoso `sent`/`delivered`/`read` aplica facts y scheduling en la misma
transacción tenant-scoped. `failed` es terminal para la autorización comercial:
invalida los efectos y jobs ligados a ese outbound, conserva hechos anteriores
independientes y deja atención humana segura, sin retry automático ni LOST. Un
receipt que llega antes de la respuesta Graph se guarda y se reconcilia al ligar
el `wamid`; duplicados y estados exitosos fuera de orden no repiten efectos.

**Media opaca pasa a humano.** Audio, imagen, video, documento, sticker y
ubicación persisten inbound y asset, cancelan seguimientos y producen handoff
silencioso `unsupported_media`: cero Jev, cero writer, cero outbound, cero facts,
cero jobs. Un caption no equivale a interpretar el archivo.

**Turnos frescos.** Cada turno captura el inbound vigente y lo revalida antes de
cada efecto comercial, hecho, movimiento de pipeline y envío — también después
del upload de media. Una ráfaga durante el proveedor deja **una sola** respuesta,
la del último mensaje, tanto en legacy como en orquestador.

**Dirección de mensajes.** Una abstracción servidor única: BSUID va en
`recipient` y nunca en `to`; teléfono normalizado va en `to` y nunca en
`recipient`; las plantillas de autenticación conservan la excepción que exige
teléfono. Nunca se fabrica un teléfono a partir de un BSUID ni al revés, y
sandbox no toca Graph.

**Reservas de demo durables.** UNIQUE `(organization_id, conversation_id, slot)`
reserva el slot antes del video automático: repetirlo —pendiente, fallido o
incierto— falla cerrado con `duplicate_demo` silencioso, sin caption huérfano ni
segundo video. La incertidumbre de Graph no autoriza retry. Slots distintos y el
envío manual conservan sus reglas.

## Verificación ejecutada

| Gate | Resultado |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 — 0 errores, 3 warnings preexistentes |
| `pnpm build` | exit 0 |
| `pnpm test` | **1446 pass / 9 skipped**, 119 archivos pass + 1 skipped |
| E2E 029 (spec017) | **55/55**, exit 0 |
| E2E 021 / 022 / 028 / 020 | **44/44 · 27/27 · 32/32 · 44/44**, exit 0 |

App Next real, webhook HTTP firmado, PostgreSQL 18.4 en base exclusiva
`commercial_resources_test_safety`, proveedores deterministas locales y Chromium
conduciendo la Bandeja. Ningún check verde por status 2xx: se comprueba texto
emitido, payload Graph, contadores, hechos/jobs durables y estado en pantalla.
En PostgreSQL **físico** se observaron los rechazos 23505 (reserva concurrente),
23503 (FK compuesta entre tenants), 23505 (receipt duplicado) y el trigger de
pausa que invalida la autorización pending sin que reactivar IA la recupere.

Migración `drizzle/0011_messaging_safety.sql` aplicada y **re-ejecutable**
(dos corridas seguidas, sin backfill).

**Corrección colateral honesta:** la sección 020 no se había re-ejecutado desde
spec 011 y moría por un locator ambiguo que también resolvía al
`#__next-route-announcer__` de Next. Era arnés, no runtime: commit `89e6ba2`,
ahora 44/44.

## Pendientes que NO son opcionales

1. **Aplicar la migración 0011 en el entorno destino antes de desplegar.** El
   código consulta columnas y tablas que sólo existen después de ella.
2. `020 · persistencia tras reinicio` quedó **PENDIENTE**: check opt-in que exige
   `E2E_COMMERCIAL_RESTART_ARGV_JSON`. No se reporta como ejecutado.
3. Validación semántica de proveedores reales (Jev/LLM) sigue pendiente, igual
   que en 015/016; aquí todo se verificó contra fixtures deterministas.
4. Sin backfill de hechos ni reservas históricas: los mensajes y facts previos no
   se inventan ni se reescriben.
5. T008 **cerrado**: `main` LOCAL ya tiene **un único commit** con todo el Spec
   017 (squash de los commits de los tres workers y del integrador). Árbol
   limpio y ancestry verificados. Sin push, sin deploy, sin limpiar worktrees.
6. La decisión «media opaca → humano silencioso» sigue pendiente de sincronizar
   en el cerebro de negocio (Obsidian); este corte no escribe allí.

Commits identificables del cierre de integración: `89e6ba2` (arnés 020),
`8e1f1c8` (evidencia de integración), `ca0340b` (contrato de entrega en docs de
dominio + runbook 029). Los tres descendientes (`messaging-addressing`,
`messaging-safety`, `messaging-integrator`) quedaron **contenidos** en el
integrador: nada quedó sin commit ni fuera de la integración. Siguiente paso
exacto: aplicar 0011 en el entorno destino y desplegar por el mecanismo habitual.

## Verificación replicada por el coordinador

El coordinador **no heredó** los resultados del integrador: repetió los cuatro
gates, los unitarios de la 017 y los cinco cortes E2E contra el árbol integrado,
con sus propias instancias de app. Resultado **idéntico**:

| Verificación | Resultado |
|---|---|
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | exit 0 los tres (lint: 0 errores, 3 warnings preexistentes) |
| `pnpm test` | **1446 pass / 9 skipped**, exit 0 |
| Unitarios 017 (safety + addressing) | **70/70 pass** |
| E2E 029 | **55/55**, exit 0 |
| E2E 021 / 022 / 028 / 020 | **44/44 · 27/27 · 32/32 · 44/44**, exit 0 |
| Migración 0011 | aplicada y re-ejecutable (dos corridas) |

Dos condiciones del **entorno de prueba** (no de código) que hubo que resolver:
Chromium no arrancaba por `libnspr4.so` ausente en el host (se resolvió con
`LD_LIBRARY_PATH` a las libs ya presentes) y `ffmpeg` no estaba en `PATH` para
el MP4 sintético del self-test (binario estático **sólo de prueba**; nada se
añadió a `package.json` ni al runtime). Además, la instancia de app que el
integrador dejó corriendo tenía `.next` corrupto por compartir entre `build` y
`dev`, así que el coordinador levantó instancias propias en puertos limpios. Los
worktrees de los workers **no se tocaron**.

---

# Checkpoint 2026-10-05 — Spec 016: evidencia comercial / handoff silencioso

Conocimiento de Vende Veloz: asistencia de alumnos, control/consumo de sesiones
cuando corresponde, búsqueda por DNI/nombre/apellido y confirmación del registro.
Confirmado en código del producto `clientes-vendeveloz365@c3928c6` (AccessControl).
Bootstrap y runtime protegen Published anteriores sin reescribirlas; asistencia
conserva prioridad terciaria. Precio/oferta/campañas y lógica del hotfix 015 intactos.

Jev recibe KB comercial scoped sin IDs/metadata y reglas de next_action /
needs_human_call. Writer señala `commercial_evidence`; unknown, ausencia de
clasificación o fallo de writer → plan HUMAN/schedule_call antes del envío y
persistencia de efectos comerciales. Handoff existente silencioso marca pending
para Por atender / Atención humana y pausa IA por handoff_at. Sin texto/video,
facts de entrega ni nuevos follow-ups. Capacidades documentadas responden;
falta contexto de academia conserva pregunta. Propuesta Jev original auditada.

Gates finales verdes: typecheck, lint (3 warnings preexistentes), build y test
(**1374 pass, 9 skipped**, 118 archivos). E2E comercial 028 **32/32**, incluye
Roberto, unknown, known, DNI/nombre, contexto, clasificación ausente, 503, pausa
IA, UI real y sandbox. Regresión demos/hotfix 015 E2E 021 **44/44**. App Next +
PostgreSQL exclusiva + proveedores HTTP mock; Playwright condujo /inbox.
**Sin proveedores reales, WhatsApp real, mutación de Published real ni deploy.**
Evidencia/comandos/limitaciones: `specs/016-commercial-evidence-handoff/tasks.md`.

Commit identificable: `fix(sales): hand off unsupported commercial questions silently`.
Siguiente paso: desplegar por el mecanismo habitual; no requiere migraciones
ni republicar playbook. Validación semántica de proveedores reales en sandbox
pendiente; pendientes históricos no relacionados conservados. Decisión comercial
unknown → humano silencioso a sincronizar en Obsidian.

---

# Checkpoint 2026-10-05 — Spec 015: hotfix demos prematuros

Objetivo: anuncio pagos/saldos + «¡Hola! Quiero más información» no envía video;
beneficio breve y UNA pregunta; al expresar problema/pedir demo, video relevante.

Implementación mínima: guard conservador de curiosidad en resolver (sin scores),
regla de evidencia reforzada en bootstrap y state runtime para Published antiguas,
`ad_context` en routing/writer, DTO del panel toma `plan.nextAction`. Snapshot
conserva propuesta Jev y `demoGuardReason`. No migraciones, campañas, pricing ni
oferta. Writer usa respuesta acotada para opener inequívoco; resto conserva LLM.

Verificación: E2E comercial 021 **44/44**, app Next local + PostgreSQL 18.4 en
base exclusiva `commercial_resources_test_hotfix` + proveedores HTTP mock.
A/E texto corto con una pregunta/cero video; B/C demo pagos/saldos; D matrícula;
ambas acciones demo protegidas; API del panel efectiva, facts tras envío,
recurso ausente/rechazo seguro y sandbox sin Graph. Jev mock reproduce propuesta
errónea con necesidad 0.16, intención 0.1 y encaje 0.5. No proveedor real ni
WhatsApp real; **no desplegado**. Evidencia detallada y gates en
`specs/015-demo-opener-hotfix/tasks.md`.

Siguiente paso exacto: desplegar el commit del hotfix por el mecanismo habitual;
no requiere publicar/mutar playbooks existentes ni cambiar configuración comercial.
Es corrección de contrato ya acordado, sin nueva decisión de negocio para Obsidian.
Pendientes históricos de otros specs siguen vigentes. Commit identificable:
`fix(sales): prevent premature demos and route by ad context`.

---

# Checkpoint 2026-10-04 — Spec 014, CUT 8: pulido y regresión (CIERRE DE LOS DOS BLOQUES)

**LOS DOS BLOQUES CERRADOS. GATES EN VERDE, 342/342 CHECKS E2E EN LA APP REAL.**
Commit único: `test(ui): cerrar workspace de Espacio Connect`. Base limpia
`aac083c` (cierre de 014 CUT 7). Árbol limpio.

Cierra a la vez el **spec 013** (cortes 1–5, el workspace operativo) y el
**spec 014** (cortes 6–8, el rebrand y el rediseño). No añade funcionalidad:
revisa lo que dejaron los ocho cortesPrevious y lo deja presentable y operable.

**Objetivo.** Que lo que ya funcionaba se pueda **usar entero**: en un móvil, con
teclado, y sin que un fallo de red diga una mentira.

**Los cuatro fallos reales que encontró esta revisión** (los tres primeros, el
gate no los ve; el cuarto, los encontró el E2E al ejecutarse):

1. **La Bandeja se quedaba en "Cargando…" PARA SIEMPRE si el `fetch` fallaba.**
   `refetchConversations` no distinguía "falló" de "todavía no", y `conversations
   === null` es el estado de carga: una espera que no termina nunca. Ahora hay
   estado de error con su mensaje, `role="alert"` y un "Reintentar" que funciona.
2. **El Pipeline afirmaba un hecho FALSO si el tablero no cargaba.** Con
   `stages === []` pintaba "Este pipeline todavía no tiene etapas" y ofrecía
   "Gestionar etapas": le echaba la culpa a la configuración del negocio cuando
   lo que había pasado era que no se pudo preguntar. Ahora se declara como fallo
   de red, con su reintento.
3. **"Reactivar IA" fallaba en silencio.** El resultado del `PATCH` se
   descartaba: si fallaba, el botón se quedaba pulsado, no pasaba nada y no se
   decía nada. Una acción que falla callada parece que funcionó.
4. **En móvil no había forma de llegar al panel de detalles.** Con el panel
   "abierto" por defecto, el botón solo se pintaba plegado, así que al abrir una
   conversación en un móvil los detalles quedaban fuera de pantalla **sin
   ninguna puerta de entrada**. Callejón sin salida, con los cuatro gates en
   verde. Lo encontró la sección 027 al ejecutarse, no al escribirse.

**Qué se hizo.**

- **Responsive (FR-8.1).** Nuevo `src/components/app-shell.tsx`: columna en móvil
  y fila en `md+`, con el nav como cajón (velo, Escape que devuelve el foco,
  cierre al navegar). La Bandeja pasa a maestro/detalle: lista a pantalla
  completa → hilo con "atrás" → detalles a pantalla completa. En `md+` todo es
  igual que antes. `PageHeader`, Agenda, Contactos, Pipeline y Laboratorio
  en vez de fijar píxeles.
- **Accesibilidad (FR-8.2).** **No existía ninguna regla `:focus-visible`**: solo
  `Button`/`Input`/`Textarea` tenían anillo, y el resto heredaba el del
  navegador, que se dibuja fuera de la caja y lo recorta cualquier ancestro con
  `overflow` —que es la lista y la Agenda—. Ahora hay un anillo global
  `:where(...)`, **dentro** de la caja, con el token `--accent` (sin colores
  nuevos). Los avisos de las tres acciones de 013 se **anuncian**
  (`role="status"`/`role="alert"`), "Elegir fecha" declara si dejó el formulario
  abierto y al abrirlo el foco cae en la fecha.
- **Contraste: medido, no estimado.** `tests/unit/cut8-polish.test.ts` **calcula**
  las ratios leyendo los tokens de `globals.css`, así que no puede mentir. La
  causa común de los seis fallos era la misma: `--accent` es un color de
  **superficie** y se usaba como **texto** — en oscuro eso se hunde (2.57:1,
  2.33:1, 2.20:1). Con `--accent-text`, el token que el proyecto ya usaba para
  texto de marca: 10–12:1.
- **Estados (FR-8.3).** Los dos fallos de carga de arriba, más `aria-busy` en la
  lista y en la Agenda, y la Agenda vacía verificada como estado vacío de verdad
  (explica qué es y qué hacer).

**Gates.** `typecheck` OK · `lint` **0 errores** (3 warnings preexistentes) ·
`build` compiló · `test` **115 archivos / 1335 tests** verdes (+15 nuevos).

**E2E con UI real (Playwright, app + PostgreSQL + mocks), los cinco en verde y
`exit=0`:**

| Sección | Guion | Resultado |
|---|---|---|
| `027` — pulido y regresión de este corte (nueva) | `tests/e2e/027-polish-cierre.md` | **53/53** |
| `026` — los 12 casos del workspace | `013-workspace-verificacion.md` | **121/121** |
| `025` — flujo operativo | `013-flujo-operativo.md` | **84/84** |
| `024` — Agenda | `013-agenda-recordatorios.md` | **49/49** |
| `023` — cola "Por atender" | `013-bandeja-por-atender.md` | **35/35** |

Los **doce** casos mínimos de 013 se **volvieron a ejecutar** sobre el código
final, no se heredaron del corte 5. Ver la tabla en
`specs/013-operator-workspace/tasks.md`.

**Suites opt-in de PostgreSQL: por fin ejecutadas.** Con PostgreSQL disponible en
esta sesión, las dos dejaron de estar "skipped por falta de servidor":
`attention-migration.test.ts` contra `attention_test_cut8` → **11/11 verde**;
`commercial-resource-postgres.test.ts` (de 011) contra
`commercial_resources_test_cut8` → **3 de 4**, reproduciendo exactamente el
defecto que 013 C5 había anotado. **Causa confirmada de primera mano**: el mismo
`INSERT` con el mismo `client.json()`, **fuera** de vitest contra esa misma BD,
**sí** da `23505`. No es el schema ni la BD: es la serialización del parámetro
`jsonb` dentro del entorno de vitest. Sigue sin Owner (es de 011).

**Nada del motor se tocó.** Ni follow-ups, ni worker, ni cadencias, ni plantillas,
ni ningún DTO, endpoint o tabla. `pnpm test` con la lista de
`sales_follow_up_job` intacta y el outbox del mock sin crecer son checks de las
cinco secciones, no promesas. El sandbox del Laboratorio sigue intacto.

**Pendientes honestos.** No se declara READY punta a punta:

1. **Rampa neutra del tema claro por debajo de 4.5:1 para texto pequeño.**
   `--text-3` se queda en 3.22–3.33:1 en claro. Es deuda **preexistente de toda la
   app** (los items del nav y el buscador ya lo usaban), no algo introducido
   aquí: este corte **dejó de añadir casos nuevos** por debajo de ese suelo.
   Cerrarla es re-tunear la rampa neutra —decisión de diseño que afecta a toda la
   superficie visible— y queda **escrito**, con un test dedicado que afirma el
   suelo, en vez de disimulado bajando un umbral.
2. **`commercial-resource-postgres.test.ts`: 3 de 4 verdes** (de 011, causa
   arriba). Sin Owner.
3. **Secciones históricas E2E 020/021/022: PENDIENTES.** No las ejecutó este
   corte y no las toca.
4. **FK compuesta de `conversation_attention`: ABIERTA y sin Owner** (heredada de
   013 C1). Hoy la garantiza la aplicación (`scoped()`), no la base.
5. **Enmienda de la constitución: PENDIENTE FORMAL** (T611, heredado de CUT 6).
6. **Capturas de `docs/screenshots/*.png`**: no re-generadas. La verificación de
   este corte es numérica y por test, no por captura.
7. **Lección de entorno, sigue vigente**: `pnpm build` **pisa el `.next` del
   `next dev`** que esté corriendo. Gates y E2E, cada uno con su app.

**Archivos clave de este corte.** `src/components/app-shell.tsx` (nuevo, el
shell) · `src/app/globals.css` (anillo de foco global) ·
`src/components/inbox/inbox-client.tsx` (maestro/detalle, error de lista,
`patchConversation` con retorno) · `src/components/inbox/conversation-list.tsx`
(error + reintento + contraste) · `src/components/inbox/attention-block.tsx`
(avisos anunciados, "Reactivar IA" con ciclo de vida) ·
`src/components/inbox/reminder-schedule.tsx` (foco, `aria-expanded`, contraste) ·
`src/components/pipeline/pipeline-client.tsx` (error ≠ vacío) ·
`src/components/agenda/agenda-client.tsx` · `src/components/app-nav.tsx` ·
`src/components/page-header.tsx` · `tests/unit/cut8-polish.test.ts` (nuevo, 15
tests) · `scripts/e2e-cut8-polish.mjs` (nuevo, sección 027) ·
`tests/e2e/027-polish-cierre.md` (nuevo, guion legible).

**Siguiente paso exacto para una sesión futura.** Los ocho cortes están cerrados y
el producto es operable en escritorio y en móvil. Lo siguiente **no es un corte de
este bloque**: es (a) ejecutar las secciones históricas 020/021/022, que llevan
pendientes desde antes de 013 y nadie ha ejecutado; (b) decidir dueño para los
tres pendientes sin Owner (`commercial-resource-postgres` de 011, la FK compuesta
de 013 y la enmienda formal de la constitución); y (c) si se quiere cerrar la
deuda de contraste, abrir un corte propio de **sistema de diseño** para re-tunear
la rampa neutra del tema claro, midiendo como este corte midió.

---

# Checkpoint 2026-10-04 — Spec 014, CUT 7: rediseño práctico (CIERRE)

**REDISEÑO PRÁCTICO CERRADO. GATES EN VERDE Y UI REAL VERIFICADA: 240/240 checks
E2E.** Commit único: `refactor(ui): simplificar experiencia de Espacio Connect`.
Base limpia `6907d24` (cierre de 014 CUT 6). Árbol limpio.

**Objetivo.** Que el CRM sea más claro, compacto y agradable para la operación
diaria, con la jerarquía al servicio de *qué tengo que hacer ahora* — y sin tocar
un solo contrato. El sistema de diseño ya estaba maduro (tokens Atlas, `cn`,
`lucide-react`): el trabajo no fue inventar uno, sino **hacer visible la urgencia**.

**Los cuatro fallos que había, y su arreglo.**

1. El nav contaba **no leídas** en vez de la cola. Ahora el badge de la Bandeja es
   `nav-contador-por_atender`, contado con `necesitaAtencionAhora` sobre la misma
   lista que el chip: por construcción no pueden discrepar. Las no leídas siguen
   visibles como chip dentro de la Bandeja, así que no se perdió información.
2. El bloque de estado del panel era **ámbar siempre**. Ahora se tiñe por estado
   (`danger` rojo = por atender, `warning` ámbar = comprometido, neutro = nada
   pendiente), que era el agujero más grande: había trabajo urgente con el mismo
   aspecto que no tener nada que hacer.
3. La etiqueta de estado estaba **triplicada**. Ahora vive en un sitio
   (`inbox/estado-chip.tsx`, `EstadoPill`) y la usan la fila, el panel y la
   cabecera del hilo, que antes no la tenía (con el panel plegado, el estado de
   la conversación abierta era invisible).
4. **Seis pantallas, tres cabeceras.** Ahora una `PageHeader` compartida por
   Agenda, Pipeline, Contactos, Agente, Laboratorio y Configuración: un `h1`, un
   icono, un recuento opcional y una frase subordinada.

**Además:** el nav se agrupa por pregunta ("Tu trabajo" / "Operación"); la fila de
la cola lleva un canto rojo reconocible sin leer; el stepper de etapas del panel
pasa de columna a riel horizontal (mismo manejador, mismos `aria-label`, ~150 px →
dos líneas); el carril humano/IA del Pipeline es una etiqueta con color en vez de
versalitas de 10 px; y el Pipeline dice qué hacer cuando no tiene etapas
("Nadie en esta etapa" ya no es un tablero mudo).

**Gates.** `typecheck` OK · `lint` **0 errores** (3 warnings preexistentes) ·
`build` compiló · `test` **114 archivos / 1320 tests** verdes.

**E2E con UI real (Playwright, app + PostgreSQL + mocks).** `026` **121/121** ·
`025` **84/84** · `023` **35/35**; `exit=0` en los tres. Se añadió un check al
arnés: *el nav cuenta la cola y coincide con el chip y con la API*. Revisión
visual en oscuro y claro con `scripts/screenshot-c7.mjs`.

**Contraste corregido sobre la marcha:** blanco sobre `--danger` en modo oscuro
daba 3.6:1 (por debajo del 4.5:1 de un texto de 10.5 px); con el tono suave en
oscuro sube a 6.6:1 sin cambiar el significado del color.

**Archivos clave.** `src/components/page-header.tsx` (nuevo) ·
`src/components/inbox/estado-chip.tsx` (nuevo) · `src/components/app-nav.tsx` ·
`src/components/inbox/{conversation-list,attention-block,inbox-client,
contact-panel}.tsx` · `src/components/pipeline/pipeline-client.tsx` ·
`src/components/{agenda/agenda-client,contacts/contacts-client,agent/agent-client,
lab/lab-client}.tsx` · `src/app/(app)/settings/layout.tsx` ·
`tests/unit/redesign-practico.test.ts` (nuevo, 8 tests) ·
`scripts/e2e-workspace-verification.mjs` (check nuevo) ·
`scripts/screenshot-c7.mjs` (nuevo, herramienta de revisión visual, no un test).

**Sin cambios de contrato.** `git diff --name-only` no toca `src/lib/types`,
`src/server/` ni `src/app/api/`. Sin dependencia nueva: `package.json` y
`pnpm-lock.yaml` intactos.

**Pendiente para CUT 8.** `text-muted-foreground` sigue en 123 sitios en 21
ficheros apuntando al mismo token que `text-text-3`: es normalización de nombre,
no de jerarquía visual, y quedó fuera a propósito para que el diff de este corte
se pudiera leer. También `letter-spacing: -0.01em` aprieta los espacios alrededor
de los `·` a 11–12 px (visible en Agenda y en las frases de cabecera): es una
decisión del sistema de diseño, no de este corte. Y sigue pendiente lo propio de
CUT 8: responsive, accesibilidad básica y regresión por superficie.

**Siguiente paso exacto.** Abrir **CUT 8 — Polish y regresión final** (T801–T807):
responsive de escritorio primero, foco visible / `aria` / contraste / teclado sobre
lo que este corte tocó, y las regresiones por superficie (Inbox, Pipeline,
Contactos, Agente) contra el mismo arnés 026/025/023, que ya está verde y no hay
que reconstruir.

---

# Checkpoint 2026-10-04 — Spec 014, CUT 6: rebrand a Espacio Connect (CIERRE)

**REBRAND CONSOLIDADO. GATES EN VERDE Y VERIFICACIÓN EN NAVEGADOR REAL: 21/21.**
Commit único: `chore(brand): consolidar Espacio Connect`. Base limpia `a00d169`
(cierre de 013 CUT 5). Árbol limpio.

**Objetivo.** Que la **marca visible** del producto sea **Espacio Connect**, sin
replace ciego. `rg -n -i 'vocero'` dio **231 ocurrencias en 62 ficheros** al
arrancar; quedan **199 en 56**. Se cambiaron **32** y **cada superviviente está
justificada por escrito** en `specs/014-espacio-connect-rebrand/tasks.md`
(FR-6.1, FR-6.7). Sin comportamiento nuevo, sin contratos, sin dependencias.

**Lo que cambió (el producto se llama Espacio Connect)**

- `src/lib/branding.ts`: `DEFAULT_BRANDING.name` → `"Espacio Connect"`. Es **el**
  literal de marca que queda en el código. `normalizeBranding`, los presets de
  acento y el aislamiento por tenant **no se tocaron**.
- `src/components/settings/branding-client.tsx`: el literal estaba **triplicado**
  (placeholder, inicial y nombre de la vista previa); los tres leen ahora
  `DEFAULT_BRANDING.name`. Un rebrand futuro es una edición, no tres.
- `src/components/inbox/contact-panel.tsx`: "El agente de Vocero no responde…"
  → copy **neutral de marca**. No solo quita la marca: arregla un bug de
  white-label, porque aquel texto mentía en cualquier tenant que hubiera puesto
  su propio nombre.
- `src/app/api/dev/wa-mock/graph/[...path]/route.ts`: `verified_name` del mock.
- `README.md`, `INSTALL-IA.md`, `CLAUDE.md`, `tests/e2e/us-bot-api.md` y los
  comentarios de cabecera de `Dockerfile` / `docker-compose.yml`.
- `tests/unit/branding.test.ts`: **la única expectativa modificada**, y era de
  marca visible por definición (FR-6.8). Se le añadió
  `expect(DEFAULT_BRANDING.name).toBe("Espacio Connect")` para que un rebrand
  futuro no pase inadvertido, y **un test nuevo de white-label**. Ninguna otra
  expectativa se tocó.

**Lo que NO se cambió, y por qué (esto es la parte importante)**

1. **La constitución** sigue diciendo "Vocero CRM" (4 ocurrencias). Es norma
   ratificada v1.3.0 con procedimiento de enmienda propio: renombrarla **exige**
   enmienda formal con Sync Impact Report y aprobación del responsable. **Es
   PENDIENTE y es decisión de gobernanza, no de copy** (`tasks.md` T611). No
   bloquea el rebrand: el producto ya es Espacio Connect en todo lo visible.
2. **Cookies y `localStorage`** (`vocero.theme`, `vocero.theme-resolved`,
   `vocero.panelOpen`, `vocero.notifySound`). Renombrarlas **no cambia la marca y
   sí borra la preferencia ya guardada** de cada usuario instalado. Un cambio de
   comportamiento invisible disfrazado de copy.
3. **Volúmenes con nombre y usuario del contenedor** (`vocero_pg`,
   `vocero_caddy_data`, `vocero_caddy_config`, usuario no-root `vocero`, base de
   datos `vocero`). **Renombrar un volumen con nombre deja los datos huérfanos en
   el próximo redespliegue**: es el elemento de más riesgo del repo. Un rebrand no
   es un cambio de infraestructura.
4. **`package.json` `name: "vocero-crm"`** (plan D-1): identificador de paquete,
   no marca visible. Su `description` **ya era neutra**, no había nada que tocar.
5. **Migraciones, specs cerrados (incluido el nombre de carpeta
   `001-vocero-core`), `docs/AUDITORIA_BASE_ESPACIO_CONNECT.md`, checkpoints,
   `.ai/logs/**`**: historia y trazabilidad. Reescribir la auditoría base
   *falsificaría* la auditoría.
6. **Fixtures `@vocero.test` y la BD `vocero_e2e`** del arnés (49 ocurrencias en
   12 guiones): renombrarlos es editar ~50 líneas **y** el arnés, para ganancia de
   producto cero. Es justo el replace ciego que el spec prohíbe.
7. **Símbolos `__vocero*`** en `globalThis` (`auth`, `db`, `rate-limit`, `events/bus`,
   `follow-ups/worker`): caché de singletons en HMR, invisibles.

**Corrección al `plan.md` (para que nadie lo dé por hecho).** El plan listaba como
"marca visible" `src/app/(app)/layout.tsx` y `app-nav.tsx`, y como copy a renombrar
el `description` de `package.json`. **Ninguno de los tres tenía tal cosa**: el
título es `` `${branding.name} — CRM de WhatsApp` `` y login/sidebar renderizan
`branding.name`, así que cambiar `DEFAULT_BRANDING` los renombra a la vez y **por
organización**; y el `description` ya era neutro.

**"EV Connect": deliberadamente no se usa en la UI.** El nombre lo elige cada
organización: un "EV Connect" fijo en la barra lateral **pisaría el white-label**.
La forma corta ya existe y se verificó en pantalla: la inicial que la UI deriva
sola del nombre, **"E"**.

**Gates.** `typecheck` OK · `lint` **0 errores** (3 warnings preexistentes) ·
`build` compiló · `test` **113 ficheros / 1312 tests** verdes (+1: el test nuevo de
white-label), 1 fichero skipped (opt-in).

**Verificación en vivo: EJECUTADA, 21/21, `exit=0`.** App de desarrollo real +
**PostgreSQL real** en `127.0.0.1:55432` (BD desechable `espacio_brand_cut6`,
migrada con `scripts/migrate.mjs` y **eliminada** al terminar) + Chromium real vía
Playwright. Con **navegador de verdad** se comprobó:

- El nombre por defecto "Espacio Connect" en el `h1` del login, en el `<title>` y
  en la **barra lateral**.
- El **white-label por organización sigue funcionando**: tras
  `PUT /api/settings/branding` con `{name: "Vende Veloz 365", accent: "#3f6b66"}`,
  el login, el título, la barra lateral, el input y la vista previa muestran
  "Vende Veloz 365" — y el default **no** pisa al nombre propio.
- **Cero copy visible** "Vocero" en `/inbox`, `/pipeline`, `/contacts`, `/agenda` y
  `/lab`, medido con `innerText` (texto renderizado), que ignora el `<script>` donde
  sí viven las claves de cookie que se conservaron a propósito.

Un detalle de método que conviene guardar: el primer intento de check dio **falsos
negativos**
en tres sitios, y los tres eran culpa del script, no del producto — la marca vive en
el `<aside>` y no en `<nav>`; `textContent` include el `<script>` del tema (y por eso
"contó" 8 `vocero` por página, que son las cookies conservadas); y `networkidle`
nunca dispara en una app con SSE abierto. Corregido y reverificado.

**Precondición de 013 confirmada en vivo** durante la misma corrida: la captura
muestra "Por atender", "Comprometidos" y "Agenda" en la barra lateral. El corte no
toca el workspace.

**Pendientes honestos**

1. **Enmienda de la constitución: PENDIENTE FORMAL** (responsable: el dueño). Es
   lo único que queda de este corte.
2. **`docs/screenshots/*.png`: NO re-generadas.** Son binarios y muestran la
   interfaz anterior; el `alt` de la README sí dice Espacio Connect. Regenerarlas
   es trabajo de CUT 7/8, cuando además cambie el diseño.
3. Los identificadores del punto 2–7 se conservan **a propósito**: tocarlos es un
   corte propio con migración o decisión de datos.

**Archivos clave.** `src/lib/branding.ts` ·
`src/components/settings/branding-client.tsx` ·
`src/components/inbox/contact-panel.tsx` ·
`tests/unit/branding.test.ts` · `specs/014-espacio-connect-rebrand/tasks.md`
(inventario completo por categoría).

**Siguiente paso exacto.** **CUT 7 — Rediseño práctico**, commit
`refactor(ui): simplificar experiencia de Espacio Connect`: shell/sidebar/header
(jerarquía, respiración, acento), Bandeja, tarjetas de estado, Pipeline y
consistencia de labels, **reutilizando tokens y componentes existentes, sin librería
UI nueva y sin tocar contratos ni la lógica de 013**. Su E2E de UI con Playwright
ya tiene el camino probado en este corte (PostgreSQL real en `:55432` + `LD_LIBRARY_PATH`
para Chromium).

---

# Checkpoint 2026-10-04 — Spec 013, CUT 5: verificación del workspace (CIERRE)

**CORTES 1–5 CERRADOS. E2E REAL EJECUTADO EN VERDE: 120/120 checks, tres
corridas seguidas, con la app real, PostgreSQL real y UI real.** Commit único:
`test(inbox): verificar workspace operativo`. Base limpia `4b3c556` (CUT 4).

**Objetivo.** Verificar que el workspace operativo se sostiene **junto** y cerrar
los dos huecos que quedaban: el **handoff real** (el del corte 4 se sembraba por
SQL) y **lead a Cliente / lead a Perdido**, el único caso de la tabla que seguía
PENDIENTE. Sin superficie nueva: este corte no añade ni un estado ni un endpoint.

**Cambios (todo de arnés, guion y dos correcciones)**

- `scripts/e2e-workspace-verification.mjs` (nuevo) + dispatch de
  **`E2E_SECTION=026`** en `scripts/e2e-selftest.mjs`. El nombre propuesto `023`
  ya estaba ocupado: 023 = cola (C2), 024 = Agenda (C3), 025 = flujo (C4).
- `tests/e2e/013-workspace-verificacion.md` (nuevo): guion legible de los doce
  casos, con su estado al empezar y qué mira el "cero Graph".
- `tests/unit/attention-migration.test.ts`: **la capa opt-in de PostgreSQL real
  tenía dos aserciones falsas** y nunca se había ejecutado. Corregidas y
  **11/11 verde**.
- `.gitignore` + `eslint.config.mjs`: `.tmp-org-create.mjs` (ver abajo).
- `specs/013-operator-workspace/quickstart.md`: sección real `026` y el fixture
  por `pnpm org:create`.

**Evidencia por caso — los DOCE, EJECUTADOS en la misma corrida**

| Caso | E2E 026 |
|---|---|
| handoff → Por atender | EJECUTADO — handoff **real**: inbound por webhook → el agente escala solo → `pending`, 2 → 3, y **no manda WhatsApp** |
| abrir no resuelve | EJECUTADO — abrir y cerrar deja la cola en 3 y la fila `pending` |
| reply manual coherente | EJECUTADO — `waiting_client`, 3 → 2, y es lo único que sale |
| recordatorio futuro | EJECUTADO — sale de la cola (2 → 1), Comprometidos 1 → 2, Agenda "programado" |
| inbound antes del vencimiento | EJECUTADO — de inmediato, 1 → 2, y sale de Comprometidos |
| recordatorio vencido | EJECUTADO — en BD sigue `deferred` con fecha pasada: nadie lo movió, la UI lo deriva |
| programar otro recordatorio | EJECUTADO — 2º compromiso + cancelar y volver a comprometer sin duplicar fila |
| reactivar IA | EJECUTADO — `handoff_at` limpio, sale de Comprometidos y de la Agenda |
| Cliente / Perdido | EJECUTADO — `PATCH /api/pipeline/leads/{id}` real; Perdido saca la conversación de la cola |
| aislamiento tenant | EJECUTADO — dos orgs por API y por UI; lead ajeno → 404 |
| cero Graph en recordatorio humano | EJECUTADO — outbox +1 (el reply), **0** jobs creados, **0** mensajes `origin IN (ai,template)` |
| follow-ups sin regresión | EJECUTADO — programar → `wait` → cancelar; 409 `handoff_active` y 409 `human_lane`; 422 fecha pasada |

**Gates.** `typecheck` OK · `lint` **0 errores** (3 warnings preexistentes) ·
`build` compiló · `test` **113 archivos / 1311 tests** verdes (1 archivo skipped
= opt-in sin variable). E2E `026`: `exit=0`, log en `/tmp/e2e-026-green.log`.

**Los cuatro hallazgos fueron de expectativas, no de producto** (detalle en
`tasks.md`): programar un recordatorio **sí** saca de la cola; con recordatorio
vigente el panel ofrece **Cancelar**, no fecha nueva (coherente con el spec);
perder el lead limpia la **tarea**, no la pertenencia (la lista dice "Atención
humana", que el propio copy define como "sin nada pendiente" — reactivar la IA
sobre un negocio cerrado sería peor); y cancelar un seguimiento automático deja
la fila en `cancelled` en vez de borrarla.

**Corrección 1 — la opt-in de PostgreSQL mentía.** Al poder ejecutarla por fin
contra una BD real, falló 2 checks porque **las dos aserciones eran falsas**: la
FK no es compuesta (PostgreSQL acepta `organization_id = A` apuntando a una
conversación de B) y la lectura scropeada **no** la oculta (la fila se declara
de A, así que el scope de A la encuentra). Eso además rompía el test de cascade.
Ahora afirma la realidad y prueba **la garantía que sí existe**: que la app solo
escribe el par que su propio scope resolvió (`markAttentionPending(A, cv_b)` →
`null` y sin fila, con la conversación declarada humana para que el no-op no
venga de otro motivo). **La limitación de schema sigue abierta**: la garantía
vive en la aplicación, no en la base.

**Corrección 2 — `pnpm org:create` rompía `pnpm lint`.** Deja su bundle de
esbuild en `.tmp-org-create.mjs` en la raíz; no estaba en `.gitignore` (ensuciaba
el árbol) ni en los `ignores` de ESLint (5 errores de variables sin usar). Quien
ejecutara ese script documentado rompía el gate. Arreglado en las dos listas, y
la sección borra el artefacto tras usarlo.

**Pendientes (honesto, no cerrados aquí)**

1. **Suite opt-in de 011 `commercial-resource-postgres.test.ts`: 3 de 4.** La
   última aserción (el `INSERT` duplicado, que debería dar `23505`) recibe
   `TypeError [ERR_INVALID_ARG_TYPE]` desde `postgres/src/bytes.js:22` vía
   `Bind`: postgres.js serializa el parámetro `sql.json()` como cadena **dentro
   de vitest**. Los otros tres checks del mismo test sí pasan contra PostgreSQL
   real, y el mismo INSERT fuera de vitest sí da `23505` — no es schema ni
   `upsertCommercialResource`. **No se arregla aquí**: es de 011, no de 013.
2. **Secciones E2E 020/021/022**: sin cambios, siguen PENDIENTES.
3. **FK compuesta de `conversation_attention`**: sigue abierta; exige migración
   propia (`FK compuesta` + `UNIQUE (organization_id, id)` en `conversation`).
4. **Decisión de producto para Obsidian**: con el handoff verificado de punta a
   punta, la pregunta que queda es si la garantía de aislamiento entre
   organizaciones debe bajar a la base (FK compuesta) o si se acepta
   documentada en la aplicación.Hoy es lo segundo, y funciona, pero es
   defensa-en-profundidad a un solo nivel.

**Archivos clave.** `src/server/inbox/attention.ts` · `src/lib/operational-state.ts`
· `src/server/leads/stage-gateway.ts` · `src/app/api/reminders/route.ts` ·
`src/app/api/conversations/[id]/attention/route.ts` ·
`src/server/sales/follow-ups/store.ts` (`scheduleManualFollowUp`) ·
`scripts/e2e-workspace-verification.mjs` · `specs/013-operator-workspace/tasks.md`.

**Siguiente paso exacto.** Ninguno dentro de 013: el spec está cerrado con sus
cinco commits y `tasks.md` no tiene casillas abiertas. Lo que sigue es una
decisión, no una tarea: **abrir un corte de migración para la FK compuesta**
(punto 3) o **declararla aceptada** (punto 4), y en paralelo diagnosticar el
`sql.json()` de la opt-in de 011 (punto 1) desde el spec 011.

---

# Checkpoint 2026-10-04 — Spec 013, CUT 4: flujo operativo / UX integrada

**IMPLEMENTADO, GATES TÉCNICOS VERDES Y E2E DE UI REAL EJECUTADO EN VERDE
(84/84, dos corridas).** Commit único:
`feat(inbox): integrar flujo operativo de atención`. Base limpia `73cd87c`
(CUT 3).

**Objetivo.** Que una persona pueda operar el CRM **sin pensar en estados
técnicos**. Los cortes 1–3 construyeron las piezas (estado durable, cola
"Por atender", Agenda); este corte las conecta y las habla en el mismo
vocabulario. No añade estados ni endpoints de dominio: es flujo y copy.

**Cambios.**

- `src/lib/operational-state.ts` (nuevo, puro): **el vocabulario operativo en un
  solo sitio**, que es lo que hace que lista, hilo y Agenda no puedan
  contradecirse. `estadoOperativo()` deriva de `{attention, aiEnabled,
  handoffAt}`; `estadoDeAtencion()` hace lo mismo desde la fila de atención sola
  (lo que tiene la Agenda, sin inventar una conversación). `ETIQUETA_ESTADO` y
  `EXPLICACION_ESTADO` son el copy. `vencidosDeAgenda()` lee el grupo `overdue`.
  **No recalcula el reloj**: "vencido" llega derivado en `needsAttentionNow`.
- `src/app/api/conversations/[id]/attention/route.ts` (nuevo): `POST`
  `{state: "waiting_client"}` en `.strict()`. Delega en
  `markAttentionWaitingClient` — **la misma función del corte 1** que ya corren el
  envío manual y el eco del dueño, así que "marcar atendido" y "contestar" no
  son dos puertas parecidas sino la misma. 404 ajena, 409 IA/Laboratorio, 422
  cualquier otro estado. Publica `conversation.updated` con el DTO derivado.
- `src/components/inbox/attention-block.tsx` (nuevo): estado + las tres acciones
  (`Marcar atendido` → `waiting_client`, `Recordarme` → `deferred`, `Reactivar
  IA` → limpia). Aparece para **cualquier** conversación del humano; antes, con
  la IA apagada a mano, solo había "Recordarme": sin estado y sin "Reactivar IA".
- `conversation-list.tsx`: la etiqueta de la fila pasa de "atención humana" (solo
  `handoffAt`) al estado operativo compartido. Nuevo chip **"Comprometidos"**
  detrás de "Por atender" → la Bandeja responde las dos preguntas de FR-4.3.
- `app-nav.tsx`: la Agenda lleva **contador de vencidos**, con la misma
  reactividad SSE que el de no leídas. Un refetch en paralelo para los dos
  contadores, independientes: si la Agenda falla, no leídas no se congela.
- `contact-panel.tsx` + `sales-ui.ts`: el motivo del handoff se cuenta en
  castellano dentro del bloque; el lado automático se nombra "Seguimiento
  automático" / "Intentos automáticos" / "Próxima automatización"; y el lane
  `human` del badge de "Venta" pasa de "Atención humana" a "En manos de una
  persona" (decía lo mismo que la etiqueta de estado humano: dos significados
  con un solo nombre).

**Decisiones (trazadas en `tasks.md`).** (1) El estado visible se deriva en **un
solo módulo**: si cada superficie tradujera `attention.state` por su cuenta, una
palabra de más bastaría para que el hilo dijera una cosa y la Agenda otra.
(2) El contador del nav es el grupo `overdue` **tal cual**, no un cálculo
propio: por construcción no puede discrepar del chip "Por atender". (3) El
endpoint nuevo expone **una sola transición**; `pending` (lo dispara un mensaje
del cliente) y `deferred` (nace de "Recordarme" con fecha validada) no se pueden
fabricar desde la UI. (4) "Comprometidos" cuenta solo compromisos **futuros**: lo
vencido ya es trabajo de "Por atender", son preguntas distintas. (5) Sin
temporizador en el nav: los contadores se refrescan al montar y con cada evento
SSE, como el badge que ya existía.

**Evidencia.** `pnpm typecheck`, `pnpm lint` (0 errores; 3 warnings
preexistentes), `pnpm build` y `pnpm test` en verde: **114 ficheros, 1311
tests**, 9 skipped. **30 tests nuevos** en `tests/unit/operational-flow.test.ts`
(derivación única; coherencia de las tres superficies con JSX real vía
`renderToStaticMarkup`; copy sin internals; las tres acciones contra los
endpoints reales con Zod/`scoped()` reales; conteos de nav y cola incluido el
vencimiento; regresión de los filtros del corte 2). `agenda-no-send.test.ts` pasa
de 8 a 9 casos y su lista de ficheros ya cubre el endpoint nuevo, el bloque, el
vocabulario compartido y los dos ficheros de la Bandeja.

**E2E: EJECUTADO Y VERDE.** Sección nueva `E2E_SECTION=025`
(`scripts/e2e-operator-flow.mjs`, guion en
`tests/e2e/013-flujo-operativo.md`): **84/84 checks, dos veces seguidas**, con
PostgreSQL real (`operator_workspace_test` en `:55432`), app real en modo
desarrollo (los mocks se apagan en producción por diseño, así que `next start` no
sirve) y Playwright. Recorre el flujo como una persona: ver las dos preguntas,
**abrir y comprobar que NO saca** (sigue en 2), "Marcar atendido" (2 → 1),
"Recordarme" (Comprometidos 1 → 2), verlo en la Agenda con las MISMAS palabras
que la lista, "Reactivar IA" que limpia y saca de la Agenda, y un inbound real
seguido de una respuesta escrita a mano que sí sale. Camino infeliz completo:
sin sesión, organización ajena, 409 de la IA y del Laboratorio, 422 por estado no
permitido, y **la Agenda en 500** avisando sin romper la vista.

**Garantía medible del guion.** El outbox del wa-mock crece **exactamente en 1**
en toda la corrida, y es el mensaje que la persona escribió a mano. Ni marcar
atendida, ni recordarme, ni reactivar IA, ni un recordatorio vencido mandan
nada; `sales_follow_up_job` queda intacta.

**T406 NO se hizo, a propósito.** La vista read-only de seguimientos automáticos
en la Agenda exigía **cambiar el contrato `ReminderDto`**, prohibido en este
corte, y leer la tabla del motor desde la Agenda es justo el acoplamiento que el
spec §2.3 prohíbe. Lo que sí se resolvió, sin tocar contratos, es la distinción
👤/🤖 en el copy. Queda para un corte que sí pueda cambiar el DTO.

**Bug que el E2E cazó.** El botón "Enviar" del composer se deshabilita con el
texto vacío (`canSubmit`), así que usarlo como prueba de "la ventana de 24 h
está abierta" daba falso negativo; y la ventana se abre por SSE, así que el
panel ya está pintado con la conversación anterior cuando el inbound aterriza.
La comprobación mira ahora el aviso real del composer y espera al
`conversation.updated`.

**Lo que NO se tocó.** Sin cambios de contrato: ni DTOs, ni endpoints
existentes, ni la lógica de atención de 013, ni `src/server/sales/follow-ups/**`.
Sin plantillas, sin envío proactivo, sin etapas operativas, sin dashboard nuevo y
sin dependencias externas. `docs/SALES_FOLLOW_UPS.md` **no se modificó**: no
cambió ningún contrato ni ninguna regla del motor.

**Siguiente paso exacto:** `specs/013-operator-workspace/tasks.md` → **CUT 5
(verificación del workspace)**: sección propia en `scripts/e2e-selftest.mjs` que
junte los 11 casos mínimos, guion en `tests/e2e/`, y cierre de bloque con los
cuatro commits. Antes conviene cerrar la **FK compuesta ausente en
`conversation_attention`** (pendiente heredado del corte 1): es un cambio de
schema con migración propia y afecta a `attention-migration.test.ts`, que sigue
con 2 checks en rojo.

---

# Checkpoint 2026-10-04 — Spec 013, CUT 3: Agenda de recordatorios humanos

**IMPLEMENTADO, GATES TÉCNICOS VERDES Y E2E DE UI REAL EJECUTADO EN VERDE
(49/49).** Commit único: `feat(inbox): añadir agenda de recordatorios humanos`.
Base limpia `e05b85b` (CUT 2).

**Objetivo.** Que el operador pueda ponerse un "me acuerdo el jueves" que
sobreviva al día, sin convertirlo en un seguimiento automático. La columna
vertebral es la misma del corte 2: **los cinco grupos los calcula el servidor**
(`overdue/today/tomorrow/week/later`), nunca el cliente, y **vencer no dispara
nada** — la conversación simplemente vuelve a "Por atender" y la decisión sigue
siendo de la persona.

**Cambios.**

- `src/server/inbox/agenda-buckets.ts` (nuevo, puro y sin dependencias): los
  cinco grupos con `now` INYECTABLE y zona horaria explícita. `overdue` con tope
  CERRADO (`due_at <= now`, el mismo criterio que `isOverdue`); los otros cuatro
  semiabiertos y encadenados sin huecos. `startOfLocalDay` / `addLocalDays` /
  `startOfLocalWeek` aritmética de calendario local, no de 24 h: un día con
  cambio de horario de 25 h no desplaza los límites. Zona: `?tz=` →
  `OPERATOR_TIMEZONE` → zona del proceso → `UTC`; una zona inválida no rompe la
  vista.
- `src/server/inbox/agenda.ts` (nuevo, SOLO LECTURA): un `SELECT` con
  `innerJoin` y el `organization_id` de AMBOS lados en el `ON`, `is_test = false`
  y solo `state = 'deferred'`. No importa nada capaz de enviar.
- `GET|POST /api/reminders` y `DELETE /api/reminders/[conversationId]`: Zod
  `.strict()` (un `organizationId` en el body es 422, no un campo ignorado en
  silencio), `dueAt` **futura** (422 `due_in_past`), nota opcional recortada a
  280 (422 si excede o viene vacía), organización **siempre** de la sesión
  (ajena → 404), `ai_owns_conversation` e `is_test` → 409.
- `cancelHumanReminder` en `attention.ts`: borra el `deferred` filtrando por
  `state = 'deferred'` en la propia sentencia del `DELETE`, de modo que cancelar
  un recordatorio **nunca** puede borrar trabajo vivo de la cola (409 si lo que
  hay es `pending`).
- `src/components/inbox/reminder-schedule.tsx` (nuevo): acción "Recordarme" en
  el panel de la conversación, solo si es del humano. Fecha con
  `datetime-local` y nota opcional; **sin parsing de texto libre**. La etiqueta
  "Vencido" usa `attention.needsAttentionNow` (derivado en el servidor), no el
  reloj del navegador.
- `src/app/(app)/agenda/page.tsx` + `src/components/agenda/agenda-client.tsx`
  (nuevos): la Agenda como superficie PROPIA (enlace en el `AppNav`, sin contador
  de vencidos — eso es T403, corte 4). Cada item: contacto, fecha/hora, nota,
  estado ("programado" / "vencido · en Por atender") y dos acciones: **Abrir**
  (`/inbox?contact=…`) y **Cancelar**.
- `ReminderDto` / `AgendaDto` en `src/lib/types.ts` (aditivos).
- `OPERATOR_TIMEZONE` documentada en `.env.example` (placeholder vacío en `.env`).

**Decisiones (trazadas en `tasks.md`).** (1) Los grupos se calculan en el
servidor con reloj y zona explícitos: si los calculara el cliente, "Hoy" del
navegador y del servidor discreparían justo en el borde de medianoche.
(2) La Agenda lista **solo `deferred`**: `pending` es trabajo ahora (Bandeja) y
`waiting_client` es la pelota en el cliente; ninguno es un compromiso con fecha.
(3) "Esta semana" es el resto de la semana **en curso** (lunes a domingo) que
queda después de mañana; en fin de semana queda vacía y el lunes siguiente entra
directo en "Más adelante", sin huecos ni duplicados. (4) **Cancelar borra la
fila**, no la devuelve a `pending`: cancelar significa "ya no hay nada que
retomar a esa hora", y la conversación sigue siendo humana.
(5) La fecha vive en la Agenda, así que la lista de la Bandeja no necesita
mostrarla.

**Evidencia.** `pnpm typecheck`, `pnpm lint` (0 errores; 3 warnings
preexistentes), `pnpm build` y `pnpm test` en verde: **112 ficheros, 1280
tests**, 9 skipped. **59 tests nuevos** en 4 ficheros:
`agenda-buckets.test.ts` (20 — los cinco grupos con reloj inyectable, 23:59:59 /
medianoche / cambio de día, sábado y domingo, DST de 25 h, el mismo timestamp en
distinto grupo según zona, ventanas contiguas), `reminder-agenda-api.test.ts` (26
— contrato, ciclo completo, tenant A/B, sandbox), `agenda-no-send.test.ts` (8) y
`agenda-view.test.ts` (5, JSX real con `renderToStaticMarkup`).

**E2E: EJECUTADO Y VERDE.** Sección nueva `E2E_SECTION=024`
(`scripts/e2e-operator-agenda.mjs`, guion en
`tests/e2e/013-agenda-recordatorios.md`): **49/49** con PostgreSQL real
(`operator_workspace_test` en `:55432`), app real en modo desarrollo (los mocks
se apagan en producción por diseño, así que `next start` no sirve) y Playwright.
Programar desde la UI y verlo salir de "Por atender" (2→1) sin recargar a mano;
vencer y volver (1→2) tocando solo `due_at` por SQL — lo que demuestra que no
hay proceso ni worker detrás; inbound real por el wa-mock y vuelta inmediata;
cancelar desde la Agenda con la fila desapareciendo de la BD; aislamiento de
tenant en pantalla; y el camino infeliz completo (422/404/409/401 por API y
errores en la UI sin romper el panel). Al final, **outbox del wa-mock sin cambios
y `sales_follow_up_job` intacta**: cero WhatsApp y cero seguimientos.

**Bug que los tests cazaron (corregido).** El bucketing de `overdue` era
semiabierto mientras la regla de dominio es cerrada: un recordatorio vencido
hacía horas podía clasificarse como "Hoy" y quedar escondido en vez de volver a
la cola. Lo detectó el test de límites de día. El guion E2E documenta además que
el `phone_number_id` del mock debe ser ÚNICO por corrida, porque el webhook
resuelve la organización por la PRIMERA fila que coincide (con un PN fijo el
inbound acababa en la organización de una corrida anterior).

**Lo que NO se tocó.** `src/server/sales/follow-ups/**` (store, política, worker,
writer, seeds), las cadencias y los errores `human_lane`/`handoff_active`: el
endpoint de follow-ups **sigue rechazando** la vía humana, y eso ahora se afirma
también en `agenda-no-send.test.ts`. Sin plantillas WhatsApp, sin messaging
proactivo, sin etapas operativas, sin tabla ni columna nueva y sin dependencias
externas. `docs/SALES_FOLLOW_UPS.md` solo recibió una nota (§14bis) que deja
constancia de que conviven dos mecanismos distintos: no cambia ninguna regla del
motor.

**Pendiente heredado de CUT 2 (sigue abierto).** La migración `0010` declara dos
FK de una columna y ninguna compuesta: una fila de `conversation_attention`
podría decir `organization_id = A` apuntando a una conversación de B. **Impacto
aquí: ninguno**, porque lista, JOIN y `getAttention` filtran por
`organization_id` (y ahora la Agenda lo afirma además con un test de fila
inconsistente). El arreglo —FK compuesta + `UNIQUE (organization_id, id)`— sigue
exigiendo migración propia: corresponde a CUT 5 o a un corte de migración.

**Siguiente paso exacto: CUT 4 (flujo operativo / UX integrada), commit
`feat(inbox): unificar el flujo operativo humano`.** T401 revisar el naming
("Atención humana", "Marcar atendido / Esperando respuesta", "Recordarme",
"Reactivar IA"); T402 quitar `handoffAt`, lanes, jobs y timestamps internos del
copy visible; **T403 el contador de vencidos en el nav de la Agenda** (el enlace
ya existe desde este corte, sin badge); T404 acciones coherentes en la
conversación; T405 el mismo estado humano/IA con la misma semántica en lista,
hilo y Agenda; T406 (opcional) automáticos read-only con 👤/🤖 sin reimplementar
el motor. Arrancar por T401+T402 (son copy) antes de tocar T403.

**Decisión de producto para sincronizar en Obsidian:** el "recordarme" del
operador es un compromiso **humano**, no un seguimiento automático: no tiene
plantilla, no envía nada al vencer y no se apoya en `sales_follow_up_job`. Al
vencer solo vuelve a "Por atender". Y la Agenda se ordena por el **día local del
operador** (`OPERATOR_TIMEZONE`), con las fechas en UTC en la base.

---

# Checkpoint 2026-10-04 — Spec 013, CUT 2: la Bandeja como cola "Por atender"

**IMPLEMENTADO, GATES TÉCNICOS VERDES Y E2E DE UI REAL EJECUTADO EN VERDE
(35/35). Primer corte de 013 con superficie observable verificada en pantalla.**
Commit único: `feat(inbox): añadir cola por atender`. Base limpia `771f3b3`.

**Objetivo.** Que la Bandeja responda primero a "¿qué hago ahora?" y no solo a
"¿qué no he leído?". La columna vertebral es que **el chip y su lista no pueden
discrepar**: salen de la misma operación (`resumirBandeja`), no de dos cálculos
que alguien tendría que mantener sincronizados.

**Cambios.**
- `ConversationDto.attention` **aditivo y opcional** (`AttentionDto`: `state`,
  `dueAt`, `note`, `needsAttentionNow`): los consumidores que no lo conocen
  siguen compilando sin cambios.
- `listConversations` resuelve la atención con un `leftJoin` a
  `conversation_attention` en la **misma función y con el mismo patrón que
  `adAttribution`**: `organization_id` DENTRO del `ON`, no solo en el `WHERE`.
  Un solo `SELECT`, cero N+1; el `UNIQUE (org, conversation)` del corte 1
  garantiza ≤1 fila por conversación. Un único `now` para toda la lista, para
  que el vencimiento no dependa del reloj de cada fila.
- **`needsAttentionNow` se calcula en un solo sitio**: sigue en
  `deriveAttention` (`src/server/inbox/attention.ts`); `resumenAtencion()` solo
  proyecta. El cliente **nunca** lo recalcula — si lo hiciera, dos relojes
  distintos podrían separar el conteo del listado.
- `src/components/inbox/bandeja-filtros.ts` (nuevo, puro): calcula `cola`,
  `sinLeer` y `deAnuncio` **una vez** sobre la vista (búsqueda + etapa) y el
  chip usa `.length` de ese mismo array.
- `conversation-list.tsx`: chip **"Por atender (N)" primero**, con icono y
  `aria-pressed`; `data-testid="conversation-item"` en la fila para el E2E.
  `Todas` / `No leídas` / `Anuncios` / filtro de etapa **intactos** (FR-2.6).
- `PATCH /api/conversations/[id]` publica el DTO con la atención ya derivada: si
  no, el evento anunciaría "sin estado humano" justo tras un `aiEnabled:false`,
  que es lo que crea el `pending`.
- `tests/fixtures/mem-db.ts`: el doble ahora entiende proyección por tabla,
  `innerJoin`/`leftJoin` con evaluación del `ON` (incluida la comparación ENTRE
  TABLAS que Drizzle emite sin parámetros) y proyección de columnas sueltas.
  Sigue **sin** comprobar constraints de PostgreSQL — para eso está la opt-in.

**Decisiones (trazadas en `tasks.md`).** (1) El filtro es **cliente**, como
`all/unread/ads`: un endpoint para "Por atender" sería sobrearquitectura y
rompería la reactividad SSE. (2) `GET /api/conversations/[id]` no existe (solo
`PATCH`), así que el caso "no encontrada" se comprueba por `PATCH`. (3) El
fixture E2E se siembra por SQL: el estado "vencido" exige esperar y
`POST /api/reminders` es del corte 3.

**Evidencia.** `pnpm typecheck`, `pnpm lint` (0 errores; 3 warnings
preexistentes), `pnpm build` y `pnpm test` en verde: **108 ficheros, 1221 tests**,
9 skipped. `tests/unit/attention-queue.test.ts`: **28 verdes** (derivación de los
3 estados y el vencimiento; inclusión/exclusión; conteo == longitud; `unreadCount`
que NO define la cola; tenant A/B en lista y conteo; firma aditiva de
`serializeConversation`; chip renderizado). **E2E `E2E_SECTION=023`: 35/35 con
Chromium real** — ver abajo.

**E2E: EJECUTADO Y VERDE (a diferencia de todos los cortes previos).** Se levantó
PostgreSQL real en `:55432` (binarios de `embedded-postgres` en `/tmp`, `initdb` +
`pg_ctl` como usuario normal, sin root) y la app en `:3100` con los mocks; fixture
por SQL sobre la BD dedicada `operator_workspace_test`. Chromium necesitaba
`libnspr4/libnss3/libasound2`, que se resolvieron extrayendo los `.deb` en `/tmp` y
apuntando `LD_LIBRARY_PATH` (sin root). Camino feliz en pantalla: el chip existe,
es la primera opción, marca 3; al pulsarlo salen 3 filas (handoff, inbound,
vencido) y quedan fuera futuro, esperando al cliente, solo IA y anuncio; los otros
tres filtros conservan su semántica y la etapa recorta la cola a 1 y la devuelve a
3. Camino infeliz: sin sesión `GET /api/conversations` → 401, PATCH a conversación
de otra organización → 404, PATCH inexistente → 404, `/inbox` sin sesión → login.
La sesión de la organización B ve su propia cola (1), ninguna de A.

**HALLAZGO para un corte posterior (no arreglado aquí).** La migración `0010`
declara **dos FK de una columna** y ninguna **compuesta**, así que una fila de
`conversation_attention` puede decir `organization_id = A` apuntando a una
conversación de B. La suite opt-in de corte 1 lo asumía compuesto y por eso tiene
2 checks en rojo (9 verdes). Se arregló su fixture (omitía `contact.name`, NOT
NULL desde 010) para que **pudiera** ejecutarse: ya corre contra PostgreSQL real.
**Impacto en este corte: ninguno** — lista, LEFT JOIN y `getAttention` filtran por
`organization_id`. El arreglo exige migración propia (FK compuesta + `UNIQUE
(organization_id, id)` en `conversation`): corresponde a CUT 5 o a un corte de
migración. Registro en `specs/013-operator-workspace/tasks.md`.

**Lo que NO se tocó.** `src/server/sales/follow-ups/**`, `automationLane` y el
handoff intactos; `docs/SALES_FOLLOW_UPS.md` sin modificar porque su contrato no
cambia. Sin endpoint, tabla, estado de atención, etapa del pipeline, plantilla de
WhatsApp ni dependencia externa nueva. Agenda (corte 3) y flujo operativo (corte
4) sin empezar.

**Siguiente paso exacto: CUT 3 (Agenda de recordatorios humanos), commit
`feat(inbox): añadir agenda de recordatorios humanos`.** T301 store con buckets
`overdue/today/tomorrow/week/later`; T302 `GET /api/reminders` con organización de
SESIÓN (nunca del body); T303 `POST /api/reminders` con Zod y `dueAt` **futura**;
T304 `DELETE /api/reminders/[conversationId]`; T305 acción "Recordarme" en la
conversación en HUMAN; T306..T308 vista y efecto sobre "Por atender"; T309 cero
envíos (reusar `attention-no-send`); T310 bucketing UTC/local + fecha límite +
tenant; T311 gate + E2E — y aquí **sí** hay PostgreSQL disponible, así que la vía
es la de este corte (sección `E2E_SECTION=023` como base, sección propia para la
Agenda). Reutilizar el PG de `:55432` y el patrón de libs de `/tmp/pwlibs`.

**Decisión de producto para sincronizar en Obsidian:** "Por atender" es una cola
de **acción humana ahora**, deliberadamente distinta de "No leídas". Leer no es
atender: una conversación con 20 no leídas que ya esperas al cliente no sale, y
una vencida con cero no leídas sí. Esa distinción es la que hace útil la cola.

---

# Checkpoint 2026-10-04 — Spec 013, CUT 1: estado durable de atención humana

**IMPLEMENTADO / GATES TÉCNICOS VERDES; E2E NO EJECUTADO (sin PostgreSQL en la
máquina). No READY punta a punta.**
Commit único: `feat(inbox): persistir atención y recordatorios humanos`.
Base limpia `33fb80e` (árbol limpio al empezar; el bootstrap de 013).

**Objetivo.** Que "necesita atención" y "me acuerdo el jueves" sobrevivan a
reinicios, sin colarse en el motor automático. Tabla dedicada
`conversation_attention` (una fila por conversación, `ca_*`), tres estados
operativos —`pending`, `waiting_client`, `deferred(due_at, note)`— y **vencimiento
derivado**: `deferred` con `due_at <= now()` ya está vencido. No hay columna de
estado, ni worker, ni cron, ni lease (plan §3.3, D-5).

**Cambios.** `drizzle/0010_conversation_attention.sql` + journal `idx: 12`, escrita
a mano tras revisar el `pnpm db:generate` (emitía un diff de snapshot completo que
recreaba tablas existentes y hacía `DROP INDEX "test_run_org_running_uq"`). CHECK de
estado cerrado y CHECK bidireccional `deferred` ⇔ `due_at`; UNIQUE
`(organization_id, conversation_id)`; tres índices org-first; `organization_id`
NOT NULL con FK y cascade. `src/server/inbox/attention.ts` con la API de plan §3.4
más `deriveAttention` (derivación en un solo lugar, la reutiliza el corte 2),
`clearAttentionForContact` y `bestEffortAttention`. Seis enganches best-effort, uno
por punto de estrangulamiento: `applyHandoff`→`pending`; inbound durante HUMAN→
`pending`; `ingestManualEcho` y outbound `origin="operator"`→`waiting_client`;
`reactivate` limpia y `aiEnabled=false`→`pending` (reactivate gana si llegan
juntos); lead a `won`/`lost` limpia. **`markRead` no toca la atención: abrir no
resuelve.**

**Decisiones técnicas (trazadas en `tasks.md`).** (1) La guarda de FR-1.10 se
implementa como "la IA no es la dueña" = `handoffAt != null || aiEnabled === false`:
con la regla literal `handoffAt != null`, el `aiEnabled=false` sin handoff
—alcanzable desde el interruptor del panel de conversación— no podría generar el
`pending` que exige spec §3.4. (2) `moveLeadStage` limpia solo con cambio **real**
de etapa, para no romper el contrato de rendimiento del no-op documentado. (3)
`scheduleHumanReminder` falla ruidosamente (`due_in_past`) porque es acción
explícita del operador, frente al no-op silencioso de los eventos.

**Lo que NO se tocó, verificado por test.** `src/server/sales/follow-ups/**`,
cadencias, worker, seeding, `automationLane`, `followUpCount/Reason` y los errores
`human_lane`/`handoff_active`: intactos. `docs/SALES_FOLLOW_UPS.md` **no se
modificó** porque su contrato no cambia. `tests/unit/attention-no-send.test.ts` ata
esa frontera por código: falla si alguien importa el sender/Graph/plantillas/motor
desde la atención, o la atención desde el motor o el worker; y ejecuta el ciclo de
recordatorio con todos esos colaboradores sabotajeados. Cero llamadas a Graph desde
un recordatorio humano, por construcción y por prueba.

**Evidencia.** `pnpm typecheck`, `pnpm lint` (0 errores; 3 warnings preexistentes),
`pnpm build` y `pnpm test` en verde: **107 ficheros, 1193 tests** verdes, 9 skipped.
Tests nuevos: 27 del ciclo de 10 pasos + tenant A/B + derivación, 25 de los seis
enganches (incluido `markRead` intacto y los cuatro casos best-effort), 6 de
cero-Graph, 6 de estructura de migración. Regresión obligatoria **sin modificar
ninguna expectativa** (`git diff --name-only -- tests/` vacío): 9 ficheros/100 tests
de follow-ups, orchestrator, writer, handoff y media-send; 18 ficheros/210 tests de
`playbook-*` y `lab-preview-*`. Comandos y resultados en
`specs/013-operator-workspace/tasks.md`.

**E2E: NO EJECUTADO, con causa.** App construida arrancada en `:3111` →
`GET /api/health` = **503 `db_unavailable`**, `ECONNREFUSED 127.0.0.1:5432`. No hay
`postgres`/`psql`/`pg_ctl`/`initdb`/`docker` en la máquina; Playwright y Chromium sí
están instalados, así que el bloqueo es solo la BD dedicada. Este corte no añade UI,
endpoint ni DTO (la superficie observable empieza en el corte 2), pero la
verificación en PostgreSQL real de UNIQUE/CHECK/FK/cascade y el E2E de
comportamiento quedan **PENDIENTES**: los dobles en memoria no sustituyen
PostgreSQL. Los 5 tests opt-in de `tests/unit/attention-migration.test.ts` requieren
`ATTENTION_TEST_DATABASE_URL` y una BD `attention_test[_sufijo]`.

**Constitución.** I intacto (sin secretos nuevos; la nota se recorta, no se
interpola en SQL ni se loguea). III respetado: `organization_id` NOT NULL, índices
org-first y toda query por `scoped()`. IV: upsert idempotente, migración
re-ejecutable sin seeds ni backfill. VII: las tres decisiones anteriores quedan
registradas. IX pendiente, igual que en los cortes previos. Sin dependencia
externa nueva.

**Decisión de producto para sincronizar en Obsidian:** el recordatorio humano es un
concepto de **operación** y por eso vive en su propia tabla, no en
`sales_follow_up_job` ni en `lead.nextFollowUpAt`; el vencimiento se deriva por
lectura y no por proceso; y **nunca** dispara un envío — la Agenda solo le recuerda a
Max que escribir. Esa frontera (operación ≠ motor) es lo que hay que dejar escrita
en el cuaderno de producto, no el detalle de implementación.

**Archivos clave.** `src/server/inbox/attention.ts`; enganches en
`src/server/ai/delivery.ts`, `src/server/inbox/{ingest,queries,send}.ts` y
`src/server/leads/stage-gateway.ts`; `src/lib/db/{schema,ids}.ts`;
`drizzle/0010_conversation_attention.sql` + `drizzle/meta/_journal.json`;
`tests/fixtures/mem-db.ts`; `tests/unit/attention-{state,hooks,no-send,migration}.test.ts`.

**Siguiente paso exacto:** (1) con PostgreSQL local dedicado, correr
`ATTENTION_TEST_DATABASE_URL` + `pnpm vitest run tests/unit/attention-migration.test.ts`
para verificar UNIQUE, CHECK de estado, coherencia `deferred`⇔`due_at`, NOT NULL, FK,
cascade y la aplicación repetida de la migración; (2) después, sesión nueva e
independiente para **solo CUT 2** (`ConversationDto.attention` aditivo + LEFT JOIN
scropeado en `listConversations` + chip "Por atender"), que es donde empieza la
superficie observable y, por tanto, el self-test E2E de comportamiento. Ningún
`amend`, `merge`, `rebase`, `push` ni deploy en este corte.

---

# Checkpoint 2026-10-04 — Spec 012: handoff humano silencioso

**IMPLEMENTADO / GATES TÉCNICOS VERDES; E2E PENDIENTE. No READY punta a punta.**
Commit único `fix(sales): hacer silencioso el handoff humano`; hash con `git log -1`.
Base limpia `9a218b1ad4c866cff0e8224791b7fde4a621b04c`.

HUMAN puro y schedule_call devuelven text=null determinísticamente, sin LLM ni
outbound artificial; applyHandoff, lanes, motivos y decisiones Jev intactos.
Pago autorizado entrega recursos exactos + CTA de comprobante y luego handoff
silencioso; vacío responde naturalmente sin anunciar escalamiento. Protecciones
contra cobro/won/activación permanecen internas. Prueba rápida acepta null para
handoff aplicado y muestra ausencia de mensaje; vacíos inesperados siguen fallando.
No publicación ni modificación de playbook productivo; cero WhatsApp real.

Regresión comercial **438/438**; preview **27/27**. Gate completo final **exit 0**:
typecheck/lint/build/test, **1129 pass / 4 PostgreSQL skipped**, 103 archivos verdes
/ 1 omitido; lint 0 errores y 3 warnings preexistentes. Evidencia y comandos en
`specs/012-silent-human-handoff/tasks.md`; log `/tmp/silent-handoff-gates.log`.
E2E 022 actualizado e intentado: **ECONNREFUSED 127.0.0.1:3000**, sin app ni
postgres/psql/pg_ctl/docker disponibles. Ningún escenario E2E ejecutado;
Constitución IX y pendientes históricos 020/021/022/PG siguen abiertos.

Siguiente paso exacto fuera de esta sesión: preparar app/PG dedicada/mocks/Chromium
según quickstart 011, ejecutar E2E_SECTION=022 feliz/infeliz y Prueba rápida HUMAN
silenciosa en UI. Sincronizar decisión comercial en Obsidian. STOP tras commit limpio.

---

# CURRENT STATE — Espacio Connect

**Actualizado: 2026-10-04 — Spec 011, C4 IMPLEMENTADO / GATES VERDES;
E2E 022 PENDIENTE. No READY punta a punta.**

Corte recuperado sobre working tree parcial, sin reiniciarlo ni descartar cambios.
Commit único: `feat(sales): entregar instrucciones de pago configuradas`, con
padre `af6f1d9310127f4f03245fc459f8365ca0e90e88`. Hash disponible mediante
`git log -1 --format='%H %s'`. Sin otro corte, runner, deploy, publicación
productiva ni WhatsApp real.

Nueva acción `send_payment_instructions` opt-in en schema 1.1. Published/histórico
1.0 conservan siete acciones y contrato previo; no auto-migración. V3 derivada
sin alterar V2/fixture/hash/§7. Editor actualiza únicamente draft con botón
explícito, preserva ediciones y exige publicación posterior; rollback 1.0
compatible. Config/store/loader validan por versión y normalizer por set activo.
Los dos fallos iniciales eran fixtures lifecycle sin los campos ya obligatorios
1.0/NOT NULL; se completaron solo esos bloques legacy, con evidencia en tests.
Se preservó la tolerancia original del writer 1.0, separada de pago estricto 1.1.

Destinos renderizados por código desde recurso validado del tenant, sin LLM/KB:
todas las transferencias, Yape y link, en orden y sin truncar. Autorización de
entrega separada del handoff commercial posterior. Fact solo tras todas las
partes aceptadas y persistidas; vacío/error/entrega parcial no marcan ni reintentan.
HUMAN/disqualify prioritarios; sandbox local sin sender/Graph; sin won, cobro,
activación, voucher validado, nuevos follow-ups ni cambios de pricing.

Verificación final: dirigida 108/108; regresión requerida **291/291** en 24
archivos, Freeze V2 **13/13** intacto. Gate completo typecheck/lint/build/test
**exit 0**, **1120 pass / 4 skipped**, 103 archivos verdes y 1 omitido.
Lint 0 errores y 3 warnings preexistentes. Un fallo ambiental EPERM del test
HTTP localhost motivó reejecutar el gate completo con sockets habilitados;
resultado verde. Log `/tmp/commercial-c4-recovery-gates.log` y detalle durable
con comandos en `specs/011-commercial-resources/tasks.md`.

Arnés E2E **022 preparado e intentado**, con upgrade UI Playwright, publicación/
rollback API, pipeline/outbox/fact/handoff, vacío/rechazo/HUMAN, sandbox y
Published 1.0. Sin escenarios ejecutados: primero EPERM del socket, reintento
confirmó **ECONNREFUSED 127.0.0.1:3000**; sin ejecutables PG/Docker disponibles.
E2E **PENDIENTE**; no acredita UI viva/PG físico/intención real de Jev. Persisten
los pendientes 020/021 y los 4 tests PostgreSQL opt-in. OP1–OP4 de la pausa
operativa siguen cumplidos. Constitución IX pendiente.

Archivos clave: playbook schema/store/loader/payment-extension, API/editor,
sales payment-resource/normalize/resolve-plan/orchestrator/writer; tests
playbook-store/API/pago/demo y `scripts/e2e-commercial-payment.mjs`.
Documentación de publicación y contrato: `docs/playbook.md`,
`docs/SALES_ORCHESTRATOR.md`, contracts/payment-action.md y quickstart del 011.

Siguiente paso exacto: app + PostgreSQL dedicada migrada + mocks localhost:3033
+ Chromium según quickstart; ejecutar E2E_SECTION=022 happy/unhappy/UI/rollback
y registrar evidencia; completar además pendientes 020/021/PG. La habilitación
operativa exige configurar cobro, actualizar/probar/publicar draft 1.1
explícitamente. Sincronización comercial en Obsidian pendiente. STOP C4.

---


**Actualizado: 2026-10-03 — Spec 011: PAUSA OPERATIVA de recursos comerciales
cerrada (OP1–OP4 cumplidos).**

Este commit es **solo documental**: registra evidencia operativa real ya
verificada en producción. Sin código productivo, sin deploy, sin runner/codex
anidado, sin WhatsApp adicional, sin inicio de C4 y sin tocar contratos de pago.
Commit de cierre: `docs: registrar pausa operativa de recursos comerciales`.
Evidencia operativa aportada por el operador; esta sesión solo la registra.
Este commit es solo documental: registra evidencia operativa real ya verificada en producción, sin código productivo, sin deploy, sin runner/codex anidado, sin WhatsApp adicional, sin tocar contratos de pago.

**OP1 CUMPLIDO.** Los tres MP4 reales fueron subidos desde la UI de Vende Veloz
365, no por SQL ni por copia al contenedor: `demo_enrollment_panel` (matrícula y
panel), `demo_payments_balances` (pagos y saldos) y `demo_online_enrollment`
(matrícula online). **Ningún MP4 real fue agregado a Git**; verificado aquí de
forma independiente: `git ls-files` no devuelve ningún `.mp4`/`.mov`/`.m4v`/
`.webm` y `.dev-media/` sigue ignorado.

**OP2 CUMPLIDO.** Se detectó que **producción no tenía persistent storage
configurado**, por lo que `MEDIA_DIR` resolvía contra el sistema de archivos
efímero del contenedor. Se creó un volumen persistente en Coolify montado en
`/data/media` y se configuró `MEDIA_DIR=/data/media`. Escritura verificada como
usuario `vocero` (no-root del contenedor); `persistence-test.txt` sobrevivió a un redeploy; después se subió
un video comercial y se recibió una imagen real por WhatsApp, y **ambos siguieron
visibles tras otro redeploy**. Confirma operacionalmente que la media de
conversaciones y los recursos comerciales usan almacenamiento persistente.

**OP3 CUMPLIDO.** Producción controlada de la organización Vende Veloz 365,
destinatario autorizado de prueba, **sin registrar teléfono ni PII**. Los tres
recursos se enviaron y reprodujeron correctamente como **video nativo de
WhatsApp**, no como enlaces ni como documentos. Routing correcto por intención
verificado; captions verificados y posteriormente **V3 publicada**.

**OP4 CUMPLIDO con evidencia combinada.** Prueba rápida/Laboratorio ejecutado como
sandbox **sin envío real a WhatsApp**; los tests verdes del Corte 3 cubren
ausencia de asset, fallo de media, ventana/fallo sin `demoShownAt` y sandbox sin
Graph/WhatsApp real. **No se destruyó ningún recurso productivo** para provocar
un fallo artificial.

**Hallazgo operativo — causa de la pérdida histórica de imágenes y adjuntos:** la
causa raíz era `MEDIA_DIR` sin almacenamiento persistente, que provocaba que cada
redeploy borró el contenido del contenedor efímero; no era un fallo de descarga, persistencia ni autorización. La corrección fue montar `/data/media` como persistent storage y configurar `MEDIA_DIR=/data/media`. **No se afirma recuperación automática de los archivos históricos ya perdidos**: el contenido que antes desaparecía con el contenedor ya no está en el volumen y no existe copia local de la que restaurarlos; cualquier recuperación sería una tarea distinta, no verificada aquí.

**Pendientes que esta pausa NO cierra:** los self-tests **E2E 020/021** con
PostgreSQL + ffmpeg/Chromium y los **4 tests PostgreSQL opt-in** de
`tests/unit/commercial-resource-postgres.test.ts` siguen **PENDIENTES**, sin
cambios respecto a C1–C3. **No READY punta a punta** por esos pendientes. La
verificación en producción complementa la evidencia del self-test local; no la
sustituye.

**Constitution Check:** sin cambios de código ni de contrato; I/III/IV/VI/VII no
afectados, sin nueva superficie observable. Sin decisión comercial nueva que
sincronizar en Obsidian (V3 publicada es la versión del playbook vigente, ya
registrada). C4 sigue **sin iniciar** y mantiene Published 1.0 hasta que una
sesión posterior actualice el draft a 1.1, lo pruebe y lo publique explícitamente.

Detalle completo, tabla de slots y límites de afirmación en
`specs/011-commercial-resources/tasks.md` → *Pausa operativa tras 1–3*.

**Siguiente paso exacto:** con C4 sin iniciar, provisionar el entorno local
app+PostgreSQL dedicado + mocks + ffmpeg/Chromium, aplicar/repetir la migración y
la suite opt-in de C1, y ejecutar 020 con reinicio administrado y 021 según
`specs/011-commercial-resources/quickstart.md`, registrando evidencia real. Esta
sesión no despliega ni ejecuta el runner. STOP tras el único commit y árbol limpio.

---

**Actualizado: 2026-10-03 — Spec 011, C3: demos como video nativo implementadas.**

Objetivo único: entrega automática de demos configuradas en C1/C2. Commit de
cierre `feat(sales): entregar demos como video nativo`; HEAD inicial limpio
`73ab8ec82bfe8bb0c2a2106c45054a837224c929`. Un commit atómico; sin deploy/push.

Routing puro desde el último tema relevante del prospecto: operaciones elige
payments para pagos/saldos/voucher/deuda vigente y panel para matrícula/alumnos/
general; acción explícita online tiene prioridad. Negaciones y menciones del
vendedor probadas. Regla léxica limitada, sin nueva decisión LLM/producto.
Recurso y asset scoped, bytes MP4 locales revalidados; writer conoce disponibilidad.
Caption breve sin enlaces, entrega con sendMediaMessage existente como video nativo.
Media IA conserva origin=ai/aiGenerated=true también en failed; default operador y
prepareSend is_test/ventana intactos. No cancelación de follow-ups como reply manual.

DemoShownAt solo después de aceptación Graph + persistencia o simulación sandbox
persistida. Ausencia/corrupción/disco perdido responde texto honesto sin fact ni
after_demo. Upload/Meta/ID/disco/persistencia/ventana fallando no cuentan ni causan
retry/segundo mensaje. HUMAN/STOP, opt-in, facts precio y follow-ups vigentes.
Sandbox persiste copia local de media+caption en transacción antes de sender/red;
Lab/preview proyectan caption con join tenant-safe. Cleanup restringido a copias
marcadas de casos is_test, conserva recursos fuente. Sin payment action/cobro.

**Gate técnico VERDE:** typecheck → lint → build → test, **exit 0** con
`pnpm --pm-on-fail=ignore`; **1093 pass / 4 PostgreSQL skipped**, 102 archivos
verdes / 1 omitido. Lint 0 errores / 3 warnings previos. Repetición completa con
sockets locales autorizados tras EPERM de tests HTTP en sandbox. Routing/caption
26 tests nuevos y pipeline demo 17, sender/orchestrator/writer y Lab/preview
extendidos. Dobles BD en memoria, FS real, mocks de proveedores; no sustituyen PG.
Ambos scripts E2E parsean (`node --check`, exit 0). Comandos y evidencia durable
en `specs/011-commercial-resources/tasks.md`; logs `/tmp/commercial-c3-*.log`.

**E2E 021 happy/unhappy PENDIENTE:** arnés existente extendido con proveedor HTTP
mock local y MP4 sintético fuera de Git: inbound/pipeline real, tres slots,
video+caption en outbox/hilo, fact posterior; rechazo media/ausencia sin fact y
preview sandbox sin Graph. Intento `E2E_SECTION=021 pnpm --pm-on-fail=ignore test:e2e`
con app/BD/mocks locales salió **1 antes de setup**, ECONNREFUSED :3000 tras
autorizar sockets (primer intento EPERM). App ausente; postgres/psql/pg_ctl/docker/
ffmpeg no disponibles. Ningún escenario en vivo ni codec/reproducción probado.
C1 BD física y C2 E2E UI/reinicio siguen pendientes. **No READY punta a punta**;
T1134 abierto. Constitution Check V verde, IX pendiente; sin decisión comercial
nueva que sincronizar en Obsidian.

Archivos clave: `src/server/sales/{demo-routing,demo-resource,orchestrator,writer}.ts`,
`src/server/ai/delivery.ts`, `src/server/inbox/send.ts`,
`src/server/lab/sandbox-case.ts`, tests sales-demo/sender/sales/Lab,
`scripts/e2e-commercial-demos.mjs`, arnés sección 021, contrato resources y
quickstart. Contratos de dominio actualizados en SALES_ORCHESTRATOR,
SALES_FOLLOW_UPS y playbook.

**Siguiente paso exacto: PAUSA tras C3.** Provisionar app+PostgreSQL local dedicado+
mocks+ffmpeg/Chromium; aplicar/repetir migración y suite opt-in C1, ejecutar 020
con reinicio administrado y 021 según quickstart, registrar evidencia real.
Después verificar los tres MP4 reales persistidos/reproducibles como videos nativos
en producción mediante operación autorizada (OP1–OP4). Esta sesión no despliega
ni contacta WhatsApp real; C4 no iniciado. STOP tras commit único y árbol limpio.

---

**Actualizado: 2026-10-03 — Spec 011, C2: administración de demos y cobro implementada.**

Objetivo único: **Comercial / Jev → Recursos comerciales**, con API administrativa
local y UI mínima. Commit de cierre:
`feat(commercial): administrar demos y recursos de cobro`; HEAD inicial
`ceb1438eba5a32782a4401a75c77a4fc520132ef`, un commit atómico, sin deploy/push.

Tres slots MP4 con subir/reemplazar, estado, nombre/tamaño y preview privada
por `/api/media/[assetId]`. Transferencias (máximo cinco), Yape y link HTTPS
opcionales con **Guardar cobro** explícito. Recursos fuera de ConfigV1/KB;
editor Config/Preguntas, Guardar/Publicar, historial y Prueba rápida vigentes.
No se modificó el comportamiento de Jev ni se envió WhatsApp. No se requieren
conversación, credenciales Meta ni proveedor de IA para administrar recursos.
Auth igual a Comercial/Jev vigente: cualquier miembro con sesión, tenant
resuelto/revalidado por sesión; JSON/multipart estrictos sin org/paths del body.

Decisión técnica: `saveMediaFile` escribe en MEDIA_DIR; asset y vínculo se
persisten en una transacción con el store de C1 (executor opcional). Se valida
MIME video/mp4, no vacío, límite nativo 16 MiB, ftyp/boxes/moov/track vide/mdat;
no garantiza codec/aceptación de Meta. No fallback a documento ni transcodificador
runtime. Asset inmutable por reemplazo, históricos conservados. Fallo de disco
parcial/rollback conserva anterior y compensa archivo nuevo; commit incierto
conserva archivo si hay asset o no puede probar ausencia con BD. En este último
caso podría quedar huérfano para limpieza posterior; se devuelve error controlado
que invita a recargar. No se borra media histórica ni referencias concurrentes.

**Evidencia:** typecheck → lint → build → test **exit 0**;
**1040 pass / 4 PostgreSQL skipped**, 100 archivos verdes / 1 omitido.
34 tests nuevos API/UI; commercial **103 pass / 4 skipped**; regresión seleccionada
media/sales/playbook/Lab **282/282**. Lint 0 errores / tres warnings previos.
Se usó `pnpm --pm-on-fail=ignore`, igual al checkpoint anterior; gate con sockets
locales autorizados. Detalle/comandos en `specs/011-commercial-resources/tasks.md`.

**E2E 020 PENDIENTE (happy/unhappy UI real y reinicio):** arnés existente extendido
con Playwright, generación preparada de MP4 H.264 sintético fuera de Git,
upload/replacement,
preview reproducible, cobro completo/vacío/incompleto, persistencia, aislamiento,
sin sesión, ConfigV1/KB intactos y cero mensajes/Graph. Parsea (`node --check` de
ambos scripts, exit 0), pero `E2E_SECTION=020 pnpm --pm-on-fail=ignore test:e2e`
con app/BD/mocks localhost salió **1 antes del setup**, ECONNREFUSED :3000 tras
autorizar sockets (primer intento EPERM). Sin app ni ejecutables postgres/psql/
pg_ctl/docker disponibles. Generador de fixture intentado, **exit 1 por ffmpeg
no disponible**: generación/codec/reproducción también pendientes. No MP4 reales
ni binarios en Git. No se ejerció UI en navegador, ni se observó un reinicio.

**BD física C1 sigue PENDIENTE:** cuatro tests opt-in de migración/constraints
omitidos; dobles ORM/scoped/FS no sustituyen PostgreSQL. **No READY punta a punta**.
T1124 queda abierto por E2E; C3/C4 sin iniciar. Constitution Check sin excepción,
V técnico verde e IX pendiente; sin decisión de negocio nueva para Obsidian.

Archivos clave: `src/server/commercial/resources.ts`,
`src/app/api/commercial-resources/{route.ts,videos/[slot]/route.ts}`,
`src/components/agent/commercial/resources-client.tsx`, `agent-client.tsx`,
`src/lib/commercial/{dto,store}.ts`, tests API/UI, arnés sección 020/generador,
contrato resources, quickstart y `docs/playbook.md`.
Logs temporales `/tmp/commercial-c2-{typecheck,lint,build,test,targeted,regression,e2e,video}.log`.

**Siguiente paso exacto:** app+PostgreSQL dedicado+mocks y Chromium/ffmpeg;
aplicar/reaplicar migración y correr suite opt-in C1; ejecutar 020 con el comando
de `specs/011-commercial-resources/quickstart.md`, configurando reinicio de app
de pruebas y MEDIA_DIR persistente, registrar evidencia. Luego sesión nueva para
**solo C3**. Esta sesión termina tras el único commit de C2 y árbol limpio.

---

**Actualizado: 2026-10-03 — Spec 011, C1: fundación y persistencia implementadas.**

Objetivo único: recursos comerciales tenant-safe, sin superficie UI/HTTP ni
cambios del runtime Jev. Commit de este checkpoint:
`feat(commercial): persistir recursos comerciales`, base
`129ff5d11982f84aedeee170c0e2dec0684099ab`; un commit atómico, sin deploy/push.

Modelo `commercial_resource` con los tres slots demo y payment_instructions,
IDs `cr_*`, org NOT NULL y org/slot UNIQUE. Store `scoped()` valida MP4 local
propio disponible y bloque completo de transferencias/Yape/link, acepta vacío
sin defaults y conserva id/createdAt al reemplazar. Lectura ausente o demo
perdida devuelve null; fallos BD no se ocultan. Contrato:
`specs/011-commercial-resources/contracts/resources.md`.

Decisión técnica: migración manual **0009_commercial_resources.sql**, journal
idx **11**, según patrón Drizzle reejecutable vigente. FK compuesta org/media
respaldada por UNIQUE media(org,id); ON DELETE NO ACTION impide borrado directo
referenciado y permite cascade al eliminar organización. SQL limita slots/shape
básico; Zod valida detalle de cobro. Ningún recurso sembrado. Firma/codec MP4
pertenecen a upload/verificación de C2, no se prometen aquí.

**Evidencia:** gate completo typecheck → lint → build → test **exit 0**;
**1006 tests pass / 4 PostgreSQL skipped**, 98 archivos verdes / 1 omitido.
69 tests nuevos verdes y regresión seleccionada **282/282** (sales/playbook/media
+ Lab/preview). Lint: 0 errores, tres warnings preexistentes. Se usó pnpm
`--pm-on-fail=ignore` (sin esa opción el gestor falla antes del script con
`unable to open database file`), sin cambiar dependencias. Pruebas HTTP del gate
con sockets locales autorizados. Arnés E2E existente parsea (`node --check`).

**BD real PENDIENTE:** sin postgres/psql/docker disponibles. Unit tests usan
ORM/schema/scoped y filesystem reales, ejecutor BD en memoria; no prueban
FK/UNIQUE/CHECK físicos ni migración repetida. Suite opt-in preparada:
`tests/unit/commercial-resource-postgres.test.ts`, solo host local y BD dedicada
`commercial_resources_test[_sufijo]`, nunca DATABASE_URL como fallback.

**E2E happy/unhappy PENDIENTE:** `pnpm --pm-on-fail=ignore test:e2e` intentado
con APP_BASE_URL y todos los proveedores hacia localhost/mocks; exit 1 antes
del setup, **ECONNREFUSED 127.0.0.1:3000**, health 000. Primer intento sandbox
EPERM, reintento con socket autorizado confirmó falta de app. No llamadas
WhatsApp reales ni destinatarios productivos. C1 no tiene nueva UI/API observable;
no crea endpoints para probar su store. C2 debe ampliar y ejecutar el arnés de
su primera superficie. **No READY punta a punta**; C2–C4 sin iniciar.

Archivos clave: `src/lib/commercial/{resources,store}.ts`,
`src/lib/db/{schema,ids}.ts`, migración/journal, tres suites commercial-resource,
contrato y `specs/011-commercial-resources/tasks.md` con comandos/resultados.
Logs temporales `/tmp/commercial-c1-{typecheck,lint,build,test,regression,e2e}.log`.
Constitution Check reevaluado sin excepción; sin decisión comercial nueva para
Obsidian. Sender, sandbox, Published/V2 y contratos de acciones intactos.

**Siguiente paso exacto:** disponer de PostgreSQL local dedicado y ejecutar
`COMMERCIAL_RESOURCES_TEST_DATABASE_URL` +
`pnpm --pm-on-fail=ignore exec vitest run tests/unit/commercial-resource-postgres.test.ts`;
después comenzar **solo C2** en sesión independiente reconstruyendo el contexto.
Esta sesión termina tras el único commit de C1 y verificación de árbol limpio.

---

**Actualizado: 2026-10-03 — Bootstrap SDD del spec 011 (Recursos comerciales de Jev).**

Preparados `specs/011-commercial-resources/` (spec, plan, tasks, research,
contratos y quickstart), `.ai/tasks/commercial-resources/` (overview + cuatro
prompts autocontenidos) y `scripts/ai/run-commercial-resources-codex.sh`.
**Ningún corte implementado:** sin cambios de app, schema, migraciones,
respuestas Jev ni videos en Git. El estado funcional de 010 descrito abajo sigue vigente.

Cortes dependency-ordered: **1** modelo tenant-safe + media_asset + cobro preparado;
**2** UI Comercial/Jev → Recursos comerciales, subida local MP4 y cobro;
**3** entrega nativa de demos + caption, facts post-video y sandbox;
**4** acción explícita `send_payment_instructions`, contrato 1.1 compatible con
1.0, destinos configurados y handoff posterior. Recursos independientes de
KB factual y del versionado de estrategia; no multi-producto ni DAM/billing.

Hallazgos técnicos para la siguiente sesión: media vive en MEDIA_DIR/org/assetId;
la subida actual del inbox envía WhatsApp y no sirve de upload administrativo;
sendMediaMessage marca origin=operator y necesita origen IA compatible en C3;
demoShownAt hoy se marca tras texto, deberá depender del video; las siete keys
1.0/V2 están protegidas y no pueden ampliarse invalidando Published antiguas.
V2/fixture/hash quedan intactos, C4 introduce extensión explícita 1.1/V3.

Runner deriva del patrón de 008/009/010: una sesión NUEVA por corte, GNU timeout
(default 90m), stdout+stderr en vivo con tee, heartbeat 25s, logs ignorados,
START_CUT/END_CUT, árbol limpio y exactamente un commit por corte. Sin resume,
reset/checkout/clean ni deploy. El Codex instalado no anuncia --full-auto:
preflight prefiere ese flag cuando exista, si no usa --approve-for-me con sandbox
workspace-write y revisión automática; no bypass de permisos.

**Verificación bootstrap:** `bash -n scripts/ai/run-commercial-resources-codex.sh`
verde; revisión estática del runner y `git diff --check`. **Runner NO ejecutado.**
Gates de app y E2E de 011 no ejecutados (solo preparación SDD/shell); ningún corte
se declara listo. Tasks conserva los cuatro cortes pendientes y pausa operativa.
Commit de este bloque: `docs(ai): bootstrap commercial resources SDD and Codex runner`.

**Siguiente paso exacto**, desde terminal Bash/WSL externa en raíz:
`START_CUT=1 END_CUT=3 CUT_TIMEOUT=90m bash scripts/ai/run-commercial-resources-codex.sh`.
Después registrar verificación de los tres videos reales/persistencia en producción
antes de reanudar 4–4. C4 requiere actualizar draft a 1.1, probar y publicar
explícitamente para activar pago; señalar la decisión comercial para Obsidian.

---

**Actualizado: 2026-10-03 — CORTE 2 del spec 010 CERRADO (Prueba rápida embebida).**
Commit `feat(playbook): añadir prueba rápida sandbox`.

**Qué cambió (observable)**: la pestaña **Comercial / Jev** tiene ahora una
**Prueba rápida** en la columna derecha (debajo del editor en pantalla
estrecha). Pegas una conversación, eliges `Probar: [ Draft | Published ]` y
pulsas **Ejecutar**; devuelve `jev` (las 8 señales), `plan` (lane,
next_action, should_handoff, stage) y la **Respuesta** que escribió el agente,
con `[Ver JSON completo]` plegable. Contrato nuevo: **`POST /api/lab/preview`**.

**La regla que gobierna el corte**: la prueba rápida **no es un segundo motor**.
Reutiliza el andamiaje del Laboratorio y la **misma** función
`runSalesOrchestratorTurn`. Para que eso no se degrade en promesa, el andamiaje
se **extrajo** a `src/server/lab/sandbox-case.ts` (`createSandboxCase`,
`cleanupSandboxCase`, `readSandboxSnapshot`, `readSandboxMessages`) y **los dos
consumidores lo importan**: el `runConversation` del runner y el endpoint nuevo.
El helper devuelve el snapshot crudo y cada consumidor proyecta lo suyo (el
Laboratorio conserva sus 3 escalares; el preview, decisión + plan + writer).
`tests/unit/lab-pipeline-real.test.ts` sigue **verde sin tocar el archivo**
(18/18): esa es la prueba de que el Laboratorio no se movió.

**Sandbox sin reimplementar guards.** `is_test=true` en la conversación es lo
que ya activa `deliverReply` (persiste y vuelve **antes** de `sendText`), la
supresión de follow-ups (`orchestrator.ts:212-220`), el override solo en
sandbox (T306) y la auditoría de versión (T308). El preview no reimplementa
ninguno: entra por la misma puerta. `organizationId` sale **siempre** de la
sesión; el body **no** admite el documento del playbook, así que lo probado es
exactamente lo guardado/publicado (semántica **Guardar → Probar**).

**Errores honestos**: `invalid_body` 400 · `draft_not_found` 409 (sin fallback
silencioso a published) · `published_not_found` 409 · `no_open_stage` 409 ·
`ai_not_configured` 503 · `jev_failed` 502 · `no_decision` 502 ·
`no_writer_output` 502. **Un fallo del proveedor nunca se convierte en una
respuesta ficticia**, y el `detail` va saneado (sin tokens ni URLs).

**Desviación consciente del contrato**: se anticipaba `plan.stage_slug`, pero
`pipeline_stage` no tiene columna `slug` (solo `name`), así que la proyección
honesta es `plan.stage_name`.

**Gates**: `typecheck` + `lint` (0 errores; 3 warnings preexistentes) + `build`
(`✓ Compiled successfully`) + **937/937 tests en 96 archivos** (40 nuevos en 3
archivos: 19 del endpoint, **7 estructurales** que leen el código fuente y
afirman el helper compartido y la ausencia de un motor paralelo, 14 de la UI
renderizada a markup). **E2E NO ejecutado en este entorno**: no hay app
levantada, ni Docker, ni `psql`. La **Sección 019** del arnés
`scripts/e2e-selftest.mjs` está escrita y parsea (`node --check`), con su
dispatch en `main()`, pero **no se ha ejecutado** y por tanto no se declara.

**Intactos**: `/api/lab/runs`, la UI del Laboratorio, `orchestrator.ts`,
`build-state.ts`, `writer.ts`, `resolve-plan.ts`, `client.ts`, el loader,
`ConfigV1Schema`, option keys, runtime Published, follow-ups, WhatsApp, webhook,
CAPI y el schema de BD. Cero dependencias nuevas.

**Feature 010 completa** (corte 1 + corte 2), con el E2E de las Secciones 018 y
019 pendiente de corrida en un entorno con app + BD.

---

**Actualizado: 2026-10-03 — CORTE 1 del spec 010 CERRADO (Comercial / Jev simplificado +
bug de Publicar corregido).** Commit `refactor(playbook): simplificar Comercial Jev`.

**Qué cambió (observable)**, todo en la capa de cliente
(`src/components/agent/playbook/*`); backend, versionado, contrato de API y runtime
Published **sin cambios**:

- **La regla Guardar/Publicar está corregida y fijada por tests.** `Publicar` va
  **deshabilitado con cambios sin guardar** y también con JSON que no parsea (antes se
  habilitaba justo con `dirty=true`, y Publicar nunca miraba la sintaxis). Se mudó a la
  función pura `draftActions()` (`draft-actions.ts`), que la consume el componente, y
  `tests/unit/playbook-draft-editor-actions.test.ts` la ata **renderizando el componente
  real** a markup (sin jsdom) para que el `disabled` que se afirma sea el del JSX.
  **Sin autosave**: guardar solo se habilita por `dirty` explícito.
- **Pantalla a una cabecera**: `Comercial / Jev` · `Producción: Vx` · `Editando: Vy draft`/`Sin draft`
  · `schema 1.0` · `Historial`. Desaparecen la segunda cabecera "Sales Playbook", la
  tarjeta de "Estado y versionado", la tarjeta de la versión publicada (con precio,
  prioridades en pills y badges), el CTA con párrafo al Laboratorio y el párrafo
  explicativo de tres frases. El Laboratorio queda como **enlace de texto** y `Refetch`
  se conserva (ghost) para no perder una capacidad.
- **Tabs `Config` / `Preguntas Jev`**: un editor visible a la vez. El estado de los dos
  documentos vive en el padre, así que cambiar de tab no pierde lo escrito; `Guardar`
  sigue reensamblando el documento completo.
- **Historial en modal** (`className` de ancho en el panel, sin tocar el `Modal`
  compartido) y **"Editar publicada"** en vez de "Crear draft desde esta versión" (misma
  llamada `createDraft`).
- Nueva pieza pura y testeable: `src/components/agent/playbook/draft-actions.ts`.
  `PlaybookPublishedCard` se borró al quedar fuera del camino principal.

**Gates**: `typecheck` + `lint` (0 errores; 3 warnings preexistentes) + `build` + **897/897
tests en 93 archivos** (29 nuevos en 2 archivos). **E2E NO ejecutado en este entorno**: no
hay app levantada, ni Docker, ni `psql` (`localhost:3000` sin conexión). La **Sección 018**
del arnés `scripts/e2e-selftest.mjs` está escrita y parsea (`node --check`), con su dispatch
en `main()`, pero **no se ha ejecutado** y por tanto no se declara. Queda pendiente correr
`pnpm test:e2e` con `WA_MOCK_ENABLED=true`.

**Corte 2 sin empezar** (la Prueba rápida embebida). El corte 1 abre el hueco donde entra:
el editor ocupa el ancho completo porque la columna de Prueba rápida llega en el 2.

---

**Actualizado: 2026-10-03 — Bootstrap del spec 010 (Playbook Playground UX). SIN código tocado.**

El spec `specs/010-playbook-playground-ux/` queda abierto y **ninguno de sus dos cortes ha
empezado**. Este commit es **solo documental**: no cambia comportamiento observable, así que
todo lo que describe el spec 009 más abajo sigue siendo la realidad del código.

Objetivo de 010: que `Comercial / Jev` funcione como playground técnico
(**pegar/editar → validar → guardar → publicar → probar**) en vez de como formulario. Dos
cortes: (1) simplificar la pantalla y corregir la action bar, (2) una **Prueba rápida**
embebida que ejecute un caso ad-hoc por el mismo pipeline sandbox del Laboratorio.

Dos hallazgos de la fase de diseño que conviene tener presentes (evidencia en
`specs/010-playbook-playground-ux/research.md`):

- **Bug confirmado, sin corregir todavía**: `Publicar` se habilita con cambios sin guardar
  (`src/components/agent/playbook/playbook-draft-editor.tsx:150` → `disabled={busy || !dirty}`).
  Como `POST /api/playbook/publish` publica el draft **persistido**, ese botón ofrece
  publicar algo que el admin no está viendo. El corte 1 lo cierra; **hasta entonces, la
  regla segura es guardar antes de publicar**.
- **La Prueba rápida necesita un endpoint nuevo**: `POST /api/lab/runs` solo acepta
  `playbook_mode` y corre la cohorte de personas del servidor, así que no admite input
  ad-hoc. El corte 2 lo resuelve **reutilizando `runSalesOrchestratorTurn`** —la misma
  función que el Laboratorio— mediante un helper de sandbox extraído del runner. No habrá
  segundo motor comercial.

Runner: `scripts/ai/run-playbook-playground-ux.sh` (`START_CUT=1|2`).

---

**Anterior: 2026-10-03 — Corte 3 del spec 009 (runtime publicado EN PRODUCCIÓN).**
**El runtime comercial ya NO está congelado.** `SALES_PLAYBOOK_RUNTIME_ENABLED = true`
(`src/server/sales/build-state.ts:37`). Las conversaciones reales de una organización
con Sales Orchestrator consumen la versión **Published** de SU playbook, sin cache: publicar
o rollbackear surte efecto en el **siguiente turno, sin redeploy**. Los defaults
hardcodeados (`VENDE_VELOZ_*`, `JEV_SALES_QUESTIONS_V2`) quedan como **fallback**, ya no
como fuente única.

Qué cambió en el código (más allá de la constante):

- **T932 — dos defectos de merge corregidos (eran bloqueantes para encender).** Una revisión
  de toda la cadena que toca el flag encontró que el spread shallow
  `{...VENDE_VELOZ_PRODUCT, ...playbook.config.product}` era incorrecto en dos sentidos:
  (1) `ConfigV1.commercial_policy` es **camelCase** (`automationFirst`, `humanHandoff`, …)
  y el state de Jev es **snake_case**: el spread solo solapaba `goal` y `disqualification`,
  así que **6 de las 9 claves de política publicadas se perdían en silencio** y entraban al
  state como claves que Jev nunca leía. (2) `ConfigV1.product` no declara
  `implementation`/`subscription`, así que el spread **arrastraba los bloques hardcodeados
  de Vende Veloz** al state de cualquier organización con playbook de otro negocio (otro
  negocio habría recibido "S/247 al mes" hacia Jev y el writer). Ahora el mapeo es
  **explícito** (`toStateProduct` / `toStatePolicy`) y el playbook gana por completo.
  No se tocó `offer`, `writer` ni `jev_questions`: esos ya reemplazaban bien los defaults.
- **T933 — regresión de congelamiento invertida** (no borrada) en
  `tests/unit/sales-launch-hardcoded.test.ts`: el loader publicado **sí** se invoca en
  producción, la versión usada **sí** se audita, y se añadió el caso de degradación
  (Published ausente y Published inválida → fallback sin crash y sin inventar versión).
- Fixtures de `tests/unit/lab-pipeline-real.test.ts` corregidas: usaban `config: {}`, algo
  que el loader real nunca devuelve (siempre valida con `parseConfigV1`).

Gates: `pnpm typecheck` verde, `pnpm lint` verde (0 errores, 3 warnings preexistentes),
`pnpm build` verde, **868/868 tests en 91 archivos** verdes.

**👉 Precondición operativa antes de esperar tráfico real:** debe existir una **Published**
con el baseline comercial del corte 2. Si no existe, el motor cae al fallback (seguro, con
`console.warn` observable y auditoría en `null`), pero no es lo que se quiere. El paso es que
el administrador la publique desde la UI (ver `docs/playbook.md`).

**Corte 2 del spec 009 (baseline comercial Vende Veloz).**
El **fallback técnico** y el **bootstrap del playbook** quedaron sincronizados con la
decisión comercial vigente de la primera cohorte: **setup 0** (implementación asistida
incluida, sin costo de setup), **S/247/mes**, **50** alumnos activos incluidos y
**+S/1** desde el 51, primer mes pagado por adelantado, sin permanencia obligatoria,
dominio `.com` del primer año cuando la academia lo necesita (si ya tiene uno, se
conecta el existente) y **renovación del dominio desde el 2º año cobrada aparte y sin
encabezar el pitch**. El objetivo comercial del bootstrap pasa a ser **aprendizaje**
(compra/adopción/uso/retención), no maximizar margen.

Cambios de código:

- `VENDE_VELOZ_OFFER` (`src/server/sales/vende-veloz.ts`): `setup 497→0`,
  `monthlyBase 197→247`; `implementation` y `neverPromise` reflejan la
  implementación incluida y la renovación de dominio aparte. El bloque de producto
  (`implementation.price`/`subscription.price`) y la lista de precios legendada de
  `docs/SALES_ORCHESTRATOR.md` se actualizaron **en lockstep** porque el freeze test
  los compara con igualdad exacta.
- `VENDE_VELOZ_PLAYBOOK_V1` (`src/lib/sales/playbook/v1.ts`): mismos números, más
  `implementation.includes`, `neverPromise`, `commercial_policy.goal` (aprendizaje),
  `writer.present_price`, `handoff`, `urgency_rules`, `priorities` y `prohibitions`
  coherentes con **filtrar tráfico**. En `jev_questions` se cambió **solo** el texto de
  `instructions`; `src/server/sales/questions.ts` **NO se tocó** (sigue hash-frozen
  contra el blob upstream).
- `offerBlock` (`src/server/sales/writer.ts`): con `setup = 0` ya no renderiza
  `- Implementación: S/0 una sola vez` (un precio falso que llegaría al lead); declara
  la implementación como **incluida** (DV-7). El default interno de `present_price`
  tenía el mismo problema y se corrigió en el mismo commit.

**Drift preexistente encontrado y corregido:** los `criteria` de
`main_value_proposition` y `real_operational_need` en `v1.ts` **ya divergían** de
`tests/fixtures/jev-questions-v2.json` (el freeze test solo pineaba los `criteria` de
las 3 preguntas `score`, no los de `choice`/`noul`). Se alinearon al texto canónico
para que las 8 preguntas coincidan con la fixture, como exige el corte 2. No se tocó
la fixture ni `questions.ts`, así que el hash `fe3e075…` sigue verde.

**Pendiente reportado, no tocado por estar en zona prohibida:** el writer de
follow-ups (`src/server/sales/follow-ups/follow-up-writer.ts:106`) sigue nombrando
`S/497 / S/197` en la instrucción que prohíbe introducir precio antes de presentarlo.
Con el baseline nuevo esos números son los equivocados. No se modificó porque este
corte prohíbe tocar follow-ups; conviene corregirlo en un corte propio.

Gates: `pnpm typecheck` verde, `pnpm lint` verde (0 errores, 3 warnings
preexistentes), `pnpm build` verde, **867/867 tests en 91 archivos** verdes (nuevo
`tests/unit/playbook-commercial-baseline.test.ts` con 18 casos, más casos de writer y
freeze). E2E no reejecutado: este corte no cambia comportamiento observable del
runtime porque el motor sigue apagado. Commit único:
`feat(playbook): sincronizar baseline comercial Vende Veloz`.

**👉 Paso operativo que falta antes del corte 3 (documentado en `docs/playbook.md`,
sección *"Antes de encender el runtime: publica el baseline comercial"*):**
crear/actualizar y **publicar desde la UI** una versión con este baseline comercial.
Hasta que exista esa publicada, encender el runtime no tiene sentido.

**Actualizado: 2026-10-03 — Corte 1 del spec 009 (Editor técnico JSON del Playbook).**
La pestaña de playbook en Agente pasó de ocho formularios por bloques a **dos
editores JSON técnicos** (`textarea` monoespaciado, sin dependencias nuevas):
**1. Configuración comercial JSON** (`product`, `offer`, `commercial_policy`,
`priorities`, `writer`, `prohibitions`, `handoff`, `urgency_rules`) y **2.
Preguntas Jev JSON** (`jev_questions`). La pestaña se renombró a **Comercial /
Jev**; `Comportamiento` y `Conocimiento` intactas.

Se conserva el ciclo completo (crear draft, validar, guardar, publicar con nota,
historial, rollback, eliminar draft), se muestran versión publicada/draft,
`schema_version` y `version_number`, fechas y notas, y hay un CTA **Abrir el
Laboratorio** hacia `/lab` (el Laboratorio existente; no se duplicó su runner).

**Regla histórica "NO JSON crudo": SUPERSEDED** para esta pestaña. La UI por
formularios nunca se usó para su propósito real; el usuario objetivo edita
configuración técnica. Queda registrado en
`specs/009-playbook-runtime-admin/tasks.md` para que no se lea después como
regresión. Sigue vigente en el resto del producto.

El split Config / Preguntas Jev es una **proyección de cliente**: al guardar se
reassembla `{ ...configEdit, jev_questions: jevEdit }` y se hace
`PUT /api/playbook/draft` con el `ConfigV1` completo, **igual que antes**. Cero
migraciones, cero endpoints nuevos, cero cambios en `ConfigV1Schema`,
`constants.ts`, el loader, la base de datos o el Laboratorio. El cliente **no**
implementa Zod: `POST /api/playbook/validate` sigue siendo la autoridad y los
`details[]` se pintan junto al editor con su `path` literal. Los errores de
sintaxis muestran línea y columna calculadas desde el `position` de `JSON.parse`
(sin inventarlas si el motor no da posición). `fields.tsx` quedó reducido a
`Modal` (lo usan publicar y rollback); los ocho primitivos de formulario se
borraron tras verificar con grep que quedaban **sin ninguna referencia**
(incluido `BlockSection`, que el plan daba por sobreviviente: no lo sobrevivió).

**NO se tocó producción:** `SALES_PLAYBOOK_RUNTIME_ENABLED` sigue en `false`
(eso es el corte 3). Cero cambios en `package.json`. Sender, webhook, CAPI,
follow-ups y option keys contractuales de Jev, sin tocar.

Gates: `pnpm typecheck` verde, `pnpm lint` verde (0 errores, 3 warnings
preexistentes), `pnpm build` verde, **830/830 tests en 89 archivos** verdes
(incluye 11 nuevos en `tests/unit/playbook-json-editor.test.ts`).
E2E: la sección 016 del arnés (`scripts/e2e-selftest.mjs`) cubre el ciclo
completo y los tres caminos infelices (JSON inválido → 400 `bad_json`, Zod
inválido → 422 con `path`, guardarraíl violado → 422), y parsea con
`node --check`; **no se ejecutó en vivo en esta sesión** porque el entorno no
tiene Docker, `psql` ni PostgreSQL ni la app levantada. Queda como verificación
pendiente.
Commit único: `feat(playbook): simplificar editor técnico JSON`.

## Checkpoint de handoff — campaña Vende Veloz lista para operar (2026-10-01)

Corte para retomar en una nueva sesión sin reconstruir contexto:

- Runtime comercial real de Vende Veloz queda deliberadamente en defaults hardcodeados de lanzamiento (`SALES_PLAYBOOK_RUNTIME_ENABLED=false`); Feature 008 queda preservada para V2.
- `JEV_SALES_QUESTIONS_V2`, producto/policy/offer y writer defaults son la fuente operativa de V1; Meta Ads context, resolver, lanes, handoff y CRM effects siguen activos.
- Follow-ups automáticos están estabilizados y verificados: scheduling, worker, cancelación por inbound/manual, 3 intentos, Dormido/STOP, ventana 24 h, retries, lease, concurrencia y tenant isolation.
- Últimos commits de cierre: `dbb0731` (freeze configurable runtime) y `ec70a79` (follow-ups worker).
- Gates del cierre: 818/818 tests; E2E follow-ups 40/40 en entorno real local con PostgreSQL 18.4 + mocks; sin pendiente técnico conocido dentro del objetivo de lanzamiento.
- Configuración operativa requerida en producción: Agente ON + Sales Orchestrator ON + Follow-ups ON; para continuidad fuera de 24 h seleccionar plantilla WhatsApp approved y 0 variables BODY.
- No reabrir Playbook/Lab antes de lanzar salvo bug que afecte conversaciones reales. El siguiente trabajo principal es comercial/marketing: campaña Meta Ads → WhatsApp → Espacio Connect.

**2026-10-01 — Hotfix bloqueante de follow-ups cerrado.**
Reproducido POST `/api/dev/follow-ups/run` → 500 `ERR_INVALID_ARG_TYPE`
con postgres-js/PostgreSQL 18.4 antes de editar: raw SQL recibía `Date` JS.
`claimDueJobs` usa reloj PostgreSQL UTC y precisión de milisegundos, lease
numérico parametrizado de 10 min y fechas RETURNING explícitamente UTC.
Conserva claim atómico, batch 10, SKIP LOCKED y recovery. La sonda dev
adelanta job y schedule del lead juntos (transacción + scope + comparación
con due anterior), evitando un `due_mismatch` artificial del arnés.

Gates: typecheck, lint (0 errores, 3 warnings preexistentes), build y
**818/818 tests en 89 archivos** verdes. E2E completo **40/40 checks verdes**
en localhost:3021 + PostgreSQL efímero 18.4 :55439, zona Lima, mocks HTTP
Jev/writer/Graph: A–E, concurrencia sin duplicados, retry sin consumir intento,
lease abandonado/vigente, HUMAN/STOP/handoff/OFF, dos tenants y sandbox sin
Graph. Arnés durable: `scripts/e2e-follow-ups.mjs`; detalle de reproducción
local en `docs/SALES_FOLLOW_UPS.md`. Sin cambios a estrategia, pricing,
Playbook, Jev questions, Lab, Meta Ads, resolver ni writer principal.
Commit único: `fix(follow-ups): estabilizar worker para lanzamiento`.
Sin pendientes de este E2E; despliegue productivo fuera de esta sesión.

**2026-10-01 — Hotfix de lanzamiento Vende Veloz.**
Feature 008 preservada pero runtime configurable pospuesto a V2.
Campaña inicial de Vende Veloz opera con estrategia hardcodeada conocida
para reducir riesgo y salir a producción.

`SALES_PLAYBOOK_RUNTIME_ENABLED=false`: conversaciones reales no cargan
publicada; producto/policy/questions/offer y writer usan defaults conocidos.
Auditoría `playbook_version_id`/schema/number y FK quedan null. Agent Profile,
resolver, lanes, handoff, Meta attribution y CRM effects se conservan.
Tablas, migraciones, datos, versiones, API/UI y Laboratorio preservados.
V2 puede reactivar la constante en `src/server/sales/build-state.ts`.

Verificación: typecheck, lint (0 errores, 3 warnings preexistentes), build y
**817/817 tests en 89 archivos** verdes. Regresión con builder/orquestador/
resolver reales cubre publicada V1 y cambio posterior, defaults completos,
Meta Ads, perfil, lane, entrega, facts, scheduling y scope en dos tenants.
Mutation check: reactivar la constante hace fallar la regresión.
E2E comercial **22/22 checks verdes** contra copia local en localhost:3019,
PostgreSQL efímero :55439 y mocks HTTP Jev/writer/Graph. Se capturaron payloads
antes/después de publicar producto/policy/offer/questions/writer modificados;
se observó outbound, auto_close, precio durable y auditoría null. Jev inválido
registró error sin nuevo outbound (camino infeliz).

**Antecedente (resuelto por el hotfix de follow-ups arriba):** subset del arnés existente ejecutado,
**16/26 checks**, con respuesta inicial y scheduling verdes. El tick devuelve
500 por `ERR_INVALID_ARG_TYPE` al serializar `Date` en `claimDueJobs`
(`src/server/sales/follow-ups/worker.ts:105`) en PostgreSQL local 18.4.
Ese worker no cambia en este hotfix; envío, agotamiento por silencio y bloqueo
por ventana cerrada NO quedan verificados. No se declara READY punta a punta.
El error del worker y el self-test se cerraron en el hotfix separado arriba;
deploy del hotfix por flujo habitual
no ejecutado aquí. Decisión comercial de congelar 008 debe sincronizarse en Obsidian.
Commit único: `fix(sales): congelar playbook configurable para lanzamiento`.

**Actualizado: 2026-10-01 — Hotfix productivo del Laboratorio comercial (Feature 008).**
Una corrida REAL en modo Borrador terminó con score/judge pero con los tres
`actual_*` vacíos. Causas confirmadas: runner sin lead (el orquestador retornaba
por `leadId=null`) y writer sandbox sin `deliverReply` (sin outbound ni facts
de entrega). Ahora cada caso crea contacto archivado único por run/case y lead
nuevo vía gateway, en la primera etapa open del tenant por position; sin etapa
open falla explícitamente. Los defaults del INSERT mantienen todos los facts
limpios, sin reutilización entre Published/Draft o corridas. `deliverReply`
persiste outbound local en `is_test=true`, sin WhatsApp real; siguen suprimidos
follow-ups y protegido CAPI. Se copian transcript/outcomes antes del judge y
se limpia el contacto en finally por cascada (lead/conversation/messages);
`agent_test_case` conserva resultado y versión, con conversation_id SET NULL.
Board excluye `contact.archived_at IS NOT NULL`, también para contactos reales.
Expected manual nullable sigue mostrando actual a la derecha. Sin cambios a
Playbook V1, sin publicación de Draft V2, pricing ni estrategia.

**Evidencia del hotfix:** typecheck, lint (0 errores, 3 warnings preexistentes),
build y **815/815 tests en 88 archivos** verdes. Runner ahora usa builder,
orquestador, resolver y delivery reales con Jev/writer mock; pruebas cubren
lead inicial limpio, historial/facts entre turnos, outcomes, aislamiento both,
board, legacy, fallo de judge y falta de etapa. Al reintroducir cada bug, su
regresión falla. `node --check scripts/e2e-selftest.mjs` verde.

**E2E real del Laboratorio EJECUTADO:** sección 015 aislada del arnés en copia
temporal de app (`/tmp/lab-hotfix-app`, localhost:3018), PostgreSQL local y
Graph/LLM/Jev apuntando a mocks locales: **33/33 checks verdes** (Published,
Draft, both, transcript cliente+agente, judge, actuals, versiones, expected,
board, 422 modo/versión inválidos, 404 caso inexistente, outbox vacío). El
fixture local requirió aplicar migraciones existentes pendientes y sembrar
perfil/etapas de su org de prueba, además de configurar modelo mock. Consulta
PostgreSQL posterior: **24 casos durables**, **0 actuals faltantes**, **0 FK de
conversación temporal**, **0 contactos sandbox/leads/conversaciones/mensajes**,
**0 follow-up jobs**, **0 eventos CAPI** en esa org E2E. El E2E completo de
otros módulos no se reejecutó; sus pendientes históricos no se cierran aquí.
Commit único previsto: `fix(lab): ejecutar pipeline comercial real en sandbox`.
Siguiente paso: desplegar este commit por el flujo habitual; repetir Borrador
para comprobar el reporte productivo (sin publicar V2).


**Actualizado:** 2026-10-01 (Corte 7 del spec 008 — **CIERRE de la feature 008, Sales Playbook durable**. La estrategia comercial que estaba congelada en TypeScript (`VENDE_VELOZ_*` / `JEV_SALES_QUESTIONS_V2`) pasó a ser configuración durable, versionada, tenant-safe y editable sin redeploy: el motor sigue igual y solo consulta la versión publicada. Los siete cortes quedaron cerrados. Este corte agrega "Guardar conversación como caso" (`POST /api/lab/cases/from-conversation`) con **PII minimizada**: la nueva tabla `lab_case` **no tiene columna de identidad** (garantía estructural, no disciplina de código) y encima el texto se sanea server-side (`[telefono]`, `[email]`, `[enlace]`, `[id]`), porque un cliente suele dictar su propio número dentro de un mensaje. El `conversation_id` se usa solo como input autenticado y nunca se persiste. El bootstrap en boot ahora loguea explícitamente por org ("Playbook V1 sembrada" / "ya existente" / "Org X no tiene Sales Orchestrator; sin playbook"). Decisión documentada: los defaults congelados **no se borran**, quedan como `DEFAULTS_ONLY` — red de arranque del runtime y baseline de regresión de los tests. Gates: typecheck/lint/build verdes, **810/810 tests en 88 archivos** (23 nuevos), `bash -n` del runner AI verde. **E2E en vivo PENDIENTE**: este entorno no tiene Docker, `psql` ni PostgreSQL y la app no está levantada; la sección 013 extendida parsea (`node --check`) pero no se ejecutó. Guía del dueño en `docs/playbook.md`.)

**Actualizado:** 2026-10-01 (Corte 6 del spec 008 — **Laboratorio comercial**: el Laboratorio dejó de evaluar solo el agente genérico y ahora corre el **pipeline comercial real** (Sales Orchestrator + Jev + resolver + writer) sobre conversaciones sandbox, con override de Playbook por caso y comparación **Published vs Draft**. Gaps cerrados: `agent_test_case` persiste `playbook_version_id`/`playbook_schema_version` (migración aditiva `0008b`), outcomes esperados declarados a mano por el dueño con ✅/❌ en el reporte, y 6 personas V1 comerciales de academias deportivas. Las 6 ferreteras **no se eliminan**: quedan como `legacy_*` con alias para el histórico. Cero efectos residuales verificado por test: sin WhatsApp real (spy sobre `graphRequest`), sin filas en `sales_follow_up_job` y sin CAPI en corridas `is_test=true`. Cambió el índice de concurrencia de corridas: el lock pasó de UNIQUE(organización) a UNIQUE(organización, `playbook_mode`) para que `both` corra published y draft en paralelo. Gates: typecheck/lint/build verdes, 787/787 tests en 87 archivos (29 nuevos). **E2E en vivo y self-test con `pnpm dev` + mocks PENDIENTES**: este entorno no tiene Docker, `psql` ni PostgreSQL, y la app no está levantada; la sección 015 del arnés E2E está escrita y parsea, pero no se ejecutó. NO se tocó el runtime productivo: el override solo aplica con `is_test=true` y sigue validado por el guard T306 del orquestador.)

**Actualizado:** 2026-09-30 (Hotfix Sales Orchestrator — contexto de Meta Ads en estado Jev. El builder `buildJevSalesState` ahora consulta `ad_attribution` tenant-safe y, cuando la fila existe con al menos un campo comercial (`source_type`/`headline`/`body`), emite `source: "Meta Ads"` + `ad_context: { source_type, headline, body }` en el state que Jev evalúa. Contrato jevveloz 89/89 restaurado para conversaciones atribuidas; conversaciones orgánicas sin cambios observables. Commit único `fix(sales): conservar contexto de Meta Ads en estado Jev`. Gates re-verificados: typecheck/lint/build verdes, 660/660 tests, 74 archivos (650 anteriores + 10 nuevos del hotfix). NO se tocó: questions-v2, commercial-policy, resolver, writer, Jev, follow-ups ni CAPI. Defensa Constitución I verificada: el state no contiene `ctwa_clid`, `sourceId`, `sourceUrl`, `imageAssetId`, access tokens ni PII del contacto.)

**Actualizado:** 2026-09-29 (Corte 9 — auditoría final de readiness para Vende Veloz. Gates técnicos re-verificados: typecheck/lint/build verdes, 646/646 tests, 74 archivos. `docs/VENDEVELOZ_LAUNCH_CHECKLIST.md` publicado con bloques A/B/C/D. Pendiente único externo: clic CTWA real contra Meta + self-test E2E local con app+Postgres. Ningún flag de producción fue tocado en este corte.)

**Hotfix 2026-09-29 (post-Corte 9):** `drizzle/meta/_journal.json` ahora
registra las migraciones `0006_anuncio_de_origen` y `0007_meta_capi` (que
existían en disco pero no estaban en el journal, por lo que el
`scripts/migrate.mjs` de arranque nunca las aplicaba y `/api/conversations`
rompía en producción por el LEFT JOIN contra `ad_attribution`). Commit
único `fix(db): registrar migraciones 0006 y 0007 en Drizzle journal`. Gates
re-verificados: typecheck/lint/build verdes, 650/650 tests, 74 archivos;
`drizzle-orm/migrator` descubre 8 migraciones (antes 6). Sin verificación
en vivo punta a punta con Postgres (no había BD local disponible en este
turno); producción debería migrar al próximo reinicio del contenedor sin
más acciones manuales.
**Branch:** `main`
**Baseline funcional previo a esta sincronización documental:** `bbae7cd1dfd98d5006cfd26440a8acf1def2c1bb`
**Propósito:** checkpoint técnico rápido. Las decisiones de negocio viven en el cerebro de Obsidian; la implementación y la historia SDD viven aquí.

---

## 1. Cómo recuperar contexto

Leer, en este orden:

1. `AGENTS.md`
2. `.specify/memory/constitution.md`
3. este archivo
4. spec activo en `specs/`
5. docs de dominio
6. código + tests reales

El flujo SDD completo está en `docs/sdd-workflow.md`.

---

## 2. Arquitectura actual

El repo actual refleja:

- Next.js 15 App Router + React 19
- TypeScript estricto
- PostgreSQL + Drizzle ORM
- Better Auth + organizations
- SSE para tiempo real
- WhatsApp Cloud API
- OpenRouter-compatible para LLM
- TypeSafe/Jev opcional para Sales Orchestrator
- Vitest + self-test E2E
- Docker multi-stage
- despliegue soportado con Coolify o docker compose + Caddy

El contexto histórico que hablaba de Ploi/PM2 ya no describe el estado técnico actual del repositorio.

---

## 3. Multi-organización

La instalación interna de Espacio Connect opera tres organizaciones:

- Max Quispe
- Vende Veloz 365
- Espacio Veloz

El modelo de datos es tenant-safe y el acceso de dominio debe pasar por
`organization_id` / `scoped()`.

Los docs upstream siguen describiendo “una instancia = un negocio” para
despliegues externos. Interpretación vigente:

- **operación interna:** tres organizaciones aisladas en la misma instalación;
- **producto externo v1:** no generalizar esta excepción interna a una plataforma
  SaaS centralizada.

---

## 4. WhatsApp

La base madura incluye:

- webhook Meta;
- contactos y conversaciones;
- inbox;
- texto/media/templates;
- ventana de 24 h;
- sandbox;
- SSE;
- credenciales tenant-safe;
- sincronización de templates.

Regla: no reescribir webhook/inbox/sender salvo bug real o spec nuevo.

---

## 5. WHMCS → Espacio Veloz

Endpoint único:

`POST /api/integrations/whmcs/events`

Código relevante:

- `src/app/api/integrations/whmcs/events/route.ts`
- `src/server/integrations/whmcs/hmac.ts`
- `src/server/integrations/whmcs/payload.ts`
- `src/server/integrations/whmcs/invoice-created.ts`
- `src/server/integrations/whmcs/invoice-paid.ts`

Estado:

- HMAC sobre body crudo + timestamp.
- Organización fijada server-side a `espacio-veloz`.
- `integrationEvent` durable con idempotencia por organización/source/event/external id.
- Política at-most-once para evitar WhatsApps duplicados.
- `invoice.created` usa template aprobado con variables y botón URL dinámico.
- `invoice.paid` usa template aprobado con 4 variables y sin botón.
- Tests cubren duplicados secuenciales/concurrentes, aislamiento tenant y
  convivencia de created/paid para el mismo invoiceId.

Evidencia operativa histórica: ambos eventos quedaron probados en producción en
agosto de 2026.

Regla de negocio con impacto técnico:

> WHMCS decide CUÁNDO; Espacio Connect decide CÓMO comunicar por WhatsApp.

No crear cron paralelo de cobranza en el CRM.

---

## 6. Sales Orchestrator — Vende Veloz 365

Documento durable: `docs/SALES_ORCHESTRATOR.md`.

Estado implementado:

- opt-in por organización;
- OFF = agente legacy;
- Jev interpreta estado comercial;
- código determinístico resuelve lane/efectos;
- GPT/OpenRouter redacta;
- lane y pipeline son conceptos separados;
- lanes: AUTO / AUTO_CLOSE / WAIT / HUMAN / STOP;
- HUMAN hace handoff;
- STOP no equivale automáticamente a `lost`;
- fallo Jev no inventa decisión;
- sandbox no toca Meta;
- UI muestra estado comercial.

Último freeze registrado: typecheck/lint/test/build verdes con 382 tests.
E2E/live Jev quedó pendiente en ese checkpoint por falta de app local y
credenciales TypeSafe/Jev.

### Checkpoint técnico — núcleo reusable vs. configuración Vende Veloz

El Sales Orchestrator **ya está cableado al flujo real del inbox** cuando
`agent_profile.sales_orchestrator_enabled=true`. Ruta vigente:

`ingest → maybeRunAgentTurn → runAgentTurn → runSalesOrchestratorTurn → Jev → resolver determinístico → writer → efectos CRM`.

Piezas que hoy funcionan como núcleo reusable:

- `src/server/sales/client.ts`: adaptador TypeSafe/Jev aislado, endpoint completo por env, retries y degradación segura;
- `normalize.ts` / `decision.ts`: frontera raw provider → decisión tipada;
- lanes y estado durable del lead;
- resolver determinístico de lane/efectos;
- handoff humano;
- follow-ups durables;
- separación estricta Jev = interpretación, CRM = efectos, writer = redacción.

Piezas todavía específicas del funnel/campaña **Vende Veloz 365**:

- `src/server/sales/vende-veloz.ts`: producto, política comercial y oferta;
- `src/server/sales/questions.ts`: preguntas y criterios Jev del funnel actual;
- `build-state.ts`: inyecta producto/política Vende Veloz al state;
- `writer.ts`: prompt, pricing, claims y reglas de respuesta de Vende Veloz;
- parte de `next_action` / semántica del resolver refleja ese proceso comercial.

### Decisión de continuidad — DEFERRED multi-campaign

**No generalizar ahora.** La prioridad inmediata es poner Vende Veloz en
operación real con lo ya construido y corregir únicamente evidencia que aparezca
en producción.

Cuando exista la siguiente campaña comercial concreta, abrir un nuevo spec SDD para
extraer la configuración específica hacia un concepto de **Campaign Playbook**.
La unidad de estrategia será la campaña, no la organización completa: una misma
organización podrá tener campañas diferentes con reglas diferentes.

Dimensiones candidatas del futuro playbook, sin definir todavía schema ni CRUD:

- Product / Offer Context;
- Jev Evaluation Questions;
- Lead Management Policy (autogestión, lane, pipeline, next action);
- Human Handoff Policy;
- Writer Policy;
- Follow-up Policy.

El trabajo futuro debe **extraer/injectar configuración alrededor del núcleo
existente**, no reescribir Jev ni el Sales Orchestrator. Vende Veloz queda como
primer playbook concreto y baseline de regresión.

**Punto de reanudación:** segunda campaña real → comparar sus necesidades con
Vende Veloz → abrir spec → extraer únicamente lo que efectivamente deba variar.

---

## 7. Follow-ups comerciales

Documento durable: `docs/SALES_FOLLOW_UPS.md`.

Implementado hasta phase 22:

- tabla/job durable;
- secuencias `awaiting_reply`, `after_demo`, `after_price`;
- `scheduled_wait` one-shot;
- máximo 3 intentos comerciales;
- inbound cancela pending y resetea resumen;
- respuesta manual cancela automatización;
- worker in-process con claim `FOR UPDATE SKIP LOCKED`;
- lease y retries técnicos separados del intento comercial;
- revalidación inmediatamente antes del side effect externo;
- ventana abierta → writer + texto;
- ventana cerrada → template approved 0-var;
- sin template → `template_required`, no texto libre;
- tercer intento sin respuesta → Dormido: STOP + `no_reply_exhausted`, sin
  mover pipeline a lost;
- flags del agente/Orchestrator/follow-ups bloquean correctamente ejecución;
- UI permite programar/cancelar/reactivar.

### Verificación registrada

| Gate | Estado |
|---|---|
| `pnpm typecheck` | verde |
| `pnpm lint` | verde |
| `pnpm test` | verde — 420 tests |
| `pnpm build` | verde |
| `pnpm test:e2e` | pendiente |

El E2E no se ejecutó porque en esa sesión no había app/PostgreSQL local
disponibles. Por Constitución, este bloque **no está verificado punta a punta**
hasta correr el self-test real.

---

## 8. Cobertura SDD existente

Specs formales actuales:

- `specs/001-vocero-core/`
- `specs/002-diseno-atlas-white-label/`
- `specs/003-paridad-inbox-whatsapp/`
- `specs/004-inbox-messaging-ux/` (cola de adjuntos del composer + UX polish, cerrado)
- `specs/005-quick-lead-name/` (edición inline de `contact.name` desde el panel del inbox — **CERRADO** en commit único)
- `specs/006-anuncio-de-origen/` (de qué anuncio de Meta llegó cada conversación — **CERRADO**, pieza visible sin CAPI todavía)
- `specs/007-meta-capi/` (reportar `QualifiedLead` y `Purchase` a Meta Conversions API — **CERRADO** en Cortes A+B+C tras commit único de cierre)
- `specs/008-sales-playbook/` (playbook comercial durable, versionado y editable sin redeploy — **CERRADO** en Cortes 1–7 tras commit único de cierre)

### Estado del spec 008 — Sales Playbook versionado

**Cerrado el 2026-10-01** en siete cortes secuenciales, cada uno con su
commit atómico. El objetivo era uno solo: que la estrategia comercial
(producto, oferta, política, preguntas de Jev, instrucciones del writer)
dejara de estar congelada en TypeScript y pasara a ser **configuración
durable, versionada, tenant-safe y editable sin redeploy**.

El motor (Sales Orchestrator, Jev, resolver, lanes, writer, follow-ups)
**no se reescribió**: solo se le agregaron adaptadores que consultan la
versión publicada. El runtime pasó de "conocer la estrategia" a
"consultar la estrategia publicada en su versión X".

#### Historia técnica — fecha de cierre de cada corte

| Corte | Contenido | Cerrado |
|---|---|---|
| 1 | Modelo y persistencia: `sales_playbook` + `sales_playbook_version`, schema Zod versionado, contenido V1, store con `scoped()`, bootstrap multi-org determinista | 2026-09-30 |
| 2 | API de versionado: `GET /api/playbook`, draft (POST/PUT/DELETE), validate, publish, rollback, versions (list/detalle) | 2026-09-30 |
| 3 | Runtime dinámico: loader sin cache, `buildJevSalesState` con config publicada, contrato dinámico de preguntas Jev, `SalesDecision` nullable con fallbacks, override solo `is_test`, supresión de follow-ups en sandbox, snapshot de versión en el lead | 2026-09-30 |
| 4 | UI Playbook: tabs en `agent-client.tsx`, editor por bloques, lista de versiones, publish/rollback con `notes` | 2026-09-30 |
| 5 | Editor Jev avanzado: tres clases con guardarraíles duros, candados por clase, editor inline por pregunta | 2026-09-30 |
| 6 | Laboratorio comercial: pipeline real en sandbox, override por corrida, expected outcomes humanos, comparación Published vs Draft | 2026-10-01 |
| 7 | Casos reales + auditoría + cierre: "Guardar conversación como caso" con PII minimizada, logs de bootstrap por org, E2E final, docs | 2026-10-01 |

#### Decisiones (todas revisables)

- **`VENDE_VELOZ_*` y `JEV_SALES_QUESTIONS_V2` son `DEFAULTS_ONLY`.**
  No se borraron. El runtime los consume **solo** cuando la organización
  no tiene versión publicada, de forma explícita y visible. Los tests los
  importan directamente como baseline congelado de regresión. Borrarlos
  tiraría la red de seguridad del arranque y rompería la red de tests a
  cambio de nada.
- **El runtime prefiere siempre la publicada.** El fallback es una red de
  seguridad, no un modo de operación: si aparece en los logs, hay que
  publicar una versión. Cada decisión persistida queda con
  `playbook_version_id` (columna denormalizada en `lead` + clave dentro del
  JSONB `last_jev_decision`), así que la degradación es visible y
  auditable, nunca ambigua.
- **Sin cache de playbook en V1.** El loader lee BD en cada turno; un
  publish/rollback toma efecto en el turno siguiente. Con el volumen
  actual, un SELECT es más barato que la complejidad de mantener un cache
  coherente, y Jev + writer cuestan muchísimo más que esa lectura.
  Optimización futura solo si las métricas lo exigen.
- **Bootstrap multi-org determinista.** Enumera
  `agent_profile WHERE sales_orchestrator_enabled = true` de forma
  explícita; nunca usa `SELECT organization.id LIMIT 1` ni heurísticas.
  Idempotente: una org ya sembrada genera cero inserciones, y una org con
  el orchestrator apagado **nunca** se siembra (y ahora eso se loguea
  explícitamente, para que un opt-in apagado por error sea diagnosticable).
- **Override de Playbook solo en `is_test=true`.** `runSalesOrchestratorTurn`
  lanza `playbook_override_forbidden_in_production` si recibe un override
  sobre una conversación no sandbox. En producción el override es siempre
  `undefined`; el Laboratorio es el único que lo inyecta, y el Laboratorio
  solo corre sobre `is_test=true`.
- **Tres clases de preguntas Jev**, con contratos distintos:
  `engine-required` 🔒 (`next_action`, `needs_human_call` — key, type,
  option keys y `enabled` inmutables), `known signals` 📊 (6 preguntas —
  key/type/option keys bloqueados, `enabled` editable con fallback
  documentado) y `analytical/custom` ➕ (libres; se preservan en
  `decision.signals` y **nunca** influyen en una decisión).
- **Sandbox suprime scheduling de follow-ups.** El orquestador detecta
  `is_test=true` y no llama a `scheduleNextFollowUp`, de modo que una
  corrida del Laboratorio termina con cero filas en
  `sales_follow_up_job`. Junto con el guard del sender (no toca WhatsApp
  real) y el de CAPI (no emite eventos), el Laboratorio no deja efectos
  residuales.
- **El caso de conversación real vive en `lab_case`, no en
  `agent_test_case`.** Es una decisión de Constitución I: la garantía de
  PII minimizada es **estructural** (la tabla no tiene columna de
  identidad) y no una disciplina de código. Reutilizar `agent_test_case`
  habría obligado a fabricar una corrida y habría dejado una columna
  `conversation_id` lista para colar un id.

#### PII minimizada — "Guardar conversación como caso"

El caso persistido contiene **únicamente**: `transcript`
(`{ role: 'cliente' | 'agente', text }[]`, solo texto), `playbook_version_id`,
`playbook_schema_version`, los expected outcomes editables y metadata no
identificante (`turns_approx`, `chars_total`, `detected_language`).

**Nunca** contiene `lead_id`, `contact_id`, `conversation_id`, `phone`,
`email`, `wa_identity`, `ctwa_clid`, `source_id`, `source_url`, IDs de
Meta, tokens de credenciales, ni ninguna combinación que permita
reconstruir la identidad original. El `conversation_id` se usa **solo**
como input autenticado para leer la conversación del tenant.

Encima de la garantía estructural, el **texto** se sanea server-side
(`src/server/lab/case-pii.ts`): teléfonos → `[telefono]`, emails →
`[email]`, enlaces → `[enlace]`, tokens de plataforma → `[id]`. Esto
importa porque un cliente suele dictar su propio número dentro de un
mensaje: sin el saneador, el caso devolvería un camino a la identidad
real. Precios, fechas y números cortos se conservan porque no son
identidad y son justo lo que el juez necesita evaluar.

#### Verificación del cierre (Corte 7)

| Gate | Estado |
|---|---|
| `bash -n scripts/ai/run-sales-playbook.sh` | verde |
| `pnpm typecheck` | verde |
| `pnpm lint` | verde (warnings preexistentes de `<img>`, ajenos a este corte) |
| `pnpm build` | verde |
| `pnpm test` | verde — **810 tests, 88 archivos** (23 nuevos en `lab-case-from-conversation.test.ts`) |
| E2E en vivo (`pnpm test:e2e`) | **PENDIENTE en este entorno** — sin Docker, `psql` ni PostgreSQL, y la app no está levantada. La sección 013 extendida **parsea** (`node --check`), pero no se ejecutó |

Los snapshots históricos de `last_jev_decision` siguen siendo compatibles:
las claves nuevas (`playbook_version_id`, `playbook_schema_version`,
`playbook_version_number`) son aditivas y su ausencia en snapshots viejos
se interpreta como ausencia de playbook, no como error.

#### Riesgos conocidos

- **Publicar cambia producción en el turno siguiente.** No hay cache ni
  periodo de gracia: lo que se publica es lo que el agente dice en la
  siguiente conversación. Publicar solo lo que ya pasó por el Laboratorio.
- **Un `schema_version` desconocido se rechaza en rollback (422)** porque
  no hay migrador de config. Es deliberado: es preferible fallar visible
  a aplicar una config que el motor no entiende.
- **El fallback a defaults es visible pero silencioso para el dueño.** El
  warning va al log del servidor, no a la UI. Un despliegue con la
  organización sin playbook sembrada opera con la estrategia congelada.
- **1 playbook por organización en V1.** La forma soporta multi-playbook
  (slug + label), pero no hay UI ni runtime para elegir. Multi-campaña
  sigue reservado.
- **`expected_*` usan catálogos cerrados** (7 `next_action`, 5 lanes) para
  que un typo no se persista y luego compare ❌ para siempre.
- **El E2E en vivo de los cortes 3, 6 y 7 sigue pendiente** de un entorno
  con el stack levantado. Los gates técnicos y la suite unitaria están
  verdes; por Constitución IX eso no equivale a "READY punta a punta"
  hasta correr el self-test real.

Guía del dueño: [`docs/playbook.md`](./playbook.md). Detalle del
Laboratorio comercial: `docs/SALES_ORCHESTRATOR.md` y
`docs/SALES_FOLLOW_UPS.md`.


### Estado del spec 006

**Cerrado el 2026-09-29** en dos cortes A+B tras el commit 0 documental.
Puerto selectivo de la spec 018 del upstream `kevinrivm/vocero-crm`: trae
la pieza visible al raíz (bandeja con marca de anuncio, panel con tarjeta
del creativo, filtro Anuncios, copia best-effort del thumbnail al volumen
de adjuntos) sin arrastrar su pila multitenant, su CAPI ni su spec 016
previa.

**Implementación entregada (corte A — servidor/datos, cerrado):**

- **Tabla nueva `ad_attribution`** con UNIQUE `(organization_id,
  conversation_id)` y migración aditiva `0006_anuncio_de_origen.sql`
  re-ejecutable. En este repo la tabla no existía y la creamos completa
  desde cero; mismo shape de columna que la 0014 del upstream 018.
- **Normalización pura** del `messages[].referral` de WhatsApp en
  `src/server/attribution/referral.ts`. Cotas: id 128, titular 300,
  texto 2000, URL 2048, raw 8 KB. `ctwa_clid` se trata como si la futura
  bandera `ATRIBUCION` estuviera **apagada**: la columna se guarda NULL y
  el `raw` no contiene la clave. La promesa del futuro spec 007 (una
  instancia que no atribuye no acumula identificadores de clic) se
  respeta desde el primer despliegue.
- **Imagen del creativo** copiada best-effort fuera del webhook a un
  `media_asset` con defensa SSRF (allowlist cerrada de hosts de Meta +
  `https://` obligatorio + tope 1 MB + timeout 3 s). Una descarga por
  `(organization_id, source_id)` deduplicada en memoria.
- **DTO `ConversationDto.anuncio`** con `{ headline, sourceId, sourceType
  }` para la lista, y **`AnuncioDto`** completo (sin el valor del
  `ctwa_clid`: solo `hasCtwaClid: boolean`) para el detalle del contacto y
  el evento SSE `conversation.updated`.
- **Conversaciones orgánicas** quedan iguales: sin marca, sin tarjeta,
  sin línea secundaria, sin cambio en el filtro.

**Implementación entregada (corte B — UI + E2E + cierre, este commit):**

- **Componente reusable `AnuncioOrigen`** en
  `src/components/anuncio-origen.tsx`: miniatura del creativo (o
  placeholder "Sin imagen" cuando la descarga falló), titular, body
  recortado a 2 líneas, "Primer mensaje · hace X", badge "con video",
  `ID <sourceId>`, enlace "Ver anuncio" solo si la URL es `https://`,
  punto "clic CTWA atribuido" cuando `hasCtwaClid === true`. Defensa
  explícita: jamás muestra el valor del `ctwa_clid`, solo presencia.
- **Helpers de glosario** (`etiquetaDeOrigen`, `titularDeOrigen`,
  `cuentaComoAnuncio`) en `src/lib/anuncios.ts` — el primero decide
  "Anuncio" vs "Publicación", el segundo decide el titular visible, y
  el tercero es el criterio del filtro (solo `sourceType === "ad"`).
- **Marca en la lista** (`conversation-list.tsx`): debajo del nombre del
  contacto aparece el chip «Anuncio · titular» o «Publicación · titular»
  con truncado y ellipsis cuando el espacio aprieta. Sin origen, no se
  muestra nada.
- **Filtro Anuncios** (`conversation-list.tsx`): chip con icono
  `Megaphone` y contador, solo aparece si hay al menos una conversación
  de anuncio en la bandeja actual (post-búsqueda + post-etapa). Es
  mutuamente excluyente con "No leídas" (decisión TB02 del spec).
- **Tarjeta en el panel lateral** (`contact-panel.tsx`): se inserta
  entre el header del contacto y el stepper de etapa cuando
  `GET /api/contacts/:id` devuelve `anuncio !== null`. Se rehidrata en
  cada `refreshLive` (SSE) sin tocar las notas. Si la imagen llega
  tarde, `key={imageAssetId ?? "none"}` fuerza re-render.
- **Línea secundaria en el pipeline** (`pipeline-client.tsx`): debajo
  del nombre del lead aparece «Anuncio · titular» o «Publicación ·
  titular» cuando el board trae origen; sin origen, no se muestra.
  Refactor mínimo: cero cambios en dnd-kit ni en el comportamiento de
  arrastre.
- **E2E automatizado** (`tests/e2e/011-anuncio-de-origen.md` +
  `runSection011` en `scripts/e2e-selftest.mjs`): cubre los 10 caminos
  del TB05 — orgánica, con referral, primer anuncio gana, reentrega,
  publicación deduce fuente "desconocida", imagen fuera de allowlist no
  rompe el inbound, filtro Anuncios, tenant isolation. El arnés existente
  del self-test se reusa tal cual; no se copia infraestructura.

Restricciones respetadas:

- Sin Marketing API, sin nombre de campaña / adset / ad (Meta no los
  entrega en el `referral`).
- Sin Conversions API, sin `Ajustes → Anuncios`, sin envío a Meta →
  spec 007.
- Sin cambios en Sales Orchestrator, Jev, follow-ups, sender,
  `window.ts`, `agent_profile`.
- Cero nuevas dependencias npm.
- Migración ADITIVA y tenant-safe: `organization_id NOT NULL` con
  índice org-first, FK con `ON DELETE CASCADE` a `organization`,
  `contact` y `conversation`.
- `ctwaClid` nunca sale por API: el DTO expone `hasCtwaClid: boolean`
  únicamente. Defensivamente, si Meta mandase `source_url: "http://"`
  la UI no renderiza el anchor.

**Verificación actual (este PR de cierre — corte B):**

| Gate | Estado |
|---|---|
| Constitution Check | sin violaciones |
| `pnpm typecheck` | verde |
| `pnpm lint` | verde |
| `pnpm build` | verde |
| `pnpm test` | verde — 594 tests |
| Self-test E2E (sección 011) | script agregado al arnés existente |
| E2E en vivo (`pnpm test:e2e` con app + BD + mocks) | **PENDIENTE en este entorno** — sin app local ni PostgreSQL activa |
| Playwright visual (TB07) | **PENDIENTE HUMANO/PRODUCCIÓN** — requiere clic CTWA real en producción |
| Clic CTWA real en producción | **PENDIENTE HUMANO/PRODUCCIÓN** — la imagen, el `oe=` del CDN y la calidad del JSON real de Meta solo se confirman en producción |

El spec 006 está **verificado unitariamente punta a punta** y la sección
011 del self-test está agregada al arnés, pero **NO verificado en vivo
punta a punta** hasta correr Playwright manual contra `pnpm dev` local
(pasos 1–10 de `tests/e2e/011-anuncio-de-origen.md`) y un clic CTWA real
en producción. Por Constitución IX no debe reportarse como READY punta a
punta hasta entonces. La verificación pendiente es del mismo tipo y
gravedad que las secciones 008, 009 y 010: si el entorno local no tiene
app ni BD activas, queda registrada como pendiente y se ejecuta en el
siguiente checkpoint que disponga de la app levantada. La verificación
del clic CTWA real **no es automatizable** y queda marcada como
PENDIENTE HUMANO/PRODUCCIÓN, igual que el upstream.

### Estado del spec 007

**Abierto el 2026-09-29** (este commit 0, sin código de implementación).
Adaptación selectiva del upstream 016 (`kevinrivm/vocero-crm`, commits
`0a154ea2711ad5350e20451c573a7863b926cfed` y
`75124422bba2298bb21cf3e712cae16b31f01ce2`) — `specs/016-atribucion-capi/`
y `docs/atribucion-capi.md`. **No es un port ciego**: este fork tiene
Sales Orchestrator (Jev) que hoy escribe `lead.stageId` por su propio
camino, y la etapa calificada la elige cada negocio (no se hardcodea
"Interesado").

**Alcance declarado (tres cortes secuenciales):**

- **Corte A — puerta única de etapa.** Refactor neutro. Los 6 callsites
  runtime que escriben `lead.stageId` hoy
  (`app/api/pipeline/leads/[id]/route.ts`,
  `app/api/pipeline/stages/[id]/route.ts`,
  `app/api/bot/reset/route.ts`, `server/ai/pipeline.ts`,
  `server/sales/orchestrator.ts`, `server/inbox/lead-activity.ts`)
  migran a un único helper `moveLeadStage(...)` tenant-safe. Cero
  cambios observables, cero llamadas externas, sin CAPI todavía. El
  Sales Orchestrator deja de escribir `lead.stageId` directamente:
  pasa por la puerta común conservando lanes y facts intactos.
- **Corte B — CAPI core + schema + APIs.** Migración aditiva
  `drizzle/00XX_meta_capi.sql` con `conversion_event` (UNIQUE
  `(organization_id, conversation_id, event_name)` para dedup
  durable) y `capi_settings` (config cifrada AES-256-GCM). Nuevo
  `src/lib/meta/capi.ts` (catálogo cerrado `QualifiedLead`/`Purchase`,
  validación Zod, acuse real `events_received >= 1`). Nuevo
  `src/server/attribution/{flag,settings,conversions}.ts`. APIs
  `/api/settings/capi` y `/api/settings/capi/events` protegidas por
  auth+tenant y la bandera `ATRIBUCION`. El gateway del corte A
  engancha `reportStageChange` **después** del commit, nunca dentro
  de la transacción larga. Mock equivalente al patrón
  `wa-mock`/`ai-mock` aprende `POST {dataset}/events`. Sin UI final.
- **Corte C — UI + E2E + cierre.** Pestaña **Anuncios** en Ajustes
  (visible solo con `ATRIBUCION=on`): dataset ID, token opcional,
  selector de etapa calificada (lista de `pipelineStage` con
  `kind = "open"` del tenant) y tabla de actividad con `fbtrace_id`.
  Arnés E2E en **las dos configuraciones** (`ATRIBUCION=on` y
  apagada), incluido el camino infeliz (Meta rechazando, token
  vencido, sin `ctwa_clid`, `is_test`, sin etapa calificada).
  `docs/atribucion-capi.md` espejo del upstream con notas del fork.

**Decisiones no triviales documentadas en el spec:**

- `ATRIBUCION` apagada por defecto; apagada ⇒ superficie CAPI inexistente
  (404 según patrón upstream) pero 006 sigue mostrando origen sin `clid`.
- Etapa calificada **configurable** por tenant; **no** hardcodeada a
  "Interesado". `QualifiedLead` se emite la primera vez que el lead entra
  a esa etapa; si el tenant no elige ninguna, queda en `skipped` con
  motivo.
- `Purchase` se emite automáticamente al entrar a cualquier etapa
  `kind = "won"`.
- `Purchase` incluye `value`/`currency` **solo si** el modelo de deal
  actual del lead tiene un monto válido; si no, se envía **sin**
  `value`/`currency`. Nunca se inventa `0` — un valor falso envenena la
  optimización por valor de Meta.
- `user_data` hacia Meta: solo `ctwa_clid` (de `ad_attribution` de 006)
  + `whatsapp_business_account_id`. **Nunca** teléfono, nombre, email
  ni texto del contacto.
- Token CAPI: si el tenant ya conectó WhatsApp, **se reusa** ese token
  cifrado (mismo que autoriza publicar en el dataset del WABA); pegar
  token específico es opcional y se cifra con la misma capa `lib/crypto`.
- Hacia el cliente solo `last4` y estado; nunca a logs.
- Conversaciones `is_test = true` jamás emiten evento (guardrail del
  Laboratorio, mismo patrón que el sender).
- Un fallo de Meta **jamás** revierte ni bloquea el cambio de etapa; el
  desenlace queda en `conversion_event` consultable.
- Sin Marketing API, sin Campaign Playbooks, sin espejo de
  `InitiateCheckout` de fábrica (la receta queda en `docs/atribucion-capi.md`
  para cada fork que quiera agregarla); sin backfill; sin 019/Resultados.

**Constitution Check (PASA sin violaciones):** I (seguridad: cifrado,
`last4`, sin PII hacia Meta) · II (soberanía: misma Meta Graph API del
canal ya permitido, traje completo de conector opcional apagado por
defecto) · III (multi-tenancy: `organization_id NOT NULL` + `scoped()`)
· IV (idempotencia: dedup `UNIQUE` + `ON CONFLICT DO NOTHING`,
migración re-ejecutable) · V (calidad: gate + unit + E2E en dos
configuraciones) · VI (specs antes de código: spec/plan/tasks
presentes antes del código) · VII (trazabilidad: decisiones no obvias
en el spec) · VIII (foco vertical: dos eventos, una pantalla, cero
dashboards) · IX (verificación en vivo: self-test con mocks en ambas
configuraciones antes de declarar Hecho).

**Estado actual (este commit):** Cortes A + B + C cerrados. Spec 007
**completo** salvo la verificación humana pendiente (clic CTWA real contra
Meta en producción — no automatizable, igual que el upstream 016).

- **Corte A** (commit `refactor(pipeline): centralizar cambios de etapa
  del lead`): los 6 callsites runtime de `lead.stageId` ya pasan por el
  gateway `src/server/leads/stage-gateway.ts`, incluido el Sales
  Orchestrator (Jev) que dejó de escribir `stageId` directamente.
  Cero cambios observables, lanes/facts/follow-ups intactos.
- **Corte B** (commit `feat(attribution): reportar QualifiedLead y
  Purchase a Meta CAPI`): migración aditiva `0007_meta_capi.sql` con
  `conversion_event` (UNIQUE `org/conv/event` para dedup durable) +
  `capi_settings` (config cifrada AES-256-GCM). Nuevo
  `src/lib/meta/capi.ts` (catálogo cerrado, validación Zod, acuse real
  `events_received >= 1`). Nuevo `src/server/attribution/{flag,settings,
  conversions}.ts`. APIs `/api/settings/capi{,/events}` con 404 duro si
  la bandera está apagada. Mock `wa-mock/graph/[...path]` aprende
  `POST {dataset}/events` con `DSET-FAIL` / `DSET-ZERO` para el camino
  infeliz. El gateway del Corte A engancha `reportStageChange`
  **después** del commit.
- **Corte C** (commit `feat(settings): operar atribución Meta CAPI desde
  Espacio Connect`, este commit): pestaña **Anuncios** en Ajustes (solo
  visible con `ATRIBUCION=on`), con dataset ID, token opcional (cifrado,
  `last4` al cliente, reutiliza el token de WhatsApp si ya está
  conectado), selector de etapa calificada (lista `kind = "open"` del
  propio tenant — nunca hardcodeada), tabla de actividad con
  `fbtrace_id` y motivo legible para `sent`/`failed`/`skipped`.
  Botón "Desconectar atribución" limpia token + etapa sin borrar
  historial. Arnés E2E extendido (`runSection012` en
  `scripts/e2e-selftest.mjs`) que cubre **ambas configuraciones**: con
  ATRIBUCION apagada, 404 en APIs + 404 en `/settings/ads` + 006 sigue
  mostrando anuncio sin `ctwa_clid`; con ATRIBUCION=on, etapa de otro
  tenant rechazada, QualifiedLead sent con `fbtrace_id`, dedup durable,
  Purchase sin `value` inventado, lead orgánico skipped, `DSET-ZERO`
  → failed pero el stage cambia, `is_test` nunca emite, Jev moviendo
  etapa usa la misma puerta, token vencido no rompe la app. `ctwa_clid`
  jamás aparece por API ni en logs. `docs/atribucion-capi.md` publicado
  con notas del fork.

**Pendiente único:** clic CTWA real contra Meta en producción. El
self-test con mocks cubre todos los caminos verificables (acuses
positivos, negativos, acuse con `events_received=0`, tokens vencidos,
tenant isolation, idempotencia, guardrail `is_test`, regla
anti-valor-falso). El clic real con un anuncio sirviendo, la URL con
`oe=` real del CDN, la calidad del JSON de Meta y el ciclo de feedback
del algoritmo solo se confirman en producción. Por Constitución IX este
spec **no se declara READY punta a punta** hasta que se ejecute ese
clic contra Meta y se observe la fila `sent` con `fbtrace_id` real.

### Corte A — puerta única de etapa (refactor neutro)

**Cerrado el 2026-09-29** en commit
`refactor(pipeline): centralizar cambios de etapa del lead` antes de tocar
CAPI. Piezas entregadas:

- **Helper/servicio único `src/server/leads/stage-gateway.ts`** con
  `moveLeadStage(...)`, `bulkMoveLeadsToStage(...)`, `createLeadInStage(...)`
  y `findFirstOpenStage(...)`. Errores tipados con `StageGatewayError {
  code, message }` para que las rutas traduzcan al contrato HTTP preexistente.
  Acepta `actor` opcional (`human`/`agent`/`bot`/`system`) y `extra` para que
  Jev conserve su atomicidad sin acoplar el gateway al Sales Orchestrator.
- **6 callsites runtime migrados** al gateway, con el `actor` y `reason`
  legible que cada camino necesita:
  - `app/api/pipeline/leads/[id]/route.ts` — drag/drop (`actor: "human"`,
    `reason: "drag_drop"`). `invalid_stage` → 422, `lead_not_found` → 404.
  - `app/api/pipeline/stages/[id]/route.ts` — bulk-move al eliminar/mover
    etapa (`actor: "human"`, `reason: "bulk_stage_delete"`).
  - `app/api/bot/reset/route.ts` — reset de conversación de pruebas
    (`actor: "system"`, `reason: "bot_reset"`) dentro del `try/catch`
    best-effort que ya tenía la ruta.
  - `src/server/ai/pipeline.ts` — acción `move_stage` del agente inline
    (`actor: "agent"`, `reason: "ai_move_stage"`). Si el contacto aún no
    tiene lead, no falla; si el gateway rechaza, se loguea sin romper el
    turno.
  - `src/server/sales/orchestrator.ts` — Jev/Sales Orchestrator
    (`actor: "agent"`, `reason: "jev:<nextAction>"`). **El patch
    `stageId = nextStageId` desapareció como write directo.** La
    atomicidad original (lane + facts + snapshot + stageId en el mismo
    UPDATE) se conserva pasando `basePatch` como `extra` al gateway.
  - `src/server/inbox/lead-activity.ts` — asignación del primer stage al
    crear lead por inbound (`actor: "system"`, `reason: "first_inbound"`).
    El gateway calcula `position = max+1` y conserva el
    `onConflictDoNothing` original.
- **Seed fuera del scope** (`server/seed/demo.ts` sigue escribiendo
  `lead.stageId` directo, como antes — es un script de demo, no runtime).
- **Tests del gateway** en `tests/unit/stage-gateway.test.ts` (20 casos):
  tenant isolation, lead inexistente, no-op mismo stage, `extra` con mismo
  stage, movimiento a etapa won/lost/open, `position` explícita,
  `lastActivityAt` explícito, Jev lane/facts preservados, bulk move
  cross-tenant rechazado, bulk no-op mismo origen/destino, bulk reasignación
  masiva, `createLeadInStage` con timestamp, cross-tenant, idempotencia
  `onConflictDoNothing`, position auto `max+1`, `findFirstOpenStage`
  primera open / ignora won/lost.
- **Regresión del Sales Orchestrator** en `tests/unit/sales-orchestrator.test.ts`
  sigue verde (con un ajuste mínimo del mock para proveer los SELECTs
  adicionales que el gateway ahora hace explícitos: 1 lead + 1 stage por
  cada move real, y KB/profile vacíos para los caminos best-effort).
- **Verificación del Corte A**:

  | Gate | Estado |
  |---|---|
  | `pnpm typecheck` | verde |
  | `pnpm lint` | verde (1 warning preexistente en `anuncio-origen.tsx`, no relacionado) |
  | `pnpm build` | verde |
  | `pnpm test` | verde — 614 tests, 71 archivos |
  | E2E en vivo | **PENDIENTE** — sin app local ni PostgreSQL activa en este entorno (mismo PENDIENTE registrado en el cierre de 006). El self-test del Corte C cubrirá los caminos con `ATRIBUCION=on` y apagada. |

### Estado del spec 005

**Cerrado el 2026-09-29** en un solo commit funcional tras el commit 0
documental. Implementación entrega:

- **Helper pura testeable** `applyContactNamePatch` en
  `src/components/inbox/conversation-patch.ts`: sincroniza `contact.name` en
  el array de conversaciones de forma inmutable, retornando la misma
  referencia cuando no hay match (evita renders espurios).
- **Microcomponente inline `ContactNameEditor`** dentro de
  `src/components/inbox/contact-panel.tsx`: estados `view` ↔ `edit`,
  trim+validación cliente, doble-submit corto-circuitado por
  `savingRef`, manejo de errores del servidor con mensaje inline.
- **Wiring en `inbox-client.tsx`**: handler `onContactUpdated` aplica
  `applyContactNamePatch` al array, y `key={selected.contact.id}` fuerza
  re-mount del panel al cambiar de conversación (descarta el estado de
  edición).
- **Tests unit nuevos**: 9 casos en
  `tests/unit/conversation-patch.test.ts`.
- **Guion E2E** `tests/e2e/010-quick-lead-name.md` con 10 pasos visuales
  de Playwright y caminos infelices documentados (red caída, 4xx/5xx,
  blur, doble Enter, cambio de conversación, SSE concurrente).

Restricciones respetadas:

- Reutiliza exclusivamente `PATCH /api/contacts/:id` (ya valida
  `name` trim 1–120 y aplica `scoped()`).
- Cero endpoints nuevos, cero cambios de schema, cero store global,
  cero nuevas dependencias npm.
- Fuera de alcance confirmado: phone/email/empresa/tags, modal, nueva
  página, pipeline, Sales, follow-ups, sender, webhook.

**Verificación actual:**

| Gate | Estado |
|---|---|
| `pnpm typecheck` | verde |
| `pnpm lint` | verde |
| `pnpm build` | verde |
| `pnpm test` | verde — **569 tests** (560 del spec 004 + 9 nuevos del spec 005) |
| `pnpm test:e2e` (sección 010) | **PENDIENTE en este entorno** — sin app local ni PostgreSQL activa |
| Playwright visual `tests/e2e/010-quick-lead-name.md` | **PENDIENTE en este entorno** |

El spec 005 está **verificado unitariamente punta a punta** pero **NO
verificado en vivo punta a punta** hasta correr Playwright manual contra
`pnpm dev` local con los 10 pasos visuales y los caminos infelices
documentados en el guion E2E. Por Constitución IX no debe reportarse
como READY punta a punta hasta entonces. La verificación pendiente es
del mismo tipo y gravedad que las secciones 008 y 009: si el entorno
local no tiene app ni BD activas, queda registrada como pendiente y se
ejecuta en el siguiente checkpoint que disponga de la app levantada.

Trabajo posterior documentado antes de exigir Spec Kit completo:

- WHMCS: código + tests + contexto histórico.
- Sales Orchestrator: `docs/SALES_ORCHESTRATOR.md`.
- Follow-ups: `docs/SALES_FOLLOW_UPS.md`.

No crear specs retroactivos falsos solo para "cumplir". **Desde el próximo
cambio observable**, abrir un nuevo `specs/NNN-...` y mantener `tasks.md`
como estado durable.

### Estado del spec 004

Implementado a través de commits atómicos `0 → 1 → 2 → 2a → 2b → 2c → 2d`:

- Commit 0 (`275f457`): docs SDD (spec/plan/tasks).
- Commit 1 (`b3cc38f`): cola de adjuntos, helpers puros, componentes
  presentacionales, drag&drop/paste, submitQueue, retry, a11y base.
- Commit 2a (`de12265`): bucle de envío `runQueueSend`, anti-doble-envío,
  retry por adjunto, confirmación explícita video→document, override
  tipado `kind=document` server-side.
- Commit 2b (`21cc101`): corte final de UX/pulido — header de cola con
  conteo inline, `clearSent`, `summarize`+`progressLabel`, navegación
  por teclado (←/→, Delete/Backspace, Esc), drop overlay animado con
  conteo, indicadores de estado con texto explícito, toolbar buttons
  ≥ 44 px, auto-focus textarea, `aria-current`.
- Commit 2c (`0e7148c`, **fix de comportamiento**): cuatro ajustes
  de comportamiento detectados antes de E2E, todos ya especificados —
  no agrega capacidades nuevas:
  1. **Cleanup automático tras éxito total**: cuando todos los adjuntos
     del envío terminan OK y no quedan `failed`/bloqueos, la cola se
     autovacía (revocando Object URLs), se limpia el textarea y el foco
     vuelve al textarea. "Limpiar enviados" queda solo para estados
     parciales. Heurística pura `shouldAutoClearQueue(result, attempted)`.
  2. **Caption durable**: `runQueueSend` ya no usa un contador local —
     lee `captionOwner`/`captionConsumed` de los adjuntos. El caption
     queda anclado al primer adjunto elegible de la cola original; su
     retry (si falló) conserva el caption; retries de otros adjuntos
     tras un envío exitoso del captionOwner NO re-envían el caption.
     El reducer expone `markCaptionConsumed` (idempotente, defensivo).
  3. **Pre-validación client-side**: `classifyForQueue` ahora refleja
     los límites `MEDIA_LIMITS.*` (image 5 MB, audio 16 MB). Image/audio
     oversized se rechazan al añadirlos a la cola con mensaje claro vía
     `rejectionReason`, sin esperar al POST. Video >16 MB sigue
     ofreciéndose como document; document >100 MB sigue rechazado. El
     backend sigue siendo la fuente de verdad (ningún límite relajado).
  4. **Botón engañoso en panel location/contact**: abrir el panel
     secundario sin texto ni adjuntos ya NO habilita el botón principal
     del textarea (`canSubmit` no depende de `panel !== null`).
     Adicionalmente, `onlyBlocked` ya no considera adjuntos con
     `status=sent` como bloqueantes — tras un envío total (con o sin
     cleanup automático disparado) el operador puede enviar un texto
     nuevo sin tener que pulsar "Limpiar enviados" primero.
- Commit 2d (este checkpoint, **fix de comportamiento post-2c**):
  tres regresiones detectadas al revisar el código desplegado tras
  `0e7148c`. NO agrega capacidades nuevas. NO toca backend de
  WhatsApp, límites, video-as-document, transcodificación, voice
  recorder, storage/historial, webhook ni Sales/WHMCS. Solo refina
  la lógica cliente del composer y de la cola:
  1. **Rama de submit** (`composer.submit()`): antes usaba
     `attachments.some(a => !a.needsVideoAsDocumentConfirm)` para
     detectar "hay adjuntos listos". Eso contaba `status="sent"`
     como listo, así que un sent residual bloqueaba el envío de un
     texto nuevo (`submitQueue()` retornaba con `readyToSend` vacío
     y el texto no salía). Nueva helper pura `decideSubmitMode`
     encola los tres casos (`"queue" | "text" | "noop"`) usando el
     mismo filtro que `readyToSend`. `submit()` la consulta y nunca
     se contradice con `canSubmit`.
  2. **Cleanup del happy path**: `submitQueue()` llamaba
     `q.clearSent()` después del envío, pero el callback `clearSent`
     filtra por `status === "sent"` y capturó el estado anterior al
     envío (todos `pending`), por lo que su loop de
     `URL.revokeObjectURL` no revocaba nada — quedaban Object URLs
     huérfanas aunque el reducer luego quitase los sent. Fix: el
     happy path usa `q.clear()` (revoca TODO sin filtrar status),
     y los callbacks `clear`/`clearSent`/`remove` del hook ahora
     leen de `attachmentsRef.current` (deps=[]) para ser estables
     frente a capturas obsoletas. Helper pura `revokeAllPreviews`
     encapsula la semántica "revocar sin filtrar status".
  3. **Transferencia de captionOwner al eliminar**: la acción `remove`
     del reducer (vía `applyRemoveWithCaptionTransfer`) ahora
     transfiere `captionOwner=true` al primer adjunto restante
     elegible cuando el eliminado era captionOwner con su caption aún
     NO consumido. Si el caption ya viajó (`captionConsumed=true`),
     NO transfiere. Si la cola era de un solo elemento, solo lo
     quita sin transferir. Reglas duras: nunca se transfiere a un
     adjunto que ya es owner (defensivo).

**Verificación actual:**

| Gate | Estado |
|---|---|
| `pnpm typecheck` | verde |
| `pnpm lint` | verde |
| `pnpm build` | verde |
| `pnpm test` | verde — **560 tests** (546 post-2d + 14 nuevos del corte 2e) |
| `pnpm test:e2e` (sección 009) | **PENDIENTE en este entorno** — sin app local ni PostgreSQL activa |
| Playwright visual `tests/e2e/009-inbox-messaging-ux.md` | **PENDIENTE en este entorno** |
| Sección 008 (regresión spec 003 cerrado) | pendiente de re-correr con la app levantada |

El spec 004 está **verificado unitariamente punta a punta** pero **NO
verificado en vivo punta a punta** hasta correr `pnpm test:e2e` local y
re-correr la sección 008 para regresión. Por Constitución IX no debe
reportarse como READY punta a punta hasta entonces.

**Detalle de tests del corte 2d** (24 nuevos):

- `attachment-queue-run.test.ts`: 12 nuevos
  - `decideSubmitMode` × 10 casos: cola vacía, sent residual, mezcla
    sent+sending, bloqueado video→document, mezcla bloqueado+listo,
    solo `sending`, consistencia con `canSubmit`, edge cases.
  - `runQueueSend` × 2 casos de integración con
    `applyRemoveWithCaptionTransfer`: caption viaja exactamente una
    vez con el nuevo owner; eliminar owner consumido NO reasigna.
- `attachment-queue-reducer.test.ts`: 12 nuevos
  - `applyRemoveWithCaptionTransfer` × 8 casos: owner no consumido
    transfiere, owner consumido no transfiere, eliminar no-owner no
    afecta, cola de 1, id inexistente no-op, selectedId cleanup,
    preservación de orden/flags, delegación coherente con
    `queueReducer`.
  - `revokeAllPreviews` × 4 casos: revoca todos sin filtrar status,
    ignora sin previewUrl, lista vacía, regresión "filtro por status
    dejaría huérfanas".

**Detalle de tests del corte 2e** (14 nuevos):

- `attachment-queue-run.test.ts`: 8 nuevos (1 modificado)
  - `decideSubmitMode` × 5 casos nuevos (FIX-1): blocked + texto →
    `"noop"`; sent residual + texto → `"text"` (confirmación); sent +
    blocked + texto → `"noop"`; sent + blocked + ready → `"queue"`;
    blocked + failed no bloqueado → `"queue"`.
  - Test de consistencia `decideSubmitMode` ↔ `canSubmit` actualizado
    para usar el filtro nuevo (`onlyBlocked`). Nuevo test "FIX-1
    consistencia: cola con solo bloqueado + texto → botón y Enter
    ambos deshabilitados".
  - `runQueueSend` × 2 casos de integración con
    `applyRemoveWithCaptionTransfer` saltando sent (FIX-2): A owner
    failed + B sent + C failed → C se vuelve owner y retry de C
    recibe caption exactamente una vez; A owner + B sent únicamente
    → nadie hereda captionOwner y runQueueSend omite B.
- `attachment-queue-reducer.test.ts`: 6 nuevos
  - `applyRemoveWithCaptionTransfer` × 5 casos (FIX-2): A owner + B
    sent + C failed → C owner; A owner + B sent únicamente → nadie;
    A owner + B sending + C pending → C owner; blocked con
    `needsVideoAsDocumentConfirm=true` SIGUE siendo candidato válido;
    sent primero + pending después → salta sent.
  - `canMutateQueue` × 2 casos (FIX-3): `sending=false` → true,
    `sending=true` → false.

---

## 9. Historia técnica corta

| Fecha | Hito |
|---|---|
| 2026-08-12 | baseline/fork auditado y estrategia de adaptación |
| 2026-08-19 | integración WHMCS created/paid implementada y validada |
| 2026-09-20 | Sales Orchestrator V1, phases 01–14 |
| 2026-09-20/21 | follow-ups, phases 15–22 |
| 2026-09-21 | último commit funcional auditado: `bbae7cd1dfd9` |
| 2026-09-29 | sincronización de memoria técnica + disciplina SDD |
| 2026-09-29 | spec 004 cerrado: cola de adjuntos + UX polish (commits 0→1→2→2a→2b, 500 tests) |
| 2026-09-29 | spec 004 corte 2c — fix de comportamiento antes de E2E (cleanup total, caption durable, pre-validación image/audio, botón engañoso del panel), 522 tests |
| 2026-09-29 | spec 004 corte 2d — fix de comportamiento post-0e7148c (rama submit con sent residual, cleanup happy path revoca todas las previews, transferencia captionOwner al eliminar owner), 546 tests |
| 2026-09-29 | spec 004 corte 2e — 3 últimos edge cases del cliente (decideSubmitMode=noop con solo bloqueados, transferencia captionOwner salta sent/sending, mutaciones de la cola bloqueadas durante sending), 560 tests |
| 2026-09-29 | spec 005 cerrado (commit único): edición inline de `contact.name` desde el panel del inbox + sync de UI en las tres superficies, 569 tests |
| 2026-09-29 | spec 006 ABIERTO: anuncio de origen de Meta — pieza visible sin CAPI todavía (puerto selectivo del upstream 018; migración 0006 + tabla `ad_attribution` + normalización + imagen best-effort; implementación en dos cortes A/B posteriores)
| 2026-09-29 | spec 007 ABIERTO: Meta CAPI para leads Click-to-WhatsApp — adaptación selectiva del upstream 016 (gate de etapa primero: refactor neutro que centraliza los 6 callsites runtime de `lead.stageId` en `moveLeadStage(...)` antes de tocar Meta; luego CAPI core + schema/API con `ATRIBUCION` apagada por defecto, token reusado de WhatsApp, etapa calificada configurable, `Purchase` sin valor inventado, dedup `UNIQUE`, `is_test` sin evento; luego UI Ajustes → Anuncios + E2E en dos configuraciones). Commit 0 documental; sin código. | |
| 2026-09-29 | **spec 006 CERRADO** (cortes A+B) — 594 tests |
| 2026-09-29 | **spec 007 CERRADO** (cortes A+B+C) — 646 tests / 74 archivos |
| 2026-09-29 | **Corte 9 — auditoría final de readiness Vende Veloz**: gates re-verificados (typecheck/lint/build verdes, 646/646 tests), `docs/VENDEVELOZ_LAUNCH_CHECKLIST.md` publicado con bloques A/B/C/D, `CURRENT_STATE.md` actualizado. Sin código de app tocado, sin flags cambiados, sin campañas creadas. Working tree limpio. |

---

## 10. Próximo checkpoint recomendado

**No bloquear la salida de Vende Veloz por el refactor multi-campaña futuro.**
Primero operar el funnel actual y obtener evidencia real.

Antes de añadir otra feature grande:

1. levantar app + PostgreSQL + mocks;
2. correr `pnpm test:e2e` para validar:
   - sección 008 (regresión spec 003 cerrado);
   - sección 009 (contrato backend del spec 004 — cola de adjuntos);
   - secciones existentes del Sales Orchestrator/follow-ups;
   - sección 011 (anuncio de origen, spec 006);
   - sección 012 (Meta CAPI, spec 007 — corre **dos veces** si la app está
     con `ATRIBUCION=on`, una sola si está apagada);
3. correr Playwright visual con `tests/e2e/009-inbox-messaging-ux.md`;
4. registrar evidencia en el doc correspondiente y aquí;
5. para cualquier comportamiento nuevo, abrir el siguiente spec numerado;
6. mantener commits atómicos y actualizar `tasks.md` al cerrar cada corte.

---

## 11. Corte 9 — Readiness técnico para Vende Veloz (este commit)

Documento durable: `docs/VENDEVELOZ_LAUNCH_CHECKLIST.md`.

**Propósito:** consolidar para Max (operador) el estado técnico del repo
antes de abrir la primera campaña real de Vende Veloz 365 sobre la
instalación interna de Espacio Connect. **No agrega features.**

### Verificación de gates ejecutada en este corte

| Gate | Resultado | Comando |
|---|---|---|
| `pnpm typecheck` | verde (exit 0) | `tsc --noEmit` |
| `pnpm lint` | verde (0 errors, 1 warning preexistente en `src/components/anuncio-origen.tsx:65` — `<img>` no `next/image`, aceptado) | `eslint .` |
| `pnpm build` | verde (exit 0; 60+ rutas server-rendered; las del 007 con 404 duro si `ATRIBUCION` está apagada) | `next build` |
| `pnpm test` | verde — **646/646 pass**, 74 archivos, 5.03 s | `vitest run` |
| `pnpm test:e2e` | **NO EJECUTADO** — `GET http://localhost:3000/api/health` retorna `000` (sin app levantada); sin PostgreSQL local; `pg_isready` no instalado en este WSL. Constitución IX exige ejecución en vivo antes de declarar READY punta a punta. **No se inventó resultado.** |

### Estructura del checklist publicado (`docs/VENDEVELOZ_LAUNCH_CHECKLIST.md`)

- **A) IMPLEMENTADO Y VERIFICADO EN REPO** — gates + specs 001–007 + Sales
  Orchestrator + follow-ups + inbox + CAPI + 006 + storage + salud/arranque.
- **B) CONFIGURACIÓN DE PRODUCCIÓN A CONFIRMAR** — env vars (`.env.example`
  como referencia), estado por organización Vende Veloz 365 en BD, plantillas
  WhatsApp (0-var BODY), WhatsApp conectado, volumen `/data/media`.
- **C) PRUEBAS REALES EXTERNAS PENDIENTES** — self-test E2E local con
  app+Postgres (Constitución IX), primer clic CTWA real en producción
  (no automatizable), primer lead real recibe respuesta, primer seguimiento
  se programa/cancela, movimiento a qualified produce evento Meta, compra
  real → `Purchase`.
- **D) NO BLOQUEA LANZAMIENTO / FUTURO** — Campaign Playbooks, Marketing API,
  019/Resultados, backfill, `InitiateCheckout` de fábrica, parsing fechas,
  múltiples plantillas, cadencias ajustadas, S3/R2/email/Stripe/Google
  (PROHIBIDOS por Constitución II).

### Veredicto del corte

**La base del CRM está técnicamente lista para abrir campañas reales.**
Los tres pendientes que sí tocan producción:

1. Self-test E2E local con app + Postgres activos (Constitución IX).
2. Clic CTWA real en producción (no automatizable; mismo límite que los
   upstreams 016 y 018).
3. Volumen persistente `/data/media` montado en el host antes del primer
   inbound con imagen, si se quiere conservar el creativo.

### Decisión de continuidad

NO se reinterpretó el contrato de Campaign Playbooks ni se reabrió
ningún spec cerrado. La unidad de estrategia sigue siendo **Vende Veloz 365
como funnel congelado** (`docs/SALES_ORCHESTRATOR.md`); la unidad futura
será la **campaña**, no la organización. Cuando exista la 2ª campaña,
abrir spec SDD nuevo y extraer config alrededor del núcleo reusable.

### Cambios al árbol

- **Nuevos:** `docs/VENDEVELOZ_LAUNCH_CHECKLIST.md` (~24 KB).
- **Modificados:** `docs/CURRENT_STATE.md` (header + nueva sección §11).
- **NO modificados:** ningún archivo de código (`src/**`), schema ni
  migraciones (`drizzle/**`), `.env.example`, `package.json`, `pnpm-lock.yaml`.
- **Commit único:** `docs: cerrar readiness técnico de Vende Veloz para
  campañas`. Working tree limpio.

---

## 12. Qué no hacer por defecto

---

## 11. Qué no hacer por defecto

- no reconstruir Vocero/Espacio Connect;
- no crear otro sender o webhook paralelo;
- no romper tenant isolation;
- no introducir dependencias externas no permitidas;
- no crear SaaS/billing/provisioning prematuro;
- no campañas masivas/analytics avanzado sin spec y necesidad real;
- no afirmar E2E verde si no se ejecutó.

---

## 13. Bootstrap feature 009 — Playbook Runtime Admin (este commit)

Abre `specs/009-playbook-runtime-admin/` para convertir la infraestructura de
la Feature 008 en **configuración comercial real de producción**: editar y
publicar pricing, oferta, política, writer y preguntas Jev **sin redeploy**.

**Este commit es solo bootstrap documental. Cero código productivo modificado y
el runtime intacto.**

### Qué ya resuelve la 008 (y esta feature NO reconstruye)

`sales_playbook` + `sales_playbook_version`, `ConfigV1` + Zod con guardarraíles
Jev, draft/validate/publish/rollback/historial, loader **sin cache**, bootstrap
multi-org, Laboratorio Published vs Draft, override restringido a `is_test`,
tenant isolation, auditoría de versión y fallback hardcodeado.

### Los tres cerr gaps

1. **Corte 1 — Editor técnico JSON.** La UI por formularios
   (`playbook-draft-editor.tsx`, `jev-questions-editor.tsx`) se sustituye por dos
   textareas JSON técnicos. La regla histórica *"NO JSON crudo"* queda
   **SUPERSEDED** para esa pestaña: su único usuario real es un administrador
   técnico. Sin dependencias nuevas (nada de Monaco/CodeMirror) y **sin tocar
   producción**.
2. **Corte 2 — Baseline comercial vigente.** La oferta en código es la anterior
   (`setup 497`, `monthlyBase 197`); la decisión vigente es **`0` + `S/247/mes`**,
   50 alumnos incluidos y `+S/1` desde el 51. **El runtime sigue apagado en todo
   este corte** y un test lo verifica. La estrategia de Jev V1 se expresa en el
   **bootstrap del playbook** (`v1.ts`), **no** en `questions.ts`, que está
   hash-frozen contra un blob upstream validado.
3. **Corte 3 — Runtime publicado.** Enciende
   `SALES_PLAYBOOK_RUNTIME_ENABLED` (`src/server/sales/build-state.ts:37`) para
   que las conversaciones reales consuman la **Published** de su organización.
   Aislado y reversible en una línea. **Este es el interruptor de producción.**

### Estado real en el código base

| Hecho | Ubicación |
|---|---|
| Interruptor en `false` | `src/server/sales/build-state.ts:37` |
| Loader sin cache | `src/lib/sales/playbook/loader.ts` |
| Override solo en `is_test` | `src/server/sales/orchestrator.ts:78` |
| Oferta vigente en código `0`/`247` (corte 2) | `src/server/sales/vende-veloz.ts` |
| Hueco `writer.ts` "S/0" — **cerrado** en el corte 2 | `src/server/sales/writer.ts:211` |
| `sales-launch-hardcoded.test.ts` **afirma hoy el congelamiento** | hay que invertirlo en el corte 3 |

### Cómo ejecutar

```bash
./scripts/ai/run-playbook-runtime-admin.sh            # desde el corte 1
START_CUT=2 ./scripts/ai/run-playbook-runtime-admin.sh  # reanudar
```

Logs en `.ai/logs/playbook-runtime-admin/`. Si un corte falla a mitad, **no
resetear ni descartar**: relanzar ese mismo corte en una sesión nueva y reanudar
con `START_CUT=N+1`.

### Done criteria

Los tres cortes verdes, un commit cada uno, árbol limpio, y **evidencia E2E de los
escenarios A–H** de `specs/009-playbook-runtime-admin/spec.md` §4 — incluido el
hot-switch y el rollback **sin redeploy**. **Sin esa evidencia no se dice READY.**

