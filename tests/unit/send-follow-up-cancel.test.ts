import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemDb, type Tables } from "../fixtures/mem-db";

/**
 * Un envío operator con status=failed (media/Graph) NO debe cancelar
 * follow-ups automáticos; solo el envío aceptado lo hace.
 */

const cancelFollowUpsOnManualReply = vi.hoisted(() => vi.fn());
const graphRequest = vi.hoisted(() => vi.fn());
const uploadGraphMedia = vi.hoisted(() => vi.fn());
const saveMediaFile = vi.hoisted(() => vi.fn());
const getCredentialsByOrg = vi.hoisted(() => vi.fn());

vi.mock("@/server/sales/follow-ups/store", () => ({
  cancelFollowUpsOnManualReply: (...args: unknown[]) =>
    cancelFollowUpsOnManualReply(...args),
}));

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return {
    ...original,
    graphRequest,
    normalizeRecipient: (p: string) => p.replace(/\D/g, ""),
  };
});

vi.mock("@/server/whatsapp/media", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/whatsapp/media")>();
  return { ...original, uploadGraphMedia, saveMediaFile };
});

vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: (...args: unknown[]) => getCredentialsByOrg(...args),
  markReconnectRequired: vi.fn(),
}));

vi.mock("@/server/events/message-new", () => ({
  publishMessageNew: vi.fn(),
}));

vi.mock("@/lib/db/ids", () => ({ newId: () => "id_test" }));

const tables: Tables = { conversation: [], contact: [], message: [], media_asset: [],
  agent_profile: [], sales_outbound_delivery: [], sales_demo_reservation: [],
  wa_status_receipt: [], sales_follow_up_job: [], conversation_attention: [] };
const db = createMemDb(tables);
const insertedMessages = tables.message!;
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"), getDb: () => db,
}));

describe("persistOutbound y cancelación de follow-ups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const bucket of Object.values(tables)) bucket!.length = 0;
    tables.conversation!.push({ id: "cv_1", organizationId: "org_1", contactId: "ct_1",
      isTest: false, aiEnabled: true, handoffAt: null, lastInboundAt: new Date(), latestInboundMessageId: "in_1" });
    tables.contact!.push({ id: "ct_1", organizationId: "org_1", phone: "5215511111111", waUserId: null });
    tables.message!.push({ id: "in_1", organizationId: "org_1", conversationId: "cv_1",
      direction: "in", type: "text", text: "Hola", createdAt: new Date(), status: "delivered" });
    tables.agent_profile!.push({ organizationId: "org_1", enabled: true });
    getCredentialsByOrg.mockResolvedValue({
      organizationId: "org_1",
      phoneNumberId: "pn_1",
      token: "tok",
    });
    saveMediaFile.mockResolvedValue("/tmp/x");
  });

  it("media upload fallido persiste failed y NO cancela follow-ups", async () => {
    uploadGraphMedia.mockRejectedValue(new Error("upload boom"));
    const { sendMediaMessage, SendError } = await import("@/server/inbox/send");

    await expect(
      sendMediaMessage({
        conversationId: "cv_1",
        organizationId: "org_1",
        file: { data: Buffer.from("x"), mimeType: "image/jpeg" },
      })
    ).rejects.toBeInstanceOf(SendError);

    expect(insertedMessages.some((m) => m.status === "failed")).toBe(true);
    expect(cancelFollowUpsOnManualReply).not.toHaveBeenCalled();
  });

  it("texto operator exitoso sí cancela follow-ups", async () => {
    graphRequest.mockResolvedValue({ messages: [{ id: "wamid.1" }] });
    const { sendText } = await import("@/server/inbox/send");
    await sendText({
      conversationId: "cv_1",
      organizationId: "org_1",
      text: "hola manual",
      aiGenerated: false,
    });
    expect(cancelFollowUpsOnManualReply).toHaveBeenCalledWith({
      organizationId: "org_1",
      conversationId: "cv_1",
    });
  });
});
