import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemDb, type Tables } from "../fixtures/mem-db";
import * as schema from "@/lib/db/schema";
import { captureTurnToken, isTurnCurrent } from "@/server/ai/turn-safety";
import { reserveDemoSlot } from "@/server/sales/delivery-ledger";
import { sendText, sendMediaMessage } from "@/server/inbox/send";
import { applyStatusUpdate } from "@/server/inbox/status";
import { ingestInboundMessage } from "@/server/inbox/ingest";
import { runSalesOrchestratorTurn } from "@/server/sales/orchestrator";
import { runAgentTurn } from "@/server/ai/pipeline";
import { makeDecision } from "./sales-fixtures";

const mocks = vi.hoisted(() => ({ graph: vi.fn(), upload: vi.fn(), jev: vi.fn(), writer: vi.fn(),
  chat: vi.fn(), trigger: vi.fn(), publish: vi.fn(), demo: vi.fn() }));
let tables: Tables;
let db: ReturnType<typeof createMemDb>;
vi.mock("@/lib/db", async () => ({ schema: await import("@/lib/db/schema"), getDb: () => db }));
vi.mock("@/lib/env", () => ({ isAiConfigured: () => true, getEnv: () => ({ AGENT_COALESCE_MS: 0 }) }));
vi.mock("@/lib/meta/client", async original => ({ ...await original<object>(), graphRequest: mocks.graph }));
vi.mock("@/server/whatsapp/credentials", () => ({ getCredentialsByOrg: async (organizationId: string) => ({ organizationId, phoneNumberId: "pn", token: "fixture" }), markReconnectRequired: vi.fn() }));
vi.mock("@/server/whatsapp/media", async original => ({ ...await original<object>(),
  saveMediaFile: async () => "test/media", uploadGraphMedia: mocks.upload, ensureAssetAvailable: async () => {} }));
vi.mock("@/server/inbox/identity", () => ({ getOrCreateContactByIdentity: async () => ({ contact: tables.contact![0] }), resolveIdentity: vi.fn() }));
vi.mock("@/server/attribution/referral", () => ({ anuncioDeWhatsapp: () => null }));
vi.mock("@/server/events/bus", () => ({ publish: mocks.publish }));
vi.mock("@/server/events/message-new", () => ({ publishMessageNew: mocks.publish }));
vi.mock("@/server/ai/trigger", () => ({ maybeRunAgentTurn: mocks.trigger }));
vi.mock("@/server/sales/client", () => ({ evaluateJev: mocks.jev }));
vi.mock("@/server/sales/writer", () => ({ writeSalesReply: mocks.writer }));
vi.mock("@/lib/ai", () => ({ chatJson: mocks.chat }));
vi.mock("@/lib/sales/playbook/loader", () => ({ getPublishedConfigForOrg: async () => null, getConfigByVersionId: async () => null }));
vi.mock("@/server/sales/demo-resource", async original => ({ ...await original<object>(), loadDemoVideo: mocks.demo }));

function inbound(id: string, type = "text") {
  tables.message!.push({ id, organizationId: "org_a", conversationId: "cv_a", direction: "in", type,
    text: "Quiero ver cómo se controlan pagos y saldos", createdAt: new Date(), origin: "operator", status: "delivered" });
  tables.conversation![0]!.latestInboundMessageId = id;
}
function lead() { return tables.lead![0]!; }
function out() { return tables.message!.filter(m => m.direction === "out"); }
async function token() { return { ...(await captureTurnToken("org_a", "cv_a"))!, sales: true }; }
async function price() {
  const plan = { lane: "auto_close", nextAction: "present_price", shouldReply: true, shouldHandoff: false,
    desiredPipelineSemantic: null, factUpdates: {}, followUpDirective: { kind: "none" }, handoffReason: null } as const;
  return sendText({ organizationId: "org_a", conversationId: "cv_a", text: "S/247", aiGenerated: true,
    deliveryMetadata: { token: await token(), leadId: "ld_a", plan, scheduleFollowUp: true } });
}
async function status(kind: "sent" | "delivered" | "read" | "failed", id = "wamid.test") {
  return applyStatusUpdate("org_a", { id, status: kind, timestamp: "1", ...(kind === "failed" ? { errors: [{ code: 131026, title: "Message undeliverable" }] } : {}) });
}
beforeEach(() => {
  vi.clearAllMocks();
  tables = { message: [], media_asset: [], commercial_resource: [], sales_outbound_delivery: [],
    sales_demo_reservation: [], wa_status_receipt: [], sales_follow_up_job: [], conversation_attention: [], kb_entry: [], ad_attribution: [],
    contact: [{ id: "ct_a", organizationId: "org_a", phone: "51999000001", name: "Test", notes: null }],
    conversation: [{ id: "cv_a", organizationId: "org_a", contactId: "ct_a", aiEnabled: true, isTest: false, handoffAt: null, lastInboundAt: new Date() }],
    lead: [{ id: "ld_a", organizationId: "org_a", contactId: "ct_a", stageId: "st_a", automationLane: "auto",
      demoShownAt: null, pricePresentedAt: null, paymentInstructionsSentAt: null, followUpCount: 0, nextFollowUpAt: null }],
    pipeline_stage: [{ id: "st_a", organizationId: "org_a", kind: "open", name: "En conversación", position: 0 }],
    agent_profile: [{ organizationId: "org_a", enabled: true, salesOrchestratorEnabled: true, salesFollowUpsEnabled: true }],
  };
  db = createMemDb(tables); inbound("in_a");
  mocks.graph.mockResolvedValue({ messages: [{ id: "wamid.test" }] }); mocks.upload.mockResolvedValue("uploaded");
  mocks.jev.mockResolvedValue({ ok: true, decision: makeDecision({ nextAction: "show_operations_demo" }), snapshot: {} });
  mocks.writer.mockResolvedValue({ ok: true, text: "Así se controlan los pagos.", commercialEvidence: "supported" });
  mocks.demo.mockResolvedValue({ file: { data: Buffer.from("demo"), mimeType: "video/mp4" } });
});

describe("017 durable delivery authorization", () => {
  it("persists ledger before Graph and wamid remains pending with no facts/jobs", async () => {
    mocks.graph.mockImplementation(async () => {
      expect(tables.sales_outbound_delivery).toHaveLength(1); expect(out()).toHaveLength(1);
      expect(lead().pricePresentedAt).toBeNull(); return { messages: [{ id: "wamid.test" }] };
    });
    await price(); expect(out()[0]!.status).toBe("pending");
    expect(lead().pricePresentedAt).toBeNull(); expect(tables.sales_follow_up_job).toHaveLength(0);
  });
  it("first reversed/duplicate/concurrent success confirms facts and exactly one sequence", async () => {
    await price(); await Promise.all([status("read"), status("sent"), status("delivered"), status("read")]);
    expect(out()[0]!.status).toBe("read"); expect(lead().pricePresentedAt).toBeInstanceOf(Date);
    expect(tables.sales_follow_up_job).toHaveLength(1); expect(tables.sales_outbound_delivery![0]!.confirmedAt).toBeInstanceOf(Date);
  });
  it("confirmation after 24h authorizes effects without reopening free-text sending", async () => {
    await price(); tables.conversation![0]!.lastInboundAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(await isTurnCurrent(await token())).toBe(false);
    await status("sent"); expect(lead().pricePresentedAt).toBeInstanceOf(Date);
    expect(tables.sales_follow_up_job).toHaveLength(1); expect(mocks.graph).toHaveBeenCalledOnce();
  });
  it("early success before Graph response is durable and replayed at binding", async () => {
    mocks.graph.mockImplementation(async () => { await status("sent"); expect(lead().pricePresentedAt).toBeNull(); return { messages: [{ id: "wamid.test" }] }; });
    await price(); expect(lead().pricePresentedAt).toBeInstanceOf(Date); expect(tables.sales_follow_up_job).toHaveLength(1);
  });
  it("early failed131026 is terminal, visible, silent human and no facts/jobs/retry", async () => {
    mocks.graph.mockImplementation(async () => { await status("failed"); return { messages: [{ id: "wamid.test" }] }; });
    await price(); await status("sent"); await status("failed");
    expect(out()[0]).toMatchObject({ status: "failed", error: expect.any(String) });
    expect(lead().pricePresentedAt).toBeNull(); expect(tables.sales_follow_up_job).toHaveLength(0);
    expect(tables.conversation![0]).toMatchObject({ handoffReason: "delivery_failed" });
    expect(tables.conversation_attention![0]!.state).toBe("pending"); expect(lead().automationLane).toBe("human");
    expect(lead().stageId).toBe("st_a"); expect(mocks.graph).toHaveBeenCalledOnce();
  });
  it("sandbox price fact revalidates freshness inside its transaction", async () => {
    tables.conversation![0]!.isTest = true;
    mocks.jev.mockResolvedValue({ ok: true, raw: {}, decision: makeDecision({ nextAction: "present_price" }) });
    mocks.writer.mockResolvedValue({ ok: true, text: "S/247", commercialEvidence: "supported" });
    const transaction = vi.spyOn(db, "transaction").mockImplementation(async effect => {
      // The local sandbox response was persisted, then a newer inbound wins
      // immediately before the fact transaction acquires its lock.
      if (out().length) inbound("in_new_sandbox");
      return effect(db);
    });
    try {
      await runSalesOrchestratorTurn({ organizationId: "org_a", conversationId: "cv_a", conversation: tables.conversation![0] as never });
      expect(out()).toHaveLength(1);
      expect(lead().pricePresentedAt).toBeNull();
      expect(tables.sales_follow_up_job).toHaveLength(0);
      expect(mocks.graph).not.toHaveBeenCalled();
    } finally { transaction.mockRestore(); }
  });
  it("late failure revokes only owned facts and cancels linked jobs", async () => {
    const priorDemo = new Date(1); lead().demoShownAt = priorDemo;
    await price(); await status("sent"); await status("failed"); await status("read");
    expect(lead().pricePresentedAt).toBeNull(); expect(lead().demoShownAt).toEqual(priorDemo);
    expect(tables.sales_follow_up_job![0]!.status).toBe("cancelled"); expect(lead().nextFollowUpAt).toBeNull();
  });
  it.each(["inbound", "manual", "handoff", "profile"])("late confirmation after %s cannot authorize stale effects", async invalidation => {
    await price();
    if (invalidation === "inbound") inbound("in_new");
    if (invalidation === "manual") tables.message!.push({ id: "manual", organizationId: "org_a", conversationId: "cv_a", direction: "out", origin: "manual", waMessageId: "manual.wamid", status: "sent", createdAt: new Date() });
    if (invalidation === "handoff") tables.conversation![0]!.handoffAt = new Date();
    if (invalidation === "profile") tables.agent_profile![0]!.enabled = false;
    await status("sent"); expect(lead().pricePresentedAt).toBeNull(); expect(tables.sales_follow_up_job).toHaveLength(0);
    expect(tables.sales_outbound_delivery![0]!.invalidatedAt).toBeInstanceOf(Date);
  });
  it.each(["enabled", "salesFollowUpsEnabled", "pause"])("disabled %s before callback cancels pending processing job without retry", async flag => {
    const dueAt = new Date(); lead().nextFollowUpAt = dueAt;
    tables.sales_follow_up_job!.push({ id: "job_a", organizationId: "org_a", leadId: "ld_a", conversationId: "cv_a",
      status: "processing", reason: "after_price", attemptNumber: 1, dueAt, anchorAt: new Date() });
    await sendText({ organizationId: "org_a", conversationId: "cv_a", text: "retomo", aiGenerated: true,
      deliveryMetadata: { token: await token(), leadId: "ld_a", followUpJobId: "job_a" } });
    if (flag === "pause") { tables.conversation![0]!.aiEnabled = false; tables.sales_outbound_delivery![0]!.invalidatedAt = new Date(); }
    else tables.agent_profile![0]![flag] = false;
    await status("sent"); expect(tables.sales_follow_up_job![0]!.status).toBe("cancelled");
    expect(lead().nextFollowUpAt).toBeNull(); expect(lead().followUpCount).toBe(0); expect(mocks.graph).toHaveBeenCalledOnce();
  });
  it.each([1, 3])("followup attempt %i stays processing until status then advances exactly once", async attemptNumber => {
    const dueAt = new Date(); lead().nextFollowUpAt = dueAt; lead().followUpReason = "after_price";
    tables.sales_follow_up_job!.push({ id: "job_a", organizationId: "org_a", leadId: "ld_a", conversationId: "cv_a",
      status: "processing", reason: "after_price", attemptNumber, dueAt, anchorAt: new Date(), sourceMessageId: "root" });
    await sendText({ organizationId: "org_a", conversationId: "cv_a", text: "retomo", aiGenerated: true,
      deliveryMetadata: { token: await token(), leadId: "ld_a", followUpJobId: "job_a" } });
    expect(tables.sales_follow_up_job![0]!.status).toBe("processing"); expect(lead().followUpCount).toBe(0);
    await status("sent"); await status("read");
    expect(tables.sales_follow_up_job![0]!.status).toBe("sent"); expect(lead().followUpCount).toBe(attemptNumber);
    if (attemptNumber === 1) expect(tables.sales_follow_up_job).toHaveLength(2);
    else { expect(tables.sales_follow_up_job).toHaveLength(1); expect(lead().automationLane).toBe("stop"); }
    expect(lead().stageId).toBe("st_a");
  });
  it("tenant receipt cannot confirm another org message", async () => {
    await price(); await applyStatusUpdate("org_b", { id: "wamid.test", status: "sent", timestamp: "1" });
    expect(lead().pricePresentedAt).toBeNull(); expect(out()[0]!.status).toBe("pending");
  });
  it("scheduling failure rolls back facts and confirmed marker, duplicate callback can reconcile", async () => {
    await price(); const original = db.insert;
    db.insert = ((table: unknown) => { if (table === schema.salesFollowUpJob) throw new Error("DB fixture failure"); return original(table); }) as typeof db.insert;
    // transaction executor uses its own methods; inject fault there as well.
    const transaction = db.transaction;
    db.transaction = (run => transaction(tx => run({ ...tx, insert: db.insert }))) as typeof db.transaction;
    await expect(status("sent")).rejects.toThrow("DB fixture failure");
    expect(tables.lead![0]!.pricePresentedAt).toBeNull(); expect(tables.sales_outbound_delivery![0]!.confirmedAt).toBeUndefined();
    db.insert = original; await status("sent"); expect(tables.lead![0]!.pricePresentedAt).toBeInstanceOf(Date);
  });
});

describe("017 inbound and turn freshness", () => {
  it.each(["audio", "image", "video", "document", "sticker", "location", "contacts"])("%s persists, cancels and hands off before providers even with caption", async type => {
    tables.sales_follow_up_job!.push({ id: "job", organizationId: "org_a", leadId: "ld_a", conversationId: "cv_a", status: "pending" });
    await ingestInboundMessage({ organizationId: "org_a", identity: { identity: "51999000001", phone: "51999000001", waUserId: null, profileName: null }, waMessageId: `wamid.${type}`,
      type, text: "Caption is not understanding", timestamp: String(Math.floor(Date.now()/1000)),
      media: { kind: type as "audio", waMediaId: "asset", mimeType: "audio/ogg", fileName: null, caption: "demo please", payload: null, fetchStatus: "pending" } });
    expect(tables.media_asset).toHaveLength(1); expect(tables.message).toHaveLength(2); expect(out()).toHaveLength(0);
    expect(tables.conversation![0]!.handoffReason).toBe("unsupported_media"); expect(tables.conversation_attention![0]!.state).toBe("pending");
    expect(tables.sales_follow_up_job![0]!.status).toBe("cancelled");
    await runAgentTurn("cv_a"); expect(mocks.jev).not.toHaveBeenCalled(); expect(mocks.writer).not.toHaveBeenCalled(); expect(mocks.trigger).not.toHaveBeenCalled();
  });
  it("new inbound during writer abandons old plan/send then processes only current context", async () => {
    mocks.writer.mockImplementationOnce(async () => { inbound("in_b"); return { ok: true, text: "old", commercialEvidence: "supported" }; });
    const run = () => runSalesOrchestratorTurn({ organizationId: "org_a", conversationId: "cv_a", conversation: tables.conversation![0] as unknown as typeof schema.conversation.$inferSelect });
    await run(); expect(out()).toHaveLength(0); expect(lead().lastJevDecision).toBeUndefined();
    await run(); expect(out()).toHaveLength(1); expect(mocks.graph).toHaveBeenCalledOnce();
  });
  it("new inbound during media upload prevents video and orphan caption", async () => {
    mocks.upload.mockImplementation(async () => { inbound("in_b"); return "uploaded"; });
    await expect(sendMediaMessage({ organizationId: "org_a", conversationId: "cv_a", aiGenerated: true,
      deliveryMetadata: { token: await token(), leadId: "ld_a", demoSlot: "demo_payments_balances" },
      file: { data: Buffer.from("demo"), mimeType: "video/mp4" }, caption: "old" })).rejects.toMatchObject({ name: "StaleTurnError" });
    expect(mocks.graph).not.toHaveBeenCalled(); expect(lead().demoShownAt).toBeNull();
    expect(out().every(m => m.type === "video")).toBe(true);
  });
  it("legacy history excludes opaque inbound captions and unconfirmed seller text", async () => {
    tables.agent_profile![0]!.salesOrchestratorEnabled = false;
    tables.message![0]!.type = "audio"; tables.message![0]!.text = "opaque secret";
    tables.message!.push({ id: "pending", organizationId: "org_a", conversationId: "cv_a", direction: "out", origin: "ai", type: "text", text: "pending secret", status: "pending", createdAt: new Date() });
    inbound("in_b"); mocks.chat.mockResolvedValue({ ok: true, data: { action: "none" } });
    await runAgentTurn("cv_a"); expect(mocks.chat).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.chat.mock.calls[0]![1])).not.toContain("secret"); expect(out()).toHaveLength(1);
  });
  it.each(["move_stage", "update_lead"])("legacy %s abandons all effects when provider turn becomes stale", async action => {
    tables.agent_profile![0]!.salesOrchestratorEnabled = false;
    tables.pipeline_stage!.push({ id: "st_b", organizationId: "org_a", kind: "open", name: "Interesado", position: 1 });
    mocks.chat.mockImplementation(async () => { inbound("in_b"); return { ok: true, data: action === "move_stage" ? { action, stage: "Interesado", reply: "old" } : { action, note: "old", reply: "old" } }; });
    await runAgentTurn("cv_a"); expect(lead().stageId).toBe("st_a"); expect(tables.contact![0]!.notes).toBeNull(); expect(out()).toHaveLength(0);
  });
  it("inbound pointer wins same-millisecond/random-id order", async () => {
    inbound("aaa_latest"); tables.message![1]!.createdAt = tables.message![0]!.createdAt;
    expect((await token()).inboundMessageId).toBe("aaa_latest"); expect(await isTurnCurrent(await token())).toBe(true);
  });
});

describe("017 durable demo reservation", () => {
  it("concurrent identical slot reserves once, other slots and tenants stay independent", async () => {
    const t = await token(); expect(await Promise.all([reserveDemoSlot(t, "demo_enrollment_panel"), reserveDemoSlot(t, "demo_enrollment_panel")])).toEqual([true, false]);
    expect(await reserveDemoSlot(t, "demo_payments_balances")).toBe(true);
    expect(await reserveDemoSlot({ ...t, organizationId: "org_b" }, "demo_enrollment_panel")).toBe(true);
  });
  it("repeated pending demo never sends twice and creates silent human pending", async () => {
    const run = () => runSalesOrchestratorTurn({ organizationId: "org_a", conversationId: "cv_a", conversation: tables.conversation![0] as unknown as typeof schema.conversation.$inferSelect });
    await run(); inbound("in_b"); await run();
    expect(mocks.graph).toHaveBeenCalledOnce(); expect(out()).toHaveLength(1); expect(out()[0]!.type).toBe("video");
    expect(tables.conversation![0]!.handoffReason).toBe("duplicate_demo"); expect(tables.sales_demo_reservation).toHaveLength(1);
    expect(lead().demoShownAt).toBeNull(); expect(tables.sales_follow_up_job).toHaveLength(0);
  });
});
