import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { type SQL } from "drizzle-orm";
import { exportCommercialDataset } from "@/server/commercial-export/dataset";
import { exportInputSchema } from "@/server/commercial-export/input";

vi.mock("@/lib/db", async () => ({ schema: await import("@/lib/db/schema"), getDb: vi.fn() }));
const at = new Date("2026-10-06T12:00:00Z");
const input = exportInputSchema.parse({ date_from: "2026-10-06", date_to: "2026-10-06" });
function mockDatabase(queue: unknown[][]) {
  const clauses: SQL[] = [], projections: unknown[] = [];
  const tx = {
    select: (projection: unknown) => {
      projections.push(projection);
      const rows = queue.shift() ?? [];
      const chain = { from: () => chain, leftJoin: (_table: unknown, clause: SQL) => { clauses.push(clause); return chain; },
        where: (clause: SQL) => { clauses.push(clause); return chain; }, orderBy: () => chain,
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
      return chain;
    },
  };
  const transaction = vi.fn(async (fn: (db: typeof tx) => unknown) => fn(tx));
  return { db: { transaction } as unknown as Parameters<typeof exportCommercialDataset>[2], clauses, projections, transaction };
}
const fixture = { conversation: { id: "cv_A", contactId: "ct_A", createdAt: at, lastMessageAt: at,
  aiEnabled: true, handoffAt: null, handoffReason: null, lastInboundAt: at },
  lead: { id: "ld_A", stageId: "st_A", automationLane: "auto", demoShownAt: at, pricePresentedAt: at,
    paymentInstructionsSentAt: null, humanRequestedAt: null, nextFollowUpAt: at, followUpCount: 1,
    followUpReason: "after_price", lastJevEvaluatedAt: at, lastJevDecision: { decision: { nextAction: { choice: "present_price" } } },
    lastJevPlaybookVersionId: "pv_A", lastJevPlaybookSchemaVersion: "1.0" },
  stage: { id: "st_A", name: "Interesado", kind: "open" },
  attribution: { sourceId: "ad", sourceType: "ad", headline: "Anuncio", body: "Texto", mediaType: "video", createdAt: at } };
describe("commercial export batch dataset", () => {
  it("assembles real structured evidence and computes summary from exported rows", async () => {
    const mock = mockDatabase([[{ id: "A", name: "Org A" }], [fixture],
      [{ id: "m_A", conversationId: "cv_A", createdAt: at, waTimestamp: at, direction: "in", type: "text",
        text: "¿Cuánto cuesta?", status: "read", aiGenerated: false, origin: "operator", media: null }],
      [{ id: "job", conversationId: "cv_A", reason: "after_price", attemptNumber: 1, dueAt: at, status: "sent", createdAt: at, updatedAt: at, messageId: "out" }],
      [{ id: "event", conversationId: "cv_A", eventName: "Purchase", status: "sent", customData: { lead_stage: "won", token: "secret" }, createdAt: at }],
      [{ conversationId: "cv_A", messageId: "out", plan: { salesPlan: { nextAction: "present_price" } }, demoSlot: null,
        paymentGroupId: null, paymentPart: null, paymentParts: null, followUpJobId: "job", confirmedAt: at, failedAt: null, invalidatedAt: null, createdAt: at }]]);
    const result = await exportCommercialDataset("A", input, mock.db);
    expect(result.summary).toMatchObject({ conversations: 1, messages: 1, inbound_messages: 1,
      operator_messages: 0, demo_shown: 1, price_presented: 1, ad_attributed_conversations: 1 });
    expect(result.conversations[0]?.lead?.stage?.name).toBe("Interesado");
    expect(result.conversations[0]?.follow_ups[0]?.message_id).toBe("out");
    expect(result.conversations[0]?.outbound_deliveries[0]?.confirmed_at).toBe(at.toISOString());
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(mock.projections).toHaveLength(6);
    expect(mock.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "repeatable read", accessMode: "read only" });
    const sql = mock.clauses.map(clause => new PgDialect().sqlToQuery(clause));
    for (const query of sql) expect(query.params).toContain("A");
    const cohort = sql.find(query => query.sql.includes('"is_test"'))!;
    expect(cohort.sql).toMatch(/"created_at" >= .*"created_at" </);
    expect(cohort.params).toContain(false);
    expect(JSON.stringify(mock.projections, (key, value) => value?.name && value?.table ? value.name : value)).not.toMatch(/phone|wa_identity|ctwa_clid/);
  });
  it("includes unattributed conversations and handles absent lead", async () => {
    const mock = mockDatabase([[{ id: "A", name: "Org A" }], [{ ...fixture, attribution: null, lead: null, stage: null }]]);
    const result = await exportCommercialDataset("A", input, mock.db);
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]?.attribution).toBeNull();
    expect(result.conversations[0]?.lead).toBeNull();
    expect(result.summary.price_presented).toBe(0);
  });
  it("scopes optional source filter to cohort and uses paid ads only", async () => {
    const mock = mockDatabase([[{ id: "A", name: "Org A" }], []]);
    const result = await exportCommercialDataset("A", { ...input, source_ids: ["shared"], ad_attributed_only: true }, mock.db);
    expect(result.summary.messages).toBe(0);
    expect(mock.projections).toHaveLength(2);
    const query = mock.clauses.map(clause => new PgDialect().sqlToQuery(clause)).find(query => query.sql.includes('"is_test"'))!;
    expect(query.params).toEqual(expect.arrayContaining(["A", "shared", "ad", false]));
  });
});
