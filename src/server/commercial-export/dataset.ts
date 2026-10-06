import { asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { exportBounds, EXPORT_TIME_ZONE, type ExportInput } from "./input";
import { safeJev, safeCustomData, safeDeliveryPlan, safeFileName } from "./safe-json";

const conversationFields = {
  id: schema.conversation.id,
  contactId: schema.conversation.contactId,
  createdAt: schema.conversation.createdAt,
  lastMessageAt: schema.conversation.lastMessageAt,
  aiEnabled: schema.conversation.aiEnabled,
  handoffAt: schema.conversation.handoffAt,
  handoffReason: schema.conversation.handoffReason,
  lastInboundAt: schema.conversation.lastInboundAt,
};
const leadFields = {
  id: schema.lead.id,
  stageId: schema.lead.stageId,
  automationLane: schema.lead.automationLane,
  demoShownAt: schema.lead.demoShownAt,
  pricePresentedAt: schema.lead.pricePresentedAt,
  paymentInstructionsSentAt: schema.lead.paymentInstructionsSentAt,
  humanRequestedAt: schema.lead.humanRequestedAt,
  nextFollowUpAt: schema.lead.nextFollowUpAt,
  followUpCount: schema.lead.followUpCount,
  followUpReason: schema.lead.followUpReason,
  lastJevEvaluatedAt: schema.lead.lastJevEvaluatedAt,
  lastJevDecision: schema.lead.lastJevDecision,
  lastJevPlaybookVersionId: schema.lead.lastJevPlaybookVersionId,
  lastJevPlaybookSchemaVersion: schema.lead.lastJevPlaybookSchemaVersion,
};
const pipelineStageFields = {
  id: schema.pipelineStage.id,
  name: schema.pipelineStage.name,
  kind: schema.pipelineStage.kind,
};
const adAttributionFields = {
  sourceId: schema.adAttribution.sourceId,
  sourceType: schema.adAttribution.sourceType,
  headline: schema.adAttribution.headline,
  body: schema.adAttribution.body,
  mediaType: schema.adAttribution.mediaType,
  createdAt: schema.adAttribution.createdAt,
};
const messageFields = {
  id: schema.message.id,
  conversationId: schema.message.conversationId,
  createdAt: schema.message.createdAt,
  waTimestamp: schema.message.waTimestamp,
  direction: schema.message.direction,
  type: schema.message.type,
  text: schema.message.text,
  status: schema.message.status,
  aiGenerated: schema.message.aiGenerated,
  origin: schema.message.origin,
};
const mediaAssetFields = {
  kind: schema.mediaAsset.kind,
  mimeType: schema.mediaAsset.mimeType,
  fileName: schema.mediaAsset.fileName,
  caption: schema.mediaAsset.caption,
};
const salesFollowUpJobFields = {
  id: schema.salesFollowUpJob.id,
  conversationId: schema.salesFollowUpJob.conversationId,
  reason: schema.salesFollowUpJob.reason,
  attemptNumber: schema.salesFollowUpJob.attemptNumber,
  dueAt: schema.salesFollowUpJob.dueAt,
  status: schema.salesFollowUpJob.status,
  createdAt: schema.salesFollowUpJob.createdAt,
  updatedAt: schema.salesFollowUpJob.updatedAt,
  messageId: schema.salesFollowUpJob.messageId,
};
const conversionEventFields = {
  id: schema.conversionEvent.id,
  conversationId: schema.conversionEvent.conversationId,
  eventName: schema.conversionEvent.eventName,
  status: schema.conversionEvent.status,
  customData: schema.conversionEvent.customData,
  createdAt: schema.conversionEvent.createdAt,
};
const salesOutboundDeliveryFields = {
  conversationId: schema.salesOutboundDelivery.conversationId,
  messageId: schema.salesOutboundDelivery.messageId,
  plan: schema.salesOutboundDelivery.plan,
  demoSlot: schema.salesOutboundDelivery.demoSlot,
  paymentGroupId: schema.salesOutboundDelivery.paymentGroupId,
  paymentPart: schema.salesOutboundDelivery.paymentPart,
  paymentParts: schema.salesOutboundDelivery.paymentParts,
  followUpJobId: schema.salesOutboundDelivery.followUpJobId,
  confirmedAt: schema.salesOutboundDelivery.confirmedAt,
  failedAt: schema.salesOutboundDelivery.failedAt,
  invalidatedAt: schema.salesOutboundDelivery.invalidatedAt,
  createdAt: schema.salesOutboundDelivery.createdAt,
};

const iso = (date: Date | null) => date?.toISOString() ?? null;
function group<T extends { conversationId: string }>(rows: T[]) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = map.get(row.conversationId) ?? [];
    bucket.push(row);
    map.set(row.conversationId, bucket);
  }
  return map;
}

/** All tables and joins carry the active tenant; snapshot consistency during live traffic. */
export async function exportCommercialDataset(organizationId: string, input: ExportInput, database = getDb()) {
  const bounds = exportBounds(input);
  return database.transaction(async db => {
    const exportedAt = new Date();
    const [org] = await db.select({ id: schema.organization.id, name: schema.organization.name })
      .from(schema.organization).where(eq(schema.organization.id, organizationId));
    if (!org) throw new Error("Organización no disponible");
    const rows = await db.select({ conversation: conversationFields, lead: leadFields,
      stage: pipelineStageFields, attribution: adAttributionFields })
      .from(schema.conversation)
      .leftJoin(schema.lead, scoped(schema.lead.organizationId, organizationId,
        eq(schema.lead.contactId, schema.conversation.contactId)))
      .leftJoin(schema.pipelineStage, scoped(schema.pipelineStage.organizationId, organizationId,
        eq(schema.pipelineStage.id, schema.lead.stageId)))
      .leftJoin(schema.adAttribution, scoped(schema.adAttribution.organizationId, organizationId,
        eq(schema.adAttribution.conversationId, schema.conversation.id)))
      .where(scoped(schema.conversation.organizationId, organizationId,
        eq(schema.conversation.isTest, false), gte(schema.conversation.createdAt, bounds.from),
        lt(schema.conversation.createdAt, bounds.until),
        input.ad_attributed_only ? eq(schema.adAttribution.sourceType, "ad") : undefined,
        input.source_ids.length ? inArray(schema.adAttribution.sourceId, input.source_ids) : undefined))
      .orderBy(asc(schema.conversation.createdAt), asc(schema.conversation.id));
    const ids = rows.map(row => row.conversation.id);
    // Empty cohort: no child queries. Constant query count, never one per conversation.
    const [messages, jobs, events, deliveries] = ids.length ? await Promise.all([
      db.select({ ...messageFields, media: mediaAssetFields }).from(schema.message)
        .leftJoin(schema.mediaAsset, scoped(schema.mediaAsset.organizationId, organizationId,
          eq(schema.mediaAsset.id, schema.message.mediaAssetId)))
        .where(scoped(schema.message.organizationId, organizationId, inArray(schema.message.conversationId, ids)))
        .orderBy(asc(sql`coalesce(${schema.message.waTimestamp}, ${schema.message.createdAt})`),
          asc(schema.message.createdAt), asc(schema.message.id)),
      db.select(salesFollowUpJobFields).from(schema.salesFollowUpJob)
        .where(scoped(schema.salesFollowUpJob.organizationId, organizationId, inArray(schema.salesFollowUpJob.conversationId, ids)))
        .orderBy(asc(schema.salesFollowUpJob.createdAt), asc(schema.salesFollowUpJob.id)),
      db.select(conversionEventFields).from(schema.conversionEvent)
        .where(scoped(schema.conversionEvent.organizationId, organizationId, inArray(schema.conversionEvent.conversationId, ids)))
        .orderBy(asc(schema.conversionEvent.createdAt), asc(schema.conversionEvent.id)),
      db.select(salesOutboundDeliveryFields).from(schema.salesOutboundDelivery)
        .where(scoped(schema.salesOutboundDelivery.organizationId, organizationId, inArray(schema.salesOutboundDelivery.conversationId, ids)))
        .orderBy(asc(schema.salesOutboundDelivery.createdAt), asc(schema.salesOutboundDelivery.messageId)),
    ]) : [[], [], [], []];
    const messageMap = group(messages), jobMap = group(jobs), eventMap = group(events), deliveryMap = group(deliveries);
    const conversations = rows.map(({ conversation: c, lead: l, stage, attribution: a }) => ({
      conversation_id: c.id, created_at: iso(c.createdAt), last_message_at: iso(c.lastMessageAt),
      lead: l ? {
        lead_id: l.id, stage: stage ? { id: stage.id, name: stage.name, kind: stage.kind } : null,
        automation_lane: l.automationLane, demo_shown_at: iso(l.demoShownAt),
        price_presented_at: iso(l.pricePresentedAt), payment_instructions_sent_at: iso(l.paymentInstructionsSentAt),
        human_requested_at: iso(l.humanRequestedAt), next_follow_up_at: iso(l.nextFollowUpAt),
        follow_up_count: l.followUpCount, follow_up_reason: l.followUpReason,
      } : null,
      conversation: { ai_enabled: c.aiEnabled, handoff_at: iso(c.handoffAt),
        handoff_reason: c.handoffReason, last_inbound_at: iso(c.lastInboundAt) },
      attribution: a ? { source_id: a.sourceId, source_type: a.sourceType, headline: a.headline,
        body: a.body, media_type: a.mediaType, created_at: iso(a.createdAt) } : null,
      jev: l ? { last_evaluated_at: iso(l.lastJevEvaluatedAt),
        last_jev_decision: safeJev(l.lastJevDecision),
        last_jev_playbook_version_id: l.lastJevPlaybookVersionId,
        last_jev_playbook_schema_version: l.lastJevPlaybookSchemaVersion } : null,
      messages: (messageMap.get(c.id) ?? []).map(m => ({ id: m.id,
        timestamp: iso(m.waTimestamp ?? m.createdAt), created_at: iso(m.createdAt),
        direction: m.direction, type: m.type, text: m.text, status: m.status,
        ai_generated: m.aiGenerated, origin: m.origin,
        media: m.media ? { kind: m.media.kind, mime_type: m.media.mimeType,
          file_name: safeFileName(m.media.fileName), caption: m.media.caption } : null,
      })),
      follow_ups: (jobMap.get(c.id) ?? []).map(j => ({ id: j.id, reason: j.reason,
        attempt_number: j.attemptNumber, due_at: iso(j.dueAt), status: j.status,
        created_at: iso(j.createdAt), updated_at: iso(j.updatedAt), message_id: j.messageId })),
      commercial_events: (eventMap.get(c.id) ?? []).map(e => ({ id: e.id, event_name: e.eventName,
        status: e.status, custom_data: safeCustomData(e.customData), created_at: iso(e.createdAt) })),
      outbound_deliveries: (deliveryMap.get(c.id) ?? []).map(d => ({ message_id: d.messageId,
        plan: safeDeliveryPlan(d.plan), demo_slot: d.demoSlot, payment_group_id: d.paymentGroupId,
        payment_part: d.paymentPart, payment_parts: d.paymentParts, follow_up_job_id: d.followUpJobId,
        confirmed_at: iso(d.confirmedAt), failed_at: iso(d.failedAt), invalidated_at: iso(d.invalidatedAt),
        created_at: iso(d.createdAt) })),
    }));
    const allMessages = conversations.flatMap(c => c.messages);
    const count = (predicate: (c: typeof conversations[number]) => boolean) => conversations.filter(predicate).length;
    return {
      schema_version: "1.0", exported_at: exportedAt.toISOString(), organization: org,
      filters: { ...input, timezone: EXPORT_TIME_ZONE, conversation_date_field: "created_at",
        from_inclusive: bounds.from.toISOString(), until_exclusive: bounds.until.toISOString(),
        history_scope: "complete_conversation" },
      summary: { conversations: conversations.length, messages: allMessages.length,
        inbound_messages: allMessages.filter(m => m.direction === "in").length,
        outbound_messages: allMessages.filter(m => m.direction === "out").length,
        ad_attributed_conversations: count(c => c.attribution?.source_type === "ad"),
        ai_messages: allMessages.filter(m => m.direction === "out" && m.ai_generated).length,
        operator_messages: allMessages.filter(m => m.direction === "out" && m.origin === "operator").length,
        manual_messages: allMessages.filter(m => m.direction === "out" && m.origin === "manual").length,
        template_messages: allMessages.filter(m => m.direction === "out" && m.origin === "template").length,
        handoffs: count(c => c.conversation.handoff_at !== null),
        price_presented: count(c => c.lead?.price_presented_at != null),
        demo_shown: count(c => c.lead?.demo_shown_at != null),
        payment_instructions_sent: count(c => c.lead?.payment_instructions_sent_at != null),
      }, conversations,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
