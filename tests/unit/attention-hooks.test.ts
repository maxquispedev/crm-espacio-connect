import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { createMemDb, type Row, type Tables } from "../fixtures/mem-db";

/**
 * 013 C1 — Los seis puntos de estrangulamiento (plan §3.5) con el módulo de
 * atención REAL y `scoped()` REAL; solo los colaboradores externos (Graph,
 * eventos, identidad, motor de follow-ups) y el ejecutor de BD son dobles.
 *
 * Lo que se comprueba aquí es lo que NO se puede ver en el módulo solo:
 *  - el enganche se dispara en el choke point correcto y con el estado correcto;
 *  - `markRead` NO toca la atención (abrir no resuelve);
 *  - un fallo al escribir la atención NO tumba el envío, la ingesta ni la
 *    etapa (best-effort, plan §3.5/§8).
 */

const graphRequest = vi.hoisted(() => vi.fn());
const publish = vi.hoisted(() => vi.fn());
const publishMessageNew = vi.hoisted(() => vi.fn());
const cancelFollowUpsOnManualReply = vi.hoisted(() => vi.fn());
const maybeRunAgentTurn = vi.hoisted(() => vi.fn());
const onLeadActivity = vi.hoisted(() => vi.fn());
const getCredentialsByOrg = vi.hoisted(() => vi.fn());
const getCredentialsByPhoneNumberId = vi.hoisted(() => vi.fn());
const getOrCreateContactByIdentity = vi.hoisted(() => vi.fn());
const resolveIdentity = vi.hoisted(() => vi.fn());
const uploadGraphMedia = vi.hoisted(() => vi.fn());
const saveMediaFile = vi.hoisted(() => vi.fn());
const ensureAssetAvailable = vi.hoisted(() => vi.fn());
const yaExisteAnuncio = vi.hoisted(() => vi.fn());
const registrarAnuncioDeOrigen = vi.hoisted(() => vi.fn());
const anuncioPorSourceId = vi.hoisted(() => vi.fn());
const guardarCreativo = vi.hoisted(() => vi.fn());
const applyStatusUpdate = vi.hoisted(() => vi.fn());

const tables: Tables = {
  conversation: [],
  conversation_attention: [],
  message: [],
  lead: [],
  pipeline_stage: [],
  sales_outbound_delivery: [], sales_demo_reservation: [], wa_status_receipt: [],
  agent_profile: [], sales_follow_up_job: [],
};
const real = createMemDb(tables);

/** Fila enlatada para el innerJoin de `prepareSend` (conversation + contact). */
const sendTarget = {
  conversation: { id: "cv_1", organizationId: "org_a", isTest: false, lastInboundAt: new Date() },
  contact: { id: "ct_1", phone: "5215511111111", waUserId: null },
};

const db = {
  ...real,
  select: () => ({
    from: (table: unknown) => {
      const chain = real.select().from(table) as Record<string | symbol, unknown>;
      return {
        ...chain,
        // `prepareSend` une conversation + contact; el doble no interpreta
        // joins, así que esa query se sirve enlatada. Cualquier otra (atención,
        // `updateConversation`, gateway) usa el doble real con `scoped()`.
        innerJoin: () => ({
          where: () => ({ limit: async () => [{ ...sendTarget }] }),
          then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([{ ...sendTarget }]).then(resolve),
        }),
      };
    },
  }),
};

vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  getDb: () => db,
}));
vi.mock("@/server/events/bus", () => ({ publish }));
vi.mock("@/server/events/message-new", () => ({ publishMessageNew }));
vi.mock("@/server/sales/follow-ups/store", () => ({
  cancelFollowUpsOnManualReply: (...args: unknown[]) => cancelFollowUpsOnManualReply(...args),
}));
vi.mock("@/server/ai/trigger", () => ({ maybeRunAgentTurn }));
vi.mock("@/server/inbox/lead-activity", () => ({ onLeadActivity }));
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: (...args: unknown[]) => getCredentialsByOrg(...args),
  getCredentialsByPhoneNumberId: (...args: unknown[]) => getCredentialsByPhoneNumberId(...args),
  markReconnectRequired: vi.fn(),
}));
vi.mock("@/server/inbox/identity", () => ({
  getOrCreateContactByIdentity: (...args: unknown[]) => getOrCreateContactByIdentity(...args),
  resolveIdentity: (...args: unknown[]) => resolveIdentity(...args),
}));
vi.mock("@/server/whatsapp/media", () => ({
  uploadGraphMedia: (...args: unknown[]) => uploadGraphMedia(...args),
  saveMediaFile: (...args: unknown[]) => saveMediaFile(...args),
  ensureAssetAvailable: (...args: unknown[]) => ensureAssetAvailable(...args),
  deleteMediaFile: vi.fn(),
}));
vi.mock("@/server/attribution/store", () => ({
  yaExisteAnuncio: (...args: unknown[]) => yaExisteAnuncio(...args),
  registrarAnuncioDeOrigen: (...args: unknown[]) => registrarAnuncioDeOrigen(...args),
  anuncioPorSourceId: (...args: unknown[]) => anuncioPorSourceId(...args),
}));
vi.mock("@/server/attribution/creativo", () => ({ guardarCreativo }));
vi.mock("@/server/attribution/referral", () => ({ anuncioDeWhatsapp: () => null }));
vi.mock("@/server/inbox/status", async original => ({ ...await original<object>(), applyStatusUpdate }));
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return {
    ...original,
    graphRequest,
    normalizeRecipient: (phone: string) => phone.replace(/\D/g, ""),
  };
});

const { applyHandoff } = await import("@/server/ai/delivery");
const { updateConversation } = await import("@/server/inbox/queries");
const { moveLeadStage, StageGatewayError } = await import("@/server/leads/stage-gateway");
const { processEchoesValue, ingestInboundMessage } = await import("@/server/inbox/ingest");
const { sendText } = await import("@/server/inbox/send");
const { getAttention, scheduleHumanReminder } = await import("@/server/inbox/attention");

const ORG_A = "org_a";
const ORG_B = "org_b";
const MIN = 60_000;

function seedConversation(input: {
  id?: string;
  organizationId?: string;
  contactId?: string;
  handoff?: boolean;
  aiEnabled?: boolean;
}) {
  const row = {
    id: input.id ?? "cv_1",
    organizationId: input.organizationId ?? ORG_A,
    contactId: input.contactId ?? "ct_1",
    isTest: false,
    handoffAt: input.handoff ? new Date("2026-10-05T11:00:00Z") : null,
    handoffReason: input.handoff ? "cliente" : null,
    aiEnabled: input.aiEnabled ?? true,
    lastInboundAt: new Date(),
    lastMessageAt: null,
    unreadCount: 0,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-05T11:00:00Z"),
  } as Row;
  tables.conversation!.push(row);
  tables.message!.push({ id: `in_${row.id}`, organizationId: row.organizationId,
    conversationId: row.id, direction: "in", type: "text", text: "Hola", createdAt: new Date(), status: "delivered" });
  row.latestInboundMessageId = `in_${row.id}`;
  tables.agent_profile!.push({ organizationId: row.organizationId, enabled: true });
  return row;
}

const attentionRows = () => tables.conversation_attention!;
const attentionOf = (conversationId: string) =>
  attentionRows().find((row) => row.conversationId === conversationId);

beforeEach(() => {
  for (const bucket of Object.values(tables)) bucket!.length = 0;
  for (const mock of [
    graphRequest, publish, publishMessageNew, cancelFollowUpsOnManualReply,
    maybeRunAgentTurn, onLeadActivity, getCredentialsByOrg,
    getCredentialsByPhoneNumberId, getOrCreateContactByIdentity, resolveIdentity,
    uploadGraphMedia, saveMediaFile, ensureAssetAvailable, yaExisteAnuncio,
    registrarAnuncioDeOrigen, anuncioPorSourceId, guardarCreativo, applyStatusUpdate,
  ]) {
    mock.mockReset();
  }
  graphRequest.mockResolvedValue({ messages: [{ id: "wamid.1" }] });
  getCredentialsByOrg.mockResolvedValue({ organizationId: ORG_A, phoneNumberId: "pn_1", token: "tok" });
  getCredentialsByPhoneNumberId.mockResolvedValue({ organizationId: ORG_A });
  getOrCreateContactByIdentity.mockResolvedValue({
    contact: { id: "ct_1", organizationId: ORG_A, name: "Ana", phone: "5511111111" },
  });
  resolveIdentity.mockReturnValue({ identity: "5215511111111", phone: "5215511111111", waUserId: null, profileName: "Ana" });
  saveMediaFile.mockResolvedValue("org_a/x.jpg");
  onLeadActivity.mockResolvedValue(undefined);
  maybeRunAgentTurn.mockResolvedValue(undefined);
  cancelFollowUpsOnManualReply.mockResolvedValue(2);
  yaExisteAnuncio.mockResolvedValue(true);
});

describe("013 C1 — enganche 1: applyHandoff (IA -> humano)", () => {
  it("deja la conversación en pending y publica el evento como siempre", async () => {
    seedConversation({ id: "cv_h" });
    await applyHandoff("cv_h", ORG_A, "cliente");
    expect(attentionOf("cv_h")).toMatchObject({
      organizationId: ORG_A,
      conversationId: "cv_h",
      state: "pending",
      dueAt: null,
    });
    expect(publish).toHaveBeenCalledWith(
      ORG_A,
      expect.objectContaining({ type: "conversation.updated" })
    );
  });

  it("es idempotente: un segundo handoff no duplica fila", async () => {
    seedConversation({ id: "cv_h" });
    await applyHandoff("cv_h", ORG_A, "cliente");
    await applyHandoff("cv_h", ORG_A, "commercial");
    expect(attentionRows()).toHaveLength(1);
  });

  it("best-effort: si la atención falla, el handoff sigue hecho", async () => {
    seedConversation({ id: "cv_h" });
    const insert = db.insert;
    db.insert = ((table: unknown) => {
      if (getTableName(table as never) === "conversation_attention") {
        throw new Error("atención caído");
      }
      return insert(table);
    }) as typeof db.insert;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await expect(applyHandoff("cv_h", ORG_A, "cliente")).resolves.toBeUndefined();
      const conversation = tables.conversation!.find((row) => row.id === "cv_h")!;
      expect(conversation.handoffAt).not.toBeNull();
      expect(publish).toHaveBeenCalled();
    } finally {
      db.insert = insert;
      warn.mockRestore();
    }
  });

  it("no toca conversaciones de otra organización", async () => {
    seedConversation({ id: "cv_b", organizationId: ORG_B });
    await applyHandoff("cv_b", ORG_A, "cliente");
    expect(attentionRows()).toHaveLength(0);
  });
});

describe("013 C1 — enganche 2/3: updateConversation", () => {
  it("reactivar la IA limpia la atención pendiente", async () => {
    seedConversation({ id: "cv_r", handoff: true });
    await scheduleHumanReminder({
      organizationId: ORG_A,
      conversationId: "cv_r",
      dueAt: new Date(Date.now() + 24 * 60 * MIN),
    });
    expect(attentionRows()).toHaveLength(1);

    const updated = await updateConversation(ORG_A, "cv_r", { reactivate: true });
    expect(updated?.handoffAt).toBeNull();
    expect(attentionRows()).toHaveLength(0);
  });

  it("desactivar la IA deja la conversación pendiente", async () => {
    seedConversation({ id: "cv_off", handoff: true });
    await updateConversation(ORG_A, "cv_off", { aiEnabled: false });
    expect(attentionOf("cv_off")).toMatchObject({ state: "pending" });
  });

  it("desactivar la IA SIN handoff también deja pendiente (spec §3.4)", async () => {
    seedConversation({ id: "cv_off2" });
    await updateConversation(ORG_A, "cv_off2", { aiEnabled: false });
    expect(attentionOf("cv_off2")).toMatchObject({ state: "pending" });
  });

  it("reactivate gana si llegan las dos señales a la vez", async () => {
    seedConversation({ id: "cv_both", handoff: true });
    await updateConversation(ORG_A, "cv_both", { aiEnabled: false });
    expect(attentionRows()).toHaveLength(1);
    await updateConversation(ORG_A, "cv_both", { reactivate: true, aiEnabled: false });
    expect(attentionRows()).toHaveLength(0);
  });

  it("markRead NO toca la atención: abrir no resuelve (spec §3.4)", async () => {
    seedConversation({ id: "cv_read", handoff: true });
    await applyHandoff("cv_read", ORG_A, "cliente");
    expect(attentionOf("cv_read")).toMatchObject({ state: "pending" });

    const updated = await updateConversation(ORG_A, "cv_read", { markRead: true });
    expect(updated?.unreadCount).toBe(0);
    expect(attentionOf("cv_read")).toMatchObject({ state: "pending" });
    expect(attentionRows()).toHaveLength(1);
  });

  it("best-effort: si la atención falla, marcar leída no tumba la actualización", async () => {
    seedConversation({ id: "cv_read2", handoff: true });
    const insert = db.insert;
    db.insert = ((table: unknown) => {
      if (getTableName(table as never) === "conversation_attention") {
        throw new Error("atención caído");
      }
      return insert(table);
    }) as typeof db.insert;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const updated = await updateConversation(ORG_A, "cv_read2", { aiEnabled: false });
      expect(updated?.aiEnabled).toBe(false);
    } finally {
      db.insert = insert;
      warn.mockRestore();
    }
  });

  it("cross-tenant: no actualiza ni crea atención en la conversación ajena", async () => {
    seedConversation({ id: "cv_b", organizationId: ORG_B, handoff: true });
    expect(await updateConversation(ORG_A, "cv_b", { aiEnabled: false })).toBeNull();
    expect(await updateConversation(ORG_A, "cv_b", { reactivate: true })).toBeNull();
    expect(attentionRows()).toHaveLength(0);
  });
});

describe("013 C1 — enganche 4: moveLeadStage a cliente/perdido", () => {
  function seedLeadStage(kind: "open" | "won" | "lost", id = `st_${kind}`) {
    tables.pipeline_stage!.push({
      id,
      organizationId: ORG_A,
      name: kind,
      kind,
      position: 0,
    } as Row);
    return id;
  }
  function seedLead(contactId = "ct_1") {
    tables.lead!.push({
      id: "ld_1",
      organizationId: ORG_A,
      contactId,
      stageId: "st_open",
      position: 0,
      lastActivityAt: null,
      automationLane: "auto",
      updatedAt: new Date(),
    } as Row);
  }

  it("llevar el lead a cliente limpia la atención del contacto", async () => {
    seedConversation({ id: "cv_w", handoff: true });
    seedLeadStage("open");
    const won = seedLeadStage("won");
    seedLead();
    await scheduleHumanReminder({
      organizationId: ORG_A,
      conversationId: "cv_w",
      dueAt: new Date(Date.now() + 24 * 60 * MIN),
    });

    const result = await moveLeadStage({ organizationId: ORG_A, leadId: "ld_1", toStageId: won, actor: "human" });
    expect(result.moved).toBe(true);
    expect(attentionRows()).toHaveLength(0);
  });

  it("llevar el lead a perdido también limpia", async () => {
    seedConversation({ id: "cv_l", handoff: true });
    seedLeadStage("open");
    const lost = seedLeadStage("lost");
    seedLead();
    await applyHandoff("cv_l", ORG_A, "cliente");
    expect(attentionRows()).toHaveLength(1);

    await moveLeadStage({ organizationId: ORG_A, leadId: "ld_1", toStageId: lost, actor: "human" });
    expect(attentionRows()).toHaveLength(0);
  });

  it("mover a una etapa abierta conserva la atención", async () => {
    seedConversation({ id: "cv_o", handoff: true });
    const abierto = seedLeadStage("open");
    const otro = seedLeadStage("open", "st_negocio");
    seedLead();
    await applyHandoff("cv_o", ORG_A, "cliente");

    await moveLeadStage({ organizationId: ORG_A, leadId: "ld_1", toStageId: otro, actor: "human" });
    expect(attentionOf("cv_o")).toMatchObject({ state: "pending" });
    expect(abierto).toBe("st_open");
  });

  it("no-op a la misma etapa no limpia ni escribe (contrato del gateway)", async () => {
    seedConversation({ id: "cv_n", handoff: true });
    seedLeadStage("won");
    seedLead();
    await applyHandoff("cv_n", ORG_A, "cliente");

    const result = await moveLeadStage({ organizationId: ORG_A, leadId: "ld_1", toStageId: "st_open", actor: "human" });
    expect(result.moved).toBe(false);
    expect(attentionOf("cv_n")).toMatchObject({ state: "pending" });
  });

  it("cross-tenant: la etapa de otra organización se rechaza y la atención sigue", async () => {
    seedConversation({ id: "cv_x", handoff: true });
    seedLeadStage("open");
    tables.pipeline_stage!.push({
      id: "st_b_won",
      organizationId: ORG_B,
      name: "Cliente B",
      kind: "won",
      position: 0,
    } as Row);
    seedLead();
    await applyHandoff("cv_x", ORG_A, "cliente");

    await expect(
      moveLeadStage({ organizationId: ORG_A, leadId: "ld_1", toStageId: "st_b_won", actor: "human" })
    ).rejects.toBeInstanceOf(StageGatewayError);
    expect(attentionOf("cv_x")).toMatchObject({ state: "pending" });
  });

  it("best-effort: si la atención falla, el cambio de etapa se aplica igual", async () => {
    seedConversation({ id: "cv_bf", handoff: true });
    seedLeadStage("open");
    const won = seedLeadStage("won");
    seedLead();
    await applyHandoff("cv_bf", ORG_A, "cliente");
    const del = db.delete;
    db.delete = (() => {
      throw new Error("atención caído");
    }) as typeof db.delete;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const result = await moveLeadStage({ organizationId: ORG_A, leadId: "ld_1", toStageId: won, actor: "human" });
      expect(result.lead.stageId).toBe(won);
    } finally {
      db.delete = del;
      warn.mockRestore();
    }
  });
});

describe("013 C1 — enganche 5: inbound del cliente", () => {
  const inbound = (conversationId = "cv_1") =>
    ingestInboundMessage({
      organizationId: ORG_A,
      identity: { identity: "5215511111111", phone: "5215511111111", waUserId: null, profileName: "Ana" },
      waMessageId: `wamid.${conversationId}.1`,
      type: "text",
      text: "hola",
      timestamp: String(Math.floor(Date.now() / 1000)),
    });

  it("con la conversación en humano vuelve a pending y cancela el recordatorio", async () => {
    seedConversation({ id: "cv_1", handoff: true });
    await scheduleHumanReminder({
      organizationId: ORG_A,
      conversationId: "cv_1",
      dueAt: new Date(Date.now() + 24 * 60 * MIN),
      note: "jueves",
    });

    await inbound("cv_1");
    expect(attentionOf("cv_1")).toMatchObject({
      state: "pending",
      dueAt: null,
      note: null,
    });
    expect(attentionRows()).toHaveLength(1);
  });

  it("con la IA activa no registra atención (FR-1.10)", async () => {
    seedConversation({ id: "cv_1" });
    await inbound("cv_1");
    expect(attentionRows()).toHaveLength(0);
  });

  it("best-effort: si la atención falla, el mensaje se ingiere igual", async () => {
    seedConversation({ id: "cv_1", handoff: true });
    const insert = db.insert;
    db.insert = ((table: unknown) => {
      if (getTableName(table as never) === "conversation_attention") {
        throw new Error("atención caído");
      }
      return insert(table);
    }) as typeof db.insert;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(inbound("cv_1")).resolves.toBeUndefined();
    expect(tables.message!.some((row) => row.waMessageId === "wamid.cv_1.1")).toBe(true);
    expect(maybeRunAgentTurn).toHaveBeenCalled();

    db.insert = insert;
    warn.mockRestore();
  });
});

describe("013 C1 — enganche 6: respuesta manual (echo) y outbound del operador", () => {
  it("el echo del dueño deja la conversación en waiting_client", async () => {
    seedConversation({ id: "cv_1" });
    await processEchoesValue({
      metadata: { phone_number_id: "pn_1" },
      message_echoes: [
        { id: "wamid.echo.1", to: "5215511111111", type: "text", timestamp: String(Math.floor(Date.now() / 1000)), text: { body: "voy en camino" } },
      ],
    } as never);

    const conversation = tables.conversation!.find((row) => row.id === "cv_1")!;
    expect(conversation.handoffReason).toBe("manual_reply");
    expect(conversation.aiEnabled).toBe(false);
    expect(attentionOf("cv_1")).toMatchObject({ state: "waiting_client", dueAt: null });
    const view = await getAttention(ORG_A, "cv_1");
    expect(view).toMatchObject({ state: "waiting_client", needsAttentionNow: false, waitingClient: true });
    // El motor de follow-ups conserva su contrato: se cancela, no se crea nada.
    expect(cancelFollowUpsOnManualReply).toHaveBeenCalledWith({
      organizationId: ORG_A,
      conversationId: "cv_1",
    });
  });

  it("el outbound manual del CRM deja waiting_client", async () => {
    seedConversation({ id: "cv_1", handoff: true });
    await applyHandoff("cv_1", ORG_A, "cliente");
    expect(attentionOf("cv_1")).toMatchObject({ state: "pending" });

    await sendText({
      conversationId: "cv_1",
      organizationId: ORG_A,
      text: "te confirmo a las 10",
      aiGenerated: false,
    });
    expect(attentionOf("cv_1")).toMatchObject({ state: "waiting_client" });
    expect(attentionRows()).toHaveLength(1);
  });

  it("un envío de la IA no es respuesta humana: no cambia el estado", async () => {
    seedConversation({ id: "cv_1", handoff: true });
    await applyHandoff("cv_1", ORG_A, "cliente");

    await expect(sendText({
      conversationId: "cv_1",
      organizationId: ORG_A,
      text: "respuesta del agente",
      aiGenerated: true,
    })).rejects.toMatchObject({ name: "StaleTurnError" });
    expect(graphRequest).not.toHaveBeenCalled();
    expect(attentionOf("cv_1")).toMatchObject({ state: "pending" });
  });

  it("un envío IA vigente conserva la atención pending sin marcar respuesta humana", async () => {
    const conversation = seedConversation({ id: "cv_1", handoff: true });
    await applyHandoff("cv_1", ORG_A, "cliente");
    // Reactivate permissions while retaining the pending attention fixture.
    conversation.handoffAt = null;
    conversation.handoffReason = null;
    await sendText({ conversationId: "cv_1", organizationId: ORG_A, text: "respuesta vigente", aiGenerated: true });
    expect(attentionOf("cv_1")).toMatchObject({ state: "pending" });
    expect(cancelFollowUpsOnManualReply).not.toHaveBeenCalled();
    expect(tables.message!.find(row => row.direction === "out")).toMatchObject({ status: "pending", waMessageId: "wamid.1", origin: "ai" });
    expect(tables.sales_outbound_delivery![0]!.confirmedAt).toBeUndefined();
  });

  it("best-effort: si la atención falla, el mensaje se envía igual", async () => {
    seedConversation({ id: "cv_1", handoff: true });
    const insert = db.insert;
    db.insert = ((table: unknown) => {
      if (getTableName(table as never) === "conversation_attention") {
        throw new Error("atención caído");
      }
      return insert(table);
    }) as typeof db.insert;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await expect(
        sendText({ conversationId: "cv_1", organizationId: ORG_A, text: "hola", aiGenerated: false })
      ).resolves.toBeDefined();
      expect(graphRequest).toHaveBeenCalled();
      // `sendText` persiste en `pending`; el paso a `sent` llega por webhook.
      expect(
        tables.message!.some(
          (row) => row.text === "hola" && row.status === "pending" && row.waMessageId === "wamid.1"
        )
      ).toBe(true);
    } finally {
      db.insert = insert;
      warn.mockRestore();
    }
  });
});

describe("013 C1 — lectura de la atención por el módulo real", () => {
  it("getAttention devuelve la vista derivada de la fila escrita por los enganches", async () => {
    seedConversation({ id: "cv_1", handoff: true });
    await applyHandoff("cv_1", ORG_A, "cliente");
    const view = await getAttention(ORG_A, "cv_1");
    expect(view).toMatchObject({
      conversationId: "cv_1",
      state: "pending",
      needsAttentionNow: true,
    });
    expect(view!.id).toMatch(/^ca_[a-z0-9]{20}$/);
  });
});
