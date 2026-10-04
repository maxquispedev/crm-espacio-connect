import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { publish } from "@/server/events/bus";
import { getConversation, serializeConversation } from "@/server/inbox/queries";
import { markAttentionWaitingClient, resumenAtencion } from "@/server/inbox/attention";

/**
 * 013 C4 — "Marcar atendido": la acción que saca una conversación de "Por
 * atender" sin necesidad de responder.
 *
 * Por qué un endpoint PROPIO y no un campo más del `PATCH /api/conversations/[id]`:
 * ese PATCH es el interruptor de la IA (`aiEnabled`/`reactivate`/`markRead`) y su
 * contrato no se toca en este corte. Aquí se expone una sola transición, y solo
 * esa: el esquema es `.strict()` y acepta únicamente `waiting_client`, de modo que
 * ni la UI ni un script pueden fabricar un `pending` (que por definición lo
 * dispara un mensaje del cliente) ni un `deferred` (que solo puede nacer de
 * "Recordarme" con una fecha futura validada). Cualquier otra cosa es un 422
 * explícito en vez de un estado escrito en silencio.
 *
 * La transición la hace `markAttentionWaitingClient` — la MISMA función que ya
 * corren el envío manual y el eco del dueño. No hay una segunda puerta al estado:
 * "marcar atendido" y "contestar" dejan la conversación exactamente igual
 * (spec §3.2, paso 9), y por eso comparten código y no una descripción parecida.
 *
 * No envía WhatsApp, no programa nada y no toca el motor de follow-ups: es un
 * UPSERT de una fila (plan §5 D-5).
 */
export const dynamic = "force-dynamic";

const Body = z.object({ state: z.literal("waiting_client") }).strict();

type Params = { params: Promise<{ id: string }> };

export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, Body);
  if (!body.ok) return body.response;

  // Lectura previa para distinguir 404 de 409 y para serializar el DTO. La
  // organización sale SIEMPRE de la sesión (`scoped()`): una conversación de otra
  // organización es indistinguible de una inexistente y no se confirma que exista.
  const row = await getConversation(session.organizationId, id);
  if (!row) return apiError(404, "not_found", "Conversación no encontrada");

  const view = await markAttentionWaitingClient({
    organizationId: session.organizationId,
    conversationId: id,
  });
  if (!view) {
    // Existe pero `markAttentionWaitingClient` no la tocó: o la IA es la dueña,
    // o es una conversación del Laboratorio. Son dos bloqueos distintos para
    // quien está delante de la pantalla, así que el mensaje dice cuál.
    return row.conversation.isTest
      ? apiError(
          409,
          "ai_owns_conversation",
          "No se puede marcar como atendida: las conversaciones del Laboratorio no tienen atención humana"
        )
      : apiError(
          409,
          "ai_owns_conversation",
          "No se puede marcar como atendida: la IA es la dueña de esta conversación"
        );
  }

  // El DTO se publica con la atención YA derivada, como en el PATCH: sin esto,
  // el evento anunciaría "sin estado humano" justo después de resolver la cola y
  // la fila de la Bandeja seguiría mostrando "Por atender" hasta la siguiente
  // recarga.
  const dto = serializeConversation(
    row.conversation,
    row.contact,
    null,
    null,
    row.anuncio,
    resumenAtencion(view)
  );
  publish(session.organizationId, {
    type: "conversation.updated",
    data: { conversation: dto },
  });
  return Response.json({ ok: true, conversation: dto });
});
