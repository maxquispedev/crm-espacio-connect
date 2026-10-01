import { withAuth } from "@/lib/api";
import { mockGuard } from "@/lib/dev-guard";
import { bootstrapOrgIfNeeded } from "@/lib/sales/playbook/bootstrap";

export const dynamic = "force-dynamic";

/**
 * Arnés E2E (solo mocks): siembra la V1 del playbook en la organización
 * activa si aún no existe.
 *
 * Existe porque el bootstrap de producción se dispara en
 * `instrumentation.ts` AL BOOT y solo enumera orgs que ya tenían
 * `sales_orchestrator_enabled = true` en ese instante. En una base
 * recién creada ninguna cumple eso, así que el arnés no tendría una V1
 * con la que ejercitar el editor.
 *
 * NO es una vía de producción: `mockGuard()` responde 404
 * incondicional fuera del entorno de pruebas. Y no contradice la regla
 * de que la UI no siembra bajo demanda: esto es un mock del arnés, no
 * la superficie de `/agent`.
 *
 * Es idempotente (misma semántica que el bootstrap de boot): si la org
 * ya tiene playbook, devuelve `skipped`.
 */
export const POST = withAuth(async (session) => {
  const guard = mockGuard();
  if (guard) return guard;

  const result = await bootstrapOrgIfNeeded(session.organizationId);
  return Response.json({ ok: true, ...result });
});
