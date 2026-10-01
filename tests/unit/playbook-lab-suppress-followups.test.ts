/**
 * T308 — Cuando `conversation.is_test=true`, el orquestador:
 *   - NO llama a `scheduleNextFollowUp` (cero filas en
 *     `sales_follow_up_job`).
 *   - invoca `deliverReply` sandbox (persistencia local sin WhatsApp).
 *
 * Esto aísla la corrida de Laboratorio de efectos secundarios
 * sobre la cola durable y la API real de Meta.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runSalesOrchestratorTurn } from "@/server/sales/orchestrator";
import { makeDecision } from "./sales-fixtures";

const evaluateJev = vi.hoisted(() => vi.fn());
const writeSalesReply = vi.hoisted(() => vi.fn());
const deliverReply = vi.hoisted(() => vi.fn());
const applyHandoff = vi.hoisted(() => vi.fn());
const buildJevSalesState = vi.hoisted(() => vi.fn());
const scheduleNextFollowUp = vi.hoisted(() => vi.fn());
const getPublishedConfigForOrg = vi.hoisted(() => vi.fn());

vi.mock("@/server/sales/client", () => ({ evaluateJev }));
vi.mock("@/server/sales/writer", () => ({ writeSalesReply }));
vi.mock("@/server/ai/delivery", () => ({ applyHandoff, deliverReply }));
vi.mock("@/server/sales/build-state", () => ({ buildJevSalesState }));
vi.mock("@/server/sales/follow-ups/store", () => ({ scheduleNextFollowUp }));
vi.mock("@/lib/sales/playbook/loader", () => ({
  getPublishedConfigForOrg,
  getConfigByVersionId: vi.fn().mockResolvedValue(null),
}));

const selectQueue: unknown[][] = [];
const leadPatches: Array<Record<string, unknown>> = [];

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
          where: () => ({
            then: (resolve: (v: unknown) => void) =>
              Promise.resolve([]).then(resolve),
            returning: () => Promise.resolve([]),
          }),
        };
      },
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }),
    }
  ),
}));

const STAGES = [
  { id: "st_new", name: "Nuevo", kind: "open" },
  { id: "st_chat", name: "En conversación", kind: "open" },
  { id: "st_int", name: "Interesado", kind: "open" },
  { id: "st_won", name: "Cliente", kind: "won" },
  { id: "st_lost", name: "Perdido", kind: "lost" },
];

const LEAD = {
  id: "ld_1",
  organizationId: "org_1",
  contactId: "ct_1",
  stageId: "st_new",
  automationLane: "auto",
  demoShownAt: null,
  pricePresentedAt: null,
  paymentInstructionsSentAt: null,
  humanRequestedAt: null,
  followUpCount: 0,
};

beforeEach(() => {
  evaluateJev.mockReset();
  writeSalesReply.mockReset();
  deliverReply.mockReset();
  applyHandoff.mockReset();
  buildJevSalesState.mockReset();
  scheduleNextFollowUp.mockReset();
  getPublishedConfigForOrg.mockReset();
  selectQueue.length = 0;
  leadPatches.length = 0;
});

describe("lab sandbox suppress follow-ups (T308)", () => {
  it("corrida is_test=true → NO crea filas en sales_follow_up_job y NO envía WhatsApp", async () => {
    getPublishedConfigForOrg.mockResolvedValue(null);
    selectQueue.push(
      [{ lead: { ...LEAD }, stage: STAGES[0] }],
      STAGES,
      [{ id: "ld_1", organizationId: "org_1", stageId: "st_new" }],
      STAGES
    );
    evaluateJev.mockResolvedValue({
      ok: true,
      decision: makeDecision({ nextAction: "ask_more_questions" }),
      snapshot: { answers: {} },
      requestId: "req_1",
      model: "jev-test",
    });
    writeSalesReply.mockResolvedValue({ ok: true, text: "mensaje de prueba" });
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
        conversation: [],
        product: { name: "x" },
        commercial_policy: {},
      },
      playbook: null,
    });

    await runSalesOrchestratorTurn({
      organizationId: "org_1",
      conversationId: "cv_1",
      conversation: {
        id: "cv_1",
        organizationId: "org_1",
        contactId: "ct_1",
        isTest: true,
        aiEnabled: true,
        handoffAt: null,
      } as never,
    });

    // Sandbox entrega localmente y suprime la cola durable.
    expect(scheduleNextFollowUp).not.toHaveBeenCalled();
    expect(deliverReply).toHaveBeenCalledWith(
      expect.objectContaining({ isTest: true }), "mensaje de prueba"
    );
  });

  it("corrida is_test=false → sigue creando follow-ups normalmente", async () => {
    getPublishedConfigForOrg.mockResolvedValue(null);
    selectQueue.push(
      [{ lead: { ...LEAD }, stage: STAGES[0] }],
      STAGES,
      [{ id: "ld_1", organizationId: "org_1", stageId: "st_new" }],
      STAGES
    );
    evaluateJev.mockResolvedValue({
      ok: true,
      decision: makeDecision({ nextAction: "ask_more_questions" }),
      snapshot: { answers: {} },
      requestId: "req_1",
      model: "jev-test",
    });
    writeSalesReply.mockResolvedValue({ ok: true, text: "mensaje real" });
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
        conversation: [],
        product: { name: "x" },
        commercial_policy: {},
      },
      playbook: null,
    });

    await runSalesOrchestratorTurn({
      organizationId: "org_1",
      conversationId: "cv_1",
      conversation: {
        id: "cv_1",
        organizationId: "org_1",
        contactId: "ct_1",
        isTest: false,
        aiEnabled: true,
        handoffAt: null,
      } as never,
    });

    expect(writeSalesReply).toHaveBeenCalledTimes(1);
    expect(deliverReply).toHaveBeenCalledTimes(1);
    expect(scheduleNextFollowUp).toHaveBeenCalledTimes(1);
  });
});
