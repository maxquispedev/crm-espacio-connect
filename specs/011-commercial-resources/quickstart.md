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
