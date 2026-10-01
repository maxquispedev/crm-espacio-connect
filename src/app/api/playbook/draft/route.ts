/**
 * /api/playbook/draft — T202 (POST) y T203 (PUT).
 *
 * POST: crea un draft copiando la `published` actual como baseline.
 *   - 201 con `{ draft }` si ok.
 *   - 404 `no_published_baseline` si no hay publicada (mapea a 422
 *     en `details.code` para mantener contrato único; la API
 *     expone `code: "no_published_baseline"` con 422).
 *   - 409 `draft_already_open` si ya hay draft abierto.
 *
 * PUT: aplica un patch parcial a un draft existente. El draft se
 * carga, se mergea el patch, se valida con `ConfigV1Schema` (que ya
 * incluye las guardarraíles Jev del Corte 1, T103) y, si pasa, se
 * persiste via `updateDraft`.
 *   - 200 con `{ draft }` si ok.
 *   - 404 `no_draft` si no hay draft activo.
 *   - 422 `validation_failed` con `details[]` si el Zod rechaza.
 *
 * Tenant-safe por Constitución III; sin cache.
 */

import { z } from "zod";

import { parseBody, withAuth } from "@/lib/api";
import {
  ConfigV1ObjectSchema,
  ConfigV1Schema,
  type ConfigV1,
} from "@/lib/sales/playbook/schema";
import {
  createDraft,
  deleteDraft,
  DraftAlreadyOpenError,
  getDraftVersionForOrg,
  getPublishedVersionForOrg,
  NoPublishedVersionError,
  updateDraft,
} from "@/lib/sales/playbook/store";
import { versionRowToDto } from "../_dto";

export const dynamic = "force-dynamic";

/* ============================================================
 * T202 — POST /api/playbook/draft
 * ============================================================ */

const PostDraftBody = z
  .object({
    notes: z.string().min(1).max(500).optional(),
  })
  .strict();

export const POST = withAuth(async (session, request: Request) => {
  const parsed = await parseBody(request, PostDraftBody);
  if (!parsed.ok) return parsed.response;

  // La API exige una versión publicada como baseline (Corte 1
  // bootstrap). Sin published no hay a qué copiar.
  const published = await getPublishedVersionForOrg(session.organizationId);
  if (!published) {
    return Response.json(
      {
        code: "no_published_baseline",
        message:
          "No existe una versión publicada para esta organización. " +
          "Ejecuta el seed inicial antes de crear un draft.",
      },
      { status: 422 }
    );
  }

  try {
    const draft = await createDraft(session.organizationId, {
      createdBy: session.userId,
      notes: parsed.data.notes ?? null,
      config: rowToConfigV1(published),
    });
    return Response.json({ draft: versionRowToDto(draft) }, { status: 201 });
  } catch (err) {
    if (err instanceof DraftAlreadyOpenError) {
      return Response.json(
        {
          code: "draft_already_open",
          message: "Ya existe un draft abierto para este playbook",
        },
        { status: 409 }
      );
    }
    throw err;
  }
});

/* ============================================================
 * T203 — PUT /api/playbook/draft
 * ============================================================ */

const DraftPatchBody = z
  .object({
    product: ConfigV1ObjectSchema.shape.product.optional(),
    offer: ConfigV1ObjectSchema.shape.offer.optional(),
    commercial_policy: ConfigV1ObjectSchema.shape.commercial_policy.optional(),
    priorities: ConfigV1ObjectSchema.shape.priorities.optional(),
    writer: ConfigV1ObjectSchema.shape.writer.optional(),
    jev_questions: ConfigV1ObjectSchema.shape.jev_questions.optional(),
    prohibitions: ConfigV1ObjectSchema.shape.prohibitions.optional(),
    handoff: ConfigV1ObjectSchema.shape.handoff.optional(),
    urgency_rules: ConfigV1ObjectSchema.shape.urgency_rules.optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .strict();

export const PUT = withAuth(async (session, request: Request) => {
  const parsed = await parseBody(request, DraftPatchBody);
  if (!parsed.ok) return parsed.response;

  const draft = await getDraftVersionForOrg(session.organizationId);
  if (!draft) {
    return Response.json(
      {
        code: "no_draft",
        message: "No hay draft abierto para esta organización",
      },
      { status: 404 }
    );
  }

  const current = rowToConfigV1(draft);
  const merged: ConfigV1 = {
    ...current,
    ...(parsed.data.product !== undefined && {
      product: parsed.data.product,
    }),
    ...(parsed.data.offer !== undefined && { offer: parsed.data.offer }),
    ...(parsed.data.commercial_policy !== undefined && {
      commercial_policy: parsed.data.commercial_policy,
    }),
    ...(parsed.data.priorities !== undefined && {
      priorities: parsed.data.priorities,
    }),
    ...(parsed.data.writer !== undefined && { writer: parsed.data.writer }),
    ...(parsed.data.jev_questions !== undefined && {
      jev_questions: parsed.data.jev_questions,
    }),
    ...(parsed.data.prohibitions !== undefined && {
      prohibitions: parsed.data.prohibitions,
    }),
    ...(parsed.data.handoff !== undefined && { handoff: parsed.data.handoff }),
    ...(parsed.data.urgency_rules !== undefined && {
      urgency_rules: parsed.data.urgency_rules,
    }),
  };

  // El Zod de ConfigV1 ya aplica las guardarraíles Jev (T103).
  const result = ConfigV1Schema.safeParse(merged);
  if (!result.success) {
    return Response.json(
      {
        code: "validation_failed",
        message: "El playbook no pasa las guardarraíles Jev",
        details: result.error.issues.map((i) => ({
          code:
            (i as unknown as { params?: { code?: string } }).params?.code ??
            i.code,
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 422 }
    );
  }

  const updated = await updateDraft(session.organizationId, {
    config: result.data,
    notes: parsed.data.notes !== undefined ? parsed.data.notes : undefined,
  });

  // updateDraft devuelve null si no hay draft (race); el guard de
  // arriba ya cubre el caso normal.
  if (!updated) {
    return Response.json(
      {
        code: "no_draft",
        message: "El draft fue archivado antes de aplicar el patch",
      },
      { status: 404 }
    );
  }

  return Response.json({ draft: versionRowToDto(updated) }, { status: 200 });
});

/* ============================================================
 * T406 — DELETE /api/playbook/draft
 * ============================================================ */

/**
 * Elimina el draft abierto. Solo se permite si la organización tiene
 * una versión `published` activa (guardarraíl de negocio: nunca dejar
 * al negocio sin playbook en vigor).
 *
 * - 200 `{ deleted: { id, version_number } }` si había draft.
 * - 200 `{ deleted: null }` si no había draft (idempotente).
 * - 409 `no_published_version` si no hay publicada activa.
 */
export const DELETE = withAuth(async (session) => {
  try {
    const deleted = await deleteDraft(session.organizationId);
    if (!deleted) {
      return Response.json({ deleted: null }, { status: 200 });
    }
    return Response.json(
      {
        deleted: {
          id: deleted.id,
          version_number: deleted.versionNumber,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof NoPublishedVersionError) {
      return Response.json(
        {
          code: "no_published_version",
          message:
            "No se puede eliminar el draft: no hay una versión publicada activa.",
        },
        { status: 409 }
      );
    }
    throw err;
  }
});

/* ============================================================
 * Helper local: row → ConfigV1 (mismo shape que `playbook/_dto.ts`,
 * pero reutilizado dentro de la propia ruta para mergear el patch).
 * ============================================================ */

function rowToConfigV1(row: Parameters<typeof versionRowToDto>[0]): ConfigV1 {
  return {
    schema_version: row.schemaVersion as ConfigV1["schema_version"],
    product: row.productJson as ConfigV1["product"],
    offer: row.offerJson as ConfigV1["offer"],
    commercial_policy: row.policyJson as ConfigV1["commercial_policy"],
    priorities: row.prioritiesJson as ConfigV1["priorities"],
    writer: row.writerJson as ConfigV1["writer"],
    jev_questions: row.jevQuestionsJson as ConfigV1["jev_questions"],
    prohibitions: row.prohibitionsJson as ConfigV1["prohibitions"],
    handoff: row.handoffJson as ConfigV1["handoff"],
    urgency_rules: row.urgencyRules,
  };
}
