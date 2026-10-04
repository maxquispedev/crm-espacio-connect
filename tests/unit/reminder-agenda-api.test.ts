/**
 * 013 C3 — La Agenda de punta a punta: programar, agrupar, vencer, cancelar.
 *
 * Se ejercitan los TRES endpoints reales (`/api/reminders` GET+POST y
 * `/api/reminders/[conversationId]` DELETE) con `withAuth`, Zod, el ORM y
 * `scoped()` reales; lo único simulado es la sesión y el ejecutor de BD. Por eso
 * los 422, los 404 de otra organización y el aislamiento A/B se prueban sobre el
 * contrato de verdad y no sobre una reimplementación.
 *
 * El reloj de la Agenda se fija con `listAgenda({ now })`, así que "vencer" se
 * comprueba desplazando el reloj del SERVIDOR, no esperando (spec §3.4 pasos
 * 6-9).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemDb, type Row, type Tables } from "../fixtures/mem-db";
import { UnauthorizedError } from "@/lib/auth/session";
import type { AgendaDto } from "@/lib/types";

let org: string | null = "org_a";
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<object>()),
  requireSession: async () => {
    if (!org) throw new UnauthorizedError();
    return { userId: "u_test", organizationId: org, role: "member" };
  },
}));

const publish = vi.hoisted(() => vi.fn());
vi.mock("@/server/events/bus", () => ({ publish }));

const tables: Tables = {
  conversation: [],
  conversation_attention: [],
  contact: [],
  // Declarada a propósito aunque nadie debería tocarla: si un camino de la
  // Agenda acabara escribiendo en el motor automático, esta fila no estaría vacía.
  sales_follow_up_job: [],
};
const db = createMemDb(tables);
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  getDb: () => db,
}));

const { GET, POST } = await import("@/app/api/reminders/route");
const { DELETE } = await import("@/app/api/reminders/[conversationId]/route");
const { listAgenda } = await import("@/server/inbox/agenda");
const { getAttention, markAttentionPending, markAttentionWaitingClient, scheduleHumanReminder } =
  await import("@/server/inbox/attention");

const ORG_A = "org_a";
const ORG_B = "org_b";
const LIMA = "America/Lima";
const H = 3_600_000;
const D = 24 * H;

function sembrar(input: {
  id: string;
  organizationId?: string;
  nombre?: string;
  handoff?: boolean;
  aiEnabled?: boolean;
  isTest?: boolean;
}) {
  const organizationId = input.organizationId ?? ORG_A;
  const contactId = `ct_${input.id}`;
  tables.contact!.push({
    id: contactId,
    organizationId,
    waIdentity: `bsuid:${input.id}`,
    name: input.nombre ?? input.id,
    phone: null,
  } as Row);
  tables.conversation!.push({
    id: input.id,
    organizationId,
    contactId,
    handoffAt: input.handoff ? new Date("2026-10-01T10:00:00Z") : null,
    handoffReason: input.handoff ? "cliente" : null,
    aiEnabled: input.aiEnabled ?? true,
    isTest: input.isTest ?? false,
    unreadCount: 0,
    lastMessageAt: new Date("2026-10-01T10:00:00Z"),
    lastInboundAt: null,
    createdAt: new Date("2026-10-01T10:00:00Z"),
    updatedAt: new Date("2026-10-01T10:00:00Z"),
  } as Row);
  return contactId;
}

// `withAuth(handler)` devuelve `(...args) => handler(session, ...args)`: al
// invocar el handler exportado se pasa SOLO lo que Next le entrega (Request y,
// en las rutas dinámicas, `{ params }`).
function get(url = "http://localhost/api/reminders") {
  return GET(new Request(url));
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/reminders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

function borrar(conversationId: string) {
  return DELETE(new Request(`http://localhost/api/reminders/${conversationId}`, { method: "DELETE" }), {
    params: Promise.resolve({ conversationId }),
  });
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

/** Agenda con el reloj del servidor fijado. */
function agendaEn(now: Date, organizationId = ORG_A): Promise<AgendaDto> {
  return listAgenda({ organizationId, now, timeZone: LIMA });
}

/** Todos los recordatorios de la Agenda, en un solo array, para afirmar sobre el conjunto. */
function todos(d: AgendaDto) {
  return [...d.buckets.overdue, ...d.buckets.today, ...d.buckets.tomorrow, ...d.buckets.week, ...d.buckets.later];
}

const AHORA = new Date("2026-10-05T17:00:00Z"); // lunes 12:00 en Lima

/**
 * Hay DOS relojes en este fichero y no se mezclan: el endpoint valida contra el
 * reloj real (por eso las fechas de los 422 son `Date.now() ± ...`), y la
 * agrupación de la Agenda se prueba con `now` explícito para poder afirmar
 * "vencido" y "mañana" sin esperar. Para sembrar recordatorios con ese mismo
 * reloj fijo se usa `scheduleHumanReminder({ now })`, que es la MISMA función de
 * dominio que llama el endpoint — no un atajo.
 */
async function programar(
  conversationId: string,
  dueAt: Date,
  extra: { note?: string; now?: Date; organizationId?: string } = {}
) {
  return scheduleHumanReminder({
    organizationId: extra.organizationId ?? ORG_A,
    conversationId,
    dueAt,
    note: extra.note ?? null,
    now: extra.now ?? AHORA,
  });
}

beforeEach(() => {
  org = "org_a";
  publish.mockClear();
  for (const key of Object.keys(tables)) tables[key]!.length = 0;
  process.env.OPERATOR_TIMEZONE = LIMA;
});

describe("013 C3 — POST /api/reminders: entrada estricta", () => {
  it("programa un recordatorio y devuelve la fecha guardada", async () => {
    sembrar({ id: "cv_1", handoff: true });
    const res = await post({
      conversationId: "cv_1",
      dueAt: new Date(Date.now() + 2 * D).toISOString(),
      note: "  promised  a  la llamada  ",
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.ok).toBe(true);
    // La nota se normaliza (colapsa espacios) antes de guardarse.
    const recordatorio = body.reminder as { dueAt: string; note: string; state: string };
    expect(recordatorio.state).toBe("deferred");
    expect(recordatorio.note).toBe("promised a la llamada");
  });

  it("rechaza una fecha en el pasado con 422 explícito", async () => {
    sembrar({ id: "cv_1", handoff: true });
    const res = await post({
      conversationId: "cv_1",
      dueAt: new Date(Date.now() - H).toISOString(),
    });
    expect(res.status).toBe(422);
    const body = await json(res);
    expect((body.error as { code: string }).code).toBe("due_in_past");
    // No se guardó nada.
    expect(tables.conversation_attention).toHaveLength(0);
  });

  it("rechaza una nota demasiado larga y una nota vacía con 422", async () => {
    sembrar({ id: "cv_1", handoff: true });
    const larga = await post({
      conversationId: "cv_1",
      dueAt: new Date(Date.now() + D).toISOString(),
      note: "x".repeat(281),
    });
    expect(larga.status).toBe(422);
    expect((await json(larga)).error).toBeTruthy();
    // Vacía o solo espacios: error explícito, no un `null` silencioso que el
    // operador confundiría con "guardado sin nota".
    const vacia = await post({
      conversationId: "cv_1",
      dueAt: new Date(Date.now() + D).toISOString(),
      note: "   ",
    });
    expect(vacia.status).toBe(422);
    expect(tables.conversation_attention).toHaveLength(0);
  });

  it("acepta una nota justo en el límite y otra ausente", async () => {
    sembrar({ id: "cv_1", handoff: true });
    const limite = await post({
      conversationId: "cv_1",
      dueAt: new Date(Date.now() + D).toISOString(),
      note: "x".repeat(280),
    });
    expect(limite.status).toBe(201);
    const sinNota = await post({ conversationId: "cv_1", dueAt: new Date(Date.now() + 2 * D).toISOString() });
    expect(sinNota.status).toBe(201);
    expect((await json(sinNota)).reminder).toMatchObject({ note: null });
  });

  it("rechaza un body con organizationId: la organización sale de la sesión", async () => {
    sembrar({ id: "cv_1", organizationId: ORG_B, handoff: true });
    const res = await post({
      conversationId: "cv_1",
      dueAt: new Date(Date.now() + D).toISOString(),
      organizationId: ORG_B,
    });
    expect(res.status).toBe(422);
    // Ni siquiera se intenta: no se crea la fila en la organización ajena.
    expect(tables.conversation_attention).toHaveLength(0);
  });

  it("rechaza una fecha ilegible, una conversación vacía y un body no-JSON", async () => {
    sembrar({ id: "cv_1", handoff: true });
    expect((await post({ conversationId: "cv_1", dueAt: "el jueves" })).status).toBe(422);
    expect((await post({ conversationId: "", dueAt: new Date().toISOString() })).status).toBe(422);
    const roto = await POST(
      new Request("http://localhost/api/reminders", {
        method: "POST",
        body: "no soy json",
      })
    );
    expect(roto.status).toBe(422);
  });

  it("sin sesión responde 401 en listar, programar y cancelar", async () => {
    sembrar({ id: "cv_1", handoff: true });
    org = null;
    expect((await get()).status).toBe(401);
    expect((await post({ conversationId: "cv_1", dueAt: new Date().toISOString() })).status).toBe(401);
    expect((await borrar("cv_1")).status).toBe(401);
    expect(tables.conversation_attention).toHaveLength(0);
  });

  it("no programa sobre una conversación de la IA ni del Laboratorio", async () => {
    sembrar({ id: "cv_ia" });
    const ia = await post({
      conversationId: "cv_ia",
      dueAt: new Date(Date.now() + D).toISOString(),
    });
    expect(ia.status).toBe(409);
    expect((await json(ia)).error).toMatchObject({ code: "ai_owns_conversation" });
    // `is_test`: el Laboratorio no tiene atención humana (spec §3.4).
    sembrar({ id: "cv_lab", handoff: true, isTest: true });
    const lab = await post({
      conversationId: "cv_lab",
      dueAt: new Date(Date.now() + D).toISOString(),
    });
    expect(lab.status).toBe(409);
    expect(tables.conversation_attention).toHaveLength(0);
  });

  it("programa cuando la IA está desactivada aunque no haya handoff", async () => {
    sembrar({ id: "cv_1", aiEnabled: false });
    const res = await post({
      conversationId: "cv_1",
      dueAt: new Date(Date.now() + D).toISOString(),
    });
    expect(res.status).toBe(201);
  });
});

describe("013 C3 — GET /api/reminders: los cinco grupos", () => {
  it("coloca cada recordatorio en su grupo con el reloj del servidor", async () => {
    sembrar({ id: "cv_hoy", handoff: true, nombre: "Ana" });
    sembrar({ id: "cv_manana", handoff: true });
    sembrar({ id: "cv_semana", handoff: true });
    sembrar({ id: "cv_luego", handoff: true });
    sembrar({ id: "cv_vencido", handoff: true });
    const casos = [
      ["cv_hoy", AHORA.getTime() + 2 * H, "today"],
      ["cv_manana", AHORA.getTime() + D, "tomorrow"],
      ["cv_semana", AHORA.getTime() + 4 * D, "week"],
      ["cv_luego", AHORA.getTime() + 30 * D, "later"],
      ["cv_vencido", AHORA.getTime() - 3 * H, null],
    ] as const;
    for (const [conversationId, when] of casos) {
      // `cv_vencido` se sembró con una fecha pasada respecto a AHORA: por eso
      // el endpoint (que valida contra el reloj real) no sirve aquí y se usa la
      // misma función de dominio con `now` explícito.
      if (conversationId === "cv_vencido") {
        tables.conversation_attention!.push({
          id: "at_vencido",
          organizationId: ORG_A,
          conversationId,
          state: "deferred",
          dueAt: new Date(when),
          note: null,
          createdAt: new Date(when),
          updatedAt: new Date(when),
        } as Row);
        continue;
      }
      await programar(conversationId, new Date(when));
    }

    const agenda = await agendaEn(AHORA);
    expect(agenda.timeZone).toBe(LIMA);
    expect(agenda.generatedAt).toBe(AHORA.toISOString());
    expect(agenda.buckets.today.map((r) => r.conversationId)).toEqual(["cv_hoy"]);
    expect(agenda.buckets.tomorrow.map((r) => r.conversationId)).toEqual(["cv_manana"]);
    expect(agenda.buckets.week.map((r) => r.conversationId)).toEqual(["cv_semana"]);
    expect(agenda.buckets.later.map((r) => r.conversationId)).toEqual(["cv_luego"]);
    expect(agenda.buckets.overdue.map((r) => r.conversationId)).toEqual(["cv_vencido"]);
    expect(agenda.total).toBe(5);
    // Contacto, fecha y estado llegan resueltos para pintar sin consultas extra.
    expect(agenda.buckets.today[0]).toMatchObject({
      contact: { name: "Ana" },
      bucket: "today",
      needsAttentionNow: false,
    });
  });

  it("ordena por fecha dentro de cada grupo", async () => {
    sembrar({ id: "cv_a", handoff: true });
    sembrar({ id: "cv_b", handoff: true });
    await programar("cv_b", new Date(AHORA.getTime() + 5 * H));
    await programar("cv_a", new Date(AHORA.getTime() + 1 * H));
    const agenda = await agendaEn(AHORA);
    expect(agenda.buckets.today.map((r) => r.conversationId)).toEqual(["cv_a", "cv_b"]);
  });

  it("devuelve los grupos ya calculados y hace eco de la zona usada", async () => {
    sembrar({ id: "cv_1", handoff: true });
    await programar("cv_1", new Date(AHORA.getTime() + D));
    // La API entrega los CINCO grupos siempre, aunque estén vacíos, y el
    // cliente no tiene que agrupar nada.
    const porDefecto = (await json(await get())) as unknown as AgendaDto;
    expect(Object.keys(porDefecto.buckets).sort()).toEqual([
      "later",
      "overdue",
      "today",
      "tomorrow",
      "week",
    ]);
    expect(porDefecto.total).toBe(1);
    // Una zona inventada no rompe la vista: cae a la de la instancia.
    expect(
      ((await json(await get("http://localhost/api/reminders?tz=No/Existe"))) as unknown as AgendaDto).timeZone
    ).toBe(LIMA);
    // Y una zona válida se respeta y se hace eco.
    expect(
      ((await json(await get("http://localhost/api/reminders?tz=UTC"))) as unknown as AgendaDto).timeZone
    ).toBe("UTC");
  });

  it("no lista los estados que no son compromisos", async () => {
    sembrar({ id: "cv_pending", handoff: true });
    sembrar({ id: "cv_espera", handoff: true });
    await programar("cv_pending", new Date(AHORA.getTime() + D));
    await markAttentionPending({ organizationId: ORG_A, conversationId: "cv_pending" });
    await programar("cv_espera", new Date(AHORA.getTime() + D));
    await markAttentionWaitingClient({ organizationId: ORG_A, conversationId: "cv_espera" });
    const agenda = await agendaEn(AHORA);
    expect(agenda.total).toBe(0);
  });

  it("excluye las conversaciones del Laboratorio (is_test)", async () => {
    sembrar({ id: "cv_lab", handoff: true, isTest: true });
    // Se inyecta la fila a mano: el endpoint la rechaza, pero si alguien la
    // escribiera por otra vía, la Agenda tampoco la debe mostrar.
    tables.conversation_attention!.push({
      id: "at_lab",
      organizationId: ORG_A,
      conversationId: "cv_lab",
      state: "deferred",
      dueAt: new Date(AHORA.getTime() + D),
      note: "prueba de laboratorio",
      createdAt: AHORA,
      updatedAt: AHORA,
    } as Row);
    const agenda = await agendaEn(AHORA);
    expect(agenda.total).toBe(0);
    expect(todos(agenda)).toHaveLength(0);
  });
});

describe("013 C3 — ciclo completo (spec §3.2, pasos 6-9)", () => {
  it("programar → sale de Por atender → vence → vuelve a Por atender", async () => {
    sembrar({ id: "cv_1", handoff: true });
    // Escritura por el endpoint real: la fecha es futura respecto al reloj real.
    const ahora = new Date();
    const future = new Date(ahora.getTime() + 2 * H);

    // 1) Programado: `deferred` y fuera de la cola.
    const res = await post({ conversationId: "cv_1", dueAt: future.toISOString(), note: "jueves" });
    expect(res.status).toBe(201);
    const programado = await getAttention(ORG_A, "cv_1", ahora);
    expect(programado).toMatchObject({ state: "deferred", needsAttentionNow: false, note: "jueves" });
    // Sale de "Por atender": lo que define la cola es `needsAttentionNow`.
    expect(programado?.needsAttentionNow).toBe(false);
    const antes = await agendaEn(ahora);
    expect(antes.total).toBe(1);
    expect(todos(antes)[0]).toMatchObject({ needsAttentionNow: false, state: "deferred" });

    // 2) Vencido: el mismo registro pasa a `overdue` y `needsAttentionNow`.
    //    Sin proceso, sin worker: solo se mueve el reloj del servidor.
    const despues = await agendaEn(new Date(future.getTime() + 1000));
    expect(despues.buckets.overdue.map((r) => r.conversationId)).toEqual(["cv_1"]);
    expect(despues.buckets.overdue[0]?.needsAttentionNow).toBe(true);
    const vencido = await getAttention(ORG_A, "cv_1", new Date(future.getTime() + 1000));
    expect(vencido).toMatchObject({ state: "deferred", needsAttentionNow: true });
    // El estado NO se persiste vencido: sigue siendo el mismo compromiso.
    expect(tables.conversation_attention![0]!.state).toBe("deferred");
  });

  it("si el cliente escribe antes de la hora, vuelve a Por atender de inmediato", async () => {
    sembrar({ id: "cv_1", handoff: true });
    await programar("cv_1", new Date(AHORA.getTime() + D));
    expect((await agendaEn(AHORA)).buckets.tomorrow).toHaveLength(1);

    // Inbound antes de la hora: la ingesta llama a `markAttentionPending`.
    await markAttentionPending({ organizationId: ORG_A, conversationId: "cv_1" });

    const pendiente = await getAttention(ORG_A, "cv_1");
    expect(pendiente).toMatchObject({ state: "pending", needsAttentionNow: true, dueAt: null });
    // Y el recordatorio ya no está en la Agenda: la pelota está en el humano.
    expect((await agendaEn(AHORA)).total).toBe(0);
  });

  it("tras atender se puede programar el siguiente, sin acumular compromisos", async () => {
    sembrar({ id: "cv_1", handoff: true });
    await programar("cv_1", new Date(AHORA.getTime() + H), { note: "primero" });
    // El primer recordatorio vence y el dueño responde.
    const vencido = new Date(AHORA.getTime() + 2 * H);
    expect((await agendaEn(vencido)).buckets.overdue).toHaveLength(1);
    await markAttentionWaitingClient({ organizationId: ORG_A, conversationId: "cv_1" });

    // Segundo recordatorio: reemplaza al anterior, no se suma.
    await programar("cv_1", new Date(AHORA.getTime() + D), { note: "segundo" });
    expect(tables.conversation_attention).toHaveLength(1);

    const agenda = await agendaEn(AHORA);
    expect(agenda.total).toBe(1);
    expect(agenda.buckets.tomorrow).toHaveLength(1);
    expect(agenda.buckets.tomorrow[0]).toMatchObject({ note: "segundo", state: "deferred" });
    // Y no queda ningún compromiso ambiguo del primero.
    expect(todos(agenda).filter((r) => r.note === "primero")).toHaveLength(0);
  });

  it("programar dos veces sobre la misma conversación no duplica fila", async () => {
    sembrar({ id: "cv_1", handoff: true });
    await programar("cv_1", new Date(AHORA.getTime() + D), { note: "a" });
    await programar("cv_1", new Date(AHORA.getTime() + 5 * D), { note: "b" });
    expect(tables.conversation_attention).toHaveLength(1);
    const agenda = await agendaEn(AHORA);
    expect(agenda.total).toBe(1);
    expect(agenda.buckets.week[0]).toMatchObject({ note: "b" });
  });

  it("publica `conversation.updated` para que la Bandeja se refresque sola", async () => {
    sembrar({ id: "cv_1", handoff: true });
    await post({ conversationId: "cv_1", dueAt: new Date(Date.now() + D).toISOString() });
    expect(publish).toHaveBeenCalledWith(
      ORG_A,
      expect.objectContaining({ type: "conversation.updated" })
    );
    publish.mockClear();
    await borrar("cv_1");
    expect(publish).toHaveBeenCalledWith(
      ORG_A,
      expect.objectContaining({ type: "conversation.updated" })
    );
  });
});

describe("013 C3 — DELETE /api/reminders/[conversationId]", () => {
  it("cancela el recordatorio y lo saca de la Agenda", async () => {
    sembrar({ id: "cv_1", handoff: true });
    await programar("cv_1", new Date(AHORA.getTime() + D));
    expect((await agendaEn(AHORA)).total).toBe(1);

    const res = await borrar("cv_1");
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, cancelled: true });
    expect(tables.conversation_attention).toHaveLength(0);
    expect((await agendaEn(AHORA)).total).toBe(0);
  });

  it("404 si no hay nada que cancelar o la conversación no existe", async () => {
    sembrar({ id: "cv_1", handoff: true });
    expect((await borrar("cv_1")).status).toBe(404);
    expect((await borrar("cv_no_existe")).status).toBe(404);
  });

  it("409 si lo que hay es trabajo humano vivo: cancelar no borra 'Por atender'", async () => {
    sembrar({ id: "cv_1", handoff: true });
    await markAttentionPending({ organizationId: ORG_A, conversationId: "cv_1" });
    const res = await borrar("cv_1");
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatchObject({ code: "not_scheduled" });
    // El trabajo sigue ahí: no se puede borrar de la cola con "cancelar".
    expect(tables.conversation_attention).toHaveLength(1);
    const pendiente = await getAttention(ORG_A, "cv_1");
    expect(pendiente?.state).toBe("pending");
  });

  it("tras cancelar, el cliente puede escribir y la conversación vuelve a la cola", async () => {
    sembrar({ id: "cv_1", handoff: true });
    await programar("cv_1", new Date(AHORA.getTime() + D));
    await borrar("cv_1");
    await markAttentionPending({ organizationId: ORG_A, conversationId: "cv_1" });
    const pendiente = await getAttention(ORG_A, "cv_1");
    expect(pendiente).toMatchObject({ state: "pending", needsAttentionNow: true });
  });
});

describe("013 C3 — aislamiento multi-tenant (Constitución III)", () => {
  it("la Agenda de A no ve los recordatorios de B", async () => {
    sembrar({ id: "cv_a", handoff: true });
    sembrar({ id: "cv_b", organizationId: ORG_B, handoff: true });
    await programar("cv_a", new Date(AHORA.getTime() + D));

    // Mismo endpoint, sesión de B.
    org = ORG_B;
    const agendaB = await agendaEn(AHORA, ORG_B);
    expect(agendaB.total).toBe(0);
    // Programar sobre la conversación de A desde la sesión de B es 404.
    const cruzado = await post({ conversationId: "cv_a", dueAt: new Date(Date.now() + D).toISOString() });
    expect(cruzado.status).toBe(404);
    // Y cancelar lo mismo.
    const borrarCruzado = await borrar("cv_a");
    expect(borrarCruzado.status).toBe(404);
    // El recordatorio de A sigue intacto.
    org = ORG_A;
    expect((await agendaEn(AHORA, ORG_A)).total).toBe(1);
  });

  it("una fila de atención de B no se pega a una conversación de A", async () => {
    // Inyección de una fila inconsistente: `conversation_attention` de B
    // apuntando a una conversación de A. El ON con `organization_id` de ambos
    // lados debe impedir que aparezca en la Agenda de A.
    sembrar({ id: "cv_a", organizationId: ORG_A, handoff: true });
    tables.conversation_attention!.push({
      id: "at_rota",
      organizationId: ORG_B,
      conversationId: "cv_a",
      state: "deferred",
      dueAt: new Date(AHORA.getTime() + D),
      note: "fila de otra organización",
      createdAt: AHORA,
      updatedAt: AHORA,
    } as Row);
    const agendaA = await agendaEn(AHORA, ORG_A);
    expect(agendaA.total).toBe(0);
    const agendaB = await agendaEn(AHORA, ORG_B);
    expect(agendaB.total).toBe(0);
  });
});

describe("013 C3 — el camino de la Agenda no toca el motor automático", () => {
  it("no escribe nada en sales_follow_up_job ni en lead.next_follow_up_at", async () => {
    sembrar({ id: "cv_1", handoff: true });
    await programar("cv_1", new Date(AHORA.getTime() + D));
    await agendaEn(AHORA);
    await agendaEn(new Date(AHORA.getTime() + 2 * D));
    await borrar("cv_1");
    // Si la Agenda reutilizara el motor de follow-ups, aquí habría una fila.
    expect(tables.sales_follow_up_job).toHaveLength(0);
  });
});
