/**
 * GET /api/playbook/versions — T207 (Corte 2, Feature 008).
 *
 * Lista resumida de versiones del playbook de la organización,
 * ordenadas `version_number DESC`. Tenant-safe: `listVersionsForOrg`
 * ya aplica `scoped()` con la organizationId.
 */

import { withAuth } from "@/lib/api";
import { listVersionsForOrg } from "@/lib/sales/playbook/store";
import { versionRowToSummaryDto } from "../_dto";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const rows = await listVersionsForOrg(session.organizationId);
  return Response.json({
    versions: rows.map(versionRowToSummaryDto),
  });
});
