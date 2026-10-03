# 011 — Loop de recursos comerciales

Estado bootstrap: cuatro cortes pendientes. Cada archivo numerado 01–04 es
prompt completo para UNA sesión nueva desde raíz. 00 es guía, nunca se ejecuta.

1. Fundación/persistencia → 2. UI recursos → 3. Demos nativas → PAUSA → 4. Pago.
Estado durable y evidencia: specs/011-commercial-resources/tasks.md.
Operación/reanudación: specs/011-commercial-resources/quickstart.md.
Runner: scripts/ai/run-commercial-resources-codex.sh. Usar Bash/WSL externo,
START_CUT=1 END_CUT=3 CUT_TIMEOUT=90m para primera tanda; luego 4–4.
Nunca resume, runner dentro de Codex, reset/checkout/clean automático o deploy.
