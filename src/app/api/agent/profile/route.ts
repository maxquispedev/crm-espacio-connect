import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAiConfigured, isJevConfigured } from "@/lib/env";
import { countVariables } from "@/lib/whatsapp/template-placeholders";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .limit(1);
  const p = rows[0];
  if (!p) return apiError(404, "not_found", "Perfil del agente no encontrado");
  return Response.json({
    profile: {
      enabled: p.enabled,
      name: p.name,
      tone: p.tone,
      instructions: p.instructions,
      escalationRules: p.escalationRules,
      greeting: p.greeting,
      salesOrchestratorEnabled: p.salesOrchestratorEnabled,
      salesFollowUpsEnabled: p.salesFollowUpsEnabled,
      salesFollowUpTemplateId: p.salesFollowUpTemplateId,
    },
    aiConfigured: isAiConfigured(),
    jevConfigured: isJevConfigured(),
  });
});

const putSchema = z.object({
  enabled: z.boolean().optional(),
  salesOrchestratorEnabled: z.boolean().optional(),
  salesFollowUpsEnabled: z.boolean().optional(),
  salesFollowUpTemplateId: z.string().trim().min(1).max(64).nullable().optional(),
  name: z.string().trim().min(1).max(60).optional(),
  tone: z.string().max(500).nullable().optional(),
  instructions: z.string().max(8000).nullable().optional(),
  escalationRules: z.string().max(4000).nullable().optional(),
  greeting: z.string().max(1000).nullable().optional(),
});

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .limit(1);
  const current = rows[0];
  if (!current) return apiError(404, "not_found", "Perfil no encontrado");

  const nextOrchestrator =
    body.data.salesOrchestratorEnabled ?? current.salesOrchestratorEnabled;
  if (body.data.salesFollowUpsEnabled === true && !nextOrchestrator) {
    return apiError(
      422,
      "orchestrator_required",
      "Los seguimientos automáticos solo se habilitan con Sales Orchestrator encendido"
    );
  }

  if (body.data.salesFollowUpTemplateId) {
    const eligible = await loadEligibleFollowUpTemplate(
      session.organizationId,
      body.data.salesFollowUpTemplateId
    );
    if (!eligible) {
      return apiError(
        422,
        "invalid_template",
        "La plantilla debe estar aprobada y no tener variables BODY"
      );
    }
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.data.enabled !== undefined) set.enabled = body.data.enabled;
  if (body.data.salesOrchestratorEnabled !== undefined) {
    set.salesOrchestratorEnabled = body.data.salesOrchestratorEnabled;
  }
  if (body.data.name !== undefined) set.name = body.data.name;
  if (body.data.tone !== undefined) set.tone = body.data.tone;
  if (body.data.instructions !== undefined) set.instructions = body.data.instructions;
  if (body.data.escalationRules !== undefined) {
    set.escalationRules = body.data.escalationRules;
  }
  if (body.data.greeting !== undefined) set.greeting = body.data.greeting;
  if (body.data.salesFollowUpTemplateId !== undefined) {
    set.salesFollowUpTemplateId = body.data.salesFollowUpTemplateId;
  }

  if (!nextOrchestrator) {
    set.salesFollowUpsEnabled = false;
  } else if (body.data.salesFollowUpsEnabled !== undefined) {
    set.salesFollowUpsEnabled = body.data.salesFollowUpsEnabled;
  }

  const updated = await db
    .update(schema.agentProfile)
    .set(set)
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .returning();
  if (!updated[0]) return apiError(404, "not_found", "Perfil no encontrado");
  return Response.json({ ok: true });
});

async function loadEligibleFollowUpTemplate(
  organizationId: string,
  templateId: string
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({
      status: schema.template.status,
      body: schema.template.body,
    })
    .from(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        organizationId,
        eq(schema.template.id, templateId)
      )
    )
    .limit(1);
  const template = rows[0];
  if (!template) return false;
  return template.status === "approved" && countVariables(template.body) === 0;
}
