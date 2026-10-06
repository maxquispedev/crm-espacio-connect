/**
 * 004 — Cuando el cliente fuerza `kind=document` (caso típico: video >16MB
 * re-taggeado como documento), el sender debe:
 *  - Validar el tamaño contra el límite de `document` (100 MB), NO de video.
 *  - Subir a Graph con `application/octet-stream` (MIME seguro para doc
 *    genérico) y nombre original conservado.
 *  - Persistir el asset con `kind='document'` y `mimeType='application/octet-stream'`.
 *  - Enviar el mensaje a Graph como `type=document` con el filename original.
 *
 * Esto verifica el typed contract: NO se faking el MIME del File original,
 * sino que se declara el override tipado y el servidor lo aplica.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemDb, type Tables } from "../fixtures/mem-db";

const uploadGraphMedia = vi.hoisted(() => vi.fn());
const graphRequest = vi.hoisted(() => vi.fn());
const saveMediaFile = vi.hoisted(() => vi.fn());
const getCredentialsByOrg = vi.hoisted(() => vi.fn());
const publishMessageNew = vi.hoisted(() => vi.fn());
const cancelFollowUpsOnManualReply = vi.hoisted(() => vi.fn());

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
  return {
    ...original,
    uploadGraphMedia,
    saveMediaFile,
  };
});

vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: (...args: unknown[]) => getCredentialsByOrg(...args),
  markReconnectRequired: vi.fn(),
}));

vi.mock("@/server/events/message-new", () => ({
  publishMessageNew: (...args: unknown[]) => publishMessageNew(...args),
}));

vi.mock("@/server/sales/follow-ups/store", () => ({
  cancelFollowUpsOnManualReply: (...args: unknown[]) =>
    cancelFollowUpsOnManualReply(...args),
}));

vi.mock("@/lib/db/ids", () => ({ newId: () => "id_test" }));

const tables: Tables = { conversation: [], contact: [], message: [], media_asset: [],
  agent_profile: [], sales_outbound_delivery: [], sales_demo_reservation: [],
  wa_status_receipt: [], sales_follow_up_job: [], conversation_attention: [] };
const db = createMemDb(tables);
const insertedMessages = tables.message!;
const insertedAssets = tables.media_asset!;
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"), getDb: () => db,
}));

describe("sendMediaMessage — override kind=document", () => {
  beforeEach(() => {
    uploadGraphMedia.mockReset();
    graphRequest.mockReset();
    saveMediaFile.mockReset();
    getCredentialsByOrg.mockReset();
    publishMessageNew.mockReset();
    cancelFollowUpsOnManualReply.mockReset();
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
    saveMediaFile.mockResolvedValue("org_1/id_test");
    uploadGraphMedia.mockResolvedValue("media-id-test");
    graphRequest.mockResolvedValue({ messages: [{ id: "wamid.1" }] });
  });

  it("video de 30 MB con override kind=document: se valida contra document y se sube con application/octet-stream", async () => {
    const { sendMediaMessage } = await import("@/server/inbox/send");

    const fakeVideo = Buffer.from("binary-video-bytes");
    const result = await sendMediaMessage({
      conversationId: "cv_1",
      organizationId: "org_1",
      file: { data: fakeVideo, mimeType: "video/mp4", fileName: "clip.mp4" },
      kind: "document",
    });

    expect(result.messageId).toBeTruthy();
    // Validamos el ID devuelto sin acoplar el contrato al generador del fixture.
    // Subido a Graph con application/octet-stream (NO con video/mp4) para
    // esquivar el chequeo de tamaño de video en la Cloud API.
    expect(uploadGraphMedia).toHaveBeenCalledTimes(1);
    const uploaded = uploadGraphMedia.mock.calls[0]![1] as {
      mimeType: string;
      fileName?: string;
    };
    expect(uploaded.mimeType).toBe("application/octet-stream");
    expect(uploaded.fileName).toBe("clip.mp4");

    // Asset persistido con kind=document y mimeType=application/octet-stream.
    expect(insertedAssets[0]?.kind).toBe("document");
    expect(insertedAssets[0]?.mimeType).toBe("application/octet-stream");
    expect(insertedAssets[0]?.fileName).toBe("clip.mp4");

    // Mensaje a Graph con type=document y filename original.
    expect(graphRequest).toHaveBeenCalledTimes(1);
    const sent = (graphRequest.mock.calls[0]![1] as { body: unknown }).body as {
      type: string;
      document: { id: string; filename?: string };
    };
    expect(sent.type).toBe("document");
    expect(sent.document.id).toBe("media-id-test");
    expect(sent.document.filename).toBe("clip.mp4");
  });

  it("pdf normal sin override se envía como document con su mime original (no se sobreescribe a octet-stream)", async () => {
    const { sendMediaMessage } = await import("@/server/inbox/send");
    const pdf = Buffer.from("%PDF-1.4");

    await sendMediaMessage({
      conversationId: "cv_1",
      organizationId: "org_1",
      file: { data: pdf, mimeType: "application/pdf", fileName: "reporte.pdf" },
    });

    const uploaded = uploadGraphMedia.mock.calls[0]![1] as { mimeType: string };
    expect(uploaded.mimeType).toBe("application/pdf");
    expect(insertedAssets[0]?.mimeType).toBe("application/pdf");
    expect(insertedAssets[0]?.kind).toBe("document");
  });

  it("override kind=document con video >100MB → too_large (no se relaja el límite)", async () => {
    const { sendMediaMessage } = await import("@/server/inbox/send");
    // 101 MB de video forzado a document: debe fallar la validación
    // contra el límite de document (100 MB), NO contra el de video.
    const huge = Buffer.alloc(101 * 1024 * 1024, 0);

    await expect(
      sendMediaMessage({
        conversationId: "cv_1",
        organizationId: "org_1",
        file: { data: huge, mimeType: "video/mp4", fileName: "huge.mp4" },
        kind: "document",
      })
    ).rejects.toMatchObject({ code: "too_large" });

    expect(uploadGraphMedia).not.toHaveBeenCalled();
    expect(saveMediaFile).not.toHaveBeenCalled();
  });

  it("override kind no permitido por ALLOWED_KIND_OVERRIDES → unsupported_type", async () => {
    // Forzamos `kind: "image"` aunque typecheck lo acepta como FileMediaKind.
    // El servidor lo rechaza porque "image" no está en ALLOWED_KIND_OVERRIDES.
    const { sendMediaMessage } = await import("@/server/inbox/send");
    await expect(
      sendMediaMessage({
        conversationId: "cv_1",
        organizationId: "org_1",
        file: { data: Buffer.from("x"), mimeType: "video/mp4", fileName: "x.mp4" },
        kind: "image" as never,
      })
    ).rejects.toMatchObject({ code: "unsupported_type" });
  });
  it.each([true, false])("media IA=%s conserva video/caption y cancelación compatible", async aiGenerated => {
    const { sendMediaMessage } = await import("@/server/inbox/send");
    await sendMediaMessage({ conversationId: "cv_1", organizationId: "org_1", aiGenerated,
      file: { data: Buffer.from("video"), mimeType: "video/mp4" }, caption: "Así funciona" });
    const sent = graphRequest.mock.calls[0]![1].body;
    expect(sent).toMatchObject({ type: "video", video: { caption: "Así funciona" } });
    expect(insertedAssets[0]?.caption).toBe("Así funciona");
    expect(insertedMessages.find(m => m.direction === "out")).toMatchObject({ origin: aiGenerated ? "ai" : "operator", aiGenerated, type: "video", text: null });
    expect(cancelFollowUpsOnManualReply).toHaveBeenCalledTimes(aiGenerated ? 0 : 1);
  });

  it.each(["upload", "graph", "missing-id"])("fallo %s conserva origin=ai sin cancelar follow-ups ni retry", async failure => {
    const { sendMediaMessage } = await import("@/server/inbox/send");
    if (failure === "upload") uploadGraphMedia.mockRejectedValue(new Error("upload"));
    if (failure === "graph") graphRequest.mockRejectedValue(new Error("Graph"));
    if (failure === "missing-id") graphRequest.mockResolvedValue({});
    await expect(sendMediaMessage({ conversationId: "cv_1", organizationId: "org_1", aiGenerated: true,
      file: { data: Buffer.from("video"), mimeType: "video/mp4" }, caption: "Demo" })).rejects.toThrow();
    expect(insertedMessages.find(m => m.direction === "out")).toMatchObject({ status: "failed", origin: "ai", aiGenerated: true });
    expect(cancelFollowUpsOnManualReply).not.toHaveBeenCalled();
    expect(uploadGraphMedia).toHaveBeenCalledTimes(1);
    expect(graphRequest).toHaveBeenCalledTimes(failure === "upload" ? 0 : 1);
  });

});
