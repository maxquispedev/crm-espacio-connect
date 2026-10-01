/**
 * GET /api/playbook/versions/[id] — T207 (Corte 2, Feature 008).
 *
 * Detalle completo de una versión. Si la versión existe pero
 * pertenece a otra organización (cross-tenant) o no existe, 404.
 *
 * Tenant-safe: `getVersionById` ya aplica `scoped()`.
 */

import { withAuth } from "@/lib/api";
import { getVersionById } from "@/lib/sales/playbook/store";
import { versionRowToDto } from "../../_dto";

export const dynamic = "force-dynamic";

export const GET = withAuth(
  async (session, _request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    if (!id) {
      return Response.json(
        { code: "bad_request", message: "Falta el id de versión" },
        { status: 400 }
      );
    }
    const row = await getVersionById(session.organizationId, id);
    if (!row) {
      return Response.json(
        {
          code: "version_not_found",
          message: "La versión indicada no pertenece a esta organización",
        },
        { status: 404 }
      );
    }
    return Response.json({ version: versionRowToDto(row) });
  }
);
