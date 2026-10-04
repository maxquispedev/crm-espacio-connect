/**
 * 013 C2 — La Bandeja como COLA DE TRABAJO: "Por atender (N)".
 *
 * Qué afirma este fichero, y por qué en estos tres sitios:
 *
 * 1. `listConversations` (store): resuelve la atención en el MISMO SELECT con un
 *    LEFT JOIN ya scropeado a la organización — el patrón exacto de
 *    `adAttribution` en esa misma función. Se comprueba sobre la query REAL
 *    (ORM y `scoped()` reales, doble solo del ejecutor), incluida la prueba de
 *    que una fila de atención de la organización B no se pega a una
 *    conversación de A (Constitución III) y de que no hay N+1.
 * 2. `resumenBandeja` (puro): la definición de la cola y su conteo salen de la
 *    MISMA operación, así que no pueden discrepar (FR-2.7). Y `unreadCount` no
 *    participa: no es "qué no vi", es "qué hago" (spec §2.1, FR-2.3).
 * 3. `ConversationList` (JSX real con `react-dom/server`, sin jsdom): el chip
 *    existe, es el PRIMERO de la fila y pinta el número correcto.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemDb, type Row, type Tables } from "../fixtures/mem-db";
import type { ConversationDto } from "@/lib/types";

// ORM, schema y scoped() REALES; solo el ejecutor de BD es un doble en memoria.
const tables: Tables = {
  conversation: [],
  conversation_attention: [],
  contact: [],
  ad_attribution: [],
  lead: [],
  pipeline_stage: [],
};
const db = createMemDb(tables);

// Contador de SELECT para afirmar "un solo SELECT, sin N+1" (plan §4.1).
let selects = 0;
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  getDb: () => ({
    select: (...args: unknown[]) => {
      selects += 1;
      return (db.select as (...a: unknown[]) => unknown)(...args);
    },
    insert: db.insert,
    update: db.update,
    delete: db.delete,
  }),
}));

const { deriveAttention, resumenAtencion } = await import(
  "@/server/inbox/attention"
);
const { listConversations, serializeConversation } = await import(
  "@/server/inbox/queries"
);
const { resumirBandeja, necesitaAtencionAhora } = await import(
  "@/components/inbox/bandeja-filtros"
);
const { ConversationList } = await import("@/components/inbox/conversation-list");

const ORG_A = "org_a";
const ORG_B = "org_b";
const HOY = new Date("2026-10-05T12:00:00Z");
const MIN = 60_000;

type Estado = "pending" | "waiting_client" | "deferred";

function sembrarConversacion(input: {
  organizationId?: string;
  id: string;
  nombre?: string;
  handoff?: boolean;
  isTest?: boolean;
  unreadCount?: number;
  stageName?: string | null;
  updatedAt?: Date;
}) {
  const organizationId = input.organizationId ?? ORG_A;
  const contactId = `ct_${input.id}`;
  tables.contact!.push({
    id: contactId,
    organizationId,
    waIdentity: `52${input.id.replace(/\W/g, "").slice(-9).padStart(9, "0")}`,
    name: input.nombre ?? input.id,
    phone: null,
    createdAt: HOY,
    updatedAt: HOY,
  } as Row);
  tables.conversation!.push({
    id: input.id,
    organizationId,
    contactId,
    handoffAt: input.handoff ? new Date("2026-10-05T11:00:00Z") : null,
    handoffReason: input.handoff ? "commercial" : null,
    aiEnabled: true,
    isTest: input.isTest ?? false,
    unreadCount: input.unreadCount ?? 0,
    lastMessageAt: input.updatedAt ?? HOY,
    lastInboundAt: null,
    createdAt: HOY,
    updatedAt: input.updatedAt ?? HOY,
  } as Row);
  if (input.stageName) {
    const stageId = `st_${input.id}`;
    tables.pipeline_stage!.push({
      id: stageId,
      organizationId,
      name: input.stageName,
      position: 0,
    } as Row);
    tables.lead!.push({
      id: `ld_${input.id}`,
      organizationId,
      contactId,
      stageId,
    } as Row);
  }
  return input.id;
}

function sembrarAtencion(input: {
  organizationId?: string;
  conversationId: string;
  state: Estado;
  dueAt?: Date | null;
  note?: string | null;
}) {
  tables.conversation_attention!.push({
    id: `ca_${input.conversationId}`,
    organizationId: input.organizationId ?? ORG_A,
    conversationId: input.conversationId,
    state: input.state,
    dueAt: input.dueAt ?? null,
    note: input.note ?? null,
    createdAt: HOY,
    updatedAt: HOY,
  } as Row);
}

const porId = (lista: ConversationDto[], id: string) =>
  lista.find((c) => c.id === id);

beforeEach(() => {
  for (const bucket of Object.values(tables)) bucket!.length = 0;
  selects = 0;
});

/** Deriva la fila cruda como hace el servidor, con un reloj explícito. */
const derivada = (fila: Row, now: Date) => deriveAttention(fila as never, now);

describe("013 C2 — derivación de needsAttentionNow en un único lugar", () => {
  const fila = (state: Estado, dueAt: Date | null) => ({
    id: "ca_x",
    conversationId: "cv_x",
    organizationId: ORG_A,
    state,
    dueAt,
    note: null,
    createdAt: HOY,
    updatedAt: HOY,
  });

  it("pending: la conversación espera acción humana ahora", () => {
    const view = derivada(fila("pending", null), HOY);
    expect(view.needsAttentionNow).toBe(true);
    expect(resumenAtencion(view)!.needsAttentionNow).toBe(true);
  });

  it("waiting_client: atendido, la pelota está en el cliente", () => {
    const view = derivada(fila("waiting_client", null), HOY);
    expect(view.needsAttentionNow).toBe(false);
    expect(view.waitingClient).toBe(true);
  });

  it("deferred con due_at FUTURO: agendado, todavía no es trabajo de hoy", () => {
    const view = derivada(fila("deferred", new Date(HOY.getTime() + 2 * MIN)), HOY);
    expect(view.needsAttentionNow).toBe(false);
    expect(view.scheduled).toBe(true);
  });

  it("deferred con due_at VENCIDO: vuelve a la cola sin worker ni cron", () => {
    const view = derivada(fila("deferred", new Date(HOY.getTime() - 1 * MIN)), HOY);
    expect(view.needsAttentionNow).toBe(true);
    expect(view.overdue).toBe(true);
  });

  it("el vencimiento exacto (due_at == now) ya está vencido", () => {
    expect(derivada(fila("deferred", new Date(HOY)), HOY).needsAttentionNow).toBe(
      true
    );
  });

  it("resumenAtencion(null) es null: sin estado humano no hay cola", () => {
    expect(resumenAtencion(null)).toBeNull();
    expect(necesitaAtencionAhora({ attention: null } as never)).toBe(false);
    expect(necesitaAtencionAhora({} as never)).toBe(false);
  });
});

describe("013 C2 — listConversations resuelve la atención en un solo SELECT", () => {
  it("proyecta attention con los cuatro campos del plan §4.1", async () => {
    const id = sembrarConversacion({ id: "cv_handoff", handoff: true });
    sembrarAtencion({ conversationId: id, state: "pending" });
    const [dto] = await listConversations(ORG_A);
    expect(dto!.attention).toEqual({
      state: "pending",
      dueAt: null,
      note: null,
      needsAttentionNow: true,
    });
    expect(selects).toBe(1);
  });

  it("attention es null cuando la conversación no tiene estado humano", async () => {
    const id = sembrarConversacion({ id: "cv_ia" });
    const [dto] = await listConversations(ORG_A);
    expect(dto!.id).toBe(id);
    expect(dto!.attention).toBeNull();
  });

  it("un LEFT JOIN por conversación: cero N+1 con muchas filas de atención", async () => {
    for (let i = 0; i < 25; i++) {
      const id = sembrarConversacion({ id: `cv_${i}`, handoff: true });
      sembrarAtencion({ conversationId: id, state: "pending" });
    }
    const lista = await listConversations(ORG_A);
    expect(lista).toHaveLength(25);
    // 25 conversaciones, 25 filas de atención: si el JOIN no cerrara el N+1,
    // el resultado explodingaría o el número de SELECTs crecería.
    expect(selects).toBe(1);
    expect(lista.every((c) => c.attention?.needsAttentionNow === true)).toBe(true);
  });

  it("el due_at y la nota viajan al DTO de la fila", async () => {
    const id = sembrarConversacion({ id: "cv_nota", handoff: true });
    const dueAt = new Date("2026-10-08T15:00:00Z");
    sembrarAtencion({ conversationId: id, state: "deferred", dueAt, note: "jueves 10:00" });
    const [dto] = await listConversations(ORG_A);
    expect(dto!.attention).toEqual({
      state: "deferred",
      dueAt: dueAt.toISOString(),
      note: "jueves 10:00",
      needsAttentionNow: false,
    });
  });

  it("is_test (Laboratorio) no aparece: no hay operador real atendiéndolo", async () => {
    sembrarConversacion({ id: "cv_lab", handoff: true, isTest: true });
    sembrarAtencion({ conversationId: "cv_lab", state: "pending" });
    expect(await listConversations(ORG_A)).toHaveLength(0);
  });

  it("la fila de atención de B no se pega a la conversación de A", async () => {
    // Conversación REAL de A (visible en la lista) cuya única fila de atención
    // pertenece a B. El ON lleva organization_id, así que A la ve sin atención.
    const id = sembrarConversacion({ id: "cv_a1", organizationId: ORG_A, handoff: true });
    sembrarAtencion({ organizationId: ORG_B, conversationId: id, state: "pending" });
    const [dto] = await listConversations(ORG_A);
    expect(dto!.id).toBe(id);
    expect(dto!.attention).toBeNull();
  });

  it("serializeConversation mantiene su firma: el parámetro extra es aditivo", () => {
    const conversacion = {
      id: "cv_x",
      contactId: "ct_x",
      organizationId: ORG_A,
      isTest: false,
      aiEnabled: true,
      handoffAt: null,
      handoffReason: null,
      unreadCount: 3,
      lastInboundAt: null,
      lastMessageAt: null,
      createdAt: HOY,
      updatedAt: HOY,
    } as never;
    const contacto = { id: "ct_x", name: "Ana", phone: null } as never;
    // La llamada de siempre (5 argumentos) sigue siendo válida: sin atención.
    const sinAtencion = serializeConversation(conversacion, contacto);
    expect(sinAtencion.attention).toBeNull();
    expect(sinAtencion.unreadCount).toBe(3);
    const conAtencion = serializeConversation(conversacion, contacto, null, null, null, {
      state: "pending",
      dueAt: null,
      note: null,
      needsAttentionNow: true,
    });
    expect(conAtencion.attention?.needsAttentionNow).toBe(true);
  });
});

describe("013 C2 — la cola: inclusión (FR-2.4) y exclusión (FR-2.5)", () => {
  it("incluye handoff recién creado, inbound durante HUMAN y recordatorio vencido", async () => {
    const handoff = sembrarConversacion({ id: "cv_1_handoff", handoff: true, nombre: "Handoff" });
    const inbound = sembrarConversacion({ id: "cv_2_inbound", handoff: true, nombre: "Inbound" });
    const vencido = sembrarConversacion({ id: "cv_3_vencido", handoff: true, nombre: "Vencido" });
    sembrarAtencion({ conversationId: handoff, state: "pending" });
    sembrarAtencion({ conversationId: inbound, state: "pending" });
    sembrarAtencion({
      conversationId: vencido,
      state: "deferred",
      dueAt: new Date(Date.now() - MIN),
    });
    const cola = resumirBandeja(await listConversations(ORG_A), { filter: "por_atender" });
    expect(cola.visibles.map((c) => c.id).sort()).toEqual([handoff, inbound, vencido].sort());
    expect(cola.porAtender).toBe(3);
  });

  it("excluye recordatorio futuro, waiting_client y conversación sin estado", async () => {
    const futuro = sembrarConversacion({ id: "cv_futuro", handoff: true, nombre: "Futuro" });
    const esperando = sembrarConversacion({ id: "cv_espera", handoff: true, nombre: "Esperando" });
    const sinEstado = sembrarConversacion({ id: "cv_sin", nombre: "Sin estado" });
    sembrarAtencion({
      conversationId: futuro,
      state: "deferred",
      dueAt: new Date(Date.now() + 5 * 24 * 60 * MIN),
    });
    sembrarAtencion({ conversationId: esperando, state: "waiting_client" });
    const cola = resumirBandeja(await listConversations(ORG_A), { filter: "por_atender" });
    expect(cola.visibles).toEqual([]);
    expect(cola.porAtender).toBe(0);
    // Están en la bandeja, solo que no son trabajo de ahora (FR-2.6).
    expect(resumirBandeja(await listConversations(ORG_A), { filter: "all" }).visibles).toHaveLength(3);
    expect([futuro, esperando, sinEstado]).toHaveLength(3);
  });

  it("unreadCount NO define la cola: atendida con no leídas no entra; vencida sin no leídas sí", async () => {
    const atendida = sembrarConversacion({ id: "cv_unread", handoff: true, unreadCount: 7, nombre: "Con no leídas" });
    const vencida = sembrarConversacion({ id: "cv_zero", handoff: true, unreadCount: 0, nombre: "Sin no leídas" });
    sembrarAtencion({ conversationId: atendida, state: "waiting_client" });
    sembrarAtencion({
      conversationId: vencida,
      state: "deferred",
      dueAt: new Date(Date.now() - MIN),
    });
    const lista = await listConversations(ORG_A);
    const cola = resumirBandeja(lista, { filter: "por_atender" });
    expect(cola.visibles.map((c) => c.id)).toEqual([vencida]);
    expect(cola.porAtender).toBe(1);
    expect(porId(lista, atendida)!.unreadCount).toBe(7);
    // Y el filtro de lectura sigue siendo el de siempre: ve la atendida, no la vencida.
    const sinLeer = resumirBandeja(lista, { filter: "unread" });
    expect(sinLeer.visibles.map((c) => c.id)).toEqual([atendida]);
    expect(sinLeer.noLeidas).toBe(1);
  });

  it("el conteo del chip es SIEMPRE la longitud de su listado", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const id = sembrarConversacion({ id: `cv_mix_${i}`, handoff: true, unreadCount: i % 2 });
      ids.push(id);
    }
    sembrarAtencion({ conversationId: ids[0]!, state: "pending" });
    sembrarAtencion({ conversationId: ids[1]!, state: "waiting_client" });
    sembrarAtencion({
      conversationId: ids[2]!,
      state: "deferred",
      dueAt: new Date(Date.now() - MIN),
    });
    sembrarAtencion({
      conversationId: ids[3]!,
      state: "deferred",
      dueAt: new Date(Date.now() + 60 * MIN),
    });
    const lista = await listConversations(ORG_A);
    // Un item de cada situación, para que ningún camino del filtro quede sin probar.
    const esperados = 2;
    for (const filtro of ["por_atender", "all", "unread", "ads"] as const) {
      const resumen = resumirBandeja(lista, { filter: filtro });
      if (filtro === "por_atender") {
        expect(resumen.visibles).toHaveLength(esperados);
        expect(resumen.porAtender).toBe(esperados);
      }
      // Invariante universal: cada chip cuenta lo que su lista muestra.
      const esperado = {
        por_atender: esperados,
        all: 7,
        unread: 3,
        ads: 0,
      }[filtro];
      const contador = {
        por_atender: resumen.porAtender,
        all: resumen.total,
        unread: resumen.noLeidas,
        ads: resumen.anuncios,
      }[filtro];
      expect(contador, filtro).toBe(esperado);
      expect(resumen.visibles.length, filtro).toBeLessThanOrEqual(contador);
    }
    // Y el conteo de la cola no depende de la búsqueda ni de la etapa: se
    // recalcula sobre la vista actual, como el resto de chips.
    expect(resumirBandeja(lista, { filter: "por_atender", query: "cv_mix_0" }).porAtender).toBe(1);
  });

  it("el filtro de etapa acota la cola: conteo y lista siguen cuadrando", async () => {
    const interesado = sembrarConversacion({ id: "cv_i", handoff: true, stageName: "Interesado", nombre: "Interesado" });
    const nuevo = sembrarConversacion({ id: "cv_n", handoff: true, stageName: "Nuevo", nombre: "Nuevo" });
    sembrarAtencion({ conversationId: interesado, state: "pending" });
    sembrarAtencion({ conversationId: nuevo, state: "pending" });
    // Las dos conversaciones están en la cola.
    expect(resumirBandeja(await listConversations(ORG_A), { filter: "por_atender" }).porAtender).toBe(2);

    // `stageName` viene de un subquery SQL, que el doble no sabe calcular
    // (`listConversations` lo devuelve null), así que la etapa se ejercita sobre
    // el DTO tal como lo pinta la fila. Lo que importa: el chip RECUENTA sobre
    // la vista por etapa en vez de seguir enseñando el total global.
    const conEtapa = [
      { id: interesado, contact: { id: "c1", name: "Interesado", phone: null }, stageName: "Interesado", unreadCount: 0, preview: null, anuncio: null, attention: { state: "pending", dueAt: null, note: null, needsAttentionNow: true } },
      { id: nuevo, contact: { id: "c2", name: "Nuevo", phone: null }, stageName: "Nuevo", unreadCount: 0, preview: null, anuncio: null, attention: { state: "pending", dueAt: null, note: null, needsAttentionNow: true } },
    ] as never[];
    const soloInteresado = resumirBandeja(conEtapa, { filter: "por_atender", stage: "Interesado" });
    expect(soloInteresado.porAtender).toBe(1);
    expect(soloInteresado.visibles).toHaveLength(1);
    expect(soloInteresado.visibles[0]!.id).toBe(interesado);
    // Y sin filtrar por etapa, las dos.
    expect(resumirBandeja(conEtapa, { filter: "por_atender" }).porAtender).toBe(2);
  });

  it("la búsqueda por nombre acota la cola igual que a las demás", async () => {
    const ana = sembrarConversacion({ id: "cv_ana", handoff: true, nombre: "Ana Ruiz" });
    const beto = sembrarConversacion({ id: "cv_beto", handoff: true, nombre: "Beto Soto" });
    sembrarAtencion({ conversationId: ana, state: "pending" });
    sembrarAtencion({ conversationId: beto, state: "pending" });
    const cola = resumirBandeja(await listConversations(ORG_A), {
      filter: "por_atender",
      query: "ana",
    });
    expect(cola.visibles.map((c) => c.contact.name)).toEqual(["Ana Ruiz"]);
    expect(cola.porAtender).toBe(1);
  });
});

describe("013 C2 — aislamiento tenant A/B en la lista y en el conteo", () => {
  it("cada organización ve solo su cola, y el conteo es el de su lista", async () => {
    sembrarConversacion({ id: "cv_a1", organizationId: ORG_A, handoff: true, nombre: "A-pendiente" });
    sembrarConversacion({ id: "cv_a2", organizationId: ORG_A, handoff: true, nombre: "A-atendida" });
    sembrarConversacion({ id: "cv_b1", organizationId: ORG_B, handoff: true, nombre: "B-pendiente" });
    sembrarAtencion({ organizationId: ORG_A, conversationId: "cv_a1", state: "pending" });
    sembrarAtencion({ organizationId: ORG_A, conversationId: "cv_a2", state: "waiting_client" });
    sembrarAtencion({ organizationId: ORG_B, conversationId: "cv_b1", state: "pending" });

    const colaA = resumirBandeja(await listConversations(ORG_A), { filter: "por_atender" });
    expect(colaA.visibles.map((c) => c.contact.name)).toEqual(["A-pendiente"]);
    expect(colaA.porAtender).toBe(1);
    expect(colaA.total).toBe(2);

    const colaB = resumirBandeja(await listConversations(ORG_B), { filter: "por_atender" });
    expect(colaB.visibles.map((c) => c.contact.name)).toEqual(["B-pendiente"]);
    expect(colaB.porAtender).toBe(1);
    expect(colaB.total).toBe(1);
  });

  it("una fila de atención ajena no cuelga en el DTO de la conversación", async () => {
    sembrarConversacion({ id: "cv_a", organizationId: ORG_A, handoff: true, nombre: "Solo A" });
    // Fila huérfana de B apuntando a una conversación que NO existe en B.
    sembrarAtencion({ organizationId: ORG_B, conversationId: "cv_b", state: "pending" });
    const lista = await listConversations(ORG_A);
    expect(lista).toHaveLength(1);
    expect(lista[0]!.attention).toBeNull();
    expect(resumirBandeja(lista, { filter: "por_atender" }).porAtender).toBe(0);
  });
});

describe("013 C2 — Todas / No leídas / Anuncios / etapa intactos (FR-2.6)", () => {
  function bandejaMixta() {
    const conAnuncio = sembrarConversacion({ id: "cv_ad", handoff: true, unreadCount: 2, nombre: "Anuncio", stageName: "Interesado" });
    const leida = sembrarConversacion({ id: "cv_ok", handoff: true, unreadCount: 0, nombre: "Leída", stageName: "Nuevo" });
    sembrarAtencion({ conversationId: conAnuncio, state: "pending" });
    tables.ad_attribution!.push({
      id: `aa_${conAnuncio}`,
      organizationId: ORG_A,
      conversationId: conAnuncio,
      sourceType: "ad",
      sourceId: "src_1",
      sourceUrl: null,
      headline: "Promo",
      ctwaClid: null,
      createdAt: HOY,
    } as Row);
    return { conAnuncio, leida };
  }

  it("'Todas' muestra todo; el filtro de búsqueda no mira el preview", () => {
    const { conAnuncio, leida } = bandejaMixta();
    const lista = resumirBandeja(
      [
        { id: conAnuncio, contact: { id: "c1", name: "Ana", phone: null }, stageName: "Interesado", unreadCount: 2, preview: "Zafiro", anuncio: null } as never,
        { id: leida, contact: { id: "c2", name: "Beto", phone: "51999988877" }, stageName: "Nuevo", unreadCount: 0, preview: "Ana", anuncio: null } as never,
      ],
      { filter: "all" }
    );
    expect(lista.visibles).toHaveLength(2);
    expect(lista.total).toBe(2);
    // Buscar por el texto del preview ya no devolvía coincidencias antes; sigue igual.
    expect(resumirBandeja(lista.visibles, { query: "Zafiro" }).visibles).toHaveLength(0);
  });

  it("'No leídas' cuenta y lista solo las no leídas", () => {
    const { conAnuncio, leida } = bandejaMixta();
    const lista = [
      { id: conAnuncio, contact: { id: "c1", name: "Ana", phone: null }, stageName: "Interesado", unreadCount: 2, preview: null, anuncio: { sourceType: "ad" } } as never,
      { id: leida, contact: { id: "c2", name: "Beto", phone: null }, stageName: "Nuevo", unreadCount: 0, preview: null, anuncio: null } as never,
    ];
    const sinLeer = resumirBandeja(lista, { filter: "unread" });
    expect(sinLeer.visibles.map((c) => c.id)).toEqual([conAnuncio]);
    expect(sinLeer.noLeidas).toBe(1);
  });

  it("'Anuncios' solo cuenta los que son anuncio de verdad", () => {
    const lista = [
      { id: "1", contact: { id: "c1", name: "A", phone: null }, stageName: null, unreadCount: 0, preview: null, anuncio: { sourceType: "ad" } } as never,
      { id: "2", contact: { id: "c2", name: "B", phone: null }, stageName: null, unreadCount: 0, preview: null, anuncio: { sourceType: "post" } } as never,
      { id: "3", contact: { id: "c3", name: "C", phone: null }, stageName: null, unreadCount: 0, preview: null, anuncio: null } as never,
    ];
    const anuncios = resumirBandeja(lista, { filter: "ads" });
    expect(anuncios.visibles.map((c) => c.id)).toEqual(["1"]);
    expect(anuncios.anuncios).toBe(1);
  });

  it("'Toda etapa' es el valor por defecto y el stage acota los tres filtros", () => {
    const lista = [
      { id: "1", contact: { id: "c1", name: "A", phone: null }, stageName: "Interesado", unreadCount: 1, preview: null, anuncio: null } as never,
      { id: "2", contact: { id: "c2", name: "B", phone: null }, stageName: "Nuevo", unreadCount: 1, preview: null, anuncio: null } as never,
    ];
    expect(resumirBandeja(lista).total).toBe(2);
    expect(resumirBandeja(lista, { stage: "Nuevo" }).visibles.map((c) => c.id)).toEqual(["2"]);
  });
});

describe("013 C2 — la UI pinta el chip y su número", () => {
  const conversacion = (
    id: string,
    nombre: string,
    extra: Record<string, unknown> = {}
  ): ConversationDto =>
    ({
      id,
      contact: { id: `ct_${id}`, name: nombre, phone: null },
      stageName: null,
      aiEnabled: true,
      handoffAt: null,
      handoffReason: null,
      lastInboundAt: null,
      lastMessageAt: "2026-10-05T11:00:00.000Z",
      unreadCount: 0,
      windowOpen: false,
      windowRemainingMs: 0,
      preview: "hola",
      anuncio: null,
      ...extra,
    }) as unknown as ConversationDto;

  const render = (conversations: ConversationDto[]) =>
    renderToStaticMarkup(
      createElement(ConversationList, {
        conversations,
        selectedId: null,
        onSelect: () => {},
        onSeeded: () => {},
      })
    );

  it("'Por atender' es el PRIMER chip de la fila y muestra el conteo", () => {
    const html = render([
      conversacion("cv_1", "Ana", {
        attention: { state: "pending", dueAt: null, note: null, needsAttentionNow: true },
      }),
      conversacion("cv_2", "Beto", {
        attention: { state: "waiting_client", dueAt: null, note: null, needsAttentionNow: false },
      }),
      conversacion("cv_3", "Caro"),
    ]);
    // El número vive en el <span> del contador, dentro del mismo botón.
    expect(html).toMatch(/Por atender<span[^>]*>1<\/span>/);
    // La fila arranca con la cola, no con "Todas".
    expect(html.indexOf("Por atender")).toBeLessThan(html.indexOf("Todas"));
    expect(html).toContain("No leídas");
  });

  it("con la cola vacía el chip muestra 0 y la lista sigue mostrando 'Todas'", () => {
    const html = render([conversacion("cv_1", "Ana")]);
    expect(html).toMatch(/Por atender<span[^>]*>0<\/span>/);
    expect(html).toContain("Ana");
  });

  it("el chip expone su estado para lectores de pantalla y teclado", () => {
    const html = render([
      conversacion("cv_1", "Ana", {
        attention: { state: "pending", dueAt: null, note: null, needsAttentionNow: true },
      }),
    ]);
    expect(html).toContain('aria-pressed="false"');
  });
});
