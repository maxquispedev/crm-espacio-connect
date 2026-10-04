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

- [x] T601 Inventario real con `rg -n -i 'vocero' .`, grabado en este archivo
- [x] T602 Clasificar cada categoría (marca visible / metadata / docs / demo copy /
      comentarios / migraciones / specs cerrados / constitución / identificadores)
- [x] T603 `DEFAULT_BRANDING.name` → Espacio Connect; white-label por org intacto
- [x] T604 Títulos y `metadata` de la app
- [x] T605 Copy de demo y textos visibles
- [x] T606 README vigente e instalación vigente
- [x] T607 Docs operativas vigentes
- [x] T608 `branding.test.ts` verde (ajuste de expectativa **solo** de marca visible,
      justificado)
- [x] T609 Migraciones, specs cerrados y constitución **intactos**
- [x] T610 Referencias inevitables documentadas con su razón
- [x] T611 Enmienda de marca en la constitución registrada como **pendiente formal**
- [x] T612 Gate completo
- [x] T613 Evidencia, un commit, árbol limpio

### T611 — Enmienda de marca en la constitución: PENDIENTE FORMAL

`.specify/memory/constitution.md` sigue diciendo **"Vocero CRM Constitution"** y
"Vocero CRM" en el Principio II y en el Principio III (4 ocurrencias). **No se
tocó en este corte, a propósito.**

**Por qué.** La constitución es norma ratificada (v1.3.0, *Ratified* 2026-07-09) y
su sección Governance fija un procedimiento de enmienda propio: la enmienda se
**propone por escrito**, la **aprueba el responsable del proyecto** y se registra
en control de versiones **con su Sync Impact Report actualizado**. El propio
documento lleva ya un bloque `SYNC IMPACT REPORT` en la cabecera por eso. Editar
la marca desde un corte de copy sería saltarse la gobernanza del propio producto
—el error que la constitución quiere impedir en todos los demás sitios.

**Qué hace falta para cerrarlo** (corte propio, con el responsable):

1. Texto de la enmienda: "Vocero CRM" → "Espacio Connect" en título, Principles
   II and III. Sin cambio de fondo en ningún principio: es un **PATCH** de
   redacción/nombre (o MINOR, si el responsable prefiere registrarlo como
   cambio de identidad de producto — es su decisión, no nuestra).
2. **Sync Impact Report** en la cabecera de la constitución.
3. Revisión de las plantillas dependientes (`.specify/templates/*`): el plan las
   declara compatibles, y este cambio **no** las afecta (no habla de la marca).
4. Aprobación del responsable y bump de versión en el pie.

**Estado: PENDIENTE. Responsable: el dueño del proyecto.** No bloquea CUT 6: el
producto ya se llama Espacio Connect en todo lo visible, y la constitución sigue
siendo vigente como norma (describe los mismos principios).

### Referencias inevitables que sobreviven (FR-6.7)

Resumen accionable de las 199 supervivientes, para quien las encuentre en el
futuro y sepa que son deliberadas:

| Dónde | Qué sobrevive | Por qué |
|---|---|---|
| `.specify/memory/constitution.md` (4) | "Vocero CRM Constitution" | Enmienda formal pendiente (T611) |
| `drizzle/0006`, `drizzle/0007` (2) | Atribución a `kevinrivm/vocero-crm` | Script ya aplicado; no se reescribe |
| `Dockerfile` (18) · `docker-compose*.yml` (14) | usuario `vocero`, BD `vocero`, volúmenes `vocero_pg`/`vocero_caddy_*` | Identificadores de despliegue; renombrar un volumen con nombre **huérfana los datos** |
| `package.json` (1) | `"name": "vocero-crm"` | Identificador de paquete, no marca visible (plan D-1) |
| `src/lib/theme.ts` (2) · `inbox-client.tsx` (2) · `notifications/desktop.ts` (1) | claves de cookie y `localStorage` | Renombrarlas **borra la preferencia guardada** de cada usuario instalado |
| `src/lib/auth`, `src/lib/db`, `rate-limit`, `events/bus`, `follow-ups/worker` (23) | `__vocero*` en `globalThis` | Caché de singletons en HMR; invisible |
| `scripts/e2e-*.mjs` (49) · `sales-follow-up-worker.test.ts` (8) | cuentas `@vocero.test`, BD `vocero_e2e`, `__voceroFollowUpTimer` | Fixtures del arnés; renombrarlos es tocar 12 guiones para ganancia cero |
| `specs/001-vocero-core/**` (20) y resto de specs cerrados (~33) | nombre de carpeta y prosa histórica | Trazabilidad; el nombre de carpeta tampoco se renombra |
| `docs/AUDITORIA_BASE_ESPACIO_CONNECT.md` (3) | El estado **antes** del rebrand | Es el registro de la auditoría; reescribirlo la falsificaría |
| `docs/CURRENT_STATE.md` (5) · `VENDEVELOZ_LAUNCH_CHECKLIST.md` (4) · `atribucion-capi.md` (1) | checkpoints, usuario del contenedor, URL del upstream | Log append-only y atribución real |
| `.ai/tasks/**` (7) · `.ai/logs/**` | guion del corte y sesiones grabadas | Prompts e historia inmutable |
| `.specify/feature.json` (1) | `"feature_directory": "specs/001-vocero-core"` | Apunta a una carpeta real |
| `specs/014/**` (13) | Enunciado del problema y el propio comando de auditoría | Describen lo que este corte cambió |



### Registro de la auditoría (ejecutado en CUT 6)

`rg -n -i 'vocero' .` al arrancar el corte (HEAD `a00d169`, árbol limpio):
**231 ocurrencias en 62 ficheros**. Al cerrarlo: **199 en 56**. Se cambiaron **32**
y las **199** supervivientes están justificadas una a una abajo.

> Nota de método: `rg` no está instalado en el entorno; la auditoría se hizo con el
> motor ripgrep del harness de búsqueda, con las mismas reglas de exclusión
> (`.gitignore`, binarios). El recuento por fichero y el diff son los que constan.

| Categoría | Ficheros | Ocurr. | Decisión | Razón |
|---|---|---|---|---|
| **Marca visible — nombre por defecto** | `src/lib/branding.ts` | 1 | **RENOMBRADO** → `Espacio Connect` | Es literalmente el objetivo (FR-6.4). Único valor de marca del producto. `normalizeBranding` y el aislamiento por tenant **no se tocaron**. |
| **Marca visible — copy de UI** | `src/components/inbox/contact-panel.tsx` | 1 | **RENOMBRADO → copy sin marca** | Decía "El agente de Vocero…". `ContactPanel` no recibe `branding` y cablearlo sería un cambio estructural fuera de un corte de copy. Se usó copy **neutral de marca** ("El agente no responde por su cuenta"): además de quitar la marca, **respeta el white-label**, porque el texto anterior mentía en cualquier tenant que hubiera puesto su propio nombre. |
| **Marca visible — Configuración → Marca** | `src/components/settings/branding-client.tsx` | 3 | **REFACTOR a `DEFAULT_BRANDING.name`** | El literal estaba **triplicado** (placeholder, inicial de la vista previa, nombre de la vista previa). Ahora los tres leen `DEFAULT_BRANDING.name`: una sola fuente de verdad, y un rebrand futuro no tiene que cazarlo en tres sitios. |
| **Metadata / títulos** | `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/app/(auth)/layout.tsx` | 0 | **SIN CAMBIO NECESARIO** | Corrección al `plan.md` §2: **ninguno de los tres tenía un "Vocero" literal**. El título es `` `${branding.name} — CRM de WhatsApp` `` y login/sidebar renderizan `branding.name`. Cambiar `DEFAULT_BRANDING` los renombra **a la vez** y por organización. Verificado en navegador (§Evidencia). |
| **Demo copy** | `src/app/api/dev/wa-mock/graph/[...path]/route.ts` | 1 | **RENOMBRADO** | `verified_name: "Número de prueba Espacio Connect"`. Superficie de mock (404 en producción por diseño). **Comprobado que ningún test lo afirma**, así que no hay contrato roto. |
| **README / instalación** | `README.md` (15), `INSTALL-IA.md` (9) | 15→1 / 9→5 | **RENOMBRADO (visible) / conservado (técnico)** | Se renombraron título, prosa, alt de captura y el mensaje de cierre. Se conservaron a propósito: la **URL del upstream** `github.com/kevinrivm/vocero-crm` (URL real) y el **nombre de base de datos** `vocero` en `DATABASE_URL` y "base `vocero`" (tiene que coincidir con `docker-compose.yml`; renombrar solo el doc rompería la Ruta A). El `git clone … && cd` **sí** pasó a `espacio-connect`: nombre local de carpeta creado en fresco, nada lo referencia. El diagrama ASCII de la README se realineó a mano tras el renombre. |
| **Docs operativas vigentes** | `CLAUDE.md` (4→2) | 2 | **RENOMBRADO (prosa) / conservado (trazas)** | Los dos párrafos que describen el producto ahora dicen Espacio Connect. Se conservan `(fork de Vocero CRM)` en el título —es una **nota de linaje exacta**— y la ruta `specs/001-vocero-core/quickstart.md`. |
| **Migraciones** | `drizzle/0006_anuncio_de_origen.sql`, `drizzle/0007_meta_capi.sql` | 2 | **CONSERVADO** | Comentarios de atribución al upstream dentro de scripts **ya aplicados**. Un jáxel aplicado no se reescribe (trazabilidad). |
| **Constitución** | `.specify/memory/constitution.md` | 4 | **CONSERVADO — enmienda formal pendiente** | Norma ratificada v1.3.0 con procedimiento de enmienda propio (Governance). Renombrar la marca aquí **exige** enmienda con Sync Impact Report aprobada por el responsable. No es copy: es gobernanza (plan D-2). Ver T611. |
| **Specs cerrados** | `specs/001-vocero-core/**` (20), `002` (6), `006` (3), `007` (2), `011` (2), `specs/014/**` (13) | 46 | **CONSERVADO** | Trazabilidad histórica; **el nombre de carpeta `001-vocero-core` tampoco se renombra**. En `specs/014/**` las menciones a "Vocero" son el enunciado del problema y el propio comando de auditoría: se quedan porque describen lo que este corte cambió. |
| **Identificadores con riesgo — `package.json`** | `package.json` `name: "vocero-crm"` | 1 | **CONSERVADO** | Plan D-1. Identificador de paquete, no marca visible. `description` **ya era neutra** ("CRM de WhatsApp open source y self-hosted…"), no hubo nada que cambiar. Lo único que lo referencia son logs históricos y una spec cerrada. |
| **Identificadores con riesgo — contenedor** | `Dockerfile` (19→18), `docker-compose.yml` (10→9), `docker-compose.dev.yml` (5) | 32 | **CONSERVADO (identidad) / RENOMBRADO (comentario)** | Se renombró **solo el comentario de cabecera** de Dockerfile y compose (copy). Se conservaron: usuario no-root `vocero`, base de datos `vocero` y los volúmenes con nombre `vocero_pg`, `vocero_caddy_data`, `vocero_caddy_config`. **Renombrar un volumen con nombre Deja los datos huérfanos en el próximo redespliegue**: es el elemento de más riesgo del repo, y un rebrand no es un cambio de infraestructura (spec §2). El usuario del contenedor está documentado en `docs/CURRENT_STATE.md` y en el checklist de lanzamiento. |
| **Claves de cliente (identificadores)** | `src/lib/auth/index.ts` (8), `src/lib/db/index.ts` (4), `src/lib/rate-limit.ts` (4), `src/server/events/bus.ts` (4), `src/server/sales/follow-ups/worker.ts` (3) | 23 | **CONSERVADO** | Símbolos `__vocero*` en `globalThis` (caché de singletons en HMR). No son visibles, no son copy y renombrarlos no cambia nada que un usuario vea. |
| **Claves de almacenamiento local** | `src/lib/theme.ts` (2), `src/components/inbox/inbox-client.tsx` (2), `src/components/notifications/desktop.ts` (1) | 5 | **CONSERVADO** | Nombres de **cookie** (`vocero.theme`, `vocero.theme-resolved`) y de **localStorage** (`vocero.panelOpen`, `vocero.notifySound`). Renombrarlos **no cambia la marca pero sí destruye la preferencia ya guardada** de cada usuario instalado (tema, panel, sonido): un cambio de comportamiento invisible disfrazado de copy. Fuera del alcance de un rebrand (FR-6.6). **Sí aparecen en el HTML servido**, dentro del `<script>` de bootstrap del tema — verificado en navegador, y es la razón de que el chequeo de copy visible use `innerText` y no `textContent`. |
| **Fixtures de prueba** | `scripts/e2e-*.mjs` (49 en 12 ficheros), `tests/unit/sales-follow-up-worker.test.ts` (8), `tests/e2e/us-bot-api.md` (1) | 58 | **CONSERVADO (fixtures) / RENOMBRADO (doc)** | Las cuentas `@vocero.test` (TLD reservado, nunca visibles) y el prefijo de BD `vocero_e2e` que validan los guardas del arnés: renombrarlos es editar ~50 líneas en 12 guiones **y** `specs/011/quickstart.md`, para ganancia de producto **cero**. Es exactamente el "replace ciego" que el spec prohíbe; la instrucción era renombrarlos *solo* si se actualiza también el arnés, y el coste no se justifica. Los 8 de `sales-follow-up-worker.test.ts` son los mismos `__voceroFollowUpTimer`. **Sí** se renombró la frase de prosa de `us-bot-api.md`. |
| **Auditoría base / checkpoints** | `docs/AUDITORIA_BASE_ESPACIO_CONNECT.md` (3), `docs/CURRENT_STATE.md` (5), `docs/VENDEVELOZ_LAUNCH_CHECKLIST.md` (4), `docs/atribucion-capi.md` (1) | 13 | **CONSERVADO** | `AUDITORIA_BASE` **es el registro de lo que se encontró antes del rebrand**: reescribirlo falsificaría la auditoría. `CURRENT_STATE.md` es un log append-only de checkpoints. Las 4 del checklist son `001-vocero-core`, el usuario `vocero:vocero` del contenedor y la URL del upstream. `atribucion-capi.md` atribuye a `kevinrivm/vocero-crm`. |
| **Configuración de tooling** | `.specify/feature.json` | 1 | **CONSERVADO** | `"feature_directory": "specs/001-vocero-core"`: apunta a una carpeta real. |
| **Prompts y logs de agentes** | `.ai/tasks/**` (7), `.ai/logs/**` | 8+ | **CONSERVADO** | `.ai/tasks/operator-workspace/06-cut6-rebrand.md` es el guion de este mismo corte (cita el comando de auditoría). Los `.ai/logs/**` son **sesiones grabadas**: historia inmutable. |

### Decisiones de este corte

1. **Una sola fuente de verdad para el nombre.** `DEFAULT_BRANDING.name` es el
   único literal de marca que queda en el código; las tres apariciones que había
   en `branding-client.tsx` sederivaron a él. Un rebrand futuro es una edición.
2. **Copy neutral donde el componente no conoce la marca.** El white-label es por
   organización: un texto visible que dijera "Espacio Connect" en un tenant
   renombrado a "Vende Veloz 365" sería un bug. Solo se nombra la marca donde el
   nombre ya viene de `branding`.
3. **Los identificadores que no se ven no se tocan** aunque la marca haya
   cambiado. Cookies, `localStorage`, `globalThis`, volúmenes, usuario del
   contenedor, `package.json` name: ninguno de ellos es marca visible, y varios
   tienen coste real de datos o de preferencia de usuario.
4. **Sobre "EV Connect": no se usa en la UI, a propósito.** El nombre lo elige
   cada organización; un "EV Connect" fijo en la barra lateral o en Configuración
   pisaría el white-label y sería un bug de la misma familia que el punto 2. La
   forma corta que ya existe (y que se verificó en pantalla) es la inicial que la
   UI deriva sola del nombre: **"E"**. En docs se usa solo donde abre abrevio
   natural, y aquí no hacía falta.
5. **Lo que el plan profetizó y no ocurrió.** `plan.md` §2 listaba como "marca
   visible" `src/app/(app)/layout.tsx` y `src/components/app-nav.tsx`: **ninguno
   tenía un literal**. También listaba `package.json` `description` como copy a
   renombrar: **ya era neutra**. Se corrige aquí para que nadie lo dé por hecho.

### Verificación en vivo (EJECUTADA, no PENDIENTE)

Este corte no añade comportamiento, pero **la marca visible sí es observable**, así
que se ejercitó contra la app real en lugar de Assuming. App de desarrollo real
(`pnpm dev`, los mocks se apagan en producción por diseño) + **PostgreSQL real** en
`127.0.0.1:55432` (BD desechable `espacio_brand_cut6`, migrada con
`scripts/migrate.mjs`, luego eliminada) + Playwright con Chromium real.

**21/21 checks, `exit=0`**, cubriendo:

- El **nombre por defecto** es "Espacio Connect" en el `h1` del login, en el
  `<title>` del navegador y en la barra lateral.
- El **white-label por organización sigue intacto**: tras `PUT
  /api/settings/branding` con `{name: "Vende Veloz 365", accent: "#3f6b66"}`, el
  login, el `<title>`, la barra lateral, el input y la **vista previa** de
  Configuración → Nombre muestran "Vende Veloz 365" — y el default **no** pisa al
  nombre propio.
- **Cero copy visible** diciendo "Vocero" en `/inbox`, `/pipeline`, `/contacts`,
  `/agenda` y `/lab`, medido con `innerText` (texto renderizado), que ignora el
  `<script>` donde sí viven las claves de cookie conservadas.
- Capturas: login, barra lateral y Configuración → Nombre con el valor por defecto.

Nota de entorno: Chromium no arrancaba por `libnspr4.so` / `libnss3` ausentes en
el sistema; se resolvió con `LD_LIBRARY_PATH` sobre unas librerías ya extraídas en
`~/.local/share/Trash/files/libs/final`. No es un cambio del repo.

La base de 013 se confirmó **presente y sin tocar** durante la misma corrida (la
captura muestra "Por atender", "Comprometidos" y "Agenda" en la barra lateral): se
cumplía la precondición de este corte.


## CUT 7 — Rediseño práctico

- [x] T701 Shell / sidebar / header: jerarquía, respiración, acento
- [x] T702 Nav: "Por atender" y Agenda visibles con conteos
- [x] T703 Bandeja: lo urgente arriba; "Por atender" como primera opción
- [x] T704 Tarjetas de conversación y panel: estado humano/IA legible de un vistazo
- [x] T705 Pipeline: etapas comerciales claras, sin etapas operativas falsas
- [x] T706 Consistencia de labels, spacing, badges
- [x] T707 Empty states de las superficies nuevas y existentes tocadas
- [x] T708 Sin librería UI nueva; tokens y componentes reutilizados
- [x] T709 Sin cambios de contrato (DTOs, endpoints, lógica de 013)
- [x] T710 Gate + E2E de UI (o PENDIENTE con causa)
- [x] T711 Evidencia, un commit, árbol limpio

### CUT 7 — CERRADO (2026-10-04)

**Diagnóstico de partida.** El código ya tenía un sistema de diseño maduro
(tokens Atlas, `cn`, `lucide-react`) y un vocabulario de estado bien hecho. El
problema no era el sistema: era que la **señal de urgencia no era visual**. En
concreto, cuatro fallos que se ven sin abrir la app:

1. El contador de la Bandeja en el nav era **no leídas**, no la cola. "No leídas"
   responde "¿qué no vi?" y casi siempre ya lo había contestado la IA; la pregunta
   del día es "¿qué hago?". FR-7.7 pide que "Por atender" sea evidente, y en el
   shell no lo era en ninguna parte.
2. El bloque de estado del panel era **ámbar siempre**, con independencia del
   estado. Un recordatorio vencido (hay trabajo HOY) se veía igual que una
   conversación ya atendida esperando al cliente (no hay nada que hacer).
3. La etiqueta del estado estaba **triplicada** en tres componentes: fila de la
   lista, chip del panel y (a medias) el hilo. Tres copias se separan en cuanto
   se rediseña una.
4. Seis pantallas tenían **tres cabeceras distintas**: Agenda con icono y frase,
   Pipeline/Contactos/Agente/Configuración con un `h2` pelado, Laboratorio con
   otro. Rediseñar "la cabecera" obligaba a repetir el trabajo seis veces.

**Decisiones de diseño (las cinco, con su porqué).**

| # | Decisión | Razón |
|---|---|---|
| 1 | El nav se agrupa por **pregunta** —"Tu trabajo" (Bandeja, Agenda) y "Operación" (Pipeline, Contactos, Agente, Laboratorio)— | Seis items del mismo peso obligaban a leerlos todos para encontrar la Bandeja. Dos grupos lo dicen sin leer. |
| 2 | El badge de la Bandeja pasa de **no leídas a la cola** (`nav-contador-por_atender`), contado con `necesitaAtencionAhora` sobre la MISMA lista que usa el chip | Extiende el invariante de 013 C4: dos números para la misma lista no pueden discrepar porque son la misma operación leída dos veces. Lo que se pierde no es información: las no leídas siguen como chip dentro de la Bandeja. |
| 3 | **Una sola etiqueta de estado** (`EstadoPill` en `inbox/estado-chip.tsx`), usada por la fila, el panel y la cabecera del hilo; el tono se decide una vez por estado | El bloque del panel se tiñe con el tono del estado (`danger` / `warning` / neutro) en vez de ámbar fijo. Con la IA al mando no se pinta nada, igual que en 013 C4. |
| 4 | La fila de la cola lleva un **canto rojo** a la izquierda, y el chip "Por atender" se pinta rojo al activarse y se insinúa en rojo si hay cola sin estar en ella | Una etiqueta de 11 px dentro de una fila con tres chips obligaba a *leer* para saber qué hacer. Ahora se reconoce al pasar el ratón por la lista. El canto sale de `necesitaAtencionAhora`, la misma función del chip: no inventa un estado. |
| 5 | **Una `PageHeader`** compartida por las seis páginas, y el stepper de etapas del panel pasa de columna a **riel horizontal** | Seis cabeceras obligaban a repetir el rediseño; el stepper gastaba ~150 px de alto para decir una cosa y empujaba el bloque de estado y las notas. El riel conserva el mismo manejador, el mismo `aria-label` ("Mover a X") y el mismo orden de etapas. |

**Lo que NO se hizo, a propósito.**

- **No se metió un dashboard** (FR-7.8, D-4). El "Por atender" es la primera
  opción de una fila de filtros que ya existía, no una pantalla nueva.
- **No se inventaron etapas ni copy de negocio.** T705 pedía "sin etapas
  operativas falsas" y así quedó: el Pipeline sigue mostrando las etapas que
  siembra `org:create`, y solo se le añadió el recuento de leads y los estados
  vacíos honestos.
- **No se tocó ningún contrato.** `git diff --name-only` no toca `src/lib/types`,
  `src/server/` ni `src/app/api/`: ni un DTO, ni un endpoint, ni la lógica de
  atención de 013, ni el motor de follow-ups.
- **No se normalizaron los 123 usos de `text-muted-foreground`.** Apunta al mismo
  token que `text-text-3` (`--text-3`), así que es un detalle de nombre, no de
  jerarquía visual, y tocar 21 ficheros para eso haría el diff irrevisible. Queda
  anotado para CUT 8 si se decide.
- **No se tocó el `letter-spacing: -0.01em` global.** A 11–12 px aprieta los
  espacios alrededor de los `·` de la Agenda y de las frases de las cabeceras
  (se ve en las capturas). Es una decisión del sistema de diseño, no de este corte.

**Evidencia — gates técnicos.** `typecheck` OK · `lint` **0 errores** (los 3
warnings son preexistentes: `<img>` en `anuncio-origen.tsx` y dos
`eslint-disable` sin uso en `build-state.ts`) · `build` compiló · `test`
**114 archivos / 1320 tests** verdes (1 archivo skipped = opt-in sin variable),
incluidos los 8 nuevos de `tests/unit/redesign-practico.test.ts`.

**Evidencia — E2E con UI real (Playwright).** App real + PostgreSQL real
(`operator_workspace_test_c7` en `:55432`) + mocks, en `:3200`:

| Sección | Resultado | Log |
|---|---|---|
| `E2E_SECTION=026` (los 12 casos del workspace) | **121/121 checks OK**, `exit=0` | `/tmp/e2e-c7-final-026.log` |
| `E2E_SECTION=025` (flujo operativo) | **84/84 checks OK**, `exit=0` | `/tmp/e2e-c7-final-025.log` |
| `E2E_SECTION=023` (cola "Por atender") | **35/35 checks OK**, `exit=0` | `/tmp/e2e-c7-final-023.log` |

Se añadió **un check nuevo** al arnés 026 (no solo el `.md`):
`026 · el nav cuenta la cola y coincide con el chip y con la API`, que compara
las tres fuentes —badge del nav, chip de la lista y `GET /api/conversations`— para
que una divergencia futura se vea en pantalla y no en una queja.

**Revisión visual (modo oscuro y claro).** `scripts/screenshot-c7.mjs` deja PNGs
en `/tmp/shots-c7` y `/tmp/shots-c7-light`. En la captura de la Bandeja se ve el
resultado: nav con "TU TRABAJO" y los dos números en rojo, "Por atender 2" en
rojo, las dos filas de la cola con el canto rojo y la etiqueta `Por atender` en
rojo, "Esperando respuesta" en neutro, "Recordatorio" en ámbar, la etapa "Nuevo"
ya subordinada a gris, y el Pipeline con la cabecera unificada, el recuento de
leads y "Nadie en esta etapa" en las columnas vacías.

**Contraste corregido sobre la marcha.** El badge activo con `bg-danger
text-white` quedaba en **3.6:1** en modo oscuro (`--danger` es `#c46e6a`), por
debajo del 4.5:1 que pide un texto de 10.5–12.5 px. Con `dark:bg-danger-soft
dark:text-danger-text` se sube a 6.6:1 sin cambiar el significado del color.

**Constitution Check re-evaluado tras el corte (V, IX).** Sin violaciones. Cero
dependencias nuevas, luego II intacto; sin secretos nuevos (I); sin
`organization_id` ni scope tocados, porque no se tocó la capa de datos (III);
sin integraciones externas (IV); gate completo **más** verificación en navegador
con camino feliz e infeliz comprobados en pantalla, nada dado por supuesto (V);
los artefactos SDD preceden al corte (VI); la auditoría de decisiones queda
grabada en esta tabla, no en memoria informal (VII); sin alcance nuevo, la
jerarquía se resolvió dentro de las superficies existentes (VIII); y el
comportamiento observable —qué número sale en el shell y cómo se ve una fila de
la cola— se ejerció contra la app real, en los dos temas (IX).

## CUT 8 — Polish y regresión final

- [x] T801 Responsive razonable (escritorio primero)
- [x] T802 Accesibilidad básica: foco visible, `aria`, contraste, teclado
- [x] T803 Empty / loading / error states completos
- [x] T804 Regresión Inbox
- [x] T805 Regresión Pipeline
- [x] T806 Regresión Contactos
- [x] T807 Regresión Agente
- [x] T808 E2E actualizado y ejecutado (o PENDIENTE con causa)
- [x] T809 `docs/CURRENT_STATE.md` final
- [x] T810 `specs/013-operator-workspace/tasks.md` actualizado
- [x] T811 `specs/014-espacio-connect-rebrand/tasks.md` actualizado
- [x] T812 Pendientes honestos; sin "READY" sin evidencia
- [x] T813 Gate completo final
- [x] T814 Un commit, árbol limpio

**Ver nota de cierre al final de esta sección: T809–T814 son la propia
documentación de este corte; su evidencia está en §Evidencia → CUT 8.**

---

## Evidencia

### CUT 8 — Polish y regresión final (2026-10-04)

Este corte no añade funcionalidad: revisa lo que dejaron los cortes 1–7 y lo deja
presentable y operable. Lo que se encontró al revisar no era hipotético —tres
defectos reales que el gate no ve— y se corrigió con su test.

**Gates, en verde:**

| Gate | Resultado |
|---|---|
| `pnpm typecheck` | OK, sin salida |
| `pnpm lint` | **0 errores**, 3 warnings preexistentes (los mismos de CUT 5/6/7) |
| `pnpm build` | compiló (Next 15.5.20) |
| `pnpm test` | **115 ficheros / 1335 tests verdes**, 1 fichero skipped (opt-in sin variable), 9 tests skipped. **+15** respecto a CUT 7: `tests/unit/cut8-polish.test.ts` |

**E2E con UI real, app + PostgreSQL + mocks.** BD dedicada
`operator_workspace_test_cut8` en `127.0.0.1:55432`, app en `:3021`, Chromium
real vía Playwright:

| Sección | Guion | Resultado |
|---|---|---|
| `E2E_SECTION=027` (este corte) | `tests/e2e/027-polish-cierre.md` | **53/53 checks OK**, `exit=0` |
| `E2E_SECTION=026` (los 12 casos del workspace) | `013-workspace-verificacion.md` | **121/121 checks OK**, `exit=0` |
| `E2E_SECTION=025` (flujo operativo) | `013-flujo-operativo.md` | **84/84 checks OK**, `exit=0` |
| `E2E_SECTION=024` (Agenda) | `013-agenda-recordatorios.md` | **49/49 checks OK**, `exit=0` |
| `E2E_SECTION=023` (cola "Por atender") | `013-bandeja-por-atender.md` | **35/35 checks OK**, `exit=0` |

Los cinco en verde y con `exit=0`: los 12 casos del bloque 013 se **volvieron a
ejecutar** después de estos cambios, no se heredaron.

**Tres defectos reales que encontró la revisión (y que el gate no ve):**

1. **La Bandeja se quedaba en "Cargando…" PARA SIEMPRE si el `fetch` fallaba.**
   `refetchConversations` hacía `return` a secas sin distinguir fallo de "todavía
   no", y `conversations === null` es exactamente el estado de carga: una espera
   que nunca termina. Ahora hay estado de error con su mensaje, `role="alert"` y
   un "Reintentar" que funciona.
2. **El Pipeline afirmaba un hecho FALSO si el tablero no cargaba.** Con
   `stages === []` pintaba "Este pipeline todavía no tiene etapas" y ofrecía
   "Gestionar etapas" — es decir, le echaba la culpa a la configuración del
   negocio cuando lo que había pasado era que no se pudo preguntar. Ahora el
   fallo de red se declara como fallo de red, con su reintento.
3. **"Reactivar IA" fallaba en silencio.** `onPatchConversation` devolvía `void`
   y descartaba la respuesta del `PATCH`: si fallaba, el botón se quedaba
   pulsado, no pasaba nada y no se decía nada. Ahora devuelve el mensaje de error
   y el bloque lo muestra.

**Un cuarto defecto lo encontró el propio E2E 027 al ejecutarse** (no al
escribirse): con el panel de detalles "abierto" por defecto, en móvil **no había
ninguna manera de llegar a los detalles** —el botón solo se pintaba con
`!panelOpen`, y en móvil los detalles quedan fuera de pantalla aunque `panelOpen`
sea `true`. Callejón sin salida, con el gate completamente en verde. Corregido en
`inbox-client.tsx`; los checks "el panel de detalles ocupa la pantalla" y "cerrar
los detalles devuelve al hilo" lo cubren.

**Cambios de código (12 ficheros):**

| Fichero | Qué |
|---|---|
| `src/components/app-shell.tsx` | **nuevo**. Columna en móvil / fila en `md+`, barra mínima, cajón con velo, Escape + foco devuelto, cierre al navegar |
| `src/app/(app)/layout.tsx` | delega el shell en `AppShell` |
| `src/components/app-nav.tsx` | `w-full md:w-56` (el ancho lo pone el cajón); etiqueta de grupo de `--text-4` → `--text-3` |
| `src/app/globals.css` | anillo de foco global `:where(...):focus-visible`, dentro de la caja |
| `src/components/inbox/inbox-client.tsx` | maestro/detalle en móvil, error de la lista, "atrás" en el hilo, botón de detalles sin callejón, `patchConversation` devuelve el fallo |
| `src/components/inbox/conversation-list.tsx` | estado de error + reintento, `aria-busy`, reloj de lo no leído a `--accent-text`, megáfono a `--text-3` |
| `src/components/inbox/attention-block.tsx` | `role="status"`/`role="alert"`, y "Reactivar IA" con ciclo de vida propio |
| `src/components/inbox/reminder-schedule.tsx` | foco en la fecha al abrir, `aria-expanded`/`aria-controls`, avisos anunciados, confirmación a `--accent-text` |
| `src/components/pipeline/pipeline-client.tsx` | estado de error distinto del vacío, "Nadie en esta etapa" a `--text-3` |
| `src/components/agenda/agenda-client.tsx` | `role="alert"`, `aria-busy`, padding y filas fluidas |
| `src/components/page-header.tsx` | `flex-wrap` y padding responsive (lo demás idéntico) |
| `src/components/contacts/contacts-client.tsx` · `src/components/lab/lab-client.tsx` | padding y buscador responsive |

**Contraste: medido, no estimado.** `tests/unit/cut8-polish.test.ts` **calcula** las
ratios leyendo los tokens de `src/app/globals.css`, así que no puede quedarse
mintiendo si alguien re-tunea el tema. Lo que estaba por debajo del umbral y se
corrigió:

| Estado | Antes (claro / oscuro) | Ahora (claro / oscuro) | Token |
|---|---|---|---|
| Reloj de lo no leído (C7) | 7.28 / **2.57** | 10.66 / **12.38** | `--accent-text` |
| … sobre la fila seleccionada | 7.28 / **2.20** | 9.83 / **10.62** | `--accent-text` |
| Confirmación de "Recordarme" (C4) | 6.86 / **2.33** | 10.04 / **11.24** | `--accent-text` |
| Etiqueta de grupo del nav (C7) | **2.13** / 3.48 | 3.22 / **5.28** | `--text-3` |
| "Nadie en esta etapa" (C7) | **2.20** / 3.60 | 3.33 / **5.47** | `--text-3` |
| Icono del megáfono (C7) | **2.20** / 3.60 | 3.33 / **5.47** | `--text-3` |

La causa común: `--accent` es un color de **superficie** y se estaba usando como
**texto**. En tema oscuro eso se hunde. `--accent-text` es el token que el
proyecto ya usaba para texto de marca en el resto de la app; los tres cambios lo
dejan de ser los dos únicos sitios que se salían la convención.

**Ninguna expectativa existente se modificó en este corte.** `page-header.tsx` y
`conversation-list.tsx` cambian, pero en responsive, en `aria` y en los tres
tokens de la tabla de contraste; los 8 tests de `redesign-practico.test.ts`
(CUT 7) y los 30 de `operational-flow.test.ts` (CUT 4) siguen verdes **sin
tocarlos**. Sobre la Agenda se comprobó que los cinco grupos vacíos **deben**
seguir viéndose, porque 013 C3 lo decidió así con un test
(`agenda-view.test.ts`, "pinta los cinco grupos aunque estén vacíos") y es una
decisión buena: el mensaje de vacío explica qué hacer y los cinco grupos
explican qué es. Ocultarlos habría sido una "mejora" que rompía una intención.

**Pendientes honestos de este corte (NO se declara READY punta a punta):**

1. **Rampa neutra del tema claro por debajo de 4.5:1 para texto pequeño.**
   `--text-3` se queda en 3.22–3.33:1 en claro. Es deuda **preexistente y de toda
   la app** (los items del nav, el buscador y las etapas ya lo usaban), no algo
   que este corte introdujera: lo que hace este corte es **dejar de añadir casos
   nuevos** por debajo de ese suelo. Cerrarla es re-tunear la rampa neutra, una
   decisión de diseño que afecta a toda la superficie visible, y por eso queda
   escrita y **no** se disimula bajando un umbral en el test: hay un test
   dedicado que afirma el suelo y escribe la deuda con sus números.
2. **`commercial-resource-postgres.test.ts`: 3 de 4 verdes.** Reproducido de
   primera mano (ver `013-operator-workspace/tasks.md`, pendientes históricos). No
   se arregla aquí: es de 011, y un corte es un objetivo.
3. **Secciones históricas 020/021/022**: sin cambios, siguen PENDIENTES. No las
   ejecutó este corte.
4. **FK compuesta de `conversation_attention`**: sigue abierta y sin Owner
   (heredada de 013 C1). La garantía vive hoy en la aplicación, no en la base.
5. **La revisión visual en modo oscuro y claro** (los PNGs de `scripts/screenshot-c7.mjs`)
   no se repitió con capturas nuevas: la verificación de contraste de este corte
   es **numérica y por test**, no por captura.
6. **Enmienda de la constitución**: sigue PENDIENTE FORMAL (T611), heredado de CUT 6.

**Constitution Check re-evaluado tras el corte (V, IX).** Sin violaciones. Cero
dependencias de UI o de runtime nuevas, luego II intacto; sin secretos nuevos ni
cambios de cifrado (I); el shell, el panel y los estados tocan la capa de
presentación, no el scope ni `organization_id`, y ninguna tabla cambió (III); sin
integraciones externas, y el sandbox del Laboratorio intacto (IV); gate completo
**más** 342 checks de navegador con camino feliz e infeliz, incluidos los cuatro
que fallaban y ahora están verificados (V); los artefactos SDD preceden al corte
(VI); la auditoría queda grabada en este archivo, incluidas las cifras de
contraste y los pendientes (VII); sin alcance nuevo ni panel nuevo: se corrigieron
superficies que ya existían, y la causa de cada decisión está escrita junto al
código (VIII); y el comportamiento observable —qué se ve al tabular, en un móvil,
y cuando el servidor falla— se ejerció contra la app real y se midió (IX).


### CUT 6 — Rebrand Espacio Connect (2026-10-04)

**Gates, en verde:**

| Gate | Resultado |
|---|---|
| `pnpm typecheck` | OK, sin salida |
| `pnpm lint` | **0 errores**, 3 warnings preexistentes (los mismos de 013 CUT 5) |
| `pnpm build` | compiló (Next 15.5.20) |
| `pnpm test` | **113 ficheros / 1312 tests verdes**, 1 fichero skipped (opt-in sin variable), 9 tests skipped. **+1** respecto a 013: el test nuevo de white-label |

**Cambios de código (5 ficheros, 12 líneas de producto):**

- `src/lib/branding.ts` — `DEFAULT_BRANDING.name` → `"Espacio Connect"`. Nada más
  del fichero: `normalizeBranding`, `resolveAccentSet*`, presets y `accentCssVariables`
  intactos.
- `src/components/settings/branding-client.tsx` — los 3 literales "Vocero"
  pasan a leer `DEFAULT_BRANDING.name` (placeholder, inicial y nombre de la vista
  previa). **Una** fuente de verdad.
- `src/components/inbox/contact-panel.tsx` — "El agente de Vocero no responde…"
  → "El agente no responde por su cuenta" (copy neutral: respeta el white-label).
- `src/app/api/dev/wa-mock/graph/[...path]/route.ts` — `verified_name` del mock.
- `tests/unit/branding.test.ts` — **única expectativa modificada, justificada**: era
  una afirmación de **marca visible** (`normalizeBranding(null).name === "Vocero"`),
  que FR-6.2 cambia por definición. El nombre del test se actualizó y se añadió
  `expect(DEFAULT_BRANDING.name).toBe("Espacio Connect")` para que un rebrand
  futuro no pase inadvertido. **Ninguna otra expectativa se tocó**: las de acento,
  recorte a 30 caracteres, dark mode y CSS variables siguen idénticas.
  **+1 test nuevo**: el white-label por organización (`normalizeBranding` respeta el
  nombre propio en nombre y acento), que es la garantía que el cambio de default
  podía romper y la que ahora queda fijada por test.

**Docs (4 ficheros):** `README.md` (15→1), `INSTALL-IA.md` (9→5), `CLAUDE.md` (4→2),
`tests/e2e/us-bot-api.md` (1→0), más los comentarios de cabecera de `Dockerfile` y
`docker-compose.yml`. Se renombró solo lo visible; lo técnico se conserva y está
inventariado arriba.

**Verificación en vivo: 21/21, `exit=0`.** App de desarrollo real + PostgreSQL real
(`127.0.0.1:55432`, BD desechable `espacio_brand_cut6` migrada y luego eliminada) +
Chromium real vía Playwright. Detalle en §Verificación en vivo. Se comprobó, con
navegador de verdad: el nombre por defecto en login, `<title>` y barra lateral; el
**white-label por organización sigue funcionando** (nombre propio gana en login,
título, sidebar, input y vista previa); y **cero copy visible** "Vocero" en
`/inbox`, `/pipeline`, `/contacts`, `/agenda` y `/lab`.

**Pendientes honestos de este corte:**

1. **Enmienda de la constitución: PENDIENTE FORMAL** (T611). Requiere propuesta
   escrita, Sync Impact Report y aprobación del responsable. No bloquea el
   rebrand: el producto ya es Espacio Connect en todo lo visible.
2. **Capturas de `docs/screenshots/*.png`: no re-generadas.** Son binarios y
   muestran la interfaz anterior; el `alt` de la README sí dice Espacio Connect.
   Regenerarlas es trabajo de CUT 7/8, cuando además cambie el diseño.
3. Los identificadores inventariados (cookies, `localStorage`, `globalThis`,
   volúmenes, usuario del contenedor, `package.json` name, fixtures `@vocero.test`)
   se conservan **a propósito**; cambiar cualquiera de ellos es un corte propio con
   migración o decisión de datos, no un rebrand.

**Constitution Check re-evaluado tras el corte (Principio V y VII).** Sin
violaciones. La marca no es un secreto (I); ninguna dependencia nueva (II); el
branding es **por organización** y solo se cambió el valor por defecto, sin tocar
`normalizeBranding` ni el scope (III); sin integraciones (IV); gate completo más
verificación en navegador, con lo no ejecutable marcado (V); este spec/plan/tasks
preceden al corte (VI); la auditoría completa queda **grabada** en este archivo, con
la decisión y la razón de cada categoría, incluidas las 199 supervivientes (VII);
sin alcance nuevo (VIII); y el comportamiento observable —el nombre que la gente
ve— se ejerció en la app real, no se dio por supuesto (IX).

---

### Bootstrap (2026-10-04)

Creados `spec.md`, `plan.md` y `tasks.md` de este spec, más los
prompts `.ai/tasks/operator-workspace/06..08` y el runner compartido
`scripts/ai/run-operator-workspace-mcode.sh`. **Cero código funcional de 014 en ese
commit.** CUT 6 dependía de los Cortes 1–5 de 013 cerrados: confirmado con `git log`
(`771f3b3`…`a00d169`) y en vivo durante la verificación.
