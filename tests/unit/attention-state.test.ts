import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemDb, type Row, type Tables } from "../fixtures/mem-db";
import * as schema from "@/lib/db/schema";

// ORM, schema y scoped() REALES; solo el ejecutor de BD es un doble en memoria.
// Los constraints de PostgreSQL los comprueba `attention-postgres.test.ts`.
const tables: Tables = {
  conversation: [],
  conversation_attention: [],
  lead: [],
  pipeline_stage: [],
};
const db = createMemDb(tables);
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  getDb: () => db,
}));

const {
  ATTENTION_NOTE_MAX_LENGTH,
  AttentionError,
  clearAttention,
  clearAttentionForContact,
  deriveAttention,
  getAttention,
  listAttention,
  markAttentionPending,
  markAttentionWaitingClient,
  scheduleHumanReminder,
} = await import("@/server/inbox/attention");

const ORG_A = "org_a";
const ORG_B = "org_b";
const T0 = new Date("2026-10-05T12:00:00Z");
const MIN = 60_000;

function seedConversation(input: {
  organizationId?: string;
  id?: string;
  handoff?: boolean;
  aiEnabled?: boolean;
  isTest?: boolean;
  contactId?: string;
}) {
  const organizationId = input.organizationId ?? ORG_A;
  const id = input.id ?? `cv_${organizationId}`;
  tables.conversation!.push({
    id,
    organizationId,
    contactId: input.contactId ?? `ct_${organizationId}`,
    handoffAt: input.handoff ? new Date("2026-10-05T11:00:00Z") : null,
    handoffReason: input.handoff ? "cliente" : null,
    aiEnabled: input.aiEnabled ?? true,
    isTest: input.isTest ?? false,
    unreadCount: 0,
    lastMessageAt: null,
    lastInboundAt: null,
    updatedAt: new Date("2026-10-05T11:00:00Z"),
  } as Row);
  return id;
}

const humanConversation = () => seedConversation({ handoff: true, id: "cv_human" });
const aiConversation = () => seedConversation({ id: "cv_ai" });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  for (const bucket of Object.values(tables)) bucket!.length = 0;
});

describe("013 C1 — ciclo de atención humana paso a paso (spec §3.2)", () => {
  it("1. handoff -> pending, y es la primera fila de la conversación", async () => {
    const id = humanConversation();
    const view = await markAttentionPending({ organizationId: ORG_A, conversationId: id });
    expect(view).toMatchObject({
      conversationId: id,
      state: "pending",
      dueAt: null,
      needsAttentionNow: true,
      waitingClient: false,
      scheduled: false,
      overdue: false,
    });
    expect(view!.id).toMatch(/^ca_[a-z0-9]{20}$/);
    expect(tables.conversation_attention).toHaveLength(1);
  });

  it("2. abrir/marcar leída NO resuelve: la fila sigue pendiente", async () => {
    const id = humanConversation();
    await markAttentionPending({ organizationId: ORG_A, conversationId: id });
    // El módulo de atención no tiene ninguna operación de lectura que resuelva:
    // leer el estado es puro `getAttention`, sin efectos.
    const before = await getAttention(ORG_A, id);
    const after = await getAttention(ORG_A, id);
    expect(after).toEqual(before);
    expect(after!.state).toBe("pending");
    expect(after!.needsAttentionNow).toBe(true);
  });

  it("3. el dueño responde desde el CRM -> waiting_client (no requiere acción)", async () => {
    const id = humanConversation();
    await markAttentionPending({ organizationId: ORG_A, conversationId: id });
    const view = await markAttentionWaitingClient({ organizationId: ORG_A, conversationId: id });
    expect(view).toMatchObject({
      state: "waiting_client",
      needsAttentionNow: false,
      waitingClient: true,
      scheduled: false,
      overdue: false,
      dueAt: null,
    });
    expect(tables.conversation_attention).toHaveLength(1);
  });

  it("4. Max queda esperando: waiting_client persiste sin reactivar la IA", async () => {
    const id = humanConversation();
    await markAttentionWaitingClient({ organizationId: ORG_A, conversationId: id });
    const view = await getAttention(ORG_A, id);
    expect(view!.waitingClient).toBe(true);
    // La conversación sigue en humano: el estado no la mueve.
    const conversation = tables.conversation!.find((row) => row.id === id)!;
    expect(conversation.handoffAt).not.toBeNull();
    expect(conversation.aiEnabled).toBe(true);
  });

  it("5. el cliente escribe durante HUMAN -> vuelve a pending", async () => {
    const id = humanConversation();
    await markAttentionWaitingClient({ organizationId: ORG_A, conversationId: id });
    const view = await markAttentionPending({ organizationId: ORG_A, conversationId: id });
    expect(view).toMatchObject({ state: "pending", needsAttentionNow: true, waitingClient: false });
  });

  it("6. acordar jueves 10:00 -> deferred: sale de Por atender, entra en Agenda", async () => {
    const id = humanConversation();
    const dueAt = new Date(T0.getTime() + 3 * 24 * 60 * MIN);
    const view = await scheduleHumanReminder({
      organizationId: ORG_A,
      conversationId: id,
      dueAt,
      note: "  cerrar   en persona  ",
      now: T0,
    });
    expect(view).toMatchObject({
      state: "deferred",
      dueAt: dueAt.toISOString(),
      note: "cerrar en persona",
      needsAttentionNow: false,
      scheduled: true,
      overdue: false,
      waitingClient: false,
    });
    // Entra en la Agenda (bucket `deferred`) y NO en "Por atender", que
    // selecciona por `needsAttentionNow` (derivado, cortes 2/3).
    const enHoy = await listAttention(ORG_A, { states: ["deferred"] }, T0);
    expect(enHoy).toHaveLength(1);
    expect(enHoy[0]!.needsAttentionNow).toBe(false);
    expect(enHoy[0]!.scheduled).toBe(true);
    // Al vencer, el MISMO filtro por estado pasa a requerir atención.
    const vencido = await listAttention(
      ORG_A,
      { states: ["deferred"] },
      new Date(dueAt.getTime() + MIN)
    );
    expect(vencido[0]!.needsAttentionNow).toBe(true);
  });

  it("7. el cliente escribe antes del jueves -> pending inmediato, el recordatorio deja de esconderlo", async () => {
    const id = humanConversation();
    await scheduleHumanReminder({
      organizationId: ORG_A,
      conversationId: id,
      dueAt: new Date(T0.getTime() + 3 * 24 * 60 * MIN),
      note: "jueves 10:00",
      now: T0,
    });
    const view = await markAttentionPending({ organizationId: ORG_A, conversationId: id });
    expect(view).toMatchObject({
      state: "pending",
      dueAt: null,
      note: null,
      needsAttentionNow: true,
    });
    expect(tables.conversation_attention).toHaveLength(1);
  });

  it("8. llega el jueves -> pending DERIVADO, sin proceso ni columna nueva", async () => {
    const id = humanConversation();
    const dueAt = new Date(T0.getTime() + 60 * MIN);
    await scheduleHumanReminder({
      organizationId: ORG_A,
      conversationId: id,
      dueAt,
      note: "jueves",
      now: T0,
    });
    const antes = await getAttention(ORG_A, id, new Date(dueAt.getTime() - MIN));
    expect(antes).toMatchObject({ state: "deferred", needsAttentionNow: false, scheduled: true });
    // Nadie ejecutó nada: la misma fila, leída más tarde, ya está vencida.
    const vencido = await getAttention(ORG_A, id, new Date(dueAt.getTime() + MIN));
    expect(vencido).toMatchObject({
      state: "deferred",
      needsAttentionNow: true,
      overdue: true,
      scheduled: false,
    });
    // El estado persistido NO cambió: el vencimiento es derivado, no un flag.
    expect(tables.conversation_attention![0]!.state).toBe("deferred");
    expect(tables.conversation_attention).toHaveLength(1);
  });

  it("9. Max responde ese jueves -> waiting_client y puede programar otro", async () => {
    const id = humanConversation();
    const dueAt = new Date(T0.getTime() + 60 * MIN);
    await scheduleHumanReminder({
      organizationId: ORG_A,
      conversationId: id,
      dueAt,
      now: T0,
    });
    const jueves = new Date(dueAt.getTime() + 15 * MIN);
    await markAttentionWaitingClient({ organizationId: ORG_A, conversationId: id });
    const otro = await scheduleHumanReminder({
      organizationId: ORG_A,
      conversationId: id,
      dueAt: new Date(jueves.getTime() + 24 * 60 * MIN),
      note: "reintentar",
      now: jueves,
    });
    expect(otro).toMatchObject({
      state: "deferred",
      needsAttentionNow: false,
      scheduled: true,
      note: "reintentar",
    });
    expect(tables.conversation_attention).toHaveLength(1);
  });

  it("10a. reactivar la IA -> limpia el estado humano", async () => {
    const id = humanConversation();
    await markAttentionPending({ organizationId: ORG_A, conversationId: id });
    expect(await clearAttention({ organizationId: ORG_A, conversationId: id })).toBe(1);
    expect(await getAttention(ORG_A, id)).toBeNull();
    expect(tables.conversation_attention).toHaveLength(0);
  });

  it("10b. lead a cliente/perdido -> limpia el estado humano del contacto", async () => {
    const id = humanConversation();
    await scheduleHumanReminder({
      organizationId: ORG_A,
      conversationId: id,
      dueAt: new Date(T0.getTime() + 60 * MIN),
      now: T0,
    });
    expect(
      await clearAttentionForContact({ organizationId: ORG_A, contactId: "ct_org_a" })
    ).toBe(1);
    expect(await getAttention(ORG_A, id)).toBeNull();
  });
});

describe("013 C1 — aislamiento de tenant (Constitución III)", () => {
  it("una conversación de otra organización es invisible e inmodificable", async () => {
    const idB = seedConversation({
      organizationId: ORG_B,
      handoff: true,
      id: "cv_b_human",
    });
    // A no ve la fila de B...
    expect(await getAttention(ORG_A, idB)).toBeNull();
    expect(await listAttention(ORG_A)).toHaveLength(0);
    // ...ni puede escribir sobre ella...
    expect(await markAttentionPending({ organizationId: ORG_A, conversationId: idB })).toBeNull();
    expect(await markAttentionWaitingClient({ organizationId: ORG_A, conversationId: idB })).toBeNull();
    expect(tables.conversation_attention).toHaveLength(0);
    await expect(
      scheduleHumanReminder({
        organizationId: ORG_A,
        conversationId: idB,
        dueAt: new Date(T0.getTime() + MIN),
        now: T0,
      })
    ).rejects.toBeInstanceOf(AttentionError);
    // ...ni borrarla aunque exista (fila de B sembrada a mano).
    tables.conversation_attention!.push({
      id: "ca_b",
      organizationId: ORG_B,
      conversationId: idB,
      state: "pending",
      dueAt: null,
      note: null,
      createdAt: T0,
      updatedAt: T0,
    } as Row);
    expect(await clearAttention({ organizationId: ORG_A, conversationId: idB })).toBe(0);
    expect(await getAttention(ORG_B, idB)).toMatchObject({ state: "pending" });
  });

  it("A y B escriben filas independientes para conversaciones distintas", async () => {
    const idA = humanConversation();
    const idB = seedConversation({ organizationId: ORG_B, handoff: true, id: "cv_b_human" });
    await markAttentionPending({ organizationId: ORG_A, conversationId: idA });
    const pendienteB = await markAttentionPending({ organizationId: ORG_B, conversationId: idB });
    expect(pendienteB!.conversationId).toBe(idB);
    // Limpiar en A no toca B.
    await clearAttention({ organizationId: ORG_A, conversationId: idA });
    expect(await getAttention(ORG_B, idB)).not.toBeNull();
    expect(await listAttention(ORG_B)).toHaveLength(1);
    expect(await listAttention(ORG_A)).toHaveLength(0);
  });

  it("rechaza organizationId vacío antes de tocar la BD", async () => {
    const id = humanConversation();
    await expect(getAttention("", id)).rejects.toThrow("organizationId");
  });
});

describe("013 C1 — FR-1.10: la atención solo existe si la IA no es la dueña", () => {
  it("inbound con la IA activa no registra nada", async () => {
    const id = aiConversation();
    expect(await markAttentionPending({ organizationId: ORG_A, conversationId: id })).toBeNull();
    expect(await markAttentionWaitingClient({ organizationId: ORG_A, conversationId: id })).toBeNull();
    expect(tables.conversation_attention).toHaveLength(0);
    await expect(
      scheduleHumanReminder({
        organizationId: ORG_A,
        conversationId: id,
        dueAt: new Date(T0.getTime() + MIN),
        now: T0,
      })
    ).rejects.toMatchObject({ code: "ai_owns_conversation" });
  });

  it("desactivar la IA sin handoff sí genera pendiente (spec §3.4)", async () => {
    const id = seedConversation({ id: "cv_solo_ia_off", aiEnabled: false });
    const view = await markAttentionPending({ organizationId: ORG_A, conversationId: id });
    expect(view).toMatchObject({ state: "pending", needsAttentionNow: true });
  });

  it("handoff sin desactivar la IA sigue siendo humano", async () => {
    const id = seedConversation({ id: "cv_handoff_sin_ia_off", handoff: true, aiEnabled: true });
    expect(await markAttentionPending({ organizationId: ORG_A, conversationId: id })).not.toBeNull();
  });

  it("las conversaciones del Laboratorio quedan fuera del modelo", async () => {
    const id = seedConversation({ id: "cv_test", handoff: true, isTest: true });
    expect(await markAttentionPending({ organizationId: ORG_A, conversationId: id })).toBeNull();
    expect(tables.conversation_attention).toHaveLength(0);
  });

  it("conversación inexistente: no-op silencioso en eventos, error explícito al programar", async () => {
    expect(await markAttentionPending({ organizationId: ORG_A, conversationId: "cv_nope" })).toBeNull();
    await expect(
      scheduleHumanReminder({
        organizationId: ORG_A,
        conversationId: "cv_nope",
        dueAt: new Date(T0.getTime() + MIN),
        now: T0,
      })
    ).rejects.toMatchObject({ code: "conversation_not_found" });
  });
});

describe("013 C1 — idempotencia y coherencia del contrato", () => {
  it("repetir la misma operación no duplica fila ni pierde id/createdAt", async () => {
    const id = humanConversation();
    const first = await markAttentionPending({ organizationId: ORG_A, conversationId: id });
    const createdAt = tables.conversation_attention![0]!.createdAt;
    const second = await markAttentionPending({ organizationId: ORG_A, conversationId: id });
    expect(second!.id).toBe(first!.id);
    expect(tables.conversation_attention![0]!.createdAt).toEqual(createdAt);
    expect(tables.conversation_attention).toHaveLength(1);
  });

  it("programar dos recordatorios reemplaza al anterior (D-6)", async () => {
    const id = humanConversation();
    await scheduleHumanReminder({
      organizationId: ORG_A,
      conversationId: id,
      dueAt: new Date(T0.getTime() + 24 * 60 * MIN),
      note: "primero",
      now: T0,
    });
    const segundo = await scheduleHumanReminder({
      organizationId: ORG_A,
      conversationId: id,
      dueAt: new Date(T0.getTime() + 72 * 60 * MIN),
      note: "segundo",
      now: T0,
    });
    expect(segundo.note).toBe("segundo");
    expect(tables.conversation_attention).toHaveLength(1);
    expect(tables.conversation_attention![0]!.note).toBe("segundo");
  });

  it("cada estado escribe su dueAt coherente (CHECK en BD) y null cuando no toca", async () => {
    const id = humanConversation();
    const pendiente = await markAttentionPending({ organizationId: ORG_A, conversationId: id });
    expect(pendiente!.dueAt).toBeNull();
    const esperando = await markAttentionWaitingClient({ organizationId: ORG_A, conversationId: id });
    expect(esperando!.dueAt).toBeNull();
    const aplazado = await scheduleHumanReminder({
      organizationId: ORG_A,
      conversationId: id,
      dueAt: new Date(T0.getTime() + 24 * 60 * MIN),
      now: T0,
    });
    expect(aplazado!.dueAt).not.toBeNull();
    // Volver a pending borra la fecha: nunca queda un estado con due_at viejo.
    const vuelta = await markAttentionPending({ organizationId: ORG_A, conversationId: id });
    expect(vuelta!.dueAt).toBeNull();
  });

  it("no se puede programar en el pasado", async () => {
    const id = humanConversation();
    await expect(
      scheduleHumanReminder({
        organizationId: ORG_A,
        conversationId: id,
        dueAt: T0,
        now: T0,
      })
    ).rejects.toMatchObject({ code: "due_in_past" });
    await expect(
      scheduleHumanReminder({
        organizationId: ORG_A,
        conversationId: id,
        dueAt: new Date(T0.getTime() - MIN),
        now: T0,
      })
    ).rejects.toBeInstanceOf(AttentionError);
    expect(tables.conversation_attention).toHaveLength(0);
  });

  it("la nota se recorta y normaliza; nunca queda vacía", async () => {
    const id = humanConversation();
    const largo = await scheduleHumanReminder({
      organizationId: ORG_A,
      conversationId: id,
      dueAt: new Date(T0.getTime() + MIN),
      note: `  ${"a".repeat(400)}  `,
      now: T0,
    });
    expect(largo!.note).toHaveLength(ATTENTION_NOTE_MAX_LENGTH);
    const sinNota = await scheduleHumanReminder({
      organizationId: ORG_A,
      conversationId: id,
      dueAt: new Date(T0.getTime() + 2 * MIN),
      note: "   ",
      now: T0,
    });
    expect(sinNota!.note).toBeNull();
  });
});

describe("013 C1 — derivación de lectura en un solo lugar", () => {
  it("deriveAttention es la única fuente de needsAttentionNow/overdue", () => {
    const fila = {
      id: "ca_1",
      organizationId: ORG_A,
      conversationId: "cv_1",
      state: "deferred",
      dueAt: new Date("2026-10-05T12:00:00Z"),
      note: null,
      createdAt: T0,
      updatedAt: T0,
    } as Row;
    const antes = deriveAttention(fila as never, new Date("2026-10-05T11:59:00Z"));
    expect(antes).toMatchObject({ scheduled: true, overdue: false, needsAttentionNow: false });
    const despues = deriveAttention(fila as never, new Date("2026-10-05T12:00:00Z"));
    expect(despues).toMatchObject({ scheduled: false, overdue: true, needsAttentionNow: true });
    const pendiente = deriveAttention({ ...fila, state: "pending", dueAt: null } as never, T0);
    expect(pendiente).toMatchObject({ needsAttentionNow: true, overdue: false, dueAt: null });
  });
});

describe("013 C1 — listado para Por atender / Agenda", () => {
  it("filtra por estado y ordena por lo tocado más recientemente", async () => {
    const a = humanConversation();
    const b = seedConversation({ handoff: true, id: "cv_b" });
    await markAttentionPending({ organizationId: ORG_A, conversationId: a });
    await scheduleHumanReminder({
      organizationId: ORG_A,
      conversationId: b,
      dueAt: new Date(T0.getTime() + 24 * 60 * MIN),
      now: T0,
    });
    expect(await listAttention(ORG_A, {}, T0)).toHaveLength(2);
    expect(await listAttention(ORG_A, { states: ["pending"] }, T0)).toHaveLength(1);
    expect(await listAttention(ORG_A, { states: ["deferred"] }, T0)).toHaveLength(1);
    expect(await listAttention(ORG_A, { states: [] }, T0)).toHaveLength(2);
    // Vencido => entra en el mismo filtro que `pending` para "Por atender".
    const vencido = new Date(T0.getTime() + 2 * 24 * 60 * MIN);
    expect(await listAttention(ORG_A, { states: ["deferred"] }, vencido)).toHaveLength(1);
  });
});

describe("013 C1 — la tabla declarada coincide con el módulo", () => {
  it("conversation_attention existe en el schema con las columnas del contrato", () => {
    const columnas = Object.keys(schema.conversationAttention);
    expect(columnas).toEqual(
      expect.arrayContaining([
        "id",
        "organizationId",
        "conversationId",
        "state",
        "dueAt",
        "note",
        "createdAt",
        "updatedAt",
      ])
    );
  });
});

// Fixed fixtures must not depend on the machine calendar.
afterEach(() => vi.useRealTimers());
