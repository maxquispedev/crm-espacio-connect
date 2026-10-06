import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemDb, type Tables } from "../fixtures/mem-db";
import { resolveMessageAddress } from "@/server/whatsapp/addressing";

const mocks = vi.hoisted(() => ({
  graphRequest: vi.fn(), uploadGraphMedia: vi.fn(), saveMediaFile: vi.fn(),
  credentials: vi.fn(), publishMessageNew: vi.fn(),
}));
vi.mock("@/lib/meta/client", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/meta/client")>(), graphRequest: mocks.graphRequest,
}));
vi.mock("@/server/whatsapp/media", async importOriginal => ({
  ...await importOriginal<typeof import("@/server/whatsapp/media")>(),
  uploadGraphMedia: mocks.uploadGraphMedia, saveMediaFile: mocks.saveMediaFile,
}));
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: mocks.credentials, markReconnectRequired: vi.fn(),
}));
vi.mock("@/server/events/message-new", () => ({ publishMessageNew: mocks.publishMessageNew }));
vi.mock("@/server/inbox/attention", () => ({ bestEffortAttention: vi.fn(), markAttentionWaitingClient: vi.fn() }));
vi.mock("@/server/sales/follow-ups/store", () => ({ cancelFollowUpsOnManualReply: vi.fn() }));
vi.mock("@/server/inbox/ingest", () => ({ serializeMessage: (m: unknown) => m }));

const tables: Tables = { conversation: [], contact: [], message: [], media_asset: [],
  template: [], agent_profile: [], sales_outbound_delivery: [], sales_demo_reservation: [],
  wa_status_receipt: [], sales_follow_up_job: [], conversation_attention: [] };
const db = createMemDb(tables);
vi.mock("@/lib/db", async () => ({ schema: await import("@/lib/db/schema"), getDb: () => db }));
function seed(identity: Record<string, unknown>, overrides: Record<string, unknown> = {}, tpl = template) {
  tables.template!.push({ ...tpl, organizationId: "org_1" });
  tables.contact!.push({ ...identity, id: "ct_1", organizationId: "org_1" });
  tables.conversation!.push({ ...conversation, contactId: "ct_1", aiEnabled: true,
    handoffAt: null, latestInboundMessageId: "in_1", ...overrides });
  tables.message!.push({ id: "in_1", organizationId: "org_1", conversationId: "cv_1",
    direction: "in", type: "text", createdAt: new Date(), status: "delivered" });
  tables.agent_profile!.push({ organizationId: "org_1", enabled: true });
}

const bsuid = "PE.13491208655302741918";
const identities = [
  { label: "phone-only", phone: "+52 (1) 551-111-1111", waUserId: null, expected: { to: "525511111111" } },
  { label: "BSUID-only", phone: null, waUserId: bsuid, expected: { recipient: bsuid } },
  { label: "both", phone: "+51 999 111 222", waUserId: bsuid, expected: { recipient: bsuid } },
];
const conversation = { id: "cv_1", organizationId: "org_1", isTest: false, lastInboundAt: new Date() };
const template = { id: "tpl_1", name: "hello", language: "es", body: "Hola {{1}}", category: "UTILITY", status: "approved" };
const { sendText, sendMediaMessage, sendStructured } = await import("@/server/inbox/send");
const { applyStatusUpdate } = await import("@/server/inbox/status");
const { sendTemplate } = await import("@/server/whatsapp/templates");

beforeEach(() => {
  vi.clearAllMocks();
  for (const bucket of Object.values(tables)) bucket!.length = 0;
  mocks.credentials.mockResolvedValue({ organizationId: "org_1", phoneNumberId: "pn_1", token: "fixture" });
  mocks.graphRequest.mockResolvedValue({ messages: [{ id: "wamid.fixture" }] });
  mocks.uploadGraphMedia.mockResolvedValue("media_1");
  mocks.saveMediaFile.mockResolvedValue("org_1/media_1");
});

async function send(kind: string) {
  const input = { organizationId: "org_1", conversationId: "cv_1" };
  if (kind === "text") return sendText({ ...input, text: "Hola", aiGenerated: true });
  if (kind === "video") return sendMediaMessage({ ...input, aiGenerated: true,
    file: { data: Buffer.from("synthetic-video"), mimeType: "video/mp4" }, caption: "Demo" });
  if (kind === "template") return sendTemplate({ ...input, templateId: "tpl_1", variables: ["Max"], urlButtonSuffix: "invoice" });
  return sendStructured({ ...input, kind: "location", location: { latitude: -12, longitude: -77 } });
}

describe("real sender Graph payload addressing", () => {
  for (const kind of ["text", "video", "template", "location"]) {
    it.each(identities)(`${kind}: $label uses exactly one Meta destination`, async identity => {
      seed(identity);
      mocks.graphRequest.mockImplementationOnce(async () => {
        const pending = tables.message!.find(m => m.direction === "out");
        expect(pending).toMatchObject({ status: "pending", waMessageId: null });
        if (kind === "text" || kind === "video") {
          expect(tables.sales_outbound_delivery).toHaveLength(1);
          expect(tables.sales_outbound_delivery![0]).toMatchObject({ messageId: pending!.id, inboundMessageId: "in_1" });
        }
        return { messages: [{ id: "wamid.fixture" }] };
      });
      await send(kind);
      expect(tables.message!.find(m => m.direction === "out")).toMatchObject({ status: "pending", waMessageId: "wamid.fixture" });
      expect(tables.sales_outbound_delivery!.every(row => !row.confirmedAt)).toBe(true);
      expect(tables.sales_follow_up_job).toHaveLength(0);
      expect(mocks.graphRequest).toHaveBeenCalledTimes(1);
      const [path, request] = mocks.graphRequest.mock.calls[0]!;
      expect(path).toBe("pn_1/messages");
      expect(request.body).toMatchObject({ messaging_product: "whatsapp", type: kind, ...identity.expected });
      expect(Object.keys(request.body).filter(k => k === "to" || k === "recipient")).toEqual(Object.keys(identity.expected));
      if (kind === "video") expect(request.body.video).toEqual({ id: "media_1", caption: "Demo" });
      if (kind === "text") expect(request.body.text).toEqual({ body: "Hola" });
      if (kind === "template") expect(request.body.template).toMatchObject({
        name: "hello", language: { code: "es" }, components: [
          { type: "body", parameters: [{ type: "text", text: "Max" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "invoice" }] },
        ],
      });
    });
    it.each(identities)(`${kind}: sandbox $label touches no Graph/upload/disk`, async identity => {
      seed(identity, { isTest: true });
      await expect(send(kind)).rejects.toMatchObject({ code: "sandbox_violation" });
      expect(mocks.graphRequest).not.toHaveBeenCalled();
      expect(mocks.uploadGraphMedia).not.toHaveBeenCalled();
      expect(mocks.saveMediaFile).not.toHaveBeenCalled();
      expect(mocks.credentials).not.toHaveBeenCalled();
    });
  }
  it.each(identities)("authentication template $label respects Meta phone requirement", async identity => {
    seed(identity, {}, { ...template, category: "AUTHENTICATION" });
    if (!identity.phone) {
      await expect(send("template")).rejects.toMatchObject({ code: "meta_error" });
      expect(mocks.graphRequest).not.toHaveBeenCalled();
    } else {
      await send("template");
      const payload = mocks.graphRequest.mock.calls[0]![1].body;
      expect(payload.to).toBe(identity.label === "both" ? "51999111222" : "525511111111");
      expect(payload).not.toHaveProperty("recipient");
    }
  });
  it.each(["text", "video", "template", "location"])("%s: missing identity fails before external effects", async kind => {
    seed({ phone: null, waUserId: null });
    await expect(send(kind)).rejects.toMatchObject({ code: "meta_error" });
    expect(mocks.graphRequest).not.toHaveBeenCalled();
    expect(mocks.uploadGraphMedia).not.toHaveBeenCalled();
    expect(mocks.saveMediaFile).not.toHaveBeenCalled();
  });
});

describe("opaque IDs and normalized phones", () => {
  it("preserves parent BSUID exactly", () => {
    expect(resolveMessageAddress({ waUserId: "US.ENT.11815799212886844830" })).toEqual({ recipient: "US.ENT.11815799212886844830" });
  });
  it("never recovers a BSUID or username by stripping letters from phone", () => {
    expect(resolveMessageAddress({ phone: bsuid })).toBeNull();
    expect(resolveMessageAddress({ phone: "@max123" })).toBeNull();
  });
});

describe("addressed AI outbound requires confirmed delivery", () => {
  it.each(["sent", "delivered", "read"])("%s confirms the bound ledger once despite repeated/reversed receipts", async status => {
    seed(identities[1]!);
    await send("text");
    const ledger = tables.sales_outbound_delivery![0]!;
    expect(ledger.confirmedAt).toBeUndefined();
    const receipt = { id: "wamid.fixture", status, timestamp: "1" };
    await applyStatusUpdate("org_1", receipt);
    const confirmedAt = ledger.confirmedAt;
    expect(confirmedAt).toBeInstanceOf(Date);
    await applyStatusUpdate("org_1", receipt);
    await applyStatusUpdate("org_1", { ...receipt, status: "sent" });
    expect(ledger.confirmedAt).toEqual(confirmedAt);
    expect(tables.sales_outbound_delivery).toHaveLength(1);
    expect(tables.sales_follow_up_job).toHaveLength(0);
    expect(mocks.graphRequest).toHaveBeenCalledOnce();
  });
  it("replays an early receipt only after durable wamid binding", async () => {
    seed(identities[1]!);
    mocks.graphRequest.mockImplementationOnce(async () => {
      await applyStatusUpdate("org_1", { id: "wamid.fixture", status: "read", timestamp: "1" });
      expect(tables.wa_status_receipt).toHaveLength(1);
      expect(tables.sales_outbound_delivery![0]!.confirmedAt).toBeUndefined();
      return { messages: [{ id: "wamid.fixture" }] };
    });
    await send("text");
    expect(tables.message!.find(m => m.direction === "out")).toMatchObject({ status: "read", waMessageId: "wamid.fixture" });
    expect(tables.sales_outbound_delivery![0]!.confirmedAt).toBeInstanceOf(Date);
    expect(mocks.graphRequest).toHaveBeenCalledOnce();
  });
});
