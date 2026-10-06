/**
 * T308 — Persistencia: el orquestador escribe
 * `last_jev_playbook_version_id`, `last_jev_playbook_schema_version`
 * y, dentro del JSONB `last_jev_decision`, las claves
 * `playbook_version_id`, `playbook_schema_version`,
 * `playbook_version_number`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runSalesOrchestratorTurn } from "@/server/sales/orchestrator";
import { makeDecision } from "./sales-fixtures";

const evaluateJev = vi.hoisted(() => vi.fn());
const writeSalesReply = vi.hoisted(() => vi.fn());
const deliverReply = vi.hoisted(() => vi.fn());
const applyHandoff = vi.hoisted(() => vi.fn());
const buildJevSalesState = vi.hoisted(() => vi.fn());
const getPublishedConfigForOrg = vi.hoisted(() => vi.fn());

vi.mock("@/server/sales/client", () => ({ evaluateJev }));
vi.mock("@/server/sales/writer", () => ({ writeSalesReply }));
vi.mock("@/server/ai/delivery", () => ({ applyHandoff, deliverReply }));
vi.mock("@/server/sales/build-state", () => ({ buildJevSalesState }));
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
            then: (resolve: (v: unknown) => void) => Promise.resolve([]).then(resolve),
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

const CONVERSATION = {
  id: "cv_1",
  organizationId: "org_1",
  contactId: "ct_1",
  isTest: false,
  aiEnabled: true,
  handoffAt: null,
};

beforeEach(() => {
  evaluateJev.mockReset();
  writeSalesReply.mockReset();
  deliverReply.mockReset();
  applyHandoff.mockReset();
  buildJevSalesState.mockReset();
  getPublishedConfigForOrg.mockReset();
  selectQueue.length = 0;
  leadPatches.length = 0;
});

describe("snapshot persistence (T308)", () => {
  it("playbook publicado → patch incluye last_jev_playbook_version_id y schema_version", async () => {
    getPublishedConfigForOrg.mockResolvedValue({
      id: "spv_published_v3",
      config: {
        schema_version: "1.2.0",
        product: { name: "Custom Product", one_liner: "x" },
        commercial_policy: {},
        offer: null,
        priorities: null,
        writer: null,
        jev_questions: null,
        prohibitions: null,
        handoff: null,
        urgency_rules: null,
      },
      schema_version: "1.2.0",
      version_number: 3,
      status: "published",
    });

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
    writeSalesReply.mockResolvedValue({ ok: true, text: null });
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
        product: { name: "Custom Product" },
        commercial_policy: {},
      },
      playbook: {
        id: "spv_published_v3",
        config: {
          schema_version: "1.2.0",
          product: { name: "Custom Product", one_liner: "x" },
          commercial_policy: {},
          offer: null,
          priorities: null,
          writer: null,
          jev_questions: null,
          prohibitions: null,
          handoff: null,
          urgency_rules: null,
        },
        schema_version: "1.2.0",
        version_number: 3,
        status: "published",
      },
    });

    await runSalesOrchestratorTurn({
      organizationId: "org_1",
      conversationId: "cv_1",
      conversation: CONVERSATION as never,
    });

    // El patch escrito en `lead` debe incluir las claves T308.
    const patch = leadPatches.find((p) =>
      "lastJevPlaybookVersionId" in p || "lastJevDecision" in p
    );
    expect(patch).toBeTruthy();
    expect(patch?.lastJevPlaybookVersionId).toBe("spv_published_v3");
    expect(patch?.lastJevPlaybookSchemaVersion).toBe("1.2.0");

    // El JSONB `lastJevDecision` debe tener las claves de auditoría.
    const decision = patch?.lastJevDecision as
      | Record<string, unknown>
      | undefined;
    expect(decision?.playbook_version_id).toBe("spv_published_v3");
    expect(decision?.playbook_schema_version).toBe("1.2.0");
    expect(decision?.playbook_version_number).toBe(3);
  });

  it("sin playbook → patch con version_id null", async () => {
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
    writeSalesReply.mockResolvedValue({ ok: true, text: null });
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
      conversation: CONVERSATION as never,
    });

    const patch = leadPatches.find((p) =>
      "lastJevPlaybookVersionId" in p || "lastJevDecision" in p
    );
    expect(patch?.lastJevPlaybookVersionId).toBeNull();
    expect(patch?.lastJevPlaybookSchemaVersion).toBeNull();
    const decision = patch?.lastJevDecision as
      | Record<string, unknown>
      | undefined;
    expect(decision?.playbook_version_id).toBeNull();
  });
});

// These tests isolate legacy business/flag contracts; 017 safety has real-module regressions.
vi.mock("@/server/ai/turn-safety", async original => ({
  ...await original<object>(),
  captureTurnToken: async (organizationId: string, conversationId: string) => ({ organizationId, conversationId, inboundMessageId: "msg_1", manualMessageId: null }),
  readTurnInbound: async () => ({ id: "msg_1", type: "text" }),
  isTurnCurrent: async () => true,
  withCurrentTurn: async (_token: unknown, effect: (db: unknown) => Promise<unknown>) => effect((await import("@/lib/db")).getDb()),
}));
vi.mock("@/server/sales/delivery-ledger", async original => ({ ...await original<object>(), reserveDemoSlot: async () => true }));
