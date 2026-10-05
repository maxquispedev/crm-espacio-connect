# 016 — Evidencia comercial y handoff silencioso

Solicitud autorizada 2026-10-05. Separada de 015, sin campañas, precio, oferta,
seguimientos ajenos ni UI nueva.

## Comportamiento
- Capacidad/fit/implementación/integración/condición material respaldada por
  producto, oferta, política o KB del tenant: responder breve, sin inventar.
- Falta contexto de la academia: UNA pregunta (`ask_more_questions`).
- Respuesta material sin evidencia: HUMAN, sin outbound ni transición; Por
  atender / Atención humana existente; IA pausada hasta reactivación válida.
- Asistencia existe: registro de alumnos y control/consumo de sesiones cuando
  corresponde. No cambia su prioridad terciaria. Control de Acceso permite buscar por DNI, nombre o apellido y confirmar
  el registro. No prometer biometría u otras modalidades sin evidencia.
- Roberto: Precio → S/247 → qué incluye → asistencia: respuesta afirmativa breve,
  sin handoff. Integración no documentada: silencio y atención humana.
- Known: pagos parciales/saldos, matrícula, asistencia responden normalmente.
- Contexto: «Necesito algo para controlar mejor mi academia» pide contexto.

Clarify: requerimientos suficientes. Usuario confirma asistencia/sesiones.
Código real confirmado en repo local `clientes-vendeveloz365@c3928c6`:
`app/Filament/Pages/AccessControl.php` lookup (90–116), registerAttendance
(147–207); vista `resources/views/filament/pages/access-control.blade.php`
(27–42). DNI exacto o nombre/apellido, selección y confirmación de matrícula
elegible; consume clases_remaining en planes no ilimitados. No se modificó
ese repositorio ni se dedujo soporte de hardware/biometría.

Verificar regresiones, proveedores fallando/formato incompleto, tenant, sandbox,
no repetir IA tras handoff; gates y self-test por webhook y superficies reales.
