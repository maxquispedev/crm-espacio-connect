import { beforeEach, describe, expect, it, vi } from "vitest";

import { runSalesOrchestratorTurn } from "@/server/sales/orchestrator";
import { makeDecision } from "./sales-fixtures";

const evaluateJev = vi.hoisted(() => vi.fn());
const writeSalesReply = vi.hoisted(() => vi.fn());
const deliverReply = vi.hoisted(() => vi.fn());
const applyHandoff = vi.hoisted(() => vi.fn());
const scheduleNextFollowUp = vi.hoisted(() => vi.fn());
const scopedSpy = vi.hoisted(() => vi.fn());
const getPublishedConfigForOrg = vi.hoisted(() => vi.fn());

vi.mock("@/server/sales/client", () => ({ evaluateJev }));
vi.mock("@/server/sales/writer", () => ({ writeSalesReply }));
vi.mock("@/server/ai/delivery", () => ({ applyHandoff, deliverReply }));
vi.mock("@/server/sales/follow-ups/store", () => ({ scheduleNextFollowUp }));
vi.mock("@/lib/db/tenant", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db/tenant")>();
  return { ...real, scoped: (...args: Parameters<typeof real.scoped>) => {
    scopedSpy(...args);
    return real.scoped(...args);
  } };
});
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
  scheduleNextFollowUp.mockReset();
  scopedSpy.mockClear();
  getPublishedConfigForOrg.mockReset();
  selectQueue.length = 0;
  leadPatches.length = 0;
});


import { VENDE_VELOZ_PRODUCT, VENDE_VELOZ_COMMERCIAL_POLICY, VENDE_VELOZ_OFFER } from "@/server/sales/vende-veloz";
import { JEV_SALES_QUESTIONS_V2 } from "@/server/sales/questions";
import { buildJevSalesState } from "@/server/sales/build-state";

function queueTurn(orgId: string, conversationId: string) {
  const conv = { ...CONVERSATION, id: conversationId, organizationId: orgId };
  const lead = { ...LEAD, organizationId: orgId, stageId: "st_int" };
  selectQueue.push(
    [{ conversation: conv, contact: { id: "ct_1" } }],
    [{ lead, stageName: "Interesado" }],
    [{ message: { direction: "in", text: "precio por favor" }, media: null }],
    [{ sourceType: "ad", headline: "Ordena tu academia", body: "Control de pagos" }],
    [{ lead, stage: STAGES[2] }],
    STAGES,
    [],
    [{ tone: "cercano", instructions: "Sé breve", escalationRules: "Pedido humano" }],
  );
  return conv;
}

function published(version: number) {
  return {
    id: `spv_${version}`, schema_version: "1.0.0", version_number: version,
    status: "published",
    config: {
      product: { name: `Producto publicado ${version}` },
      commercial_policy: { goal: "POLICY CUSTOM" },
      offer: { setup: 9999 },
      writer: { present_price: "WRITER CUSTOM" },
      jev_questions: { custom_question: { type: "score", instructions: "CUSTOM" } },
    },
  };
}

describe("lanzamiento: builder + orquestador + resolver reales", () => {
  it("Published V1 y publicación posterior no cambian defaults; conserva Meta, perfil, lane, CRM y follow-ups por tenant", async () => {
    evaluateJev.mockResolvedValue({ ok: true, decision: makeDecision({ nextAction: "present_price" }), snapshot: {} });
    writeSalesReply.mockResolvedValue({ ok: true, text: "Oferta conocida" });
    deliverReply.mockResolvedValue(true);
    for (const [orgId, version] of [["org_1", 1], ["org_1", 2], ["org_2", 3]] as const) {
      getPublishedConfigForOrg.mockResolvedValue(published(version));
      const conversationId = `cv_${version}`;
      const conv = queueTurn(orgId, conversationId);
      await runSalesOrchestratorTurn({ organizationId: orgId, conversationId, conversation: conv as never });
      expect(selectQueue).toHaveLength(0);
      expect(evaluateJev).toHaveBeenLastCalledWith({
        state: expect.objectContaining({
          product: VENDE_VELOZ_PRODUCT, commercial_policy: VENDE_VELOZ_COMMERCIAL_POLICY,
          source: "Meta Ads", ad_context: { source_type: "ad", headline: "Ordena tu academia", body: "Control de pagos" },
        }), questions: JEV_SALES_QUESTIONS_V2,
      });
      expect(writeSalesReply).toHaveBeenLastCalledWith(expect.objectContaining({
        product: VENDE_VELOZ_PRODUCT, policy: VENDE_VELOZ_COMMERCIAL_POLICY,
        offer: VENDE_VELOZ_OFFER, writerInstructions: undefined,
        plan: expect.objectContaining({ lane: "auto_close", nextAction: "present_price" }),
        agentProfile: { tone: "cercano", instructions: "Sé breve", escalationRules: "Pedido humano" },
      }));
      expect(deliverReply).toHaveBeenLastCalledWith(conv, "Oferta conocida");
      expect(scheduleNextFollowUp).toHaveBeenLastCalledWith(expect.objectContaining({ organizationId: orgId, conversationId, leadId: "ld_1" }));
      const patch = leadPatches.at(-2);
      expect(patch).toMatchObject({ automationLane: "auto_close", lastJevPlaybookVersionId: null, lastJevPlaybookSchemaVersion: null,
        lastJevDecision: expect.objectContaining({ playbook_version_id: null, playbook_schema_version: null, playbook_version_number: null }) });
      expect(leadPatches.at(-1)?.pricePresentedAt).toBeInstanceOf(Date);
      expect(scopedSpy.mock.calls.every((args) => args[1] === orgId)).toBe(true);
      scopedSpy.mockClear();
    }
    expect(getPublishedConfigForOrg).not.toHaveBeenCalled();
    expect(applyHandoff).not.toHaveBeenCalled();
  });

  it("tenant sin conversación accesible retorna not_found sin Jev, writer ni efectos", async () => {
    selectQueue.push([]);
    const result = await buildJevSalesState({ organizationId: "org_other", conversationId: "cv_1" });
    expect(result).toMatchObject({ ok: false, error: "not_found" });
    expect(scopedSpy).toHaveBeenCalledWith(expect.anything(), "org_other", expect.anything());
    expect(getPublishedConfigForOrg).not.toHaveBeenCalled();
    expect(evaluateJev).not.toHaveBeenCalled();
    expect(writeSalesReply).not.toHaveBeenCalled();
    expect(leadPatches).toHaveLength(0);
  });
});
