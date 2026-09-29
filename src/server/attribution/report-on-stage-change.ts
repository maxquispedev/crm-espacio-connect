import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  reportStageChange,
  type StageSnapshot,
} from "@/server/attribution/conversions";

/**
 * 007 — Helper que el gateway del Corte A usa para enganchar CAPI.
 *
 * Este módulo existe para que el gateway (`stage-gateway.ts`) no conozca
 * CAPI. Los callers del gateway (rutas API, Sales Orchestrator, AI pipeline)
 * llaman `reportStageChangeOnMove(...)` DESPUÉS de un `moveLeadStage` /
 * `bulkMoveLeadsToStage` exitoso, pasando el resultado del gateway y el ID
 * del lead.
 *
 * Reglas (Constitución IX + spec B8):
 *  - Se llama FUERA de la transacción larga. NUNCA dentro de un `db.transaction`.
 *  - Un fallo de CAPI NUNCA revierte el cambio de etapa. La excepción se
 *    loguea como warning y el caller sigue.
 *  - Si `moved === false`, no se hace nada (la etapa no cambió).
 *  - Si el lead no tiene conversation asociada, se omite silenciosamente:
 *    eso solo ocurre en seeds / test fixtures.
 *  - El best-effort es absoluto: el caller nunca ve un error de CAPI.
 */

/** Resultado de `moveLeadStage`. */
export type GatewayMoveResult = {
  lead: { id: string; organizationId: string; conversationId?: string | null };
  moved: boolean;
  fromStageId: string;
  toStageId: string;
};

/** Resultado de `bulkMoveLeadsToStage`. */
export type GatewayBulkMoveResult = {
  movedCount: number;
  fromStageId: string;
  toStageId: string;
  /** IDs efectivamente reasignados, opcionales. */
  leadIds?: string[];
};

/**
 * Engancha el reporte CAPI tras un `moveLeadStage` exitoso. Fire-and-forget
 * desde el punto de vista del caller: nunca lanza, siempre degrada bien.
 *
 * Acepta un caller que no conoce `conversationId` del lead: lo resuelve
 * internamente. Si el lead no tiene conversación (escenario raro, posible
 * en seeds), se omite silenciosamente.
 */
export async function reportStageChangeOnMove(args: {
  organizationId: string;
  leadId: string;
  moved: boolean;
  fromStageId: string;
  toStageId: string;
  toStageName: string;
  toStageKind: "open" | "won" | "lost";
}): Promise<void> {
  if (!args.moved) return;
  try {
    const conversationId = await resolveLeadConversationId(
      args.organizationId,
      args.leadId
    );
    if (!conversationId) return;
    const snapshot: StageSnapshot = {
      id: args.toStageId,
      kind: args.toStageKind,
      name: args.toStageName,
    };
    await reportStageChange({
      organizationId: args.organizationId,
      conversationId,
      fromStageId: args.fromStageId,
      toStage: snapshot,
    });
  } catch (err) {
    console.warn(
      "[capi] report tras move falló (best-effort):",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Variante bulk: itera sobre los leads movidos. Si el caller no pasó
 * `leadIds`, hace un SELECT por la etapa origen + destino dentro del
 * tenant (escenario del bulk-move al eliminar una etapa).
 *
 * El reporte por lead se hace en serie para mantener orden y evitar
 * sobrecargar Meta con ráfagas paralelas en un bulk de 50+ leads. CAPI
 * tolera cientos por segundo, pero la serialización también mantiene el
 * log de `conversion_event` ordenado.
 */
export async function reportStageChangeOnBulkMove(args: {
  organizationId: string;
  bulk: GatewayBulkMoveResult;
  toStageName: string;
  toStageKind: "open" | "won" | "lost";
}): Promise<void> {
  if (args.bulk.movedCount === 0) return;
  let leadIds = args.bulk.leadIds;
  if (!leadIds || leadIds.length === 0) {
    leadIds = await loadLeadsInStage(
      args.organizationId,
      args.bulk.toStageId
    );
  }
  for (const leadId of leadIds) {
    await reportStageChangeOnMove({
      organizationId: args.organizationId,
      leadId,
      moved: true,
      fromStageId: args.bulk.fromStageId,
      toStageId: args.bulk.toStageId,
      toStageName: args.toStageName,
      toStageKind: args.toStageKind,
    });
  }
}

async function resolveLeadConversationId(
  organizationId: string,
  leadId: string
): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ contactId: schema.lead.contactId })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.id, leadId)
      )
    )
    .limit(1);
  const contactId = rows[0]?.contactId;
  if (!contactId) return null;
  // Una conversación real por contacto (excluyendo is_test en el UNIQUE
  // parcial). El helper devuelve la que no es de prueba; CAPI filtra is_test.
  const conversations = await db
    .select({ id: schema.conversation.id, isTest: schema.conversation.isTest })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.contactId, contactId)
      )
    )
    .orderBy(asc(schema.conversation.createdAt))
    .limit(1);
  return conversations[0]?.id ?? null;
}

async function loadLeadsInStage(
  organizationId: string,
  stageId: string
): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.stageId, stageId)
      )
    );
  return rows.map((r) => r.id);
}
