import { beforeEach, describe, expect, it, vi } from "vitest";

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

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

const selectQueue: unknown[][] = [];
const insertedMessages: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        if (values.direction === "out") insertedMessages.push(values);
        const row = { id: "msg_1", createdAt: new Date(), ...values };
        return {
          returning: () => Promise.resolve([row]),
        };
      },
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy(
          {},
          { get: (_t2, col) => `${String(tableName)}.${String(col)}` }
        ),
    }
  ),
}));

describe("persistOutbound y cancelación de follow-ups", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    insertedMessages.length = 0;
    cancelFollowUpsOnManualReply.mockReset();
    graphRequest.mockReset();
    uploadGraphMedia.mockReset();
    saveMediaFile.mockReset();
    getCredentialsByOrg.mockReset();

    selectQueue.push([
      {
        conversation: {
          id: "cv_1",
          organizationId: "org_1",
          isTest: false,
          lastInboundAt: new Date(),
        },
        contact: { id: "ct_1", phone: "5215511111111", waUserId: null },
      },
    ]);
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
