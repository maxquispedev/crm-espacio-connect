import { AgendaClient } from "@/components/agenda/agenda-client";

export const dynamic = "force-dynamic";

/**
 * 013 C3 — La Agenda es una superficie PROPIA, no un filtro de la Bandeja
 * (plan §4.3): el layout `(app)` ya aporta el `AppNav` y la sesión.
 */
export default function AgendaPage() {
  return <AgendaClient />;
}
