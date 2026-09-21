import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SendError } from "@/server/inbox/send";

const selectQueue: unknown[][] = [];
const inserts: unknown[] = [];
const updates: Record<string, unknown>[] = [];
let capturedClaimSql = "";
let claimLocked = false;
let claimRows: Record<string, unknown>[] = [];

const writeFollowUpText = vi.hoisted(() => vi.fn());
const sendText = vi.hoisted(() => vi.fn());
const sendTemplate = vi.hoisted(() => vi.fn());

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
  getSql: () => {
    const tagged = (strings: TemplateStringsArray) => {
      capturedClaimSql = strings.join(" ");
      if (claimLocked) return Promise.resolve([]);
      claimLocked = true;
      return Promise.resolve(claimRows);
    };
    return tagged;
  },
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: () => ({
      values: (values: unknown) => {
        inserts.push(values);
        const row = { id: "msg_fu", ...(values as object) };
        return { returning: () => Promise.resolve([row]) };
      },
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return {
          where: () => {
            const chain = {
              returning: () => Promise.resolve([{ id: "x" }]),
              then: (resolve: (v: unknown) => void) =>
                Promise.resolve([{ id: "x" }]).then(resolve),
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

vi.mock("@/lib/db/ids", () => ({ newId: () => "id_test" }));

vi.mock("@/server/sales/follow-ups/follow-up-writer", () => ({
  writeFollowUpText: (...args: unknown[]) => writeFollowUpText(...args),
}));

vi.mock("@/server/inbox/send", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/inbox/send")>();
  return { ...original, sendText: (...args: unknown[]) => sendText(...args) };
});

vi.mock("@/server/whatsapp/templates", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/whatsapp/templates")>();
  return {
    ...original,
    sendTemplate: (...args: unknown[]) => sendTemplate(...args),
  };
});

vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));

const due = new Date("2026-09-20T12:00:00Z");

function rawJob(over: Record<string, unknown> = {}) {
  return {
    id: "sfj_1",
    organization_id: "org_1",
    lead_id: "ld_1",
    conversation_id: "cv_1",
    reason: "awaiting_reply",
    attempt_number: 1,
    due_at: due,
    anchor_at: new Date("2026-09-20T06:00:00Z"),
    status: "processing",
    run_attempts: 0,
    claimed_at: new Date(),
    message_id: null,
    error: null,
    created_at: due,
    updated_at: due,
    ...over,
  };
}

function mappedJob() {
  return {
    id: "sfj_1",
    organizationId: "org_1",
    leadId: "ld_1",
    conversationId: "cv_1",
    reason: "awaiting_reply" as const,
    attemptNumber: 1,
    dueAt: due,
    anchorAt: new Date("2026-09-20T06:00:00Z"),
    status: "processing" as const,
    runAttempts: 0,
    claimedAt: new Date(),
    messageId: null,
    error: null,
    createdAt: due,
    updatedAt: due,
  };
}

function lead(over: Record<string, unknown> = {}) {
  return {
    id: "ld_1",
    organizationId: "org_1",
    contactId: "ct_1",
    stageId: "st_open",
    automationLane: "auto",
    nextFollowUpAt: due,
    followUpCount: 0,
    followUpReason: "awaiting_reply",
    lastJevDecision: null,
    pricePresentedAt: null,
    ...over,
  };
}

function conversation(over: Record<string, unknown> = {}) {
  return {
    id: "cv_1",
    organizationId: "org_1",
    contactId: "ct_1",
    isTest: false,
    aiEnabled: true,
    handoffAt: null,
    lastInboundAt: new Date(),
    ...over,
  };
}

function profile(over: Record<string, unknown> = {}) {
  return {
    id: "agp_1",
    organizationId: "org_1",
    salesOrchestratorEnabled: true,
    salesFollowUpsEnabled: true,
    salesFollowUpTemplateId: null,
    ...over,
  };
}

function queueContext(opts?: {
  lead?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
  profile?: Record<string, unknown>;
  afterAnchor?: boolean;
}) {
  selectQueue.push(
    [mappedJob()],
    [lead(opts?.lead)],
    [conversation(opts?.conversation)],
    [profile(opts?.profile)]
  );
  selectQueue.push(opts?.afterAnchor ? [{ id: "msg_later" }] : []);
}

describe("worker de follow-ups", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    inserts.length = 0;
    updates.length = 0;
    capturedClaimSql = "";
    claimLocked = false;
    claimRows = [rawJob()];
    writeFollowUpText.mockReset();
    sendText.mockReset();
    sendTemplate.mockReset();
    writeFollowUpText.mockResolvedValue({ ok: true, text: "te retomo" });
    sendText.mockResolvedValue({ messageId: "msg_sent" });
    sendTemplate.mockResolvedValue({ messageId: "msg_tpl" });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    const g = globalThis as unknown as { __voceroFollowUpTimer?: ReturnType<typeof setInterval> };
    if (g.__voceroFollowUpTimer) {
      clearInterval(g.__voceroFollowUpTimer);
      g.__voceroFollowUpTimer = undefined;
    }
    await Promise.resolve();
  });

  it("el claim usa SKIP LOCKED y recupera processing abandonado", async () => {
    selectQueue.push([mappedJob()], [lead()], [conversation()], [profile()], [], [], []);
    const { runDueFollowUps, CLAIM_LEASE_MS } = await import(
      "@/server/sales/follow-ups/worker"
    );
    await runDueFollowUps();
    expect(capturedClaimSql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(capturedClaimSql).toMatch(/status = 'pending'/);
    expect(capturedClaimSql).toMatch(/status = 'processing'/);
    expect(CLAIM_LEASE_MS).toBe(10 * 60 * 1000);
  });

  it("dos ticks concurrentes: solo un envío", async () => {
    queueContext();
    selectQueue.push([], []);
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await Promise.all([runDueFollowUps(), runDueFollowUps()]);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(writeFollowUpText).toHaveBeenCalledTimes(1);
  });

  it("ventana abierta: writer + sender, job sent, programa intento 2; no Jev", async () => {
    queueContext();
    selectQueue.push([], []);
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps();
    expect(writeFollowUpText).toHaveBeenCalledOnce();
    expect(sendText).toHaveBeenCalledOnce();
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(updates.some((u) => u.status === "sent")).toBe(true);
    expect(updates.some((u) => u.followUpCount === 1)).toBe(true);
    expect(inserts.some((v) => (v as { attemptNumber?: number }).attemptNumber === 2)).toBe(
      true
    );
  });

  it("ventana cerrada sin plantilla: blocked template_required, sin Graph text", async () => {
    queueContext({
      conversation: { lastInboundAt: new Date("2020-01-01T00:00:00Z") },
    });
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps();
    expect(sendText).not.toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(updates.some((u) => u.status === "blocked" && u.error === "template_required")).toBe(
      true
    );
    expect(updates.some((u) => u.followUpReason === "template_required")).toBe(true);
  });

  it("plantilla pending/con variables no se envía", async () => {
    queueContext({
      conversation: { lastInboundAt: new Date("2020-01-01T00:00:00Z") },
      profile: { salesFollowUpTemplateId: "tpl_1" },
    });
    selectQueue.push([{ id: "tpl_1", status: "pending", body: "Hola {{1}}" }]);
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps();
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(updates.some((u) => u.status === "blocked")).toBe(true);
  });

  it("tercer intento enviado → Dormant sin stageId lost", async () => {
    claimRows = [rawJob({ attempt_number: 3 })];
    selectQueue.push(
      [{ ...mappedJob(), attemptNumber: 3 }],
      [lead()],
      [conversation()],
      [profile()],
      [],
      [],
      []
    );
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps();
    expect(sendText).toHaveBeenCalledOnce();
    expect(inserts.some((v) => (v as { attemptNumber?: number }).attemptNumber === 4)).toBe(
      false
    );
    const dormant = updates.find((u) => u.followUpReason === "no_reply_exhausted");
    expect(dormant).toMatchObject({
      automationLane: "stop",
      followUpReason: "no_reply_exhausted",
      nextFollowUpAt: null,
    });
    expect(dormant).not.toHaveProperty("stageId");
  });

  it("scheduled_wait envía uno y no crea intento 2", async () => {
    claimRows = [rawJob({ reason: "scheduled_wait", attempt_number: 1 })];
    selectQueue.push(
      [{ ...mappedJob(), reason: "scheduled_wait" }],
      [lead({ automationLane: "wait", followUpReason: "scheduled_wait" })],
      [conversation()],
      [profile()],
      [],
      [],
      []
    );
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps();
    expect(sendText).toHaveBeenCalledOnce();
    expect(inserts.filter((v) => (v as { reason?: string }).reason === "scheduled_wait")).toHaveLength(
      0
    );
    expect(updates.some((u) => u.nextFollowUpAt === null)).toBe(true);
  });

  it("handoff activo cancela y no envía", async () => {
    queueContext({ conversation: { handoffAt: new Date() } });
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps();
    expect(sendText).not.toHaveBeenCalled();
    expect(updates.some((u) => u.status === "cancelled" && u.error === "handoff_active")).toBe(
      true
    );
  });

  it("salesFollowUpsEnabled=false no envía", async () => {
    queueContext({ profile: { salesFollowUpsEnabled: false } });
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps();
    expect(sendText).not.toHaveBeenCalled();
    expect(updates.some((u) => u.error === "follow_ups_disabled")).toBe(true);
  });

  it("salesOrchestratorEnabled=false no envía", async () => {
    queueContext({
      profile: { salesFollowUpsEnabled: true, salesOrchestratorEnabled: false },
    });
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps();
    expect(sendText).not.toHaveBeenCalled();
    expect(updates.some((u) => u.error === "follow_ups_disabled")).toBe(true);
  });

  it("error transitorio reprograma el mismo job sin consumir followUpCount", async () => {
    queueContext();
    writeFollowUpText.mockResolvedValue({
      ok: false,
      error: "provider_error",
      detail: "timeout",
    });
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps();
    expect(sendText).not.toHaveBeenCalled();
    expect(updates.some((u) => u.followUpCount !== undefined)).toBe(false);
    expect(updates.some((u) => u.status === "pending" && u.runAttempts === 1)).toBe(
      true
    );
  });

  it("tras 3 run attempts falla y no reintenta infinito", async () => {
    claimRows = [rawJob({ run_attempts: 2 })];
    selectQueue.push(
      [{ ...mappedJob(), runAttempts: 2 }],
      [lead()],
      [conversation()],
      [profile()],
      [],
      [],
      []
    );
    sendText.mockRejectedValue(
      new SendError("meta_unavailable", "Graph 503")
    );
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps();
    expect(updates.some((u) => u.status === "failed")).toBe(true);
    expect(updates.some((u) => u.status === "pending")).toBe(false);
    expect(updates.some((u) => u.followUpReason === "follow_up_failed")).toBe(true);
  });

  it("sandbox is_test no llama sendText ni sendTemplate", async () => {
    queueContext({ conversation: { isTest: true } });
    selectQueue.push([], []);
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps();
    expect(sendText).not.toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(inserts.some((v) => (v as { direction?: string }).direction === "out")).toBe(
      true
    );
  });

  it("claim de otra org no carga contexto (tenant)", async () => {
    selectQueue.push([]);
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps();
    expect(sendText).not.toHaveBeenCalled();
    expect(updates.some((u) => u.error === "context_missing")).toBe(true);
  });

  it("startSalesFollowUpWorker es idempotente ante HMR", async () => {
    claimRows = [];
    const { startSalesFollowUpWorker } = await import(
      "@/server/sales/follow-ups/worker"
    );
    startSalesFollowUpWorker();
    await Promise.resolve();
    startSalesFollowUpWorker();
    const g = globalThis as unknown as {
      __voceroFollowUpTimer?: ReturnType<typeof setInterval>;
    };
    expect(g.__voceroFollowUpTimer).toBeTruthy();
    const first = g.__voceroFollowUpTimer;
    startSalesFollowUpWorker();
    expect(g.__voceroFollowUpTimer).toBe(first);
  });
});
