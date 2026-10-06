import { beforeEach, describe, expect, it, vi } from "vitest";

const selectQueue: unknown[][] = [];
const inserts: unknown[] = [];
const leadPatches: Record<string, unknown>[] = [];
const jobUpdates: Record<string, unknown>[] = [];

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
    insert: () => ({
      values: (values: unknown) => {
        inserts.push(values);
        const row = { id: "sfj_1", status: "pending", ...(values as object) };
        return {
          returning: () => Promise.resolve([row]),
        };
      },
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        if ("status" in patch && patch.status === "cancelled") {
          jobUpdates.push(patch);
        } else {
          leadPatches.push(patch);
        }
        return {
          where: () => {
            const chain = {
              returning: () => Promise.resolve([{ id: "sfj_1" }]),
              then: (resolve: (v: unknown) => void) =>
                Promise.resolve([{ id: "sfj_1" }]).then(resolve),
            };
            return chain;
          },
        };
      },
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

vi.mock("@/lib/db/ids", () => ({
  newId: () => "sfj_1",
}));

const PLAN_AUTO = {
  lane: "auto" as const,
  nextAction: "ask_more_questions" as const,
  shouldReply: true,
};

const PROFILE_ON = {
  salesOrchestratorEnabled: true,
  salesFollowUpsEnabled: true,
};

describe("store de follow-ups", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    inserts.length = 0;
    leadPatches.length = 0;
    jobUpdates.length = 0;
  });

  it("AUTO con reply crea job pending intento 1", async () => {
    selectQueue.push([PROFILE_ON]);
    const { scheduleNextFollowUp } = await import(
      "@/server/sales/follow-ups/store"
    );
    const job = await scheduleNextFollowUp({
      organizationId: "org_1",
      leadId: "ld_1",
      conversationId: "cv_1",
      plan: PLAN_AUTO,
      anchorAt: new Date("2026-09-20T00:00:00Z"),
    });
    expect(job?.status).toBe("pending");
    expect(inserts[0]).toMatchObject({
      organizationId: "org_1",
      leadId: "ld_1",
      conversationId: "cv_1",
      reason: "awaiting_reply",
      attemptNumber: 1,
      status: "pending",
    });
    expect(leadPatches.at(-1)).toMatchObject({
      followUpCount: 0,
      followUpReason: "awaiting_reply",
    });
  });

  it("AUTO_CLOSE present_price → after_price", async () => {
    selectQueue.push([PROFILE_ON]);
    const { scheduleNextFollowUp } = await import(
      "@/server/sales/follow-ups/store"
    );
    await scheduleNextFollowUp({
      organizationId: "org_1",
      leadId: "ld_1",
      conversationId: "cv_1",
      plan: {
        lane: "auto_close",
        nextAction: "present_price",
        shouldReply: true,
      },
      anchorAt: new Date("2026-09-20T00:00:00Z"),
    });
    expect(inserts[0]).toMatchObject({ reason: "after_price", attemptNumber: 1 });
  });

  it("salesFollowUpsEnabled=false no crea job aunque orchestrator ON", async () => {
    selectQueue.push([
      { salesOrchestratorEnabled: true, salesFollowUpsEnabled: false },
    ]);
    const { scheduleNextFollowUp } = await import(
      "@/server/sales/follow-ups/store"
    );
    const job = await scheduleNextFollowUp({
      organizationId: "org_1",
      leadId: "ld_1",
      conversationId: "cv_1",
      plan: PLAN_AUTO,
      anchorAt: new Date("2026-09-20T00:00:00Z"),
    });
    expect(job).toBeNull();
    expect(inserts).toHaveLength(0);
    expect(leadPatches.some((p) => p.nextFollowUpAt != null)).toBe(false);
  });

  it("HUMAN / STOP / WAIT / shouldReply false no crean job", async () => {
    const { scheduleNextFollowUp } = await import(
      "@/server/sales/follow-ups/store"
    );
    const cases = [
      { ...PLAN_AUTO, lane: "human" as const },
      { ...PLAN_AUTO, lane: "stop" as const },
      { ...PLAN_AUTO, lane: "wait" as const },
      { ...PLAN_AUTO, shouldReply: false },
    ];
    for (const plan of cases) {
      const job = await scheduleNextFollowUp({
        organizationId: "org_1",
        leadId: "ld_1",
        conversationId: "cv_1",
        plan,
        anchorAt: new Date(),
      });
      expect(job).toBeNull();
    }
    expect(inserts).toHaveLength(0);
  });

  it("inbound cancela, pone count 0 y nextFollowUpAt null; DORMANT open → auto", async () => {
    selectQueue.push([
      {
        lead: {
          id: "ld_1",
          automationLane: "stop",
          followUpReason: "no_reply_exhausted",
        },
        pipelineKind: "open",
      },
    ]);
    const { resetFollowUpsOnInbound } = await import(
      "@/server/sales/follow-ups/store"
    );
    await resetFollowUpsOnInbound({ organizationId: "org_1", leadId: "ld_1" });
    expect(jobUpdates[0]?.status).toBe("cancelled");
    expect(leadPatches.at(-1)).toMatchObject({
      nextFollowUpAt: null,
      followUpCount: 0,
      automationLane: "auto",
      followUpReason: null,
    });
  });

  it("STOP lost + silencio no reactiva a auto", async () => {
    selectQueue.push([
      {
        lead: {
          id: "ld_1",
          automationLane: "stop",
          followUpReason: "no_reply_exhausted",
        },
        pipelineKind: "lost",
      },
    ]);
    const { resetFollowUpsOnInbound } = await import(
      "@/server/sales/follow-ups/store"
    );
    await resetFollowUpsOnInbound({ organizationId: "org_1", leadId: "ld_1" });
    const patch = leadPatches.at(-1);
    expect(patch).toMatchObject({
      nextFollowUpAt: null,
      followUpCount: 0,
    });
    expect(patch).not.toHaveProperty("automationLane");
  });

  it("respuesta manual cancela y no crea secuencia nueva", async () => {
    selectQueue.push([{ leadId: "ld_1" }]);
    const { cancelFollowUpsOnManualReply } = await import(
      "@/server/sales/follow-ups/store"
    );
    await cancelFollowUpsOnManualReply({
      organizationId: "org_1",
      conversationId: "cv_1",
    });
    expect(jobUpdates[0]?.status).toBe("cancelled");
    expect(leadPatches.at(-1)).toMatchObject({ nextFollowUpAt: null });
    expect(inserts).toHaveLength(0);
  });

  it("markDormant pone STOP + no_reply_exhausted y no toca stageId", async () => {
    const { markDormant } = await import("@/server/sales/follow-ups/store");
    await markDormant({ organizationId: "org_1", leadId: "ld_1" });
    const patch = leadPatches.at(-1);
    expect(patch).toMatchObject({
      automationLane: "stop",
      followUpReason: "no_reply_exhausted",
      nextFollowUpAt: null,
    });
    expect(patch).not.toHaveProperty("stageId");
  });

  it("programación manual futura es WAIT one-shot tenant-bound", async () => {
    selectQueue.push(
      [PROFILE_ON],
      [{ id: "ld_1", contactId: "ct_1", automationLane: "auto" }],
      [{ id: "cv_1", handoffAt: null }]
    );
    const { scheduleManualFollowUp } = await import(
      "@/server/sales/follow-ups/store"
    );
    const dueAt = new Date(Date.now() + 60_000);
    const result = await scheduleManualFollowUp({
      organizationId: "org_1",
      leadId: "ld_1",
      dueAt,
    });
    expect(result.ok).toBe(true);
    expect(inserts[0]).toMatchObject({
      organizationId: "org_1",
      reason: "scheduled_wait",
      attemptNumber: 1,
    });
    expect(leadPatches.at(-1)).toMatchObject({
      automationLane: "wait",
      followUpReason: "scheduled_wait",
    });
  });

  it("manual no programa HUMAN ni handoff ni fecha pasada", async () => {
    const { scheduleManualFollowUp } = await import(
      "@/server/sales/follow-ups/store"
    );
    const past = await scheduleManualFollowUp({
      organizationId: "org_1",
      leadId: "ld_1",
      dueAt: new Date(Date.now() - 1000),
    });
    expect(past).toEqual({ ok: false, error: "due_in_past" });

    selectQueue.push(
      [PROFILE_ON],
      [{ id: "ld_1", contactId: "ct_1", automationLane: "human" }]
    );
    const human = await scheduleManualFollowUp({
      organizationId: "org_1",
      leadId: "ld_1",
      dueAt: new Date(Date.now() + 60_000),
    });
    expect(human).toEqual({ ok: false, error: "human_lane" });

    selectQueue.push(
      [PROFILE_ON],
      [{ id: "ld_1", contactId: "ct_1", automationLane: "auto" }],
      [{ id: "cv_1", handoffAt: new Date() }]
    );
    const handoff = await scheduleManualFollowUp({
      organizationId: "org_1",
      leadId: "ld_1",
      dueAt: new Date(Date.now() + 60_000),
    });
    expect(handoff).toEqual({ ok: false, error: "handoff_active" });
    expect(inserts).toHaveLength(0);
  });

  it("manual rechaza si orchestrator u follow-ups OFF", async () => {
    const { scheduleManualFollowUp } = await import(
      "@/server/sales/follow-ups/store"
    );
    const dueAt = new Date(Date.now() + 60_000);

    selectQueue.push([
      { salesOrchestratorEnabled: false, salesFollowUpsEnabled: true },
    ]);
    const orchOff = await scheduleManualFollowUp({
      organizationId: "org_1",
      leadId: "ld_1",
      dueAt,
    });
    expect(orchOff).toEqual({ ok: false, error: "orchestrator_disabled" });

    selectQueue.push([
      { salesOrchestratorEnabled: true, salesFollowUpsEnabled: false },
    ]);
    const fuOff = await scheduleManualFollowUp({
      organizationId: "org_1",
      leadId: "ld_1",
      dueAt,
    });
    expect(fuOff).toEqual({ ok: false, error: "follow_ups_disabled" });
    expect(inserts).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // 018 · nivel 1: el `due_at` se normaliza al horario comercial
  // ---------------------------------------------------------------------

  it("anchor de día: el delay no mueve un due_at ya válido", async () => {
    selectQueue.push([PROFILE_ON]);
    const { scheduleNextFollowUp } = await import(
      "@/server/sales/follow-ups/store"
    );
    // 10:00 Lima + 6h = 16:00 Lima (09:00Z + 6h = 15:00Z → 10:00 local... se
    // ancla a las 09:00 Lima para que el resultado sea inequívoco).
    const job = await scheduleNextFollowUp({
      organizationId: "org_1",
      leadId: "ld_1",
      conversationId: "cv_1",
      plan: PLAN_AUTO,
      anchorAt: new Date("2026-09-20T14:00:00Z"), // 09:00 Lima
    });
    expect((job?.dueAt as Date).toISOString()).toBe("2026-09-20T20:00:00.000Z"); // 15:00 Lima
    expect(leadPatches.at(-1)?.nextFollowUpAt).toEqual(job?.dueAt);
  });

  it("anchor de noche: el intento 1 se difiere a las 09:00 del mismo día", async () => {
    selectQueue.push([PROFILE_ON]);
    const { scheduleNextFollowUp } = await import(
      "@/server/sales/follow-ups/store"
    );
    // 23:00 Lima + 6h = 05:00 del día siguiente, todavía de madrugada.
    const job = await scheduleNextFollowUp({
      organizationId: "org_1",
      leadId: "ld_1",
      conversationId: "cv_1",
      plan: PLAN_AUTO,
      anchorAt: new Date("2026-09-21T04:00:00Z"), // 23:00 Lima del 20
    });
    expect((job?.dueAt as Date).toISOString()).toBe("2026-09-21T14:00:00.000Z"); // 09:00 Lima
    // El resumen de UI sigue al job: mismo instante, sin desfase.
    expect(leadPatches.at(-1)?.nextFollowUpAt).toEqual(job?.dueAt);
  });

  it("el intento encadenado también se normaliza, sin perder el delay relativo", async () => {
    const { enqueueFollowUpAttempt } = await import(
      "@/server/sales/follow-ups/store"
    );
    // Intento 2: +18h desde las 04:00 Lima caen a las 22:00 del día siguiente.
    const job = await enqueueFollowUpAttempt({
      organizationId: "org_1",
      leadId: "ld_1",
      conversationId: "cv_1",
      reason: "awaiting_reply",
      attemptNumber: 2,
      anchorAt: new Date("2026-09-21T09:00:00Z"), // 04:00 Lima
    });
    expect((job?.dueAt as Date).toISOString()).toBe("2026-09-22T14:00:00.000Z"); // 09:00 Lima
    expect(leadPatches.at(-1)?.nextFollowUpAt).toEqual(job?.dueAt);
  });

  it("scheduled_wait conserva la fecha que eligió el operador, de noche y de día", async () => {
    const night = new Date("2026-09-21T08:00:00Z"); // 03:00 Lima
    selectQueue.push([PROFILE_ON]);
    selectQueue.push([{ id: "ld_1", contactId: "ct_1", automationLane: "auto" }]);
    selectQueue.push([{ id: "cv_1", handoffAt: null }]);
    const { scheduleManualFollowUp } = await import(
      "@/server/sales/follow-ups/store"
    );
    const result = await scheduleManualFollowUp({
      organizationId: "org_1",
      leadId: "ld_1",
      dueAt: night,
      now: new Date("2026-09-20T14:00:00Z"),
    });
    expect(result.ok).toBe(true);
    expect((inserts[0] as { dueAt: Date }).dueAt.toISOString()).toBe(
      "2026-09-21T08:00:00.000Z"
    );
    expect(leadPatches.at(-1)?.nextFollowUpAt).toEqual(night);
  });
});
