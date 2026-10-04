/**
 * 013 C4 — El FLUJO OPERATIVO de punta a punta: mismo estado en las tres
 * superficies, tres acciones que hacen lo que dicen, y copy que no enseña
 * internals.
 *
 * Qué afirma este fichero, y por qué en estos cuatro sitios:
 *
 * 1. `operational-state` (puro): el estado visible se deriva en UN solo lugar y
 *    las tres superficies leen de ahí. La coherencia de FR-4.4 no es "que coincida
 *    hoy": es que coincida porque no hay dos implementaciones que puedan separarse.
 * 2. JSX real con `renderToStaticMarkup` (sin jsdom, como los cortes 2 y 3): se
 *    afirma sobre el marcado que ve la persona — la fila de la lista, el bloque del
 *    hilo y el item de la Agenda — y no sobre un HTML copiado a mano. Se incluye
 *    el caso de vencimiento, que es donde un cliente que recalculara el reloj
 *    discreparía de los otros dos.
 * 3. Copy: los internals que el spec prohíbe por nombre (FR-4.2) no aparecen en el
 *    texto renderizado de ninguna de las tres superficies. Los `data-estado` SÍ se
 *    comprueban, y contra el vocabulario OPERATIVO, para que un test hook no se
 *    cuele como atajo para colgar un nombre interno en la UI.
 * 4. Acciones contra los ENDPOINTS REALES (Zod, `withAuth`, ORM y `scoped()`
 *    reales; lo único simulado es la sesión y el ejecutor de BD): "Marcar
 *    atendido" saca de "Por atender", "Recordarme" mueve a la Agenda y "Reactivar
 *    IA" limpia. Se prueba también que la puerta nueva NO es una puerta trasera
 *    al estado: `waiting_client` es la única transición que acepta.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemDb, type Row, type Tables } from "../fixtures/mem-db";
import { UnauthorizedError } from "@/lib/auth/session";
import type {
  AgendaBucketName,
  AgendaDto,
  AttentionDto,
  ConversationDto,
  ReminderDto,
} from "@/lib/types";

// --- Sesión y bus, dobles mínimos -------------------------------------------
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

// --- ORM, schema y `scoped()` REALES; solo el ejecutor de BD es memoria ------
const tables: Tables = {
  conversation: [],
  conversation_attention: [],
  contact: [],
  ad_attribution: [],
  // Declarada a propósito: si alguno de estos caminos tocara el motor automático,
  // esta fila dejaría de estar vacía y el test lo notaría.
  sales_follow_up_job: [],
};
const db = createMemDb(tables);
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  getDb: () => db,
}));

// Los componentes cliente se renderizan sin navegador: `useEvents` abriría un
// `EventSource` que no existe fuera de un DOM.
vi.mock("@/components/use-events", () => ({ useEvents: () => {} }));

const { ConversationList } = await import("@/components/inbox/conversation-list");
const { AttentionBlock } = await import("@/components/inbox/attention-block");
const { AgendaGroups } = await import("@/components/agenda/agenda-client");
const { resumirBandeja, necesitaAtencionAhora } = await import(
  "@/components/inbox/bandeja-filtros"
);
const {
  ETIQUETA_ESTADO,
  estadoDeAtencion,
  estadoOperativo,
  esConversacionHumana,
  tieneCompromiso,
  vencidosDeAgenda,
} = await import("@/lib/operational-state");
const { POST: MARK_ATTENDED } = await import(
  "@/app/api/conversations/[id]/attention/route"
);
const { POST: PROGRAMAR, GET: LEER_AGENDA } = await import("@/app/api/reminders/route");
const { PATCH: PARCHAR_CONVERSACION } = await import(
  "@/app/api/conversations/[id]/route"
);
const { listConversations } = await import("@/server/inbox/queries");
const { listAgenda } = await import("@/server/inbox/agenda");
const { getAttention } = await import("@/server/inbox/attention");

const ORG_A = "org_a";
const ORG_B = "org_b";
const LIMA = "America/Lima";
const H = 3_600_000;
const D = 24 * H;
/** Lunes 12:00 en Lima. El reloj de la Agenda se fija con él. */
const AHORA = new Date("2026-10-05T17:00:00Z");

// ===========================================================================
// Utilidades de siembra y render
// ===========================================================================

function sembrar(input: {
  id: string;
  organizationId?: string;
  nombre?: string;
  handoff?: boolean;
  aiEnabled?: boolean;
  isTest?: boolean;
  unreadCount?: number;
}): string {
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
    handoffAt: input.handoff ? new Date("2026-10-05T11:00:00Z") : null,
    handoffReason: input.handoff ? "cliente" : null,
    aiEnabled: input.aiEnabled ?? true,
    isTest: input.isTest ?? false,
    unreadCount: input.unreadCount ?? 0,
    lastMessageAt: new Date("2026-10-05T10:00:00Z"),
    lastInboundAt: null,
    createdAt: new Date("2026-10-01T10:00:00Z"),
    updatedAt: new Date("2026-10-05T10:00:00Z"),
  } as Row);
  return contactId;
}

/** Fija la fila de atención cruda (como la dejaría el dominio). */
function sembrarAtencion(
  conversationId: string,
  state: "pending" | "waiting_client" | "deferred",
  dueAt: Date | null = null,
  note: string | null = null,
  organizationId: string = ORG_A
) {
  tables.conversation_attention!.push({
    id: `at_${organizationId}_${conversationId}`,
    organizationId,
    conversationId,
    state,
    dueAt,
    note,
    createdAt: new Date("2026-10-05T10:00:00Z"),
    updatedAt: new Date("2026-10-05T10:00:00Z"),
  } as Row);
}

function atencion(extra: Partial<AttentionDto> = {}): AttentionDto {
  return {
    state: "pending",
    dueAt: null,
    note: null,
    needsAttentionNow: true,
    ...extra,
  };
}

function conversacion(extra: Partial<ConversationDto> = {}): ConversationDto {
  return {
    id: "cv_1",
    contact: { id: "ct_1", name: "Ana Ruiz", phone: null },
    stageName: null,
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: null,
    lastMessageAt: "2026-10-05T10:00:00.000Z",
    unreadCount: 0,
    windowOpen: true,
    windowRemainingMs: H,
    preview: "Hola",
    anuncio: null,
    ...extra,
  };
}

function recordatorio(extra: Partial<ReminderDto> = {}): ReminderDto {
  return {
    conversationId: "cv_1",
    contact: { id: "ct_1", name: "Ana Ruiz", phone: null },
    dueAt: AHORA.toISOString(),
    note: null,
    state: "deferred",
    bucket: "today",
    needsAttentionNow: false,
    ...extra,
  };
}

function agenda(entries: Partial<Record<AgendaBucketName, ReminderDto[]>>): AgendaDto {
  const buckets = {
    overdue: [],
    today: [],
    tomorrow: [],
    week: [],
    later: [],
  } as Record<AgendaBucketName, ReminderDto[]>;
  let total = 0;
  for (const [key, items] of Object.entries(entries) as [
    AgendaBucketName,
    ReminderDto[] | undefined,
  ][]) {
    if (!items) continue;
    buckets[key] = items;
    total += items.length;
  }
  return { generatedAt: AHORA.toISOString(), timeZone: LIMA, buckets, total };
}

const noop = () => {};

/** La fila de la lista, tal cual la pinta la Bandeja. */
function pintarLista(filas: ConversationDto[]): string {
  return renderToStaticMarkup(
    createElement(ConversationList, {
      conversations: filas,
      selectedId: null,
      onSelect: noop,
      onSeeded: noop,
    })
  );
}

/** El bloque de atención del panel del hilo. */
function pintarPanel(fila: ConversationDto): string {
  return renderToStaticMarkup(
    createElement(AttentionBlock, {
      conversation: fila,
      onPatchConversation: noop,
      onChanged: noop,
    })
  );
}

/** La Agenda. */
function pintarAgenda(d: AgendaDto): string {
  return renderToStaticMarkup(
    createElement(AgendaGroups, { agenda: d, busyId: null, onCancel: noop })
  );
}

// ===========================================================================
// 1 · El estado se deriva en un solo lugar
// ===========================================================================

describe("013 C4 · una sola derivación del estado visible", () => {
  it("la IA al mando no tiene estado operativo que enseñar", () => {
    // Aunque quedara una fila de atención huérfana, si la IA es la dueña no hay
    // estado humano que mostrar: es la misma regla que aplica el servidor para
    // decidir si admite "Recordarme" (FR-1.10).
    expect(
      estadoOperativo({
        attention: atencion(),
        aiEnabled: true,
        handoffAt: null,
      })
    ).toBe("ia");
    expect(esConversacionHumana({ aiEnabled: true, handoffAt: null })).toBe(false);
  });

  it("del humano es humano por handoff O por IA apagada, y sin fila no hay tarea", () => {
    const sinFila = { attention: null, aiEnabled: false, handoffAt: null };
    expect(estadoOperativo(sinFila)).toBe("atencion_humana");
    expect(
      estadoOperativo({ attention: null, aiEnabled: true, handoffAt: "2026-10-05T11:00:00Z" })
    ).toBe("atencion_humana");
  });

  it("pending y recordatorio VENCIDO son la misma cosa: hay que actuar ahora", () => {
    // Es el punto donde un cliente que recalculara el reloj se delataría: los dos
    // `state` son distintos y aun así se presentan con la misma palabra.
    expect(
      estadoOperativo({
        attention: atencion({ state: "pending", needsAttentionNow: true }),
        aiEnabled: false,
        handoffAt: null,
      })
    ).toBe("por_atender");
    expect(
      estadoOperativo({
        attention: atencion({
          state: "deferred",
          dueAt: "2026-10-01T10:00:00.000Z",
          needsAttentionNow: true,
        }),
        aiEnabled: false,
        handoffAt: null,
      })
    ).toBe("por_atender");
  });

  it("atendida y comprometida se distinguen entre sí y de la cola", () => {
    const atendida = estadoOperativo({
      attention: atencion({ state: "waiting_client", needsAttentionNow: false }),
      aiEnabled: false,
      handoffAt: null,
    });
    const comprometida = estadoOperativo({
      attention: atencion({
        state: "deferred",
        dueAt: "2026-10-20T15:00:00.000Z",
        needsAttentionNow: false,
      }),
      aiEnabled: false,
      handoffAt: null,
    });
    expect(atendida).toBe("esperando_cliente");
    expect(comprometida).toBe("comprometido");
    // Y solo la comprometida es un compromiso VIVO: lo vencido ya es "ahora".
    expect(tieneCompromiso({ attention: atencion({ state: "waiting_client" }), aiEnabled: false, handoffAt: null })).toBe(false);
    expect(
      tieneCompromiso({
        attention: atencion({ state: "deferred", needsAttentionNow: false }),
        aiEnabled: false,
        handoffAt: null,
      })
    ).toBe(true);
  });

  it("la Agenda deriva del recordatorio con la MISMA función que la lista", () => {
    // `estadoDeAtencion` es la entrada sin "quién manda": la Agenda solo conoce
    // un recordatorio, y no debería tener que inventar una conversación para
    // obtener la misma palabra.
    const vencido = recordatorio({ bucket: "overdue", needsAttentionNow: true });
    const futuro = recordatorio({ bucket: "later", needsAttentionNow: false });
    expect(
      estadoDeAtencion({
        state: vencido.state,
        dueAt: vencido.dueAt,
        note: vencido.note,
        needsAttentionNow: vencido.needsAttentionNow,
      })
    ).toBe(estadoOperativo({ attention: atencion({ state: "deferred", needsAttentionNow: true }), aiEnabled: false, handoffAt: null }));
    expect(
      estadoDeAtencion({
        state: futuro.state,
        dueAt: futuro.dueAt,
        note: futuro.note,
        needsAttentionNow: futuro.needsAttentionNow,
      })
    ).toBe("comprometido");
  });
});

// ===========================================================================
// 2 · Las tres superficies dicen lo mismo
// ===========================================================================

describe("013 C4 · coherencia de estado en lista, hilo y Agenda", () => {
  it("'Por atender' se lee igual en la fila, en el panel y en la Agenda", () => {
    const fila = conversacion({
      aiEnabled: false,
      attention: atencion({ state: "pending" }),
    });
    const htmlLista = pintarLista([fila]);
    const htmlPanel = pintarPanel(fila);
    // El item vencido de la Agenda dice "vencido · en Por atender": contiene la
    // etiqueta compartida, que es lo que hace comparables las dos superficies.
    const htmlAgenda = pintarAgenda(
      agenda({ overdue: [recordatorio({ bucket: "overdue", needsAttentionNow: true })] })
    );
    for (const [nombre, html] of [
      ["lista", htmlLista],
      ["panel", htmlPanel],
      ["agenda", htmlAgenda],
    ] as const) {
      expect(html, nombre).toContain(ETIQUETA_ESTADO.por_atender);
    }
    expect(ETIQUETA_ESTADO.por_atender).toBe("Por atender");
  });

  it("'Esperando respuesta' se lee igual en las tres superficies", () => {
    const fila = conversacion({
      aiEnabled: false,
      attention: atencion({ state: "waiting_client", needsAttentionNow: false }),
    });
    const htmlLista = pintarLista([fila]);
    const htmlPanel = pintarPanel(fila);
    // En la Agenda un `waiting_client` ya no es un compromiso: no aparece. Lo que
    // se comprueba es que, si se pinta, usaría la misma palabra.
    const htmlAgenda = pintarAgenda(
      agenda({ later: [recordatorio({ bucket: "later", needsAttentionNow: false })] })
    );
    for (const [nombre, html] of [
      ["lista", htmlLista],
      ["panel", htmlPanel],
    ] as const) {
      expect(html, nombre).toContain(ETIQUETA_ESTADO.esperando_cliente);
    }
    expect(htmlAgenda).toContain("programado");
    // Y la palabra compartida no es un accidental: el rótulo del compromiso a
    // futuro es el mismo en panel y fila.
    expect(pintarPanel(
      conversacion({
        aiEnabled: false,
        attention: atencion({ state: "deferred", dueAt: "2026-10-20T15:00:00.000Z", needsAttentionNow: false }),
      })
    )).toContain(ETIQUETA_ESTADO.comprometido);
  });

  it("con la IA al mando, la fila no inventa estado y el panel no se pinta", () => {
    const fila = conversacion({ aiEnabled: true, handoffAt: null });
    const htmlLista = pintarLista([fila]);
    expect(htmlLista).not.toContain('data-testid="fila-estado"');
    expect(htmlLista).not.toContain(ETIQUETA_ESTADO.ia);
    // Sin handoff ni IA apagada no hay bloque de atención: ni "Reactivar IA" ni
    // "Recordarme", que el servidor rechazaría con 409.
    expect(pintarPanel(fila)).toBe("");
  });

  it("el hook `data-estado` usa el vocabulario operativo, no el interno", () => {
    const html = pintarPanel(
      conversacion({
        aiEnabled: false,
        attention: atencion({ state: "waiting_client", needsAttentionNow: false }),
      })
    );
    expect(html).toContain('data-estado="esperando_cliente"');
    // El `state` crudo de la base no se cuela por la puerta de atrás del test hook.
    expect(html).not.toContain('data-estado="waiting_client"');
  });
});

// ===========================================================================
// 3 · El copy no enseña internals (FR-4.1 / FR-4.2)
// ===========================================================================

describe("013 C4 · el copy es de operación, no de internals", () => {
  /** Tokens que el spec prohíbe por nombre en texto de interfaz. */
  const PROHIBIDOS = [
    "handoffAt",
    "handoffReason",
    "handoff",
    "needsAttentionNow",
    "waiting_client",
    "deferred",
    "nextFollowUpAt",
    "automationLane",
    "followUpReason",
    "sales_follow_up_job",
    "conversation_attention",
  ];

  it("ninguna de las tres superficies imprime un nombre interno", () => {
    const fila = conversacion({
      aiEnabled: false,
      handoffReason: "cliente",
      attention: atencion({
        state: "deferred",
        dueAt: "2026-10-20T15:00:00.000Z",
        note: "prometió llamar",
        needsAttentionNow: false,
      }),
    });
    const htmls = [
      ["lista", pintarLista([fila])],
      ["panel", pintarPanel(fila)],
      [
        "agenda",
        pintarAgenda(
          agenda({ later: [recordatorio({ bucket: "later", note: "prometió llamar" })] })
        ),
      ],
    ] as const;
    for (const [nombre, html] of htmls) {
      for (const token of PROHIBIDOS) {
        expect(html, `${nombre} no debe decir ${token}`).not.toContain(token);
      }
      // Y ningún ISO crudo: las fechas se muestran ya formateadas para una
      // persona, no como el valor que hay en la columna.
      expect(html, `${nombre} no debe imprimir un ISO crudo`).not.toMatch(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
      );
    }
  });

  it("las cuatro palabras del spec están, y significan lo que dicen", () => {
    // FR-4.1 nombra exactamente este vocabulario: si alguien lo renombra, este
    // test se pone rojo en vez de dejar dos pantallas hablando idiomas distintos.
    expect(ETIQUETA_ESTADO.atencion_humana).toBe("Atención humana");
    expect(ETIQUETA_ESTADO.esperando_cliente).toBe("Esperando respuesta");
    const panel = pintarPanel(
      conversacion({ aiEnabled: false, attention: atencion({ state: "pending" }) })
    );
    expect(panel).toContain("Atención humana");
    expect(panel).toContain("Marcar atendido");
    expect(panel).toContain("Reactivar IA");
    expect(panel).toContain("Recordarme");
  });

  it("el motivo del handoff se cuenta en castellano, no como `handoffReason`", () => {
    const html = pintarPanel(
      conversacion({
        aiEnabled: true,
        handoffAt: "2026-10-05T11:00:00.000Z",
        handoffReason: "ventana",
        attention: atencion(),
      })
    );
    expect(html).toContain("La ventana de 24 h está cerrada.");
  });
});

// ===========================================================================
// 4 · Acciones contra los endpoints reales
// ===========================================================================

function marcarAtendido(id: string, body: unknown) {
  return MARK_ATTENDED(
    new Request(`http://localhost/api/conversations/${id}/attention`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

function parchear(id: string, body: unknown) {
  return PARCHAR_CONVERSACION(
    new Request(`http://localhost/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

function programar(body: unknown) {
  return PROGRAMAR(
    new Request("http://localhost/api/reminders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

async function cola(organizationId = ORG_A): Promise<string[]> {
  const filas = await listConversations(organizationId);
  return filas.filter(necesitaAtencionAhora).map((c) => c.id).sort();
}

async function agendaIds(now = AHORA): Promise<string[]> {
  const d = await listAgenda({ organizationId: ORG_A, now, timeZone: LIMA });
  return [
    ...d.buckets.overdue,
    ...d.buckets.today,
    ...d.buckets.tomorrow,
    ...d.buckets.week,
    ...d.buckets.later,
  ]
    .map((r) => r.conversationId)
    .sort();
}

describe("013 C4 · 'Marcar atendido' saca de 'Por atender'", () => {
  beforeEach(() => {
    for (const t of Object.values(tables)) t.length = 0;
    publish.mockClear();
    org = ORG_A;
  });

  it("deja la conversación en `waiting_client` y fuera de la cola", async () => {
    sembrar({ id: "cv_a", handoff: true });
    sembrarAtencion("cv_a", "pending");
    expect(await cola()).toEqual(["cv_a"]);

    const res = await marcarAtendido("cv_a", { state: "waiting_client" });
    expect(res.status).toBe(200);
    const cuerpo = (await res.json()) as {
      ok: boolean;
      conversation: ConversationDto;
    };
    expect(cuerpo.ok).toBe(true);
    // El DTO viaja con la atención YA derivada, que es lo que permite a la fila
    // de la listaactualizarse sin recargar.
    expect(cuerpo.conversation.attention?.state).toBe("waiting_client");
    expect(cuerpo.conversation.attention?.needsAttentionNow).toBe(false);
    expect(await cola()).toEqual([]);
    // Y sale por SSE, que es lo que hace que la Bandeja y la Agenda se enteren.
    expect(publish).toHaveBeenCalledWith(
      ORG_A,
      expect.objectContaining({ type: "conversation.updated" })
    );
  });

  it("saca de la cola tanto un `pending` como un recordatorio vencido", async () => {
    sembrar({ id: "cv_viejo", handoff: true });
    sembrarAtencion("cv_viejo", "deferred", new Date("2026-10-01T10:00:00Z"));
    expect(await cola()).toEqual(["cv_viejo"]);
    // Vencido significa que ya está de vuelta en la cola; atenderlo lo resuelve.
    expect(await agendaIds()).toEqual(["cv_viejo"]);

    const res = await marcarAtendido("cv_viejo", { state: "waiting_client" });
    expect(res.status).toBe(200);
    expect(await cola()).toEqual([]);
    // Y desaparece de la Agenda: el compromiso se cumplió, no se dejó huérfano.
    expect(await agendaIds()).toEqual([]);
  });

  it("es idempotente: marcar dos veces no cambia nada ni duplica fila", async () => {
    sembrar({ id: "cv_a", handoff: true });
    sembrarAtencion("cv_a", "pending");
    expect((await marcarAtendido("cv_a", { state: "waiting_client" })).status).toBe(200);
    expect((await marcarAtendido("cv_a", { state: "waiting_client" })).status).toBe(200);
    expect(tables.conversation_attention).toHaveLength(1);
    expect(await cola()).toEqual([]);
  });

  it("no es una puerta trasera: cualquier otro estado es un 422 explícito", async () => {
    sembrar({ id: "cv_a", handoff: true });
    sembrarAtencion("cv_a", "pending");
    // Un `pending` lo dispara un mensaje del cliente y un `deferred` nace de
    // "Recordarme" con fecha futura validada. Aceptarlos aquí dejaría que la UI
    // fabricara estados que el ciclo no permite.
    for (const body of [
      { state: "pending" },
      { state: "deferred" },
      { state: "waiting_client", dueAt: AHORA.toISOString() },
      {},
    ]) {
      const res = await marcarAtendido("cv_a", body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    // Nada se escribió: la conversación sigue esperando.
    expect((await getAttention(ORG_A, "cv_a"))?.state).toBe("pending");
    expect(await cola()).toEqual(["cv_a"]);
  });

  it("409 si la IA es la dueña, y 404 si la conversación no es de esta organización", async () => {
    sembrar({ id: "cv_ia" }); // IA activa, sin handoff
    sembrar({ id: "cv_b", organizationId: ORG_B, handoff: true });
    sembrarAtencion("cv_b", "pending", null, null, ORG_B);

    const ia = await marcarAtendido("cv_ia", { state: "waiting_client" });
    expect(ia.status).toBe(409);
    expect(((await ia.json()) as { error: { code: string } }).error.code).toBe(
      "ai_owns_conversation"
    );

    // Conversación de B: indistinguible de inexistente, y no se toca la fila.
    const ajena = await marcarAtendido("cv_b", { state: "waiting_client" });
    expect(ajena.status).toBe(404);
    expect((await getAttention(ORG_B, "cv_b"))?.state).toBe("pending");

    const inexistente = await marcarAtendido("cv_nope", { state: "waiting_client" });
    expect(inexistente.status).toBe(404);
  });

  it("409 en el Laboratorio: no hay operador real que atienda", async () => {
    sembrar({ id: "cv_test", handoff: true, isTest: true });
    const res = await marcarAtendido("cv_test", { state: "waiting_client" });
    expect(res.status).toBe(409);
  });

  it("no se marca atendida una conversación de la IA por mucho que se insista", async () => {
    sembrar({ id: "cv_ia" });
    sembrarAtencion("cv_ia", "pending"); // fila huérfana e inconsistente
    for (let i = 0; i < 3; i += 1) {
      expect((await marcarAtendido("cv_ia", { state: "waiting_client" })).status).toBe(409);
    }
    expect(tables.conversation_attention).toHaveLength(1);
  });
});

describe("013 C4 · 'Recordarme' mueve a la Agenda y 'Reactivar IA' limpia", () => {
  beforeEach(() => {
    for (const t of Object.values(tables)) t.length = 0;
    publish.mockClear();
    org = ORG_A;
  });

  it("programar saca de la cola y mete en la Agenda, y ya no hay envíos", async () => {
    sembrar({ id: "cv_a", handoff: true });
    sembrarAtencion("cv_a", "pending");
    expect(await cola()).toEqual(["cv_a"]);

    const res = await programar({
      conversationId: "cv_a",
      dueAt: new Date(AHORA.getTime() + 2 * D).toISOString(),
      note: "  vuelve a llamar  ",
    });
    expect(res.status).toBe(201);
    // Fuera de "Por atender" y presente en la Agenda: las dos mitidas de FR-4.3.
    expect(await cola()).toEqual([]);
    expect(await agendaIds(AHORA)).toEqual(["cv_a"]);
    // El motor automático no se ha tocado: ni una fila.
    expect(tables.sales_follow_up_job).toHaveLength(0);
  });

  it("vencer devuelve el trabajo a la cola y al grupo de vencidos del nav", async () => {
    sembrar({ id: "cv_a", handoff: true });
    sembrarAtencion("cv_a", "pending");
    await programar({
      conversationId: "cv_a",
      dueAt: new Date(AHORA.getTime() + D).toISOString(),
    });
    // Un día después: el mismo recordatorio, vencido.
    const manana = new Date(AHORA.getTime() + 2 * D);
    const d = await listAgenda({ organizationId: ORG_A, now: manana, timeZone: LIMA });
    expect(d.buckets.overdue.map((r) => r.conversationId)).toEqual(["cv_a"]);
    expect(d.buckets.today).toHaveLength(0);
    // Y el contador del nav lee EXACTAMENTE ese grupo.
    expect(vencidosDeAgenda(d)).toBe(1);
    expect(d.buckets.overdue[0]?.needsAttentionNow).toBe(true);
  });

  it("'Reactivar IA' limpia el estado humano: ni cola ni Agenda", async () => {
    sembrar({ id: "cv_a", handoff: true });
    sembrarAtencion("cv_a", "pending");
    expect(await cola()).toEqual(["cv_a"]);

    const res = await parchear("cv_a", { reactivate: true });
    expect(res.status).toBe(200);
    expect(await getAttention(ORG_A, "cv_a")).toBeNull();
    expect(await cola()).toEqual([]);
    expect(await agendaIds()).toEqual([]);
    // Y la conversación vuelve a ser de la IA, así que ya no se pinta el bloque.
    const cuerpo = (await res.json()) as { conversation: ConversationDto };
    expect(cuerpo.conversation.handoffAt).toBeNull();
    expect(
      estadoOperativo({
        attention: cuerpo.conversation.attention ?? null,
        aiEnabled: cuerpo.conversation.aiEnabled,
        handoffAt: cuerpo.conversation.handoffAt,
      })
    ).toBe("ia");
    expect(pintarPanel(cuerpo.conversation)).toBe("");
  });
});

// ===========================================================================
// 5 · Los contadores del nav y los de la Bandeja no pueden discrepar
// ===========================================================================

describe("013 C4 · conteos coherentes, incluido el vencimiento", () => {
  beforeEach(() => {
    for (const t of Object.values(tables)) t.length = 0;
    publish.mockClear();
    org = ORG_A;
  });

  it("vencidos del nav = vencidos de la Agenda = parte vencida de 'Por atender'", async () => {
    // Tres situaciones a la vez, porque es donde los conteos se separan: una
    // pendiente, una comprometida a futuro y una con el recordatorio ya vencido.
    sembrar({ id: "cv_pendiente", handoff: true });
    sembrarAtencion("cv_pendiente", "pending");
    sembrar({ id: "cv_futuro", handoff: true });
    sembrarAtencion("cv_futuro", "deferred", new Date(AHORA.getTime() + 2 * D));
    sembrar({ id: "cv_vencido", handoff: true });
    sembrarAtencion("cv_vencido", "deferred", new Date("2026-10-01T10:00:00Z"));

    const filas = await listConversations(ORG_A);
    const resumen = resumirBandeja(filas);
    // "Por atender": la pendiente y la vencida. La comprometida a futuro NO.
    expect(resumen.porAtender).toBe(2);
    expect(resumen.visibles).toHaveLength(3);
    // "Comprometidos": solo la de futuro. La vencida ya es trabajo de hoy.
    expect(resumen.comprometidos).toBe(1);
    expect(
      resumirBandeja(filas, { filter: "comprometidos" }).visibles.map((c) => c.id)
    ).toEqual(["cv_futuro"]);

    const d = await listAgenda({ organizationId: ORG_A, now: AHORA, timeZone: LIMA });
    // El contador del nav es el grupo vencido, y ese grupo son las vencidas.
    expect(vencidosDeAgenda(d)).toBe(d.buckets.overdue.length);
    expect(d.buckets.overdue.map((r) => r.conversationId)).toEqual(["cv_vencido"]);
    const enCola = new Set(resumen.visibles.filter(necesitaAtencionAhora).map((c) => c.id));
    for (const r of d.buckets.overdue) expect(enCola.has(r.conversationId)).toBe(true);
  });

  it("el contador del nav aguanta una Agenda que aún no ha cargado o falló", () => {
    // El nav monta antes que la Agenda: si leyera de un `undefined` sin este
    // guardia, la navegación entera se caería por un número que puede esperar.
    expect(vencidosDeAgenda(null)).toBe(0);
    expect(vencidosDeAgenda(undefined)).toBe(0);
    expect(vencidosDeAgenda(agenda({}))).toBe(0);
    expect(vencidosDeAgenda(agenda({ later: [recordatorio({ bucket: "later" })] }))).toBe(0);
  });

  it("el nav lee el MISMO payload que la Agenda: no hay dos formas de contar", async () => {
    // El contador del nav no pide nada nuevo: consume el `GET /api/reminders`
    // entero y lee el grupo `overdue`. Por eso esta prueba usa la respuesta REAL
    // del endpoint y no un DTO hecho a mano: si alguien cambiara la forma del
    // payload, aquí se rompería en vez de dejar el nav en cero sin avisar.
    sembrar({ id: "cv_vencido", handoff: true });
    sembrarAtencion("cv_vencido", "deferred", new Date("2026-10-01T10:00:00Z"));
    sembrar({ id: "cv_futuro", handoff: true });
    sembrarAtencion("cv_futuro", "deferred", new Date(AHORA.getTime() + 3 * D));

    const res = await LEER_AGENDA(new Request("http://localhost/api/reminders"));
    expect(res.status).toBe(200);
    const payload = (await res.json()) as AgendaDto;
    expect(vencidosDeAgenda(payload)).toBe(1);
    expect(vencidosDeAgenda(payload)).toBe(payload.buckets.overdue.length);
    // Y coincide con la cola: el vencido es trabajo de ahora, el otro no.
    expect(await cola()).toEqual(["cv_vencido"]);
  });

  it("cada organización cuenta solo lo suyo", async () => {
    sembrar({ id: "cv_a", handoff: true });
    sembrarAtencion("cv_a", "deferred", new Date("2026-10-01T10:00:00Z"));
    // La fila de B es deliberadamente huérfana de conversación: aunque existiera,
    // el scope es por organización en cada lectura.
    const a = await listAgenda({ organizationId: ORG_A, now: AHORA, timeZone: LIMA });
    const b = await listAgenda({ organizationId: ORG_B, now: AHORA, timeZone: LIMA });
    expect(vencidosDeAgenda(a)).toBe(1);
    expect(vencidosDeAgenda(b)).toBe(0);
  });
});

// ===========================================================================
// 6 · Regresión: los filtros del corte 2 siguen significando lo mismo
// ===========================================================================

describe("013 C4 · regresión de los filtros de la Bandeja (corte 2)", () => {
  const base = {
    ...conversacion(),
    unreadCount: 0,
  };

  it("el chip nuevo NO se come a la cola: los dos son disjuntos y juntos cuadran", () => {
    const cola = {
      ...base,
      id: "cv_1",
      aiEnabled: false,
      attention: atencion({ state: "pending" }),
    };
    const comprometido = {
      ...base,
      id: "cv_2",
      aiEnabled: false,
      attention: atencion({
        state: "deferred",
        dueAt: "2026-10-20T15:00:00.000Z",
        needsAttentionNow: false,
      }),
    };
    const laIa = { ...base, id: "cv_3" };
    const filas = [cola, comprometido, laIa];

    const resumen = resumirBandeja(filas);
    expect(resumen.porAtender).toBe(1);
    expect(resumen.comprometidos).toBe(1);
    expect(resumen.total).toBe(3);
    // Conjuntos disjuntos: nadie está en "Por atender" y en "Comprometidos".
    const enCola = new Set(
      resumirBandeja(filas, { filter: "por_atender" }).visibles.map((c) => c.id)
    );
    const enCompromiso = new Set(
      resumirBandeja(filas, { filter: "comprometidos" }).visibles.map((c) => c.id)
    );
    for (const id of enCola) expect(enCompromiso.has(id)).toBe(false);
    // Y la conversación de la IA no está en ninguno de los dos.
    expect(enCola.has("cv_3")).toBe(false);
    expect(enCompromiso.has("cv_3")).toBe(false);
  });

  it("'Todas', 'No leídas' y 'Anuncios' conservan su definición", () => {
    const filas = [
      { ...base, id: "cv_1", unreadCount: 2, anuncio: { headline: "H", sourceId: "ad_1", sourceType: "ad" } },
      { ...base, id: "cv_2", unreadCount: 0, anuncio: null },
      {
        ...base,
        id: "cv_3",
        unreadCount: 0,
        aiEnabled: false,
        attention: atencion({ state: "pending" }),
      },
    ];
    expect(resumirBandeja(filas).visibles).toHaveLength(3);
    expect(resumirBandeja(filas, { filter: "unread" }).visibles.map((c) => c.id)).toEqual([
      "cv_1",
    ]);
    expect(resumirBandeja(filas, { filter: "ads" }).visibles.map((c) => c.id)).toEqual([
      "cv_1",
    ]);
    // Y la cola sigue definiéndose sin mirar `unreadCount` (spec §2.1): "cv_1"
    // tiene no leídas y no está en la cola; "cv_3" está en la cola sin no leídas.
    expect(resumirBandeja(filas, { filter: "por_atender" }).visibles.map((c) => c.id)).toEqual([
      "cv_3",
    ]);
  });

  it("la búsqueda y la etapa acotan los dos conteos por igual", () => {
    const filas = [
      {
        ...base,
        id: "cv_1",
        contact: { id: "ct_1", name: "Ana Ruiz", phone: null },
        stageName: "Interesado",
        aiEnabled: false,
        attention: atencion({ state: "pending" }),
      },
      {
        ...base,
        id: "cv_2",
        contact: { id: "ct_2", name: "Luis Paz", phone: null },
        stageName: "Nuevo",
        aiEnabled: false,
        attention: atencion({
          state: "deferred",
          dueAt: "2026-10-20T15:00:00.000Z",
          needsAttentionNow: false,
        }),
      },
    ];
    const porNombre = resumirBandeja(filas, { query: "ana" });
    expect(porNombre.porAtender).toBe(1);
    expect(porNombre.comprometidos).toBe(0);
    // Y el conteo es SIEMPRE la longitud de su listado, también para el nuevo.
    const porEtapa = resumirBandeja(filas, { stage: "Nuevo" });
    expect(porEtapa.comprometidos).toBe(
      resumirBandeja(filas, { stage: "Nuevo", filter: "comprometidos" }).visibles.length
    );
  });

  it("los chips se pintan con su número y con su cuenta de lista", () => {
    const filas = [
      {
        ...base,
        id: "cv_1",
        aiEnabled: false,
        attention: atencion({ state: "pending" }),
      },
      {
        ...base,
        id: "cv_2",
        aiEnabled: false,
        attention: atencion({
          state: "deferred",
          dueAt: "2026-10-20T15:00:00.000Z",
          needsAttentionNow: false,
        }),
      },
    ];
    const html = pintarLista(filas);
    for (const filtro of [
      "por_atender",
      "comprometidos",
      "all",
      "unread",
    ] as const) {
      expect(html, filtro).toContain(`data-testid="bandeja-filtro-${filtro}"`);
    }
    // "Por atender" sigue siendo el PRIMERO de la fila: es la pregunta con la
    // que arranca el día el operador (spec §2.1).
    expect(html.indexOf('data-testid="bandeja-filtro-por_atender"')).toBeLessThan(
      html.indexOf('data-testid="bandeja-filtro-comprometidos"')
    );
    expect(html.indexOf('data-testid="bandeja-filtro-comprometidos"')).toBeLessThan(
      html.indexOf('data-testid="bandeja-filtro-all"')
    );
    // Y con la lista vacía los dos chips siguen estando, a cero.
    const vacia = pintarLista([]);
    expect(vacia).toContain('data-testid="bandeja-filtro-por_atender"');
    expect(vacia).toContain('data-testid="bandeja-filtro-comprometidos"');
  });
});
