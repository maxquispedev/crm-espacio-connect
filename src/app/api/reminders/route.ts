import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { publish } from "@/server/events/bus";
import { listAgenda } from "@/server/inbox/agenda";
import {
  ATTENTION_NOTE_MAX_LENGTH,
  AttentionError,
  scheduleHumanReminder,
  type AttentionErrorCode,
} from "@/server/inbox/attention";

/**
 * 013 C3 — Agenda de recordatorios humanos.
 *
 * `GET` devuelve los cinco grupos YA calculados por el servidor. El cliente no
 * vuelve a agrupar: si lo hiciera, el "Hoy" del navegador y el del servidor
 * discreparían en el borde de medianoche (spec §3.3, plan §4.2).
 *
 * `POST` es la acción "Recordarme": fija una fecha futura para retomar una
 * conversación en humano. No crea un seguimiento automático, no agenda una
 * plantilla y no encola nada: solo mueve la fecha en `conversation_attention`
 * (plan §5 D-5). La organización sale SIEMPRE de la sesión — por eso el
 * esquema es `.strict()` y un `organizationId` en el body es un 422, no un
 * campo ignorado en silencio (Constitución III).
 */
export const dynamic = "force-dynamic";

const Body = z
  .object({
    conversationId: z.string().min(1),
    /** ISO-8601 con zona. El futuro se valida en el dominio, no en el esquema. */
    dueAt: z.string().datetime(),
    /**
     * Opcional, pero si viene tiene que ser una nota de verdad: vacía o
     * ilegible es un 422 explícito en vez de un `null` silencioso que el
     * operador cree que guardó.
     */
    note: z.string().trim().min(1).max(ATTENTION_NOTE_MAX_LENGTH).nullish(),
  })
  .strict();

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const agenda = await listAgenda({
    organizationId: session.organizationId,
    // Zona declarada por el cliente, agrupación siempre aquí. Si no viene o no
    // es válida, manda la de la instancia (`OPERATOR_TIMEZONE`).
    timeZone: url.searchParams.get("tz") ?? undefined,
  });
  return Response.json(agenda);
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, Body);
  if (!body.ok) return body.response;

  try {
    const view = await scheduleHumanReminder({
      organizationId: session.organizationId,
      conversationId: body.data.conversationId,
      dueAt: new Date(body.data.dueAt),
      note: body.data.note ?? null,
    });
    // La Bandeja escucha `conversation.updated` y se recarga: al programar, la
    // conversación sale de "Por atender" sin que nadie recargue a mano.
    publish(session.organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: view.conversationId } },
    });
    return Response.json(
      {
        ok: true,
        reminder: {
          conversationId: view.conversationId,
          dueAt: view.dueAt,
          note: view.note,
          state: view.state,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof AttentionError) return scheduleErrorResponse(err.code);
    throw err;
  }
});

function scheduleErrorResponse(code: AttentionErrorCode): Response {
  if (code === "due_in_past") {
    return apiError(422, "due_in_past", "El recordatorio se programa a futuro, no en el pasado");
  }
  if (code === "conversation_not_found") {
    return apiError(404, "not_found", "Conversación no encontrada");
  }
  return apiError(
    409,
    "ai_owns_conversation",
    "No se puede programar: la IA es la dueña de esta conversación"
  );
}
