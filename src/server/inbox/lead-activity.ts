import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { resetFollowUpsOnInbound } from "@/server/sales/follow-ups/store";
import {
  StageGatewayError,
  createLeadInStage,
  findFirstOpenStage,
} from "@/server/leads/stage-gateway";

/**
 * Actividad de lead al recibir un mensaje (US2): si el contacto no tiene lead,
 * se crea en la primera etapa del pipeline; si lo tiene, se actualiza su
 * última actividad.
 */
export async function onLeadActivity(
  organizationId: string,
  contactId: string,
  at: Date
): Promise<void> {
  const db = getDb();

  const existing = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.lead)
      .set({ lastActivityAt: at, updatedAt: new Date() })
      .where(
        scoped(
          schema.lead.organizationId,
          organizationId,
          eq(schema.lead.id, existing[0].id)
        )
      );
    await resetFollowUpsOnInbound({
      organizationId,
      leadId: existing[0].id,
    });
    return;
  }

  // Corte A — la asignación inicial del lead al detectar primer inbound pasa
  // por la puerta única de etapa. El gateway valida la primera etapa del
  // tenant, calcula la posición y conserva `lastActivityAt` exacto.
  const first = await findFirstOpenStage(organizationId);
  if (!first) return; // pipeline sin etapas abiertas: no hay dónde crear

  try {
    await createLeadInStage({
      organizationId,
      contactId,
      toStageId: first.id,
      lastActivityAt: at,
      actor: "system",
      reason: "first_inbound",
    });
  } catch (err) {
    if (err instanceof StageGatewayError) {
      console.warn(`[inbox/lead-activity] create falló: ${err.message}`);
      return;
    }
    throw err;
  }
}
