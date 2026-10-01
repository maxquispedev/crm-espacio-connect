/**
 * GET /api/playbook — T201 (Corte 2, Feature 008).
 *
 * Devuelve la cabecera del playbook + las versiones `published` y
 * `draft` de la organización. Las tres pueden ser null; si todas lo
 * son respondemos 404 `not_found` (no hay playbook bootstrapeado
 * todavía).
 *
 * Tenant-safe por Constitución III: todas las queries via store con
 * `organizationId = session.organizationId`. Nada de cache en memoria
 * (Corte 1 retiró la cache; no reintroducir).
 */

import { withAuth } from "@/lib/api";
import {
  getDraftVersionForOrg,
  getPlaybookForOrg,
  getPublishedVersionForOrg,
} from "@/lib/sales/playbook/store";
import {
  playbookRowToDto,
  versionRowToDto,
} from "./_dto";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const [playbook, published, draft] = await Promise.all([
    getPlaybookForOrg(session.organizationId),
    getPublishedVersionForOrg(session.organizationId),
    getDraftVersionForOrg(session.organizationId),
  ]);

  if (!playbook && !published && !draft) {
    return Response.json(
      { code: "not_found", message: "No hay playbook para esta organización" },
      { status: 404 }
    );
  }

  return Response.json({
    playbook: playbook ? playbookRowToDto(playbook) : null,
    published: published ? versionRowToDto(published) : null,
    draft: draft ? versionRowToDto(draft) : null,
  });
});
