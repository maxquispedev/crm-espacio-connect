import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemDb, type Row, type Tables } from "../fixtures/mem-db";
import { UnauthorizedError } from "@/lib/auth/session";

/**
 * 013 C3 — LA AGENDA NO ENVÍA NADA. Es un requisito de producto, no un extra
 * (plan §5 D-5).
 *
 * El corte 1 ya probó que `attention.ts` no envía. Aquí se cubre la superficie
 * NUEVA de este corte —el store de la Agenda y los tres endpoints— por las dos
 * vías que yaembleron en el corte 1, porque son las que se rompen en la práctica:
 *
 *  1. ESTRUCTURAL: los ficheros nuevos no importan ni nombran nada capaz de
 *     enviar, ni la tabla ni la columna del motor automático. Si alguien "casi"
 *     lo conecta, el test se pone rojo antes de que llegue a producción.
 *  2. DINÁMICO: se ejecuta el camino COMPLETO por los endpoints reales (programar,
 *     listar, vencer, cancelar) con TODOS los colaboradores de envío
 *     sabotajeados. Si alguno se llama, revienta el test.
 *
 * Y se afirma lo contrario de lo que suele implementarse por error: un
 * recordatorio NO encola un follow-up. `sales_follow_up_job` se declara en el
 * doble precisamente para poder comprobar que sigue vacía.
 */

const root = path.resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

/**
 * Código sin comentarios. Hace falta porque estos ficheros DOCUMENTAN a
 * propósito que no tocan el motor: sin quitar los comentarios, la propia
 * explicación ("no se toca `sales_follow_up_job`") haría fallar la comprobación.
 * Lo que se audita es el código que se ejecuta, no la prosa.
 */
const codeOf = (relative: string): string =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\s\/\/.*$/gm, " ");

const SABOTAGE = "el camino de la Agenda intentó enviar o encolar un seguimiento";
const graphRequest = vi.hoisted(() => vi.fn(() => { throw new Error(SABOTAGE); }));
const sendText = vi.hoisted(() => vi.fn(() => { throw new Error(SABOTAGE); }));
const sendMediaMessage = vi.hoisted(() => vi.fn(() => { throw new Error(SABOTAGE); }));
const sendTemplate = vi.hoisted(() => vi.fn(() => { throw new Error(SABOTAGE); }));
const enqueueFollowUp = vi.hoisted(() => vi.fn(() => { throw new Error(SABOTAGE); }));
const enqueueFollowUpAttempt = vi.hoisted(() => vi.fn(() => { throw new Error(SABOTAGE); }));
const scheduleManualFollowUp = vi.hoisted(() => vi.fn(() => { throw new Error(SABOTAGE); }));
const scheduleNextFollowUp = vi.hoisted(() => vi.fn(() => { throw new Error(SABOTAGE); }));
const runDueFollowUps = vi.hoisted(() => vi.fn(() => { throw new Error(SABOTAGE); }));
const startSalesFollowUpWorker = vi.hoisted(() => vi.fn(() => { throw new Error(SABOTAGE); }));

let org: string | null = "org_a";
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<object>()),
  requireSession: async () => {
    if (!org) throw new UnauthorizedError();
    return { userId: "u_test", organizationId: org, role: "member" };
  },
}));

const tables: Tables = {
  conversation: [],
  conversation_attention: [],
  contact: [],
  ad_attribution: [],
  sales_follow_up_job: [],
};
const db = createMemDb(tables);
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  getDb: () => db,
}));
vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return {
    ...original,
    graphRequest,
    uploadGraphMedia: vi.fn(() => { throw new Error(SABOTAGE); }),
  };
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
  enqueueFollowUp,
  enqueueFollowUpAttempt,
  scheduleManualFollowUp,
  scheduleNextFollowUp,
  loadConversationFollowUpState: vi.fn(() => null),
}));
vi.mock("@/server/sales/follow-ups/worker", () => ({
  runDueFollowUps,
  startSalesFollowUpWorker,
}));

const { GET, POST } = await import("@/app/api/reminders/route");
const { DELETE } = await import("@/app/api/reminders/[conversationId]/route");
const { POST: MARCAR_ATENDIDO } = await import(
  "@/app/api/conversations/[id]/attention/route"
);
const { listAgenda } = await import("@/server/inbox/agenda");
const { markAttentionPending } = await import("@/server/inbox/attention");

const ORG_A = "org_a";
const AHORA = new Date("2026-10-05T17:00:00Z");
const H = 3_600_000;

/**
 * 013 C4 amplía la lista: el flujo operativo completo (el endpoint de "Marcar
 * atendido", el bloque de atención, el vocabulario compartido y los dos ficheros
 * de la Bandeja) hereda la misma promesa — resolver una cola humana es escribir
 * un estado, nunca mandar un mensaje. Si alguno de ellos "casi" se conectara al
 * sender, esta lista lo delata.
 */
const FICHEROS_DE_LA_AGENDA = [
  "src/server/inbox/agenda.ts",
  "src/server/inbox/agenda-buckets.ts",
  "src/app/api/reminders/route.ts",
  "src/app/api/reminders/[conversationId]/route.ts",
  "src/app/api/conversations/[id]/attention/route.ts",
  "src/app/(app)/agenda/page.tsx",
  "src/components/agenda/agenda-client.tsx",
  "src/components/inbox/reminder-schedule.tsx",
  "src/components/inbox/attention-block.tsx",
  "src/components/inbox/conversation-list.tsx",
  "src/components/inbox/bandeja-filtros.ts",
  "src/lib/operational-state.ts",
];

function sembrarHumana(id: string) {
  tables.contact!.push({
    id: `ct_${id}`,
    organizationId: ORG_A,
    waIdentity: `bsuid:${id}`,
    name: id,
    phone: null,
  } as Row);
  tables.conversation!.push({
    id,
    organizationId: ORG_A,
    contactId: `ct_${id}`,
    isTest: false,
    aiEnabled: false,
    handoffAt: new Date("2026-10-01T10:00:00Z"),
    handoffReason: "cliente",
    lastInboundAt: new Date("2026-10-01T10:00:00Z"),
    unreadCount: 0,
    createdAt: new Date("2026-10-01T10:00:00Z"),
    updatedAt: new Date("2026-10-01T10:00:00Z"),
  } as Row);
}

afterEach(() => vi.useRealTimers());

beforeEach(() => {
  org = "org_a";
  for (const bucket of Object.values(tables)) bucket!.length = 0;
  for (const mock of [
    graphRequest,
    sendText,
    sendMediaMessage,
    sendTemplate,
    enqueueFollowUp,
    enqueueFollowUpAttempt,
    scheduleManualFollowUp,
    scheduleNextFollowUp,
    runDueFollowUps,
    startSalesFollowUpWorker,
  ]) {
    mock.mockClear();
  }
});

describe("013 C3 — prueba estructural: la Agenda no tiene con qué enviar", () => {
  it("ningún fichero de la Agenda importa el sender, Graph, plantillas ni el motor", () => {
    for (const file of FICHEROS_DE_LA_AGENDA) {
      const source = read(file);
      const imports = source.match(/^\s*import .*$/gm)?.join("\n") ?? "";
      for (const prohibido of [
        "inbox/send",
        "meta/client",
        "whatsapp/templates",
        "whatsapp/credentials",
        "sales/follow-ups",
        "ai/delivery",
        "inbox/webhook",
      ]) {
        expect(imports, `${file} no debe importar ${prohibido}`).not.toContain(prohibido);
      }
    }
  });

  it("ningún fichero de la Agenda nombra funciones que envían", () => {
    for (const file of FICHEROS_DE_LA_AGENDA) {
      const source = read(file);
      expect(source, file).not.toMatch(
        /graphRequest|uploadGraphMedia|sendText|sendMediaMessage|sendStructured|sendTemplate/
      );
    }
  });

  it("la Agenda no toca la tabla ni la columna del motor automático (D-2/D-3)", () => {
    for (const file of FICHEROS_DE_LA_AGENDA) {
      const code = codeOf(file);
      expect(code, file).not.toContain("sales_follow_up_job");
      expect(code, file).not.toContain("nextFollowUpAt");
      expect(code, file).not.toContain("salesFollowUpJob");
    }
  });

  it("el worker de follow-ups no conoce la Agenda ni la atención", () => {
    for (const file of [
      "src/server/sales/follow-ups/store.ts",
      "src/server/sales/follow-ups/worker.ts",
      "src/server/sales/follow-ups/policy.ts",
      "src/server/sales/follow-ups/follow-up-writer.ts",
      "src/server/sales/follow-ups/index.ts",
      "src/instrumentation-node.ts",
    ]) {
      expect(read(file), file).not.toContain("inbox/attention");
      expect(read(file), file).not.toContain("inbox/agenda");
      expect(read(file), file).not.toContain("api/reminders");
    }
  });

  it("el endpoint de follow-ups sigue rechazando la vía humana (no se duplicaron)", () => {
    // Si alguien "arreglara" este endpoint para aceptar la vía humana, la
    // Agenda habría dejado de ser el único mecanismo y el corte 1 se habría
    // deshecho. Se afirma explícitamente.
    const source = read("src/app/api/pipeline/leads/[id]/follow-up/route.ts");
    expect(source).toContain("human_lane");
    expect(source).toContain("handoff_active");
  });
});

describe("013 C3 — prueba dinámica: el camino completo no envía ni encola", () => {
  it("programar, listar, vencer, recibir al cliente y cancelar no toca Graph, sender ni el motor", async () => {
    vi.useFakeTimers({ now: AHORA });
    sembrarHumana("cv_1");
    const endpoint = (cuerpo: Record<string, unknown>) =>
      new Request("http://localhost/api/reminders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cuerpo),
      });

    // 1) Programar por el endpoint real con reloj fijado a AHORA: la fixture
    //    sigue siendo futura cuando este test se ejecuta otro día.
    const creado = await POST(
      endpoint({ conversationId: "cv_1", dueAt: new Date(AHORA.getTime() + 2 * H).toISOString(), note: "jueves 10:00" })
    );
    expect(creado.status).toBe(201);

    // 2) Listar la Agenda: los cinco grupos ya calculados.
    const listado = await GET(new Request("http://localhost/api/reminders"));
    expect(listado.status).toBe(200);
    const agenda = (await listado.json()) as { total: number };
    expect(agenda.total).toBe(1);

    // 3) "Vencer": solo se mueve el reloj del servidor. Ni cron, ni worker.
    const vencido = await listAgenda({
      organizationId: ORG_A,
      now: new Date(AHORA.getTime() + 3 * H),
      timeZone: "America/Lima",
    });
    expect(vencido.buckets.overdue).toHaveLength(1);
    expect(vencido.buckets.overdue[0]?.needsAttentionNow).toBe(true);

    // 4) El cliente escribe antes de la hora: vuelve a la cola humana.
    await markAttentionPending({ organizationId: ORG_A, conversationId: "cv_1" });
    expect(tables.conversation_attention![0]!.state).toBe("pending");

    // 5) Con trabajo vivo, cancelar se rechaza a propósito (409): "cancelar" no
    //    es una forma de borrar un pendiente de la cola.
    const rechazado = await DELETE(
      new Request("http://localhost/api/reminders/cv_1", { method: "DELETE" }),
      { params: Promise.resolve({ conversationId: "cv_1" }) }
    );
    expect(rechazado.status).toBe(409);

    // 6) Se reprograma (reemplazando, no acumulando) y esa sí se cancela.
    const reprogramado = await POST(
      endpoint({ conversationId: "cv_1", dueAt: new Date(Date.now() + 72 * H).toISOString() })
    );
    expect(reprogramado.status).toBe(201);
    expect(tables.conversation_attention).toHaveLength(1);
    const cancelado = await DELETE(
      new Request("http://localhost/api/reminders/cv_1", { method: "DELETE" }),
      { params: Promise.resolve({ conversationId: "cv_1" }) }
    );
    expect(cancelado.status).toBe(200);
    expect(tables.conversation_attention).toHaveLength(0);

    for (const [nombre, mock] of [
      ["graphRequest", graphRequest],
      ["sendText", sendText],
      ["sendMediaMessage", sendMediaMessage],
      ["sendTemplate", sendTemplate],
      ["enqueueFollowUp", enqueueFollowUp],
      ["enqueueFollowUpAttempt", enqueueFollowUpAttempt],
      ["scheduleManualFollowUp", scheduleManualFollowUp],
      ["scheduleNextFollowUp", scheduleNextFollowUp],
      ["runDueFollowUps", runDueFollowUps],
      ["startSalesFollowUpWorker", startSalesFollowUpWorker],
    ] as const) {
      expect(mock, nombre).not.toHaveBeenCalled();
    }
  });

  it("un recordatorio NO crea un seguimiento automático", async () => {
    sembrarHumana("cv_1");
    const res = await POST(
      new Request("http://localhost/api/reminders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: "cv_1",
          dueAt: new Date(Date.now() + 24 * H).toISOString(),
        }),
      })
    );
    expect(res.status).toBe(201);
    // La tabla del motor sigue vacía: el recordatorio vive solo en la humana.
    expect(tables.sales_follow_up_job).toHaveLength(0);
    expect(tables.conversation_attention).toHaveLength(1);
  });

  it("'Marcar atendido' resuelve la cola sin enviar ni encolar nada", async () => {
    // 013 C4: la acción nueva de la conversación pasa por la MISMA prueba que
    // la Agenda. Resolver "Por atender" tocando un estado no puede terminar en un
    // WhatsApp ni en un follow-up encolado.
    sembrarHumana("cv_1");
    await POST(
      new Request("http://localhost/api/reminders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: "cv_1",
          dueAt: new Date(Date.now() + 24 * H).toISOString(),
        }),
      })
    );
    expect(tables.conversation_attention![0]!.state).toBe("deferred");

    const res = await MARCAR_ATENDIDO(
      new Request("http://localhost/api/conversations/cv_1/attention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "waiting_client" }),
      }),
      { params: Promise.resolve({ id: "cv_1" }) }
    );
    expect(res.status).toBe(200);
    expect(tables.conversation_attention![0]!.state).toBe("waiting_client");
    // La fila se actualizó: no se añadió una segunda conversación al motor.
    expect(tables.conversation_attention).toHaveLength(1);
    expect(tables.sales_follow_up_job).toHaveLength(0);
    for (const [nombre, mock] of [
      ["graphRequest", graphRequest],
      ["sendText", sendText],
      ["sendMediaMessage", sendMediaMessage],
      ["sendTemplate", sendTemplate],
      ["enqueueFollowUp", enqueueFollowUp],
      ["scheduleNextFollowUp", scheduleNextFollowUp],
    ] as const) {
      expect(mock, nombre).not.toHaveBeenCalled();
    }
  });

  it("el sandbox del Laboratorio no tiene efecto en la atención ni en Graph", async () => {
    // Conversación de prueba: aunque se le intente colgar un recordatorio, el
    // endpoint lo rechaza y nada sale hacia la API real.
    tables.contact!.push({
      id: "ct_lab",
      organizationId: ORG_A,
      waIdentity: "bsuid:lab",
      name: "Caso de laboratorio",
      phone: null,
    } as Row);
    tables.conversation!.push({
      id: "cv_lab",
      organizationId: ORG_A,
      contactId: "ct_lab",
      isTest: true,
      aiEnabled: false,
      handoffAt: null,
      lastInboundAt: null,
      unreadCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Row);

    const res = await POST(
      new Request("http://localhost/api/reminders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: "cv_lab",
          dueAt: new Date(Date.now() + 24 * H).toISOString(),
        }),
      })
    );
    expect(res.status).toBe(409);
    expect(tables.conversation_attention).toHaveLength(0);
    // Y la Agenda no la lista aunque la fila existiera.
    const agenda = await listAgenda({ organizationId: ORG_A, now: new Date(), timeZone: "UTC" });
    expect(agenda.total).toBe(0);
    for (const mock of [graphRequest, sendText, sendTemplate, enqueueFollowUp, runDueFollowUps]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });
});
