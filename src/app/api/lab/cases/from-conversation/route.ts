import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getPublishedConfigForOrg } from "@/lib/sales/playbook/loader";
import {
  buildCaseMetadata,
  sanitizeTranscript,
  type TranscriptTurn,
} from "@/server/lab/case-pii";

export const dynamic = "force-dynamic";

const Body = z.object({
  conversation_id: z.string().min(1, "conversation_id requerido"),
});

/**
 * 008 Corte 7 — "Guardar conversación como caso" (T702).
 *
 * Convierte una conversación REAL en un caso de evaluación del
 * Laboratorio con **PII minimizada estricta**.
 *
 * Garantías de este endpoint:
 *
 * 1. **Tenant**: la conversación se lee por `scoped()`, así que una
 *    `conversation_id` de otra organización es indistinguible de una
 *    inexistente (404).
 * 2. **Requiere Sales Orchestrator**: guardar un caso solo tiene sentido
 *    si el pipeline comercial es el que va a evaluarlo. Sin orchestrator
 *    se responde 409, no se guarda nada.
 * 3. **Minimización ESTRUCTURAL**: lo que se persiste vive en
 *    `lab_case`, tabla que no tiene columnas de identidad. El
 *    `conversation_id` recibido se usa SOLO para leer; nunca se escribe.
 * 4. **Minimización de CONTENIDO**: el texto pasa por
 *    `sanitizeTranscript`, que sustituye teléfonos, emails, URLs y
 *    tokens de plataforma por marcadores neutros. Un cliente puede
 *    escribir su propio número dentro de un mensaje; sin esto, el caso
 *    devolvería un camino a la identidad real.
 *
 * El dueño edita después los outcomes esperados en la UI del
 * Laboratorio (`PATCH /api/lab/cases/:id/expected`). NUNCA se
 * autocompletan desde lo observado: eso haría la comparación tautológica.
 */
export const POST = withAuth(async (session, req: Request) => {
  const parsed = await parseBody(req, Body);
  if (!parsed.ok) return parsed.response;
  const conversationId = parsed.data.conversation_id;

  const db = getDb();
  const orgId = session.organizationId;

  // 1) Tenant + existencia. `scoped()` hace que cross-org sea un 404,
  //    nunca un leak de existencia.
  const conversations = await db
    .select({
      id: schema.conversation.id,
      contactId: schema.conversation.contactId,
    })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        orgId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  const conversation = conversations[0];
  if (!conversation) {
    return apiError(404, "conversation_not_found", "Conversación no encontrada");
  }

  // 2) Solo con Sales Orchestrator encendido: el caso se evalúa con el
  //    pipeline comercial, y sin él el Laboratorio corre la cohorte
  //    legacy, donde un caso comercial no aporta señal.
  const profiles = await db
    .select({ enabled: schema.agentProfile.salesOrchestratorEnabled })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, orgId))
    .limit(1);
  if (profiles[0]?.enabled !== true) {
    return apiError(
      409,
      "sales_orchestrator_disabled",
      "Guardar una conversación como caso requiere el Sales Orchestrator encendido"
    );
  }

  // 3) Turnos en orden CRONOLÓGICO. `wa_timestamp` es el reloj del
  //    emisor; `created_at` desempata. La dirección `in` es el cliente;
  //    `out` es el agente (o un humano en handoff: en ambos casos es lo
  //    que el cliente vio).
  const messages = await db
    .select({
      direction: schema.message.direction,
      type: schema.message.type,
      text: schema.message.text,
      waTimestamp: schema.message.waTimestamp,
      createdAt: schema.message.createdAt,
    })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        orgId,
        eq(schema.message.conversationId, conversationId)
      )
    )
    .orderBy(asc(schema.message.createdAt));

  const turns: TranscriptTurn[] = [];
  for (const m of messages) {
    // Solo texto. Los adjuntos (imagen, audio, documento, ubicación) no
    // aportan señal al juez y sí son un vector de PII: se omiten, igual
    // que cualquier URL o id de media que trajeran.
    if (m.type !== "text" || !m.text) continue;
    turns.push({
      role: m.direction === "in" ? "cliente" : "agente",
      text: m.text,
    });
  }

  const transcript = sanitizeTranscript(turns);
  if (transcript.length === 0) {
    return apiError(
      422,
      "empty_transcript",
      "La conversación no tiene mensajes de texto guardables"
    );
  }

  // 4) Versión del playbook PUBLICADA al momento de guardar. `null` si
  //    no hay publicada (el runtime usa el fallback a defaults): queda
  //    visible en el caso, nunca ambiguo.
  const published = await getPublishedConfigForOrg(orgId).catch(() => null);

  const metadata = buildCaseMetadata(transcript);

  // 5) Persistencia. Nótese lo que NO aparece en este INSERT: ningún
  //    id de conversación, contacto o lead; ningún teléfono, email,
  //    identidad de WhatsApp, ctwa_clid, source_id ni source_url.
  const inserted = await db
    .insert(schema.labCase)
    .values({
      id: newId("labCase"),
      organizationId: orgId,
      transcript,
      playbookVersionId: published?.id ?? null,
      playbookSchemaVersion: published?.schema_version ?? null,
      metadata,
    })
    .returning({ id: schema.labCase.id });

  const caseId = inserted[0]?.id;
  if (!caseId) {
    return apiError(500, "case_not_persisted", "No se pudo guardar el caso");
  }

  return Response.json(
    {
      case_id: caseId,
      turns: transcript.length,
      playbook_version_id: published?.id ?? null,
      playbook_schema_version: published?.schema_version ?? null,
      metadata,
    },
    { status: 201 }
  );
});

/**
 * Lista los casos guardados desde conversaciones reales. La usa la UI
 * del Laboratorio. Misma promesa de minimización: el DTO devuelve solo
 * el transcript saneado y los campos del caso, jamás la conversación de
 * origen.
 */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const orgId = session.organizationId;

  const rows = await db
    .select()
    .from(schema.labCase)
    .where(scoped(schema.labCase.organizationId, orgId))
    .orderBy(asc(schema.labCase.createdAt));

  return Response.json({
    cases: rows.map((c) => ({
      id: c.id,
      transcript: c.transcript ?? [],
      playbook_version_id: c.playbookVersionId,
      playbook_schema_version: c.playbookSchemaVersion,
      expected_next_action: c.expectedNextAction,
      expected_lane: c.expectedLane,
      expected_handoff: c.expectedHandoff,
      metadata: c.metadata ?? null,
      created_at: c.createdAt.toISOString(),
    })),
  });
});
