# CUT 6 — Spec 007: puerta única de cambio de etapa

Lee completamente spec/plan/tasks 007 y código real.

Objetivo único:
implementar el corte A: crear una única puerta de cambio de etapa, tenant-safe y testeada, SIN CAPI todavía y SIN cambiar comportamiento comercial.

Primero descubre TODOS los writes runtime actuales a `lead.stageId`:
- drag/drop / pipeline APIs;
- Sales Orchestrator/Jev;
- cualquier endpoint/bot/integración actual.

Diseña el helper/servicio mínimo compatible con arquitectura actual. Debe:
- validar tenant y etapa destino del mismo tenant;
- actualizar stage/position y campos existentes según el camino actual sin perder semántica;
- permitir indicar source/actor si el modelo actual lo necesita;
- ser la única puerta runtime al finalizar el corte;
- ser utilizable por Jev sin crear dependencia circular;
- NO emitir eventos externos todavía.

Migra los callers actuales al gateway.
Especial cuidado: runSalesOrchestratorTurn / persistDecision debe dejar de escribir stageId directamente y usar la puerta común manteniendo lanes/facts exactamente iguales.

Tests:
- tenant isolation;
- no-op mismo stage;
- operador/API;
- movimiento producido por Jev;
- won/lost/open según modelo actual;
- regresión del Sales Orchestrator.

Gates completos.
Actualizar tasks.md 007 con evidencia del corte A.

Un commit:
refactor(pipeline): centralizar cambios de etapa del lead

Working tree limpio. No implementar CAPI en este corte.
