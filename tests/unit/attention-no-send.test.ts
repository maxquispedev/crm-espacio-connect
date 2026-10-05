import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemDb, type Row, type Tables } from "../fixtures/mem-db";

/**
 * 013 C1 — Un recordatorio humano NO envía nada (plan §5/§8, D-4).
 *
 * Se demuestra por dos vías independientes, porque el error que se quiere evitar
 * es exactamente "alguien conectó esto al motor":
 *  1. ESTRUCTURAL: los imports del módulo y de todo el motor de follow-ups. Si
 *     alguien importa el sender, Graph, plantillas o el store de follow-ups
 *     desde la atención (o la atención desde el motor), el test falla.
 *  2. DINÁMICO: el camino completo de recordatorio se ejecuta con TODOS los
 *     Collaboration de envío sabotajeados (si se llaman, explotan).
 *
 * El motor de follow-ups se queda como estaba: su store no sabe que existe
 * `conversation_attention` (FR-1.9, y las 5 razones de plan §5, D-2/D-3).
 */

const root = path.resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const SABOTAGE = "si se llama, el camino de recordatorio está enviando algo";
const graphRequest = vi.hoisted(() => vi.fn(() => { throw new Error(SABOTAGE); }));
const sendText = vi.hoisted(() => vi.fn(() => { throw new Error(SABOTAGE); }));
const sendMediaMessage = vi.hoisted(() => vi.fn(() => { throw new Error(SABOTAGE); }));
const sendTemplate = vi.hoisted(() => vi.fn(() => { throw new Error(SABOTAGE); }));
const cancelFollowUpsOnManualReply = vi.hoisted(() => vi.fn(() => { throw new Error(SABOTAGE); }));
const enqueueFollowUp = vi.hoisted(() => vi.fn(() => { throw new Error(SABOTAGE); }));
const evaluateJev = vi.hoisted(() => vi.fn(() => { throw new Error(SABOTAGE); }));

const tables: Tables = { conversation: [], conversation_attention: [] };
const db = createMemDb(tables);
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  getDb: () => db,
}));
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest, uploadGraphMedia: vi.fn(() => { throw new Error(SABOTAGE); }) };
});
vi.mock("@/server/inbox/send", () => ({
  sendText,
  sendMediaMessage,
  sendStructured: vi.fn(() => { throw new Error(SABOTAGE); }),
  SendError: class extends Error {},
}));
vi.mock("@/server/whatsapp/templates", () => ({
  sendTemplate,
  listApprovedTemplates: vi.fn(() => []),
}));
vi.mock("@/server/sales/follow-ups/store", () => ({
  cancelFollowUpsOnManualReply,
  enqueueFollowUp,
  loadConversationFollowUpState: vi.fn(() => null),
}));
vi.mock("@/server/sales/orchestrator", () => ({ evaluateJev, buildDecisionFromReplay: vi.fn() }));

const {
  clearAttention,
  getAttention,
  listAttention,
  markAttentionPending,
  markAttentionWaitingClient,
  scheduleHumanReminder,
} = await import("@/server/inbox/attention");

const ORG_A = "org_a";
const MIN = 60_000;

function seedHumanConversation() {
  tables.conversation!.push({
    id: "cv_1",
    organizationId: ORG_A,
    contactId: "ct_1",
    isTest: false,
    aiEnabled: false,
    handoffAt: new Date("2026-10-05T11:00:00Z"),
    handoffReason: "cliente",
    lastInboundAt: new Date(),
    unreadCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Row);
  return "cv_1";
}

beforeEach(() => {
  for (const bucket of Object.values(tables)) bucket!.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("013 C1 — preuve estructural: nada que pueda enviar", () => {
  it("el módulo de atención no importa el sender, Graph, plantillas ni el motor", () => {
    const source = read("src/server/inbox/attention.ts");
    const imports = source.match(/^import .*$/gm)?.join("\n") ?? "";
    for (const prohibido of [
      "inbox/send",
      "meta/client",
      "whatsapp/templates",
      "sales/follow-ups",
      "ai/delivery",
    ]) {
      expect(imports).not.toContain(prohibido);
    }
    // Tampoco por vía indirecta dentro del cuerpo del módulo.
    expect(source).not.toMatch(/graphRequest|sendText|sendMediaMessage|uploadGraphMedia/);
  });

  it("el motor de follow-ups no conoce la atención (FR-1.9)", () => {
    for (const file of [
      "src/server/sales/follow-ups/store.ts",
      "src/server/sales/follow-ups/worker.ts",
      "src/server/sales/follow-ups/index.ts",
      "src/server/sales/follow-ups/policy.ts",
      "src/server/sales/follow-ups/follow-up-writer.ts",
      "src/instrumentation-node.ts",
    ]) {
      expect(read(file), file).not.toContain("inbox/attention");
    }
  });

  it("la tabla nueva no se sembró en el motor ni en el worker", () => {
    expect(read("src/server/sales/follow-ups/store.ts")).not.toContain("conversationAttention");
    expect(read("src/server/sales/follow-ups/store.ts")).not.toContain("conversation_attention");
    expect(read("src/instrumentation-node.ts")).not.toContain("attention");
  });

  it("solo los seis estrangulamientos del plan usan el módulo", () => {
    const usuarios = [
      "src/server/ai/delivery.ts",
      "src/server/inbox/ingest.ts",
      "src/server/inbox/queries.ts",
      "src/server/inbox/send.ts",
      "src/server/leads/stage-gateway.ts",
    ];
    for (const file of usuarios) {
      expect(read(file), file).toContain("inbox/attention");
    }
  });
});

afterEach(() => vi.useRealTimers());

describe("013 C1 — prueba dinámica: el camino de recordatorio no llama a nada que envíe", () => {
  it("programar, vencer, leer y limpiar no toca Graph ni el sender", async () => {
    const conversationId = seedHumanConversation();
    const t0 = new Date("2026-10-05T12:00:00Z");
    vi.useFakeTimers({ now: t0 });

    // 1) Programar un recordatorio: no envía nada.
    const programado = await scheduleHumanReminder({
      organizationId: ORG_A,
      conversationId,
      dueAt: new Date(t0.getTime() + 60 * MIN),
      note: "jueves 10:00",
      now: t0,
    });
    expect(programado).toMatchObject({ state: "deferred", needsAttentionNow: false });

    // 2) Llega el jueves: se deriva leyendo, sin proceso que lo dispare.
    const vencido = await getAttention(ORG_A, conversationId, new Date(t0.getTime() + 61 * MIN));
    expect(vencido).toMatchObject({ state: "deferred", overdue: true, needsAttentionNow: true });

    // 3) Listado para "Por atender"/Agenda: lectura pura.
    expect(await listAttention(ORG_A, {}, new Date(t0.getTime() + 61 * MIN))).toHaveLength(1);

    // 4) El cliente escribe y el dueño responde: transiciones de estado.
    await markAttentionPending({ organizationId: ORG_A, conversationId });
    await markAttentionWaitingClient({ organizationId: ORG_A, conversationId });
    await clearAttention({ organizationId: ORG_A, conversationId });

    for (const [nombre, mock] of [
      ["graphRequest", graphRequest],
      ["sendText", sendText],
      ["sendMediaMessage", sendMediaMessage],
      ["sendTemplate", sendTemplate],
      ["cancelFollowUpsOnManualReply", cancelFollowUpsOnManualReply],
      ["enqueueFollowUp", enqueueFollowUp],
      ["evaluateJev", evaluateJev],
    ] as const) {
      expect(mock, nombre).not.toHaveBeenCalled();
    }
    expect(tables.conversation_attention).toHaveLength(0);
  });

  it("el recordatorio no crea filas en el motor: solo en su propia tabla", async () => {
    const conversationId = seedHumanConversation();
    await scheduleHumanReminder({
      organizationId: ORG_A,
      conversationId,
      dueAt: new Date(Date.now() + 24 * 60 * MIN),
      note: "llamar",
    });
    expect(Object.keys(tables)).toEqual(["conversation", "conversation_attention"]);
    expect(tables.conversation_attention).toHaveLength(1);
    for (const mock of [enqueueFollowUp, evaluateJev, sendText, graphRequest]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });
});
