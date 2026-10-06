import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SendError } from "@/server/inbox/send";

const selectQueue: unknown[][] = [];
const inserts: unknown[] = [];
const updates: Record<string, unknown>[] = [];
let capturedClaimSql = "";
let capturedClaimValues: unknown[] = [];
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
    const tagged = (strings: TemplateStringsArray, ...values: unknown[]) => {
      capturedClaimValues = values;
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
        const rows = updateRows ?? [{ id: "x" }];
        return {
          where: () => {
            const chain = {
              returning: () => Promise.resolve(rows),
              then: (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve),
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
const claimedAt = new Date("2026-09-20T12:00:01Z");

/**
 * 018 — reloj comercial explícito. Antes de este spec el worker usaba el reloj
 * real, así que estos tests dependían de la hora a la que se ejecutaban: un
 * caso que exige envío fallaría de madrugada y al mediodía. `America/Lima` es
 * UTC-5, de modo que 19:00Z son las 14:00 locales (dentro de la ventana) y
 * 07:00Z son las 02:00 (fuera).
 */
const NOW = new Date("2026-09-20T19:00:00Z"); // 14:00 Lima: permitido
const NIGHT = new Date("2026-09-20T07:00:00Z"); // 02:00 Lima: diferido a 09:00
const NEXT_ALLOWED = new Date("2026-09-20T14:00:00.000Z"); // 09:00 Lima del mismo día

/**
 * Cuando el update no toca fila (lease perdido, cancelación concurrente), el
 * mock devuelve una lista vacía: es lo que impide que un reschedule escriba
 * sobre un job que ya no es nuestro.
 */
let updateRows: Record<string, unknown>[] | null = null;

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
    claimed_at: claimedAt,
    message_id: null,
    error: null,
    created_at: due,
    updated_at: due,
    ...over,
  };
}

function mappedJob(over: Record<string, unknown> = {}) {
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
    claimedAt,
    messageId: null,
    error: null,
    createdAt: due,
    updatedAt: due,
    ...over,
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
    enabled: true,
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
  job?: Record<string, unknown>;
}) {
  selectQueue.push(
    [mappedJob(opts?.job)],
    [lead(opts?.lead)],
    [conversation(opts?.conversation)],
    [profile(opts?.profile)]
  );
  selectQueue.push(opts?.afterAnchor ? [{ id: "msg_later" }] : []);
}

/** loadTurns + loadKb + ensureEligibleToSend (reload + anchor). */
function queueOpenWindowSelects(opts?: {
  lead?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
  profile?: Record<string, unknown>;
  job?: Record<string, unknown>;
}) {
  selectQueue.push([], []); // turns, kb
  selectQueue.push(
    [mappedJob(opts?.job)],
    [lead(opts?.lead)],
    [conversation(opts?.conversation)],
    [profile(opts?.profile)],
    [] // no message after anchor
  );
}

describe("worker de follow-ups", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    inserts.length = 0;
    updates.length = 0;
    capturedClaimSql = "";
    capturedClaimValues = [];
    claimLocked = false;
    claimRows = [rawJob()];
    updateRows = null;
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
    queueContext();
    queueOpenWindowSelects();
    const { runDueFollowUps, CLAIM_LEASE_MS } = await import(
      "@/server/sales/follow-ups/worker"
    );
    await runDueFollowUps({ now: NOW });
    expect(capturedClaimSql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(capturedClaimSql).toMatch(/status = 'pending'/);
    expect(capturedClaimSql).toMatch(/status = 'processing'/);
    expect(CLAIM_LEASE_MS).toBe(10 * 60 * 1000);
  });

  it("claim usa reloj PostgreSQL y solo parámetros primitivos, nunca Date", async () => {
    claimRows = [];
    const { runDueFollowUps, CLAIM_LEASE_MS } = await import(
      "@/server/sales/follow-ups/worker"
    );
    await runDueFollowUps({ now: NOW });
    expect(capturedClaimValues).toEqual([CLAIM_LEASE_MS, 10]);
    expect(capturedClaimValues.some((value) => value instanceof Date)).toBe(false);
    expect(capturedClaimSql).toMatch(/claimed_at = date_trunc\('milliseconds', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)/);
    expect(capturedClaimSql).toMatch(/updated_at = date_trunc\('milliseconds', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)/);
    expect(capturedClaimSql).toMatch(/due_at <= \(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\)/);
    expect(capturedClaimSql).toMatch(/claimed_at < \(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'\) -/);
    for (const column of ["due_at", "anchor_at", "claimed_at", "created_at", "updated_at"]) {
      expect(capturedClaimSql).toContain(`job.${column} AT TIME ZONE 'UTC' AS ${column}`);
    }
    expect(capturedClaimSql).toContain("INTERVAL '1 millisecond'");
  });

  it("dos ticks concurrentes: solo un envío", async () => {
    queueContext();
    queueOpenWindowSelects();
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await Promise.all([runDueFollowUps({ now: NOW }), runDueFollowUps({ now: NOW })]);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(writeFollowUpText).toHaveBeenCalledTimes(1);
  });

  it("ventana abierta: writer + sender, job espera status sin count ni intento 2; no Jev", async () => {
    queueContext();
    queueOpenWindowSelects();
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: NOW });
    expect(writeFollowUpText).toHaveBeenCalledOnce();
    expect(sendText).toHaveBeenCalledOnce();
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(updates.some((u) => u.status === "sent")).toBe(false);
    expect(updates.some((u) => u.followUpCount === 1)).toBe(false);
    expect(inserts.some((v) => (v as { attemptNumber?: number }).attemptNumber === 2)).toBe(
      false
    );
  });

  it("ventana cerrada sin plantilla: blocked template_required, sin Graph text", async () => {
    queueContext({
      conversation: { lastInboundAt: new Date("2020-01-01T00:00:00Z") },
    });
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: NOW });
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
    await runDueFollowUps({ now: NOW });
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(updates.some((u) => u.status === "blocked")).toBe(true);
  });

  it("tercer intento aceptado espera status antes de Dormant", async () => {
    claimRows = [rawJob({ attempt_number: 3 })];
    queueContext({ job: { attemptNumber: 3 } });
    queueOpenWindowSelects({ job: { attemptNumber: 3 } });
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: NOW });
    expect(sendText).toHaveBeenCalledOnce();
    expect(inserts.some((v) => (v as { attemptNumber?: number }).attemptNumber === 4)).toBe(
      false
    );
    const dormant = updates.find((u) => u.followUpReason === "no_reply_exhausted");
    expect(dormant).toBeUndefined();
    expect(sendText.mock.calls[0]?.[0]).toMatchObject({ deliveryMetadata: { followUpJobId: "sfj_1" } });
  });

  it("scheduled_wait aceptado espera status y no crea intento 2", async () => {
    claimRows = [rawJob({ reason: "scheduled_wait", attempt_number: 1 })];
    queueContext({
      job: { reason: "scheduled_wait" },
      lead: { automationLane: "wait", followUpReason: "scheduled_wait" },
    });
    queueOpenWindowSelects({
      job: { reason: "scheduled_wait" },
      lead: { automationLane: "wait", followUpReason: "scheduled_wait" },
    });
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: NOW });
    expect(sendText).toHaveBeenCalledOnce();
    expect(inserts.filter((v) => (v as { reason?: string }).reason === "scheduled_wait")).toHaveLength(
      0
    );
    expect(updates.some((u) => u.nextFollowUpAt === null)).toBe(false);
  });

  it("handoff activo cancela y no envía", async () => {
    queueContext({ conversation: { handoffAt: new Date() } });
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: NOW });
    expect(sendText).not.toHaveBeenCalled();
    expect(updates.some((u) => u.status === "cancelled" && u.error === "handoff_active")).toBe(
      true
    );
  });

  it("salesFollowUpsEnabled=false no envía", async () => {
    queueContext({ profile: { salesFollowUpsEnabled: false } });
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: NOW });
    expect(sendText).not.toHaveBeenCalled();
    expect(updates.some((u) => u.error === "follow_ups_disabled")).toBe(true);
  });

  it("salesOrchestratorEnabled=false no envía", async () => {
    queueContext({
      profile: { salesFollowUpsEnabled: true, salesOrchestratorEnabled: false },
    });
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: NOW });
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
    await runDueFollowUps({ now: NOW });
    expect(sendText).not.toHaveBeenCalled();
    expect(updates.some((u) => u.followUpCount !== undefined)).toBe(false);
    const retry = updates.find((u) => u.status === "pending" && u.runAttempts === 1);
    expect(retry).toBeTruthy();
    expect(retry?.dueAt).toBeInstanceOf(Date);
    expect(updates.some((u) => u.nextFollowUpAt instanceof Date)).toBe(true);
    const leadDue = updates.find((u) => u.nextFollowUpAt instanceof Date);
    expect(leadDue?.nextFollowUpAt).toEqual(retry?.dueAt);
  });

  it("retry técnico: segundo tick no due_mismatch y reintenta el mismo attempt", async () => {
    queueContext();
    writeFollowUpText.mockResolvedValueOnce({
      ok: false,
      error: "provider_error",
      detail: "timeout",
    });
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: NOW });

    const retry = updates.find((u) => u.status === "pending" && u.runAttempts === 1);
    expect(retry?.dueAt).toBeInstanceOf(Date);
    const retryDueAt = retry!.dueAt as Date;

    // Segundo tick real del mismo job.
    updates.length = 0;
    inserts.length = 0;
    claimLocked = false;
    claimRows = [
      rawJob({
        due_at: retryDueAt,
        run_attempts: 1,
        status: "processing",
        claimed_at: claimedAt,
      }),
    ];
    writeFollowUpText.mockResolvedValue({ ok: true, text: "te retomo" });
    queueContext({
      job: {
        dueAt: retryDueAt,
        runAttempts: 1,
        attemptNumber: 1,
        claimedAt,
      },
      lead: { nextFollowUpAt: retryDueAt },
    });
    queueOpenWindowSelects({
      job: {
        dueAt: retryDueAt,
        runAttempts: 1,
        attemptNumber: 1,
        claimedAt,
      },
      lead: { nextFollowUpAt: retryDueAt },
    });

    await runDueFollowUps({ now: NOW });
    expect(updates.some((u) => u.error === "due_mismatch")).toBe(false);
    expect(sendText).toHaveBeenCalledOnce();
    expect(updates.some((u) => u.status === "sent")).toBe(false);
    expect(updates.some((u) => u.followUpCount === 1)).toBe(false);
  });

  it("agent profile.enabled=false no envía aunque orchestrator/follow-ups ON", async () => {
    queueContext({
      profile: {
        enabled: false,
        salesOrchestratorEnabled: true,
        salesFollowUpsEnabled: true,
      },
    });
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: NOW });
    expect(sendText).not.toHaveBeenCalled();
    expect(writeFollowUpText).not.toHaveBeenCalled();
    expect(updates.some((u) => u.error === "agent_disabled")).toBe(true);
  });

  it("carrera: inbound cancela durante writer → no sendText ni sent", async () => {
    queueContext();
    selectQueue.push([], []); // turns, kb

    let resolveWriter!: (v: { ok: true; text: string }) => void;
    writeFollowUpText.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveWriter = resolve;
        })
    );

    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    const tick = runDueFollowUps({ now: NOW });

    // Esperar a que el writer quede pendiente.
    await vi.waitFor(() => {
      expect(writeFollowUpText).toHaveBeenCalled();
    });

    // Simular cancel por inbound mientras el writer espera.
    selectQueue.push(
      [
        mappedJob({
          status: "cancelled",
          claimedAt: null,
          error: "inbound_message",
        }),
      ],
      [lead({ nextFollowUpAt: null })],
      [conversation()],
      [profile()],
      []
    );
    // Por si applyGateFailure intentara algo: marcar updates de cancelación existente.
    updates.push({ status: "cancelled", error: "inbound_message" });

    resolveWriter({ ok: true, text: "te retomo" });
    await tick;

    expect(sendText).not.toHaveBeenCalled();
    expect(updates.some((u) => u.status === "sent")).toBe(false);
    expect(
      updates.filter((u) => u.status === "cancelled").every(
        (u) => u.error === "inbound_message" || u.error === "job_not_processing"
      )
    ).toBe(true);
  });

  it("tras 3 run attempts falla y no reintenta infinito", async () => {
    claimRows = [rawJob({ run_attempts: 2 })];
    queueContext({ job: { runAttempts: 2 } });
    queueOpenWindowSelects({ job: { runAttempts: 2 } });
    sendText.mockRejectedValue(
      new SendError("meta_unavailable", "Graph 503")
    );
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: NOW });
    expect(updates.some((u) => u.status === "failed")).toBe(true);
    expect(updates.some((u) => u.status === "pending")).toBe(false);
    expect(updates.some((u) => u.followUpReason === "follow_up_failed")).toBe(true);
  });

  it("sandbox is_test no llama sendText ni sendTemplate", async () => {
    queueContext({ conversation: { isTest: true } });
    queueOpenWindowSelects({ conversation: { isTest: true } });
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: NOW });
    expect(sendText).not.toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(inserts.some((v) => (v as { direction?: string }).direction === "out")).toBe(
      true
    );
  });

  // ---------------------------------------------------------------------
  // 018 · horario comercial (segunda barrera, justo antes del outbound)
  // ---------------------------------------------------------------------

  it("02:00 Lima: ni writer, ni Graph, ni intento; vuelve a pending a las 09:00", async () => {
    queueContext();
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: NIGHT });

    expect(writeFollowUpText).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);

    const defer = updates.find((u) => u.error === "outside_business_hours");
    expect(defer).toBeTruthy();
    expect(defer?.status).toBe("pending");
    expect((defer?.dueAt as Date).toISOString()).toBe(NEXT_ALLOWED.toISOString());
    expect(defer?.claimedAt).toBeNull();
    // Un aplazamiento no es un fallo: nada de `failed` ni `blocked`.
    expect(updates.some((u) => u.status === "failed" || u.status === "blocked")).toBe(
      false
    );

    const leadPatch = updates.find((u) => u.nextFollowUpAt instanceof Date);
    expect(leadPatch?.nextFollowUpAt).toEqual(NEXT_ALLOWED);
  });

  it("aplazar por horario NO consume attempt_number ni run_attempts", async () => {
    claimRows = [rawJob({ attempt_number: 2, run_attempts: 1 })];
    queueContext({ job: { attemptNumber: 2, runAttempts: 1 } });
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: NIGHT });

    const defer = updates.find((u) => u.error === "outside_business_hours");
    expect(defer).toBeTruthy();
    // `runAttempts` ni siquiera se escribe: el valor anterior (1) se conserva.
    expect(Object.prototype.hasOwnProperty.call(defer!, "runAttempts")).toBe(false);
    expect(updates.some((u) => u.attemptNumber !== undefined)).toBe(false);
    // El intento comercial tampoco avanza: `followUpCount` es lo que lo cuenta.
    expect(updates.some((u) => u.followUpCount !== undefined)).toBe(false);
  });

  it("10:00 Lima: el mismo job se envía con normalidad", async () => {
    queueContext();
    queueOpenWindowSelects();
    const morning = new Date("2026-09-20T15:00:00Z"); // 10:00 Lima
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: morning });
    expect(writeFollowUpText).toHaveBeenCalledOnce();
    expect(sendText).toHaveBeenCalledOnce();
    expect(updates.some((u) => u.error === "outside_business_hours")).toBe(false);
  });

  it("20:30 Lima también se aplaza (límite superior exclusivo)", async () => {
    queueContext();
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: new Date("2026-09-21T01:30:00Z") });
    const defer = updates.find((u) => u.error === "outside_business_hours");
    expect(defer).toBeTruthy();
    expect((defer?.dueAt as Date).toISOString()).toBe("2026-09-21T14:00:00.000Z");
  });

  it("si el job ya no es nuestro, el aplazamiento no escribe ni en job ni en lead", async () => {
    queueContext();
    updateRows = [];
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: NIGHT });
    expect(updates.some((u) => u.nextFollowUpAt instanceof Date)).toBe(false);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("cancelación gana al horario: un job en handoff a las 02:00 se cancela", async () => {
    queueContext({ conversation: { handoffAt: new Date() } });
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: NIGHT });
    expect(updates.some((u) => u.status === "cancelled" && u.error === "handoff_active")).toBe(
      true
    );
    expect(updates.some((u) => u.error === "outside_business_hours")).toBe(false);
  });

  it("un retry que caería a las 20:05 se reprograma al día siguiente a las 09:00", async () => {
    // A las 19:50 la ventana sigue abierta, así que el writer corre y falla; el
    // retry caería 15 minutos después, ya de noche.
    queueContext();
    writeFollowUpText.mockResolvedValue({
      ok: false,
      error: "provider_error",
      detail: "timeout",
    });
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: new Date("2026-09-21T00:50:00Z") }); // 19:50 Lima

    const retry = updates.find((u) => u.status === "pending" && u.runAttempts === 1);
    expect(retry).toBeTruthy();
    expect((retry?.dueAt as Date).toISOString()).toBe("2026-09-21T14:00:00.000Z");
    expect(updates.find((u) => u.nextFollowUpAt instanceof Date)?.nextFollowUpAt).toEqual(
      new Date("2026-09-21T14:00:00.000Z")
    );
  });

  it("sandbox a las 02:00 tampoco sale: ni outbound local ni Graph", async () => {
    queueContext({ conversation: { isTest: true } });
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: NIGHT });
    expect(inserts).toHaveLength(0);
    expect(sendText).not.toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("claim de otra org no carga contexto (tenant)", async () => {
    selectQueue.push([]);
    const { runDueFollowUps } = await import("@/server/sales/follow-ups/worker");
    await runDueFollowUps({ now: NOW });
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

// These tests isolate legacy business/flag contracts; 017 safety has real-module regressions.
vi.mock("@/server/ai/turn-safety", async original => ({
  ...await original<object>(),
  captureTurnToken: async (organizationId: string, conversationId: string) => ({ organizationId, conversationId, inboundMessageId: "msg_1", manualMessageId: null }),
  readTurnInbound: async () => ({ id: "msg_1", type: "text" }),
  isTurnCurrent: async () => true,
  withCurrentTurn: async (_token: unknown, effect: (db: unknown) => Promise<unknown>) => effect((await import("@/lib/db")).getDb()),
}));
