/**
 * POST /api/playbook/publish — T205 (Corte 2, Feature 008).
 *
 * Publica el draft abierto. El archivado de la publicada actual y
 * el flip draft→published corren atómicos en `store.publishDraft`.
 *
 * Body: `{ notes: string }` (≥ 3 chars; comentario obligatorio del
 * cambio).
 *
 * - 200 `{ published, archived }` si ok.
 * - 404 `no_draft` si no hay draft y no detectamos race.
 * - 409 `publish_concurrency_lost` si otro caller ya publicó (race).
 * - 422 si `notes` no cumple la regla.
 *
 * Detección de race (concurrencia):
 *   1. Snapshot al inicio: `draftBefore` + `previouslyPublished`.
 *   2. Si `draftBefore` existía y `publishDraft` lanza
 *      `PlaybookVersionNotFoundError`, otro caller flippeó el draft
 *      mientras esperábamos → 409.
 *   3. Si NO había `draftBefore` pero hay un `published` con
 *      `publishedAt` muy reciente (< 30s), también es race → 409.
 *   4. En cualquier otro caso → 404 `no_draft`.
 *
 * El umbral de 30s es heurístico: cualquier `publish` legítimo se
 * habrá hecho mucho antes. Si en producción hay publishes más
 * espaciados, basta con subirlo.
 */

import { z } from "zod";

import { parseBody, withAuth } from "@/lib/api";
import {
  getDraftVersionForOrg,
  getPublishedVersionForOrg,
  publishDraft,
} from "@/lib/sales/playbook/store";
import { versionRowToDto } from "../_dto";

export const dynamic = "force-dynamic";

const PublishBody = z
  .object({
    notes: z
      .string()
      .min(3, "El comentario de publish debe tener al menos 3 caracteres")
      .max(500),
  })
  .strict();

const RACE_WINDOW_MS = 30_000;

export const POST = withAuth(async (session, request: Request) => {
  const parsed = await parseBody(request, PublishBody);
  if (!parsed.ok) return parsed.response;

  // Snapshot al inicio: si había draft, sabemos que otro caller no
  // pudo haberlo flippeado antes de nuestro snapshot.
  const draftBefore = await getDraftVersionForOrg(session.organizationId);
  const previouslyPublished = await getPublishedVersionForOrg(
    session.organizationId
  );

  try {
    const published = await publishDraft(
      session.organizationId,
      parsed.data.notes,
      session.userId
    );
    return Response.json(
      {
        published: versionRowToDto(published),
        // `previouslyPublished` es el snapshot leído ANTES del flip: su
        // objeto en memoria conserva `status: "published"` aunque la fila
        // ya quedó archivada en BD. Lo reportamos explícitamente como
        // `archived` para que el contrato no devuelva un estado obsoleto.
        archived: previouslyPublished
          ? {
              ...versionRowToDto(previouslyPublished),
              status: "archived" as const,
            }
          : null,
      },
      { status: 200 }
    );
  } catch (err) {
    if (
      err instanceof Error &&
      err.name === "PlaybookVersionNotFoundError"
    ) {
      // ¿Teníamos draft al entrar? Sí → otro caller lo flippeó
      // (race). No → simplemente no había draft.
      if (draftBefore) {
        return Response.json(
          {
            code: "publish_concurrency_lost",
            message:
              "Otro caller ya publicó el draft mientras esta solicitud esperaba.",
          },
          { status: 409 }
        );
      }
      // No había draft al entrar. Si hay un `published` reciente,
      // alguien acaba de publicar sin que hubiera draft → 409.
      const stillPublished = await getPublishedVersionForOrg(
        session.organizationId
      );
      if (
        stillPublished?.publishedAt &&
        Date.now() - stillPublished.publishedAt.getTime() < RACE_WINDOW_MS
      ) {
        return Response.json(
          {
            code: "publish_concurrency_lost",
            message:
              "Otra solicitud publicó el playbook hace instantes; recarga y reintenta.",
          },
          { status: 409 }
        );
      }
      return Response.json(
        {
          code: "no_draft",
          message: "No hay draft abierto para publicar",
        },
        { status: 404 }
      );
    }
    throw err;
  }
});
