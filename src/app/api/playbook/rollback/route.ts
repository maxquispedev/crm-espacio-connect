/**
 * POST /api/playbook/rollback — T206 (Corte 2, Feature 008).
 *
 * Republica una versión archivada (o un draft archivado por error).
 * Tenant-safe: la versión objetivo se busca scoped a la organización;
 * si pertenece a otra org → 404 `version_not_found`.
 *
 * Body: `{ version_id: string, notes: string }`. `version_id`
 * obligatorio; `notes` ≥ 3 chars.
 *
 * Si la versión objetivo tiene `schema_version` que NO está en la
 * lista de versiones soportadas por el loader, devolvemos 422
 * `unknown_schema_version` (sin tocar BD). Es el comportamiento
 * conservador: V1.0 está soportada; cualquier versión futura
 * requerirá migración explícita.
 *
 * - 200 `{ published, archived }` si ok.
 * - 404 `version_not_found` si la versión no existe en esta org.
 * - 422 `unknown_schema_version` si la schema no es soportada.
 * - 422 si `notes` o `version_id` no cumplen el shape.
 */

import { z } from "zod";

import { parseBody, withAuth } from "@/lib/api";
import {
  getPublishedVersionForOrg,
  getVersionById,
  rollbackToVersion,
} from "@/lib/sales/playbook/store";
import { SUPPORTED_SCHEMA_VERSIONS, versionRowToDto } from "../_dto";

export const dynamic = "force-dynamic";

const RollbackBody = z
  .object({
    version_id: z.string().min(1, "version_id es obligatorio"),
    notes: z
      .string()
      .min(3, "El comentario de rollback debe tener al menos 3 caracteres")
      .max(500),
  })
  .strict();

export const POST = withAuth(async (session, request: Request) => {
  const parsed = await parseBody(request, RollbackBody);
  if (!parsed.ok) return parsed.response;

  const target = await getVersionById(
    session.organizationId,
    parsed.data.version_id
  );
  if (!target) {
    return Response.json(
      {
        code: "version_not_found",
        message: "La versión indicada no pertenece a esta organización",
      },
      { status: 404 }
    );
  }

  // Guardarraíl de schema: V1.0 es lo único soportado por el loader.
  // Futuras versiones requieren migración explícita antes de quedar
  // publicables de nuevo.
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(target.schemaVersion as never)) {
    return Response.json(
      {
        code: "unknown_schema_version",
        message: `La versión usa schema_version="${target.schemaVersion}", que no es soportada por este loader.`,
        schema_version: target.schemaVersion,
        supported: SUPPORTED_SCHEMA_VERSIONS,
      },
      { status: 422 }
    );
  }

  const previouslyPublished = await getPublishedVersionForOrg(
    session.organizationId
  );

  const published = await rollbackToVersion(
    session.organizationId,
    target.id,
    parsed.data.notes,
    session.userId
  );

  return Response.json(
    {
      published: versionRowToDto(published),
      archived:
        previouslyPublished && previouslyPublished.id !== published.id
          ? versionRowToDto(previouslyPublished)
          : null,
    },
    { status: 200 }
  );
});
