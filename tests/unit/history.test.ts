import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaInput } from "@/server/inbox/ingest";
import type { ResolvedIdentity } from "@/server/inbox/identity";
import type {
  HistoryIngestDeps,
  HistoryMessageInsert,
  HistoryStore,
} from "@/server/inbox/history";
import type { WebhookValue } from "@/server/inbox/webhook";
import type { Credentials } from "@/server/whatsapp/credentials";
import { schema } from "@/lib/db";

vi.mock("@/server/ai/trigger", () => ({
  maybeRunAgentTurn: vi.fn(),
}));
vi.mock("@/server/inbox/lead-activity", () => ({
  onLeadActivity: vi.fn(),
}));

import { maybeRunAgentTurn } from "@/server/ai/trigger";
import { onLeadActivity } from "@/server/inbox/lead-activity";
import {
  historyTimestampToDate,
  isMediaPlaceholder,
  isNewerTimestamp,
  mapHistoryStatus,
  normalizeWebhookPhone,
  processHistoryValue,
  processStateSyncValue,
  resolveHistoryDirection,
} from "@/server/inbox/history";

type MessageRow = typeof schema.message.$inferSelect;
type ConversationRow = typeof schema.conversation.$inferSelect;
type ContactRow = typeof schema.contact.$inferSelect;

const ORG = "org_hist";
const PN = "PN-HIST";
const BIZ = "5215500000000";
const LEAD = "5214627009001";
const LEAD_NORM = "524627009001";

function creds(): Credentials {
  return {
    id: "cred_1",
    organizationId: ORG,
    wabaId: "WABA-H",
    phoneNumberId: PN,
    displayPhoneNumber: "+52 155 0000 0000",
    verifiedName: "Test",
    status: "connected",
    token: "token-no-se-loguea",
  };
}

function toRow(insert: HistoryMessageInsert): MessageRow {
  return {
    ...insert,
    error: null,
    aiGenerated: false,
    mediaAssetId: null,
  };
}

function makeHarness() {
  const messages: MessageRow[] = [];
  const contacts = new Map<string, ContactRow>();
  const conversations = new Map<string, ConversationRow>();
  const attachCalls: { messageId: string; media: MediaInput }[] = [];
  const publishCalls: unknown[] = [];
  let n = 0;

  const store: HistoryStore = {
    async findMessageByWaId(_organizationId, waMessageId) {
      return messages.find((m) => m.waMessageId === waMessageId) ?? null;
    },
    async insertMessage(row) {
      if (messages.some((m) => m.waMessageId === row.waMessageId)) return null;
      const created = toRow(row);
      messages.push(created);
      return created;
    },
    async updateMessage(id, patch) {
      const msg = messages.find((m) => m.id === id);
      if (!msg) return;
      if (patch.type !== undefined) msg.type = patch.type;
      if (patch.text !== undefined) msg.text = patch.text;
    },
    async advanceConversationClock({ conversationId, waTimestamp, direction }) {
      const conv = conversations.get(conversationId);
      if (!conv) return;
      if (isNewerTimestamp(conv.lastMessageAt, waTimestamp)) {
        conv.lastMessageAt = waTimestamp;
      }
      if (direction === "in" && isNewerTimestamp(conv.lastInboundAt, waTimestamp)) {
        conv.lastInboundAt = waTimestamp;
      }
    },
  };

  const deps: HistoryIngestDeps = {
    getCredentialsByPhoneNumberId: async (id) => (id === PN ? creds() : null),
    getOrCreateContactByIdentity: async (organizationId, resolved: ResolvedIdentity) => {
      const existing = contacts.get(resolved.identity);
      if (existing) return { contact: existing, isNew: false };
      const contact: ContactRow = {
        id: `ct_${++n}`,
        organizationId,
        waIdentity: resolved.identity,
        phone: resolved.phone,
        waUserId: resolved.waUserId,
        name: resolved.profileName?.trim() || resolved.phone || "Contacto de WhatsApp",
        notes: null,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      contacts.set(resolved.identity, contact);
      return { contact, isNew: true };
    },
    getOrCreateConversation: async (organizationId, contactId) => {
      const found = [...conversations.values()].find(
        (c) => c.contactId === contactId && !c.isTest
      );
      if (found) return found;
      const conv: ConversationRow = {
        id: `cv_${++n}`,
        organizationId,
        contactId,
        isTest: false,
        aiEnabled: true,
        handoffAt: null,
        handoffReason: null,
        lastInboundAt: null,
        lastMessageAt: null,
        unreadCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      conversations.set(conv.id, conv);
      return conv;
    },
    store,
    attachMediaAsset: async (_org, messageId, media) => {
      attachCalls.push({ messageId, media });
      const msg = messages.find((m) => m.id === messageId);
      if (msg) msg.mediaAssetId = "ma_hist";
      return {
        id: "ma_hist",
        organizationId: ORG,
        kind: media.kind,
        waMediaId: media.waMediaId,
        mimeType: media.mimeType,
        fileName: media.fileName,
        fileSize: null,
        caption: media.caption,
        payload: media.payload ?? null,
        storagePath: null,
        fetchStatus: media.fetchStatus,
        fetchError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
    publish: (_org, event) => {
      publishCalls.push(event);
    },
  };

  return { messages, contacts, conversations, attachCalls, publishCalls, deps };
}

function historyValue(threads: WebhookValue["history"]): WebhookValue {
  return {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: BIZ, phone_number_id: PN },
    history: threads,
  };
}

describe("helpers de historial", () => {
  it("normaliza teléfono con espacios y 521 MX", () => {
    expect(normalizeWebhookPhone("+52 146 2700 9001")).toBe(LEAD_NORM);
    expect(normalizeWebhookPhone(LEAD)).toBe(LEAD_NORM);
  });

  it("timestamp unix → Date; inválido → null (nunca 'ahora')", () => {
    expect(historyTimestampToDate("1700000000")).toEqual(new Date(1700000000 * 1000));
    expect(historyTimestampToDate("nope")).toBeNull();
    expect(historyTimestampToDate("0")).toBeNull();
  });

  it("mapea status de history_context", () => {
    expect(mapHistoryStatus("READ", "in")).toBe("read");
    expect(mapHistoryStatus("PLAYED", "in")).toBe("read");
    expect(mapHistoryStatus("DELIVERED", "out")).toBe("delivered");
    expect(mapHistoryStatus(undefined, "in")).toBe("delivered");
    expect(mapHistoryStatus(undefined, "out")).toBe("sent");
  });

  it("dirección inbound/outbound", () => {
    expect(resolveHistoryDirection({ from: LEAD }, LEAD, BIZ)).toBe("in");
    expect(
      resolveHistoryDirection({ from: BIZ, to: LEAD }, LEAD, BIZ)
    ).toBe("out");
    expect(resolveHistoryDirection({ from: BIZ }, LEAD, BIZ)).toBe("out");
  });

  it("isNewerTimestamp nunca retrocede", () => {
    const older = new Date(1000);
    const newer = new Date(2000);
    expect(isNewerTimestamp(null, older)).toBe(true);
    expect(isNewerTimestamp(newer, older)).toBe(false);
    expect(isNewerTimestamp(older, newer)).toBe(true);
  });

  it("detecta media_placeholder", () => {
    expect(isMediaPlaceholder("media_placeholder")).toBe(true);
    expect(isMediaPlaceholder("image")).toBe(false);
  });
});

describe("processHistoryValue", () => {
  beforeEach(() => {
    vi.mocked(maybeRunAgentTurn).mockClear();
    vi.mocked(onLeadActivity).mockClear();
  });

  it("ingiere inbound y outbound con timestamps reales y origin manual en saliente", async () => {
    const h = makeHarness();
    await processHistoryValue(
      historyValue([
        {
          metadata: { phase: 0, chunk_order: 1, progress: 100 },
          threads: [
            {
              id: LEAD,
              messages: [
                {
                  id: "wamid.hist.in",
                  from: LEAD,
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: "hola hace meses" },
                  history_context: { status: "READ" },
                },
                {
                  id: "wamid.hist.out",
                  from: BIZ,
                  to: LEAD,
                  timestamp: "1700001000",
                  type: "text",
                  text: { body: "te respondí" },
                  history_context: { status: "DELIVERED" },
                },
              ],
            },
          ],
        },
      ]),
      h.deps
    );

    expect(h.messages).toHaveLength(2);
    const inbound = h.messages.find((m) => m.waMessageId === "wamid.hist.in");
    const outbound = h.messages.find((m) => m.waMessageId === "wamid.hist.out");
    expect(inbound?.direction).toBe("in");
    expect(inbound?.status).toBe("read");
    expect(inbound?.createdAt).toEqual(new Date(1700000000 * 1000));
    expect(inbound?.waTimestamp).toEqual(inbound?.createdAt);
    expect(outbound?.direction).toBe("out");
    expect(outbound?.origin).toBe("manual");
    expect(outbound?.status).toBe("delivered");
    expect(h.contacts.get(LEAD_NORM)?.phone).toBe(LEAD_NORM);
  });

  it("reprocesar el mismo payload no duplica", async () => {
    const h = makeHarness();
    const payload = historyValue([
      {
        threads: [
          {
            id: LEAD,
            messages: [
              {
                id: "wamid.dup",
                from: LEAD,
                timestamp: "1700000000",
                type: "text",
                text: { body: "hola" },
              },
            ],
          },
        ],
      },
    ]);
    await processHistoryValue(payload, h.deps);
    await processHistoryValue(payload, h.deps);
    expect(h.messages).toHaveLength(1);
  });

  it("ordena por fecha histórica: chunk viejo después de uno nuevo no desordena", async () => {
    const h = makeHarness();
    await processHistoryValue(
      historyValue([
        {
          metadata: { chunk_order: 2 },
          threads: [
            {
              id: LEAD,
              messages: [
                {
                  id: "wamid.new",
                  from: LEAD,
                  timestamp: "1700002000",
                  type: "text",
                  text: { body: "reciente" },
                },
              ],
            },
          ],
        },
      ]),
      h.deps
    );
    const conv = [...h.conversations.values()][0]!;
    const recentTs = conv.lastInboundAt;

    await processHistoryValue(
      historyValue([
        {
          metadata: { chunk_order: 1 },
          threads: [
            {
              id: LEAD,
              messages: [
                {
                  id: "wamid.old",
                  from: LEAD,
                  timestamp: "1690000000",
                  type: "text",
                  text: { body: "viejo" },
                },
              ],
            },
          ],
        },
      ]),
      h.deps
    );

    expect(h.messages).toHaveLength(2);
    const ordered = [...h.messages].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );
    expect(ordered[0]?.waMessageId).toBe("wamid.old");
    expect(ordered[1]?.waMessageId).toBe("wamid.new");
    expect(conv.lastInboundAt).toEqual(recentTs);
    expect(conv.lastMessageAt).toEqual(recentTs);
  });

  it("no dispara agente, unread, handoff ni leads", async () => {
    const h = makeHarness();
    await processHistoryValue(
      historyValue([
        {
          threads: [
            {
              id: LEAD,
              messages: [
                {
                  id: "wamid.side",
                  from: LEAD,
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: "hola" },
                },
                {
                  id: "wamid.side.out",
                  from: BIZ,
                  to: LEAD,
                  timestamp: "1700000500",
                  type: "text",
                  text: { body: "saliente histórico" },
                },
              ],
            },
          ],
        },
      ]),
      h.deps
    );

    expect(maybeRunAgentTurn).not.toHaveBeenCalled();
    expect(onLeadActivity).not.toHaveBeenCalled();
    const conv = [...h.conversations.values()][0]!;
    expect(conv.unreadCount).toBe(0);
    expect(conv.aiEnabled).toBe(true);
    expect(conv.handoffAt).toBeNull();
    expect(h.publishCalls.some((e) => (e as { type: string }).type === "message.new")).toBe(
      false
    );
  });

  it("media_placeholder se enriquece luego con el mismo wamid", async () => {
    const h = makeHarness();
    const wamid = "wamid.media.1";
    await processHistoryValue(
      historyValue([
        {
          threads: [
            {
              id: LEAD,
              messages: [
                {
                  id: wamid,
                  from: LEAD,
                  timestamp: "1700000000",
                  type: "media_placeholder",
                },
              ],
            },
          ],
        },
      ]),
      h.deps
    );
    expect(h.messages).toHaveLength(1);
    expect(h.messages[0]?.type).toBe("media_placeholder");
    expect(h.messages[0]?.mediaAssetId).toBeNull();
    expect(h.attachCalls).toHaveLength(0);

    await processHistoryValue(
      historyValue([
        {
          threads: [
            {
              id: LEAD,
              messages: [
                {
                  id: wamid,
                  from: LEAD,
                  timestamp: "1700000000",
                  type: "image",
                  image: { id: "media-hist-1", mime_type: "image/jpeg" },
                },
              ],
            },
          ],
        },
      ]),
      h.deps
    );

    expect(h.messages).toHaveLength(1);
    expect(h.messages[0]?.type).toBe("image");
    expect(h.messages[0]?.mediaAssetId).toBe("ma_hist");
    expect(h.attachCalls).toHaveLength(1);
  });

  it("error 2593109 (historial no compartido) no lanza ni inserta", async () => {
    const h = makeHarness();
    await expect(
      processHistoryValue(
        historyValue([
          {
            errors: [
              {
                code: 2593109,
                title: "History sharing declined",
                message: "Business declined",
              },
            ],
          },
        ]),
        h.deps
      )
    ).resolves.toBeUndefined();
    expect(h.messages).toHaveLength(0);
    expect(h.contacts.size).toBe(0);
  });
});

describe("processStateSyncValue", () => {
  it("add crea contacto; remove no borra", async () => {
    const h = makeHarness();
    const value: WebhookValue = {
      metadata: { phone_number_id: PN },
      state_sync: [
        {
          type: "contact",
          action: "add",
          contact: {
            phone_number: LEAD,
            full_name: "Ana Histórica",
          },
        },
      ],
    };
    await processStateSyncValue(value, h.deps);
    expect(h.contacts.get(LEAD_NORM)?.name).toBe("Ana Histórica");
    expect(h.conversations.size).toBe(0);

    await processStateSyncValue(
      {
        metadata: { phone_number_id: PN },
        state_sync: [
          {
            type: "contact",
            action: "remove",
            contact: { phone_number: LEAD },
          },
        ],
      },
      h.deps
    );
    expect(h.contacts.has(LEAD_NORM)).toBe(true);
    expect(h.conversations.size).toBe(0);
  });
});
