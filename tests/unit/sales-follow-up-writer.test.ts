import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FollowUpWriterOutput,
  writeFollowUpText,
} from "@/server/sales/follow-ups/follow-up-writer";

const chatJson = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai", () => ({
  chatJson: (...args: unknown[]) => chatJson(...args),
}));

describe("FollowUpWriterOutput", () => {
  it("solo admite { text }; descarta acciones ejecutables", () => {
    const parsed = FollowUpWriterOutput.safeParse({
      text: "¿Seguimos?",
      action: "handoff",
      move_stage: "Cliente",
      lane: "human",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual({ text: "¿Seguimos?" });
    expect(parsed.data).not.toHaveProperty("action");
  });
});

describe("writeFollowUpText", () => {
  beforeEach(() => {
    chatJson.mockReset();
    chatJson.mockResolvedValue({
      ok: true,
      data: { text: "te retomo" },
      raw: "{}",
    });
  });

  it("no invoca a Jev: solo chatJson de redacción", async () => {
    const result = await writeFollowUpText({
      conversation: [{ from: "lead", text: "hola" }],
      reason: "awaiting_reply",
      attemptNumber: 1,
    });
    expect(result).toEqual({ ok: true, text: "te retomo" });
    expect(chatJson).toHaveBeenCalledOnce();
    const messages = chatJson.mock.calls[0]![1] as {
      role: string;
      content: string;
    }[];
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    expect(system).toMatch(/NO llamas a Jev/i);
    expect(system).toMatch(/seguimiento por silencio/);
    expect(system).not.toMatch(/evaluateJev/);
  });

  it("si el proveedor falla, no inventa texto", async () => {
    chatJson.mockResolvedValue({
      ok: false,
      error: "provider_error",
      detail: "timeout",
    });
    const result = await writeFollowUpText({
      conversation: [],
      reason: "after_price",
      attemptNumber: 2,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("provider_error");
  });
});
