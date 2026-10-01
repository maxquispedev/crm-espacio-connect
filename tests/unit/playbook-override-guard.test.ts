/**
 * T306 — Override de playbook SOLO en `is_test=true`. El orquestador
 * lanza excepción si llega `playbookOverride` y `is_test=false`.
 * En `is_test=true`, el override carga la versión solicitada y la
 * usa para el state + writer + set activo de preguntas.
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
const getConfigByVersionId = vi.hoisted(() => vi.fn());

vi.mock("@/server/sales/client", () => ({ evaluateJev }));
vi.mock("@/server/sales/writer", () => ({ writeSalesReply }));
vi.mock("@/server/ai/delivery", () => ({ applyHandoff, deliverReply }));
vi.mock("@/server/sales/build-state", () => ({ buildJevSalesState }));
vi.mock("@/lib/sales/playbook/loader", () => ({
  getPublishedConfigForOrg,
  getConfigByVersionId,
}));

const selectQueue: unknown[][] = [];

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
      set: () => ({
        where: () => ({
          then: (resolve: (v: unknown) => void) => Promise.resolve([]).then(resolve),
          returning: () => Promise.resolve([]),
        }),
      }),
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
  getPublishedConfigForOrg.mockReset();
  getConfigByVersionId.mockReset();
  selectQueue.length = 0;
});

describe("playbook override guard (T306)", () => {
  it("override con is_test=false → throws 'playbook_override_forbidden_in_production'", async () => {
    getPublishedConfigForOrg.mockResolvedValue(null);
    await expect(
      runSalesOrchestratorTurn(
        {
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
        },
        { playbookOverride: { versionId: "spv_draft_v1" } }
      )
    ).rejects.toThrow("playbook_override_forbidden_in_production");

    // No debe llamar a getConfigByVersionId ni al state en este caso.
    expect(getConfigByVersionId).not.toHaveBeenCalled();
  });

  it("override con is_test=true → acepta y carga la versión solicitada", async () => {
    getPublishedConfigForOrg.mockResolvedValue(null);
    getConfigByVersionId.mockResolvedValue({
      id: "spv_draft_v1",
      config: {
        schema_version: "1",
        product: { name: "Override Product", one_liner: "x" },
        commercial_policy: {},
        offer: null,
        priorities: null,
        writer: null,
        jev_questions: null,
        prohibitions: null,
        handoff: null,
        urgency_rules: null,
      },
      schema_version: "1",
      version_number: 1,
      status: "draft",
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
        product: { name: "Published Product" },
        commercial_policy: {},
      },
      playbook: null, // build-state no encuentra publicada
    });

    await runSalesOrchestratorTurn(
      {
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
      },
      { playbookOverride: { versionId: "spv_draft_v1" } }
    );

    // El override DEBE haber sido cargado desde el loader.
    expect(getConfigByVersionId).toHaveBeenCalledWith("org_1", "spv_draft_v1");
    // Y la decisión DEBE haberse evaluado con el set activo (no
    // necesariamente con override, pero sí con evaluateJev).
    expect(evaluateJev).toHaveBeenCalledTimes(1);
  });
});
