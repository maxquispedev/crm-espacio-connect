import { apiError, withAuth } from "@/lib/api";
import { publish } from "@/server/events/bus";
import { cancelHumanReminder, type AttentionErrorCode } from "@/server/inbox/attention";

/**
 * 013 C3 — Cancelar un recordatorio humano (FR-3.9).
 *
 * Por conversación y no por id de recordatorio: el compromiso vive en
 * `conversation_attention`, que es UNO por conversación (UNIQUE
 * (org, conversation)); la fecha se reemplaza, no se acumula. Por eso la Agenda
 * no puede tener dos compromisos ambiguos para el mismo cliente.
 *
 * Cancelar NO es responder: no se manda WhatsApp, no se crea seguimiento
 * automático y no se toca `sales_follow_up_job` (plan §5 D-5).
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ conversationId: string }> };

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { conversationId } = await ctx.params;
  const result = await cancelHumanReminder({
    organizationId: session.organizationId,
    conversationId,
  });
  if (!result.ok) return cancelErrorResponse(result.error);

  publish(session.organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversationId } },
  });
  return Response.json({ ok: true, cancelled: result.cancelled });
});

function cancelErrorResponse(code: AttentionErrorCode): Response {
  // `conversation_not_found` también cubre "es de otra organización": la
  // lectura va por `scoped()`, así que un id ajeno es indistinguible de uno
  // inexistente y no se confirma su existencia.
  if (code === "conversation_not_found") {
    return apiError(404, "not_found", "Conversación no encontrada");
  }
  if (code === "no_reminder") {
    return apiError(404, "no_reminder", "No hay ningún recordatorio que cancelar");
  }
  return apiError(
    409,
    "not_scheduled",
    "No es un recordatorio: esta conversación tiene trabajo humano ahora"
  );
}
