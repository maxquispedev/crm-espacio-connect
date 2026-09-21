import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST template manual: cancelar follow-ups solo tras sendTemplate exitoso.
 * La cancelación vive en la ruta, no en sendTemplate genérico.
 */

const sendTemplate = vi.hoisted(() => vi.fn());
const cancelFollowUpsOnManualReply = vi.hoisted(() => vi.fn());
const requireSession = vi.hoisted(() => vi.fn());

vi.mock("@/server/whatsapp/templates", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/whatsapp/templates")>();
  return {
    ...original,
    sendTemplate: (...args: unknown[]) => sendTemplate(...args),
  };
});

vi.mock("@/server/sales/follow-ups/store", () => ({
  cancelFollowUpsOnManualReply: (...args: unknown[]) =>
    cancelFollowUpsOnManualReply(...args),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: (...args: unknown[]) => requireSession(...args),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

describe("POST /api/conversations/[id]/messages/template", () => {
  beforeEach(() => {
    sendTemplate.mockReset();
    cancelFollowUpsOnManualReply.mockReset();
    requireSession.mockReset();
    requireSession.mockResolvedValue({
      userId: "u_1",
      organizationId: "org_1",
    });
  });

  it("tras sendTemplate OK cancela follow-ups", async () => {
    sendTemplate.mockResolvedValue({ messageId: "msg_tpl" });
    const { POST } = await import(
      "@/app/api/conversations/[id]/messages/template/route"
    );
    const res = await POST(
      new Request("http://localhost/api/conversations/cv_1/messages/template", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: "tpl_1" }),
      }),
      { params: Promise.resolve({ id: "cv_1" }) }
    );
    expect(res.status).toBe(200);
    expect(cancelFollowUpsOnManualReply).toHaveBeenCalledWith({
      organizationId: "org_1",
      conversationId: "cv_1",
    });
  });

  it("si sendTemplate falla NO cancela", async () => {
    const { TemplateError } = await import("@/server/whatsapp/templates");
    sendTemplate.mockRejectedValue(
      new TemplateError("meta_unavailable", "Graph 503")
    );
    const { POST } = await import(
      "@/app/api/conversations/[id]/messages/template/route"
    );
    const res = await POST(
      new Request("http://localhost/api/conversations/cv_1/messages/template", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: "tpl_1" }),
      }),
      { params: Promise.resolve({ id: "cv_1" }) }
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(cancelFollowUpsOnManualReply).not.toHaveBeenCalled();
  });
});
