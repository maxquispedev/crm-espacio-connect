import { desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isWindowOpen } from "@/server/inbox/window";

export type SafetyDb = Pick<ReturnType<typeof getDb>, "select" | "insert" | "update" | "delete">;
export type TurnToken = {
  organizationId: string;
  conversationId: string;
  inboundMessageId: string;
  manualMessageId: string | null;
  sales?: boolean;
  allowClosedWindow?: boolean;
  allowOpaqueInbound?: boolean;
};

/** There is no interpreter for inbound attachments today; captions are not evidence. */
export function isOpaqueInbound(type: string): boolean { return type !== "text"; }

export async function captureTurnToken(
  organizationId: string, conversationId: string, db: SafetyDb = getDb()
): Promise<TurnToken | null> {
  const [conv] = await db.select().from(schema.conversation).where(scoped(
    schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)
  )).limit(1);
  if (!conv) return null;
  const [inbound] = await db.select().from(schema.message).where(scoped(
    schema.message.organizationId, organizationId, eq(schema.message.conversationId, conversationId),
    eq(schema.message.direction, "in")
  )).orderBy(desc(schema.message.createdAt), desc(schema.message.id)).limit(1);
  if (!inbound) return null;
  const [manual] = await db.select().from(schema.message).where(scoped(
    schema.message.organizationId, organizationId, eq(schema.message.conversationId, conversationId),
    eq(schema.message.direction, "out"), inArray(schema.message.origin, ["operator", "manual", "template"]),
    isNotNull(schema.message.waMessageId), ne(schema.message.status, "failed")
  )).orderBy(desc(schema.message.createdAt), desc(schema.message.id)).limit(1);
  return { organizationId, conversationId, inboundMessageId: conv.latestInboundMessageId ?? inbound.id,
    manualMessageId: manual?.id ?? null };
}

export async function isTurnCurrent(
  token: TurnToken, db: SafetyDb = getDb(), expectedHandoffAt?: Date | null
): Promise<boolean> {
  const current = await captureTurnToken(token.organizationId, token.conversationId, db);
  if (!current || current.inboundMessageId !== token.inboundMessageId || current.manualMessageId !== token.manualMessageId) return false;
  const [conv] = await db.select().from(schema.conversation).where(scoped(
    schema.conversation.organizationId, token.organizationId, eq(schema.conversation.id, token.conversationId)
  )).limit(1);
  if (!conv?.aiEnabled) return false;
  if (conv.handoffAt && (!expectedHandoffAt || conv.handoffAt.getTime() !== expectedHandoffAt.getTime())) return false;
  if (!conv.isTest && !token.allowClosedWindow && !isWindowOpen(conv.lastInboundAt)) return false;
  const [profile] = await db.select().from(schema.agentProfile).where(scoped(
    schema.agentProfile.organizationId, token.organizationId
  )).limit(1);
  if (!profile || (!conv.isTest && !profile.enabled) || (token.sales && !profile.salesOrchestratorEnabled)) return false;
  const [inbound] = await db.select().from(schema.message).where(scoped(
    schema.message.organizationId, token.organizationId, eq(schema.message.id, token.inboundMessageId)
  )).limit(1);
  return !!inbound && (token.allowOpaqueInbound === true || !isOpaqueInbound(inbound.type));
}

export class StaleTurnError extends Error {
  constructor() { super("stale_turn"); this.name = "StaleTurnError"; }
}

/** Serialize a local effect against ingestion, operator replies and pauses. */
export async function withCurrentTurn<T>(token: TurnToken, effect: (db: SafetyDb) => Promise<T>): Promise<T> {
  return getDb().transaction(async tx => {
    await tx.select({ id: schema.conversation.id }).from(schema.conversation).where(scoped(
      schema.conversation.organizationId, token.organizationId, eq(schema.conversation.id, token.conversationId)
    )).for("update");
    if (!await isTurnCurrent(token, tx)) throw new StaleTurnError();
    return effect(tx);
  });
}

export async function readTurnInbound(token: TurnToken, db: SafetyDb = getDb()) {
  const [inbound] = await db.select().from(schema.message).where(scoped(
    schema.message.organizationId, token.organizationId, eq(schema.message.id, token.inboundMessageId)
  )).limit(1);
  return inbound ?? null;
}
