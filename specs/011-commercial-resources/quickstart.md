# Loop autónomo — operación desde Bash/WSL

Bootstrap: solo SDD y runner. Nunca iniciar el runner dentro de Codex interactivo.
Requisitos: árbol limpio, git, Bash, Codex autenticado, GNU timeout, tee y herramientas
shell comunes. Cada exec comienza en raíz; logs ignorados en .ai/logs/commercial-resources.
El preflight elige --full-auto o --approve-for-me según help instalado, sin bypass.

Desde una terminal Bash/WSL nueva:

```bash
cd /home/max/proyectos/crm-espacio-connect
START_CUT=1 END_CUT=3 CUT_TIMEOUT=90m bash scripts/ai/run-commercial-resources-codex.sh
```

Default: START_CUT=1, END_CUT=4, CUT_TIMEOUT=90m, HEARTBEAT_SECONDS=25.
GNU timeout envuelve cada exec (TERM al vencer, KILL tras 30s). Stdout+stderr
se ven en vivo y se guardan con tee; heartbeat independiente informa corte,
segundos, cambios, HEAD y archivo modificado recientemente. Exit distinto de 0,
fallo tee, árbol sucio o más/menos de un commit detienen el pipeline.

Después de 1–3: comprobar gates/evidencia y subir los tres videos reales desde UI.
Verificar persistencia tras reinicio y reproducir cada video nativo en WhatsApp
con destinatario de prueba autorizado/allowlist y sin ráfagas. Confirmar happy e
infeliz, sandbox sin llamadas externas y docs con estado real. Esta verificación
operativa no es desplegada ni ejecutada por el runner.

El task de C4 exige evidencia registrada de la pausa; si falta, se detiene.
Cuando esa comprobación esté registrada y se decida continuar:

```bash
START_CUT=4 END_CUT=4 CUT_TIMEOUT=90m bash scripts/ai/run-commercial-resources-codex.sh
```

C4 mantiene Published 1.0: después actualizar draft a 1.1, probar y publicar
explícitamente antes de esperar instrucciones de pago automáticas.

## Recuperación conservando cambios

Ante fallo, inspeccionar git status, git log y log del corte. Nunca reset,
checkout, clean ni descartar automáticamente. Si hay cambios parciales, usar una
sesión NUEVA para terminar SOLO ese corte y crear su único commit; el runner
rechaza árbol sucio. Si el commit ya existe, no crear otro por reejecutar: verificar
estado/evidencia, y reanudar en N+1 con END_CUT adecuado. START_CUT no reemplaza
las dependencias: cada task debe comprobar lo que dejaron cortes anteriores.
E2E no disponible se registra PENDIENTE; fin del rango del runner no implica READY.

## Self-test del corte 2 — sección 020

**Estado 2026-10-03:** gate técnico verde; E2E UI/BD/codec/reinicio PENDIENTES.
Intento real terminó antes del setup por ECONNREFUSED :3000; no hay ejecutables
PostgreSQL/Docker ni ffmpeg en este entorno. Generador de fixture también
intentado: exit 1 por ffmpeg ausente. No se reporta READY ni un video generado.

Usar una app **de pruebas aislada**, apuntando a la MISMA BD local dedicada del
arnés y a MEDIA_DIR persistente fuera del repo. No usar la BD ni el proceso
productivo. Requisitos: PostgreSQL local, migraciones aplicadas, app en desarrollo
con mocks locales, Playwright/Chromium y ffmpeg con libx264 **solo en tests**.
No se añade ffmpeg al runtime ni al contenedor de la app. La sección crea
organizaciones de prueba; no agrega conversaciones ni conexión Meta.

Primero comprobar físicamente C1 (aplica/reaplica migraciones y constraints):

```bash
COMMERCIAL_RESOURCES_TEST_DATABASE_URL=postgresql://local_test:local_test@127.0.0.1:5432/commercial_resources_test_c2 \
  pnpm --pm-on-fail=ignore exec vitest run tests/unit/commercial-resource-postgres.test.ts
```

La app debe usar ese mismo DATABASE_URL, un MEDIA_DIR persistente de pruebas,
secretos placeholder propios del entorno local y todos los proveedores hacia
mocks. Cuenta fixture `e2e@vocero.test` / `password-e2e-123`; el arnés intenta
signup y luego login. No acepta credenciales productivas. Para solo este corte,
sin ejecutar el setup de conexión WhatsApp de otras secciones:

```bash
APP_BASE_URL=http://127.0.0.1:3000 \
DATABASE_URL=postgresql://local_test:local_test@127.0.0.1:5432/commercial_resources_test_c2 \
E2E_SECTION=020 WA_MOCK_ENABLED=true BOT_API_KEY=e2e-local-placeholder \
META_GRAPH_BASE_URL=http://127.0.0.1:3000/api/dev/wa-mock \
OPENROUTER_BASE_URL=http://127.0.0.1:3000/api/dev/ai-mock \
TYPESAFE_JEV_ENDPOINT=http://127.0.0.1:3000/api/dev/jev-mock \
pnpm --pm-on-fail=ignore test:e2e
```

Este es el comando intentado en C2. Primer intento recibió EPERM de sockets del
sandbox; reintento autorizado confirmó ECONNREFUSED. Ningún escenario ejecutado.
El arnés completo también despacha 020 al final; requiere la misma BD dedicada.
Se puede indicar `E2E_COMMERCIAL_DATABASE_URL` para la conexión SQL del arnés,
siempre local/dedicada y coincidente con la app; no hay fallback a BD arbitraria.

020 genera un MP4 H.264 de un segundo con color sintético en `/tmp` y lo sube y
reemplaza en cada slot desde **UI real Playwright**; reproduce preview privada,
guarda/relee cobro completo y vacío, rechaza pago parcial, falso/vacío/oversized,
comprueba tenants/sin sesión y ConfigV1/KB intactos. Se verifican también bytes
por HTTP, previews históricas y cero mensajes/Graph. Unitarios cubren error de escritura inyectado tras escritura en disco
temporal real, con executor BD simulado y rollback/commit incierto;
no se atribuyen esos escenarios a PostgreSQL real.

Para generar solo la fixture (sin app, BD, Meta ni material real):

```bash
node scripts/e2e-commercial-video.mjs
```

Imprime el path temporal; ningún binario se guarda en Git. Un ffmpeg ausente
produce fallo explícito; no se usa un falso MP4 como prueba de codec.

Persistencia **tras reinicio** requiere un comando del supervisor del entorno
local de pruebas. Pasar `E2E_COMMERCIAL_RESTART_ARGV_JSON` como array JSON de argv,
por ejemplo `["/tmp/restart-commercial-test-app.sh"]`, al comando anterior.
El script debe reiniciar únicamente esa app local y conservar PostgreSQL y
MEDIA_DIR. El arnés espera health y comprueba UI, cobro, IDs y bytes tras reinicio.
Sin argv de reinicio, imprime **PENDIENTE**: una recarga de página no cuenta como
reinicio. La comprobación de los tres MP4 reales en WhatsApp sigue siendo la
pausa operativa después de C3; no se ejecuta en C2.
