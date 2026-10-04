# Plan y analyze — 012

1. Writer: mantener no-reply y pago autorizado; después retornar null para
   lane=human + shouldHandoff, antes de LLM, perfil e instrucciones editables.
   Eliminar instrucciones de transición y prohibir anuncios en el prompt general.
2. Renderer de pago: sustituir únicamente encabezado, cierre y fallback vacío.
3. Defaults playbook: schedule_call silencioso y pago con escalamiento interno;
   no modificar preguntas canónicas V2 ni reglas Jev ni Published de BD.
4. Prueba rápida acepta text=null solo para HUMAN puro con handoff aplicado;
   conserva no_writer_output para vacíos inesperados. UI muestra estado interno.
5. Tests writer + integración orquestador/delivery/sender + arnés E2E 022.
6. Gates, documentación, evidencia y commit único; detenerse.

## Constitution Check antes/después del diseño

I/III: no nuevos datos ni queries; scoped intacto. II: ninguna dependencia nueva.
IV: dedup y entrega sin retry intactos. V/IX: gates y self-test requeridos, con
pendiente explícito si falta app/PG. VI: spec/clarify/plan/tasks/analyze previos al
código. VII: decisión y límites documentados. VIII: conversación comercial actual.
Sin violaciones. Analyze: pago autorizado debe preceder al retorno HUMAN; cualquier
HUMAN prioritario sin autorización queda silencioso, sin ejecutar acción desplazada.
