import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  JEV_STATE_CONTEXT,
  trimConversation,
} from "@/server/sales/build-state";

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

describe("trimConversation", () => {
  it("conserva lo más reciente y recorta turnos antiguos", () => {
    const turns = Array.from({ length: 100 }, (_, i) => ({
      from: i % 2 === 0 ? ("lead" as const) : ("seller" as const),
      text: `turno-${i}`,
    }));
    const trimmed = trimConversation(turns);
    expect(trimmed.length).toBeLessThanOrEqual(JEV_STATE_CONTEXT.MAX_TURNS);
    expect(trimmed.at(-1)?.text).toBe("turno-99");
    expect(trimmed[0]?.text).toBe(`turno-${100 - trimmed.length}`);
  });

  it("recorta un turno excesivo y deja elipsis", () => {
    const huge = "x".repeat(JEV_STATE_CONTEXT.MAX_TURN_CHARS + 50);
    const [turn] = trimConversation([{ from: "lead", text: huge }]);
    expect(turn?.text.length).toBe(JEV_STATE_CONTEXT.MAX_TURN_CHARS + 1);
    expect(turn?.text.endsWith("…")).toBe(true);
  });
});

describe("buildJevSalesState", () => {
  beforeEach(() => {
    selectQueue.length = 0;
  });

  it("no incluye teléfono, email ni wa ids en el state que va a Jev", async () => {
    selectQueue.push(
      [
        {
          conversation: { id: "cv_1", organizationId: "org_1", contactId: "ct_1" },
          contact: {
            id: "ct_1",
            name: "Ana",
            phone: "5215512345678",
            email: "ana@secret.test",
            waIdentity: "bsuid:abc",
          },
        },
      ],
      [
        {
          lead: {
            id: "ld_1",
            automationLane: "auto",
            demoShownAt: null,
            pricePresentedAt: null,
            paymentInstructionsSentAt: null,
            humanRequestedAt: null,
            followUpCount: 0,
          },
          stageName: "Nuevo",
        },
      ],
      [
        {
          message: {
            direction: "in",
            text: "Hola, busco control de alumnos",
            type: "text",
          },
          media: null,
        },
      ]
    );

    const { buildJevSalesState } = await import("@/server/sales/build-state");
    const result = await buildJevSalesState({
      organizationId: "org_1",
      conversationId: "cv_1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.state);
    expect(serialized).not.toContain("5215512345678");
    expect(serialized).not.toContain("ana@secret.test");
    expect(serialized).not.toContain("bsuid:abc");
    expect(result.state).not.toHaveProperty("phone");
    expect(result.state).not.toHaveProperty("email");
    expect(result.state.conversation).toEqual([
      { from: "lead", text: "Hola, busco control de alumnos" },
    ]);
    expect(Object.keys(result.state)).toEqual([
      "product",
      "commercial_policy",
      "crm_state",
      "conversation",
    ]);
    expect(result.state).not.toHaveProperty("commercial_offer");
    expect(result.persist.leadId).toBe("ld_1");
  });

  it("mapea outbound a seller y no incluye commercial_offer", async () => {
    selectQueue.push(
      [
        {
          conversation: { id: "cv_1", organizationId: "org_1", contactId: "ct_1" },
          contact: { id: "ct_1" },
        },
      ],
      [],
      [
        {
          message: { direction: "out", text: "te ayudo", type: "text" },
          media: null,
        },
        {
          message: { direction: "in", text: "hola", type: "text" },
          media: null,
        },
      ]
    );

    const { buildJevSalesState } = await import("@/server/sales/build-state");
    const result = await buildJevSalesState({
      organizationId: "org_1",
      conversationId: "cv_1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.conversation).toEqual([
      { from: "lead", text: "hola" },
      { from: "seller", text: "te ayudo" },
    ]);
    expect(result.state).not.toHaveProperty("commercial_offer");
  });

  it("sin conversación del tenant → not_found, no lanza", async () => {
    selectQueue.push([]);
    const { buildJevSalesState } = await import("@/server/sales/build-state");
    const result = await buildJevSalesState({
      organizationId: "org_other",
      conversationId: "cv_missing",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_found");
  });
});
