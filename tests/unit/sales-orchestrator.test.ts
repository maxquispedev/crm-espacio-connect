import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDecision } from "./sales-fixtures";
import { matchSemanticStage } from "@/server/sales/orchestrator";
import type { schema } from "@/lib/db";

type Stage = typeof schema.pipelineStage.$inferSelect;

const graphRequest = vi.fn();
const evaluateJev = vi.hoisted(() => vi.fn());
const writeSalesReply = vi.hoisted(() => vi.fn());
const deliverReply = vi.hoisted(() => vi.fn());
const applyHandoff = vi.hoisted(() => vi.fn());
const buildJevSalesState = vi.hoisted(() => vi.fn());

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

vi.mock("@/server/sales/client", () => ({ evaluateJev }));
vi.mock("@/server/sales/writer", () => ({ writeSalesReply }));
vi.mock("@/server/ai/delivery", () => ({ applyHandoff, deliverReply }));
vi.mock("@/server/sales/build-state", () => ({ buildJevSalesState }));

const selectQueue: unknown[][] = [];
const leadPatches: Record<string, unknown>[] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        leadPatches.push(patch);
        return {
          where: () => {
            const chain = {
              returning: () => Promise.resolve([{}]),
              then: (resolve: (v: unknown) => void) =>
                Promise.resolve([{}]).then(resolve),
            };
            return chain;
          },
        };
      },
    }),
    insert: () => ({
      values: () => ({
        then: (resolve: (v: unknown) => void) => Promise.resolve([]).then(resolve),
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

const STAGES = [
  { id: "st_new", name: "Nuevo", kind: "open" },
  { id: "st_chat", name: "En conversación", kind: "open" },
  { id: "st_int", name: "Interesado", kind: "open" },
  { id: "st_won", name: "Cliente", kind: "won" },
  { id: "st_lost", name: "Perdido", kind: "lost" },
] as unknown as Stage[];

const LEAD = {
  id: "ld_1",
  organizationId: "org_1",
  contactId: "ct_1",
  stageId: "st_new",
  automationLane: "auto" as const,
  demoShownAt: null,
  pricePresentedAt: null,
  paymentInstructionsSentAt: null,
  humanRequestedAt: null,
  followUpCount: 0,
};

const CONVERSATION = {
  id: "cv_1",
  organizationId: "org_1",
  contactId: "ct_1",
  isTest: true,
  aiEnabled: true,
  handoffAt: null,
};

function queueHappyPath(nextAction: string, laneWas = "auto") {
  selectQueue.push(
    [{ lead: { ...LEAD, automationLane: laneWas }, stage: STAGES[0] }],
    STAGES,
    []
  );
  evaluateJev.mockResolvedValue({
    ok: true,
    decision: makeDecision({ nextAction: nextAction as never }),
    snapshot: { answers: {} },
    requestId: "req_1",
    model: "jev-test",
  });
  writeSalesReply.mockResolvedValue({ ok: true, text: "mensaje" });
  deliverReply.mockResolvedValue(true);
  buildJevSalesState.mockResolvedValue({
    ok: true,
    persist: {
      organizationId: "org_1",
      conversationId: "cv_1",
      contactId: "ct_1",
      leadId: "ld_1",
    },
    state: {
      conversation: [{ from: "lead", text: "hola" }],
      product: { name: "Vende Veloz 365" },
      commercial_policy: {},
    },
  });
}

describe("matchSemanticStage", () => {
  it("lost solo por kind=lost, nunca won", () => {
    expect(matchSemanticStage("lost", STAGES)?.id).toBe("st_lost");
    expect(matchSemanticStage("lost", STAGES)?.kind).toBe("lost");
    expect(matchSemanticStage("won", STAGES)).toBeUndefined();
  });
});

describe("runSalesOrchestratorTurn", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    leadPatches.length = 0;
    graphRequest.mockReset();
    evaluateJev.mockReset();
    writeSalesReply.mockReset();
    deliverReply.mockReset();
    applyHandoff.mockReset();
    buildJevSalesState.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("present_price persiste AUTO_CLOSE y precio solo tras entrega", async () => {
    queueHappyPath("present_price");
    const { runSalesOrchestratorTurn } = await import(
      "@/server/sales/orchestrator"
    );
    await runSalesOrchestratorTurn({
      organizationId: "org_1",
      conversationId: "cv_1",
      conversation: CONVERSATION as never,
    });

    const decisionPatch = leadPatches[0];
    expect(decisionPatch?.automationLane).toBe("auto_close");
    expect(decisionPatch?.stageId).not.toBe("st_won");
    expect(decisionPatch).not.toHaveProperty("pricePresentedAt");
    expect(leadPatches[1]?.pricePresentedAt).toBeInstanceOf(Date);
    expect(graphRequest).not.toHaveBeenCalled();
  });

  it("demo marca demoShownAt solo tras entrega", async () => {
    queueHappyPath("show_operations_demo");
    const { runSalesOrchestratorTurn } = await import(
      "@/server/sales/orchestrator"
    );
    await runSalesOrchestratorTurn({
      organizationId: "org_1",
      conversationId: "cv_1",
      conversation: CONVERSATION as never,
    });
    expect(leadPatches[0]).not.toHaveProperty("demoShownAt");
    expect(leadPatches[1]?.demoShownAt).toBeInstanceOf(Date);
  });

  it("si el writer falla, no se marca precio y el writer no decide", async () => {
    queueHappyPath("present_price");
    writeSalesReply.mockResolvedValue({
      ok: false,
      error: "provider_error",
      detail: "boom",
    });
    const { runSalesOrchestratorTurn } = await import(
      "@/server/sales/orchestrator"
    );
    await runSalesOrchestratorTurn({
      organizationId: "org_1",
      conversationId: "cv_1",
      conversation: CONVERSATION as never,
    });
    expect(deliverReply).not.toHaveBeenCalled();
    expect(leadPatches.some((p) => "pricePresentedAt" in p)).toBe(false);
    expect(applyHandoff).not.toHaveBeenCalled();
  });

  it("schedule_call → HUMAN + handoff commercial aun si el writer falla", async () => {
    queueHappyPath("schedule_call");
    writeSalesReply.mockResolvedValue({
      ok: false,
      error: "provider_error",
      detail: "boom",
    });
    const { runSalesOrchestratorTurn } = await import(
      "@/server/sales/orchestrator"
    );
    await runSalesOrchestratorTurn({
      organizationId: "org_1",
      conversationId: "cv_1",
      conversation: CONVERSATION as never,
    });
    expect(leadPatches[0]?.automationLane).toBe("human");
    expect(applyHandoff).toHaveBeenCalledWith("cv_1", "org_1", "commercial");
  });

  it("disqualify mueve a lost, nunca a won, y no inventa nextFollowUpAt", async () => {
    queueHappyPath("disqualify");
    const { runSalesOrchestratorTurn } = await import(
      "@/server/sales/orchestrator"
    );
    await runSalesOrchestratorTurn({
      organizationId: "org_1",
      conversationId: "cv_1",
      conversation: CONVERSATION as never,
    });
    expect(leadPatches[0]?.automationLane).toBe("stop");
    expect(leadPatches[0]?.stageId).toBe("st_lost");
    expect(leadPatches[0]?.stageId).not.toBe("st_won");
    expect(leadPatches[0]).not.toHaveProperty("nextFollowUpAt");
    expect(applyHandoff).not.toHaveBeenCalled();
  });

  it("WAIT no inventa nextFollowUpAt", async () => {
    queueHappyPath("schedule_follow_up");
    evaluateJev.mockResolvedValue({
      ok: true,
      decision: makeDecision({
        nextAction: "schedule_follow_up",
        buyingTiming: "future_season",
      }),
      snapshot: {},
    });
    const { runSalesOrchestratorTurn } = await import(
      "@/server/sales/orchestrator"
    );
    await runSalesOrchestratorTurn({
      organizationId: "org_1",
      conversationId: "cv_1",
      conversation: CONVERSATION as never,
    });
    expect(leadPatches[0]?.automationLane).toBe("wait");
    expect(leadPatches[0]?.followUpReason).toBe("future_season");
    expect(leadPatches[0]).not.toHaveProperty("nextFollowUpAt");
  });

  it("fallo de Jev preserva lane, sanitiza error y no llama al writer", async () => {
    selectQueue.push([{ lead: LEAD, stage: STAGES[0] }]);
    buildJevSalesState.mockResolvedValue({
      ok: true,
      persist: {
        organizationId: "org_1",
        conversationId: "cv_1",
        contactId: "ct_1",
        leadId: "ld_1",
      },
      state: { conversation: [] },
    });
    evaluateJev.mockResolvedValue({
      ok: false,
      error: "provider_error",
      detail: "Bearer super-secret-jev-token HTTP 500",
    });
    const { runSalesOrchestratorTurn } = await import(
      "@/server/sales/orchestrator"
    );
    await runSalesOrchestratorTurn({
      organizationId: "org_1",
      conversationId: "cv_1",
      conversation: CONVERSATION as never,
    });
    expect(writeSalesReply).not.toHaveBeenCalled();
    expect(applyHandoff).not.toHaveBeenCalled();
    expect(leadPatches).toHaveLength(1);
    expect(leadPatches[0]).not.toHaveProperty("automationLane");
    expect(String(leadPatches[0]?.lastJevError)).toContain("Bearer [redacted]");
    expect(String(leadPatches[0]?.lastJevError)).not.toContain(
      "super-secret-jev-token"
    );
  });

  it("STOP repetido no genera otra respuesta automática", async () => {
    queueHappyPath("disqualify", "stop");
    const { runSalesOrchestratorTurn } = await import(
      "@/server/sales/orchestrator"
    );
    await runSalesOrchestratorTurn({
      organizationId: "org_1",
      conversationId: "cv_1",
      conversation: CONVERSATION as never,
    });
    expect(writeSalesReply).not.toHaveBeenCalled();
    expect(leadPatches[0]?.automationLane).toBe("stop");
  });

  it("entrega fallida no marca demo ni precio", async () => {
    queueHappyPath("present_price");
    deliverReply.mockResolvedValue(false);
    const { runSalesOrchestratorTurn } = await import(
      "@/server/sales/orchestrator"
    );
    await runSalesOrchestratorTurn({
      organizationId: "org_1",
      conversationId: "cv_1",
      conversation: CONVERSATION as never,
    });
    expect(leadPatches.some((p) => "pricePresentedAt" in p)).toBe(false);
  });

  it("HUMAN por needs_human_call no marca demo aunque Jev sugirió demo", async () => {
    queueHappyPath("show_operations_demo");
    evaluateJev.mockResolvedValue({
      ok: true,
      decision: makeDecision({
        nextAction: "show_operations_demo",
        needsHumanNoul: 0.82,
      }),
      snapshot: { answers: { next_action: { choice: "show_operations_demo" } } },
      requestId: "req_1",
      model: "jev-test",
    });
    const { runSalesOrchestratorTurn } = await import(
      "@/server/sales/orchestrator"
    );
    await runSalesOrchestratorTurn({
      organizationId: "org_1",
      conversationId: "cv_1",
      conversation: CONVERSATION as never,
    });
    expect(leadPatches[0]?.automationLane).toBe("human");
    expect(applyHandoff).toHaveBeenCalledWith("cv_1", "org_1", "commercial");
    expect(leadPatches.some((p) => "demoShownAt" in p)).toBe(false);
    const snapshot = leadPatches[0]?.lastJevDecision as {
      decision: { nextAction: { choice: string } };
      plan: { nextAction: string };
    };
    expect(snapshot.decision.nextAction.choice).toBe("show_operations_demo");
    expect(snapshot.plan.nextAction).toBe("show_operations_demo");
  });
});
