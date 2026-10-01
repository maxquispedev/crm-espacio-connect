import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getConfigByVersionId, type LoadedPlaybookVersion } from "@/lib/sales/playbook/loader";
import { publish } from "@/server/events/bus";
import { applyHandoff, deliverReply } from "@/server/ai/delivery";
import { buildJevSalesState } from "@/server/sales/build-state";
import { evaluateJev } from "@/server/sales/client";
import type { PipelineSemantic, SalesPlan } from "@/server/sales/resolve-plan";
import { resolveSalesPlan } from "@/server/sales/resolve-plan";
import { scheduleNextFollowUp } from "@/server/sales/follow-ups/store";
import { VENDE_VELOZ_OFFER } from "@/server/sales/vende-veloz";
import { writeSalesReply } from "@/server/sales/writer";
import { StageGatewayError, moveLeadStage } from "@/server/leads/stage-gateway";
import { reportStageChangeOnMove } from "@/server/attribution/report-on-stage-change";
import type { JevQuestions } from "@/server/sales/questions";
import type { OfferBlock, WriterInstructions } from "@/server/sales/writer";

type Conversation = typeof schema.conversation.$inferSelect;
type Lead = typeof schema.lead.$inferSelect;
type Stage = typeof schema.pipelineStage.$inferSelect;

/**
 * Override opcional del playbook para el turno. Solo es válido en
 * conversaciones de Laboratorio (`is_test=true`). En producción se
 * ignora y, si llega explícitamente, lanza excepción (T306).
 *
 * Es el ÚNICO canal por el que el editor (Corte 4) o el harness de
 * Laboratorio (Corte 6) pueden inyectar una versión distinta a la
 * publicada. La forma exacta es opaca para el orquestador: este
 * archivo solo la valida y la propaga al estado del turno.
 */
export type PlaybookOverride = {
  versionId: string;
};

/**
 * Opciones de invocación del orquestador.
 *
 * `playbookOverride` SOLO es válido cuando `conversation.is_test=true`.
 * El guard explícito está aquí para que ningún caller accidental
 * pueda evadirlo: el orquestador es la frontera única.
 */
export type RunSalesOrchestratorTurnOptions = {
  playbookOverride?: PlaybookOverride;
};

/**
 * Turno comercial cuando `salesOrchestratorEnabled`.
 * Jev no envía mensajes. El writer no decide. Efectos solo en servidor.
 *
 * Corte 3 — Runtime dinámico:
 *   - `built.playbook` carga el playbook publicado (sin cache).
 *   - Si llega `playbookOverride` y `is_test=true`, se sustituye por
 *     la versión solicitada (T306).
 *   - El set activo de preguntas se pasa al cliente Jev (T303).
 *   - `is_test=true` suprime `scheduleNextFollowUp` (T308): la fila
 *     `sales_follow_up_job` queda vacía para esa conversación.
 *   - Se persiste `last_jev_playbook_version_id`,
 *     `last_jev_playbook_schema_version` y, dentro del JSONB
 *     `last_jev_decision`, las claves
 *     `playbook_version_id` / `playbook_schema_version` /
 *     `playbook_version_number`.
 */
export async function runSalesOrchestratorTurn(
  input: {
    organizationId: string;
    conversationId: string;
    conversation: Conversation;
  },
  opts: RunSalesOrchestratorTurnOptions = {}
): Promise<void> {
  const { organizationId, conversationId, conversation } = input;
  const isTest = conversation.isTest === true;

  // T306 — Override SOLO en sandbox. Guard único y estricto.
  if (opts.playbookOverride !== undefined && !isTest) {
    throw new Error("playbook_override_forbidden_in_production");
  }

  const built = await buildJevSalesState({ organizationId, conversationId });
  if (!built.ok) return;
  if (!built.persist.leadId) return;

  const leadCtx = await loadLeadContext(organizationId, built.persist.leadId);
  if (!leadCtx) return;

  // Resolver playbook efectivo del turno: publicado o override.
  let playbook: LoadedPlaybookVersion | null = built.playbook;
  if (opts.playbookOverride) {
    const override = await getConfigByVersionId(
      organizationId,
      opts.playbookOverride.versionId
    );
    if (!override) {
      console.error(
        `[sales] override de playbook no encontrado: versionId=${opts.playbookOverride.versionId} (is_test=true)`
      );
      return;
    }
    playbook = override;
  }

  // T303 — Set activo: el motor solo envía a Jev las preguntas con
  // `enabled=true`. Mantiene el comportamiento por defecto (V2 con
  // todas habilitadas) cuando no hay playbook.
  const jevQuestions: JevQuestions | undefined =
    playbook?.config.jev_questions as JevQuestions | undefined;

  const jev = await evaluateJev({
    state: built.state,
    questions: jevQuestions,
  });
  if (!jev.ok) {
    console.error("[sales] Jev falló:", jev.error);
    await persistLeadPatch(organizationId, leadCtx.lead.id, {
      lastJevError: sanitizeError(jev.detail),
      updatedAt: new Date(),
    });
    publishConversation(organizationId, conversationId);
    return;
  }

  const plan = resolveSalesPlan({
    decision: jev.decision,
    currentSalesState: {
      automationLane: leadCtx.lead.automationLane,
      demoShownAt: leadCtx.lead.demoShownAt,
      pricePresentedAt: leadCtx.lead.pricePresentedAt,
      paymentInstructionsSentAt: leadCtx.lead.paymentInstructionsSentAt,
      humanRequestedAt: leadCtx.lead.humanRequestedAt,
      followUpCount: leadCtx.lead.followUpCount,
    },
    currentPipelineStage: toSemantic(leadCtx.stage),
  });

  // Snapshot durable: añadir claves de versión del playbook (T308).
  // Esto preserva la auditoría por lead de qué playbook influyó la
  // decisión. Si no hay playbook (fallback a VENDE_VELOZ_*), los
  // campos quedan `null`.
  const snapshotBase = {
    snapshot: jev.snapshot,
    decision: jev.decision,
    plan: {
      lane: plan.lane,
      nextAction: plan.nextAction,
      shouldHandoff: plan.shouldHandoff,
    },
    requestId: jev.requestId ?? null,
    model: jev.model ?? null,
    playbook_version_id: playbook?.config ? playbookVersionId(playbook) : null,
    playbook_schema_version: playbook?.schema_version ?? null,
    playbook_version_number: playbook?.version_number ?? null,
  };

  await persistDecision({
    organizationId,
    conversationId,
    lead: leadCtx.lead,
    stage: leadCtx.stage,
    plan,
    snapshot: snapshotBase,
    playbook,
  });

  const skipRepeatStop =
    leadCtx.lead.automationLane === "stop" && plan.lane === "stop";
  const shouldWrite = plan.shouldReply && !skipRepeatStop;

  let sent = false;
  if (shouldWrite) {
    const kb = await loadKb(organizationId);
    // T307 — overrides para el writer: el playbook gana sobre los
    // defaults VENDE_VELOZ_*. Si llega `null` o no hay override,
    // `writeSalesReply` cae al default existente.
    const offerFromPlaybook: OfferBlock | null =
      (playbook?.config.offer as OfferBlock | undefined) ?? null;
    const writerInstructions: WriterInstructions | null =
      (playbook?.config.writer as WriterInstructions | undefined) ?? null;

    const written = await writeSalesReply({
      decision: jev.decision,
      plan,
      conversation: built.state.conversation,
      kb,
      facts: {
        automationLane: plan.lane,
        demoShownAt: leadCtx.lead.demoShownAt,
        pricePresentedAt: leadCtx.lead.pricePresentedAt,
        paymentInstructionsSentAt: leadCtx.lead.paymentInstructionsSentAt,
        humanRequestedAt: leadCtx.lead.humanRequestedAt,
        followUpCount: leadCtx.lead.followUpCount,
      },
      product: built.state.product,
      policy: built.state.commercial_policy,
      offer: offerFromPlaybook ?? VENDE_VELOZ_OFFER,
      writerInstructions: writerInstructions ?? undefined,
      isTest,
      agentProfile: await loadAgentProfileContext(organizationId),
    });

    if (written.ok && written.text) {
      // T308 — sandbox suprime TODO efecto externo: ni el sender de
      // WhatsApp (deliverReply) ni la cola durable de follow-ups.
      // Esto aísla la corrida de Laboratorio de efectos secundarios
      // sobre la cola durable y la API real de Meta.
      if (isTest) {
        sent = false;
      } else {
        sent = await deliverReply(conversation, written.text);
      }
      if (sent) {
        await persistDeliveryFacts(organizationId, leadCtx.lead.id, plan);
        // T308 — sandbox suprime follow-ups. Las filas
        // sales_follow_up_job no se crean en `is_test=true`, así la
        // corrida de Laboratorio termina sin jobs pendientes.
        if (!isTest) {
          await scheduleNextFollowUp({
            organizationId,
            leadId: leadCtx.lead.id,
            conversationId,
            plan,
            anchorAt: new Date(),
          });
        }
      }
    } else if (!written.ok) {
      console.error("[sales] writer falló:", written.error);
    }
  }

  if (plan.shouldHandoff) {
    await applyHandoff(conversationId, organizationId, "commercial");
  }
}

/**
 * Helper defensivo para extraer el `version_id` del playbook cargado.
 * El loader garantiza que la fila tiene `id`; lo retornamos como
 * string para la persistencia del snapshot.
 */
function playbookVersionId(p: LoadedPlaybookVersion): string {
  return p.id;
}

async function persistDecision(input: {
  organizationId: string;
  conversationId: string;
  lead: Lead;
  stage: Stage;
  plan: SalesPlan;
  snapshot: unknown;
  playbook: LoadedPlaybookVersion | null;
}): Promise<void> {
  const now = new Date();
  const basePatch: Record<string, unknown> = {
    automationLane: input.plan.lane,
    lastJevEvaluatedAt: now,
    lastJevDecision: input.snapshot,
    lastJevError: null,
    lastActivityAt: now,
    // T308 — auditoría por lead: qué versión del playbook influyó
    // la decisión. `null` cuando el runtime degradó a
    // VENDE_VELOZ_* (sin publicada o override rechazado).
    lastJevPlaybookVersionId: input.playbook?.id ?? null,
    lastJevPlaybookSchemaVersion: input.playbook?.schema_version ?? null,
  };

  if (input.plan.followUpDirective.kind === "schedule") {
    basePatch.followUpReason = input.plan.followUpDirective.reason;
  }

  const nextStageId = await resolveStageId(
    input.organizationId,
    input.plan.desiredPipelineSemantic,
    input.stage
  );

  if (nextStageId) {
    // Corte A — Jev deja de escribir `lead.stageId` directo. Conserva la
    // atomicidad original fusionando lane/facts/snapshot en el mismo UPDATE
    // a través del gateway. Sin dependencia circular: el gateway no conoce
    // Jev, Jev solo le pasa `extra` con los campos que ya actualizaba.
    let moveResult;
    try {
      moveResult = await moveLeadStage({
        organizationId: input.organizationId,
        leadId: input.lead.id,
        toStageId: nextStageId,
        actor: "agent",
        reason: `jev:${input.plan.nextAction}`,
        extra: basePatch,
      });
    } catch (err) {
      if (err instanceof StageGatewayError) {
        console.warn(`[sales] gateway rechazó move de Jev: ${err.message}`);
        // Aun así persistimos el resto (lane, snapshot) para no perder el
        // estado durable: el gateway es estricto, la decisión de Jev no.
        await persistLeadPatch(input.organizationId, input.lead.id, {
          ...basePatch,
          updatedAt: now,
        });
      } else {
        throw err;
      }
    }

    // 007 — Corte B: tras el commit exitoso del gateway, engancha CAPI.
    // Jev también pasa por la puerta única: su decisión dispara el mismo
    // reporte que un drag/drop humano. Best-effort absoluto.
    if (moveResult?.moved) {
      const nextStage = await loadStageById(input.organizationId, nextStageId);
      if (nextStage) {
        void reportStageChangeOnMove({
          organizationId: input.organizationId,
          leadId: input.lead.id,
          moved: true,
          fromStageId: moveResult.fromStageId,
          toStageId: nextStageId,
          toStageName: nextStage.name,
          toStageKind: nextStage.kind,
        });
      }
    }
  } else {
    // Sin cambio de etapa: escribe el patch base directamente.
    await persistLeadPatch(input.organizationId, input.lead.id, {
      ...basePatch,
      updatedAt: now,
    });
  }

  publishConversation(input.organizationId, input.conversationId);
}

async function persistDeliveryFacts(
  organizationId: string,
  leadId: string,
  plan: SalesPlan
): Promise<void> {
  if (plan.lane === "human" || plan.shouldHandoff) return;

  const now = new Date();
  const patch: Record<string, unknown> = { updatedAt: now };
  if (plan.nextAction === "present_price") {
    patch.pricePresentedAt = now;
  }
  if (
    plan.nextAction === "show_operations_demo" ||
    plan.nextAction === "show_online_enrollment_demo"
  ) {
    patch.demoShownAt = now;
  }
  if (Object.keys(patch).length === 1) return;
  await persistLeadPatch(organizationId, leadId, patch);
}

async function persistLeadPatch(
  organizationId: string,
  leadId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.lead)
    .set(patch)
    .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.id, leadId)));
}

async function resolveStageId(
  organizationId: string,
  semantic: PipelineSemantic | null,
  current: Stage
): Promise<string | null> {
  if (!semantic || semantic === "won") return null;
  const db = getDb();
  const stages = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const match = matchSemanticStage(semantic, stages);
  if (!match || match.id === current.id) return null;
  return match.id;
}

/** Resuelve etapa por semántica. Nunca elige `kind=won`. */
export function matchSemanticStage(
  semantic: PipelineSemantic,
  stages: Stage[]
): Stage | undefined {
  if (semantic === "lost") {
    return stages.find((stage) => stage.kind === "lost");
  }
  if (semantic === "interested") {
    return stages.find(
      (stage) => stage.kind === "open" && /interesado/i.test(stage.name)
    );
  }
  if (semantic === "active_conversation") {
    return stages.find(
      (stage) =>
        stage.kind === "open" && /conversaci[oó]n/i.test(stage.name)
    );
  }
  return undefined;
}

function toSemantic(stage: Stage): PipelineSemantic | null {
  if (stage.kind === "won") return "won";
  if (stage.kind === "lost") return "lost";
  if (/interesado/i.test(stage.name)) return "interested";
  if (/conversaci[oó]n/i.test(stage.name)) return "active_conversation";
  if (/^nuevo$/i.test(stage.name)) return "new";
  return stage.kind === "open" ? "active_conversation" : null;
}

async function loadLeadContext(
  organizationId: string,
  leadId: string
): Promise<{ lead: Lead; stage: Stage } | null> {
  const db = getDb();
  const rows = await db
    .select({ lead: schema.lead, stage: schema.pipelineStage })
    .from(schema.lead)
    .innerJoin(
      schema.pipelineStage,
      eq(schema.lead.stageId, schema.pipelineStage.id)
    )
    .where(
      scoped(schema.lead.organizationId, organizationId, eq(schema.lead.id, leadId))
    )
    .limit(1);
  const row = rows[0];
  return row ?? null;
}

async function loadKb(organizationId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
}

/**
 * T309 — Carga el subset de `agent_profile` que el writer necesita
 * (tone, instructions, escalationRules). Si la fila no existe o la
 * organización tiene el Sales Orchestrator deshabilitado, devuelve
 * `null` y el writer cae al comportamiento por defecto. Tenant-safe
 * vía `scoped()`.
 */
async function loadAgentProfileContext(
  organizationId: string
): Promise<
  | {
      tone?: string | null;
      instructions?: string | null;
      escalationRules?: string | null;
    }
  | null
> {
  const db = getDb();
  const rows = await db
    .select({
      tone: schema.agentProfile.tone,
      instructions: schema.agentProfile.instructions,
      escalationRules: schema.agentProfile.escalationRules,
    })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Si los 3 campos vienen null, devolvemos null para que el writer
  // no inyecte un bloque vacío en el prompt.
  if (!row.tone && !row.instructions && !row.escalationRules) return null;
  return {
    tone: row.tone,
    instructions: row.instructions,
    escalationRules: row.escalationRules,
  };
}

async function loadStageById(
  organizationId: string,
  stageId: string
): Promise<Stage | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.pipelineStage)
    .where(
      scoped(
        schema.pipelineStage.organizationId,
        organizationId,
        eq(schema.pipelineStage.id, stageId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

function publishConversation(organizationId: string, conversationId: string): void {
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversationId } },
  });
}

function sanitizeError(detail: string): string {
  return detail.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 500);
}
