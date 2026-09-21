import { beforeEach, describe, expect, it, vi } from "vitest";

const graphRequest = vi.fn();
const chatJson = vi.hoisted(() => vi.fn());
const runSalesOrchestratorTurn = vi.hoisted(() => vi.fn());

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

vi.mock("@/lib/ai", () => ({
  chatJson: (...args: unknown[]) => chatJson(...args),
}));

vi.mock("@/server/sales/orchestrator", () => ({
  runSalesOrchestratorTurn: (...args: unknown[]) =>
    runSalesOrchestratorTurn(...args),
}));

const selectQueue: unknown[][] = [];
const inserts: { values: unknown }[] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: () => ({
      values: (values: unknown) => {
        inserts.push({ values });
        const chain = {
          onConflictDoNothing: () => chain,
          returning: () => Promise.resolve([values]),
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve([values]).then(resolve),
        };
        return chain;
      },
    }),
    update: () => ({
      set: () => ({
        where: () => {
          const chain = {
            returning: () => Promise.resolve([{}]),
            then: (resolve: (v: unknown) => void) =>
              Promise.resolve([{}]).then(resolve),
          };
          return chain;
        },
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

const conversation = {
  id: "cv_1",
  organizationId: "org_1",
  contactId: "ct_1",
  isTest: true,
  aiEnabled: true,
  handoffAt: null,
  handoffReason: null,
  lastInboundAt: new Date(),
};

function profile(salesOn: boolean) {
  return {
    id: "agp_1",
    organizationId: "org_1",
    enabled: true,
    salesOrchestratorEnabled: salesOn,
    name: "Asistente",
    tone: null,
    instructions: null,
    escalationRules: null,
    greeting: null,
  };
}

const inbound = [
  { id: "msg_1", direction: "in", text: "hola", createdAt: new Date() },
];

describe("opt-in Sales Orchestrator en runAgentTurn", () => {
  beforeEach(() => {
    graphRequest.mockReset();
    chatJson.mockReset();
    runSalesOrchestratorTurn.mockReset();
    runSalesOrchestratorTurn.mockResolvedValue(undefined);
    chatJson.mockResolvedValue({
      ok: true,
      data: { action: "reply", text: "legacy" },
      raw: "{}",
    });
    selectQueue.length = 0;
    inserts.length = 0;
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  });

  it("OFF → ruta legacy (GPT) y no entra al orchestrator", async () => {
    selectQueue.push([conversation], [profile(false)], inbound, [], []);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");
    expect(runSalesOrchestratorTurn).not.toHaveBeenCalled();
    expect(chatJson).toHaveBeenCalledOnce();
  });

  it("ON → orchestrator y GPT legacy no decide move_stage/handoff", async () => {
    selectQueue.push([conversation], [profile(true)], inbound);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");
    expect(runSalesOrchestratorTurn).toHaveBeenCalledOnce();
    expect(chatJson).not.toHaveBeenCalled();
  });

  it("handoff activo (manual_reply) no dispara orchestrator ni GPT", async () => {
    selectQueue.push([
      {
        ...conversation,
        handoffAt: new Date(),
        handoffReason: "manual_reply",
      },
    ]);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");
    expect(runSalesOrchestratorTurn).not.toHaveBeenCalled();
    expect(chatJson).not.toHaveBeenCalled();
  });

  it("HUMAN con handoff commercial no genera otro turno automático", async () => {
    selectQueue.push([
      {
        ...conversation,
        handoffAt: new Date(),
        handoffReason: "commercial",
      },
    ]);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");
    expect(runSalesOrchestratorTurn).not.toHaveBeenCalled();
    expect(chatJson).not.toHaveBeenCalled();
    expect(graphRequest).not.toHaveBeenCalled();
  });

  it("pedido explícito de humano no pasa por Jev y hace handoff cliente", async () => {
    selectQueue.push(
      [conversation],
      [profile(true)],
      [
        {
          id: "msg_1",
          direction: "in",
          text: "quiero hablar con un humano",
          createdAt: new Date(),
        },
      ]
    );
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");
    expect(runSalesOrchestratorTurn).not.toHaveBeenCalled();
    expect(chatJson).not.toHaveBeenCalled();
  });
});
