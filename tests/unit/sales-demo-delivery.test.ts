import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getTableName, type SQL } from "drizzle-orm";
import { PgColumn, PgDialect } from "drizzle-orm/pg-core";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { saveMediaFile } from "@/server/whatsapp/media";
import * as media from "@/server/whatsapp/media";
import * as sender from "@/server/inbox/send";
import { runSalesOrchestratorTurn } from "@/server/sales/orchestrator";
import { readSandboxMessages, cleanupSandboxCase } from "@/server/lab/sandbox-case";
import { makeDecision } from "./sales-fixtures";
import { DEMO_RESOURCE_SLOTS } from "@/lib/commercial/resources";
import type { DemoResourceSlot } from "@/lib/commercial/resources";

// Orquestador/resolver/store/FS/delivery/sender reales. BD en memoria, no PostgreSQL.
const mocks = vi.hoisted(() => ({ graph: vi.fn(), upload: vi.fn(), writer: vi.fn(), jev: vi.fn(),
  build: vi.fn(), manual: vi.fn(), follow: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/db", async () => ({ schema: await import("@/lib/db/schema"), getDb: () => db }));
let mediaDir: string;
vi.mock("@/lib/env", () => ({ getEnv: () => ({ MEDIA_DIR: mediaDir }) }));
vi.mock("@/lib/meta/client", async original => ({ ...await original<object>(), graphRequest: mocks.graph }));
vi.mock("@/server/whatsapp/media", async original => ({ ...await original<object>(), uploadGraphMedia: mocks.upload }));
vi.mock("@/server/whatsapp/credentials", () => ({ getCredentialsByOrg: async (organizationId: string) => ({ organizationId, phoneNumberId: "pn_local", token: "fixture" }), markReconnectRequired: vi.fn() }));
vi.mock("@/server/sales/writer", () => ({ writeSalesReply: mocks.writer }));
vi.mock("@/server/sales/client", () => ({ evaluateJev: mocks.jev }));
vi.mock("@/server/sales/build-state", () => ({ buildJevSalesState: mocks.build }));
vi.mock("@/server/sales/follow-ups/store", () => ({ cancelFollowUpsOnManualReply: mocks.manual, scheduleNextFollowUp: mocks.follow }));
vi.mock("@/server/events/message-new", () => ({ publishMessageNew: mocks.publish }));
vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let failure: string;
const dialect = new PgDialect();
const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
function match(row: Row, condition: SQL) {
  const q = dialect.sqlToQuery(condition);
  const payload = [...q.sql.matchAll(/->>'sandboxConversationId' = \$(\d+)/g)].every(m =>
    (row.payload as { sandboxConversationId?: string } | undefined)?.sandboxConversationId === q.params[Number(m[1]) - 1]);
  return payload && [...q.sql.matchAll(/"\w+"\."(\w+)" = \$(\d+)/g)].every(m => row[camel(m[1]!)] === q.params[Number(m[2]) - 1]);
}
function project(row: Row, projection?: Record<string, unknown>) {
  if (!projection) return { ...row };
  return Object.fromEntries(Object.entries(projection).map(([key, ref]) => [key,
    ref instanceof PgColumn ? row[camel(ref.name)] : row[key] ?? null]));
}
const db = {
  select(projection?: Record<string, unknown>) {
    let name: string, condition: SQL;
    let joined = false;
    const result = () => {
      if (failure === "read") throw new Error("read failed");
      let rows = tables[name]!.filter(r => !condition || match(r, condition));
      if (joined && name === "lead") rows = rows.map(r => ({ ...r, lead: r, stage: tables.pipeline_stage![0] }));
      if (joined && name === "conversation") rows = rows.map(r => ({ ...r, conversation: r, contact: tables.contact!.find(c => c.id === r.contactId) }));
      if (joined && name === "message") rows = rows.map(r => ({ ...r, caption: tables.media_asset!.find(a => a.id === r.mediaAssetId && a.organizationId === r.organizationId)?.caption }));
      return rows.map(r => project(r, projection));
    };
    const chain = { from(table: typeof schema.message) { name = getTableName(table); return chain; },
      where(c: SQL) { condition = c; return chain; }, innerJoin() { joined = true; return chain; },
      leftJoin() { joined = true; return chain; }, orderBy() { return chain; },
      limit(n: number) { return Promise.resolve(result().slice(0, n)); },
      then(resolve: (rows: Row[]) => unknown, reject?: (e: unknown) => unknown) { return Promise.resolve().then(result).then(resolve, reject); } };
    return chain;
  },
  insert(table: typeof schema.message) { return { values(row: Row) {
    const insert = () => {
      const name = getTableName(table);
      if (failure === name || failure === "persist" && name === "message") throw new Error("persist failed");
      const saved = { createdAt: new Date(), ...row }; tables[name]!.push(saved); return [saved];
    };
    return { returning: () => Promise.resolve().then(insert), then: (resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve().then(insert).then(resolve, reject) };
  } }; },
  update(table: typeof schema.message) { return { set(patch: Row) { return { where(condition: SQL) {
    const update = () => { const rows = tables[getTableName(table)]!.filter(r => match(r, condition)); rows.forEach(r => Object.assign(r, patch)); return rows; };
    return { returning: () => Promise.resolve(update()), then: (resolve: (v: Row[]) => unknown) => Promise.resolve(update()).then(resolve) };
  } }; } }; },
  delete(table: typeof schema.message) { return { where(condition: SQL) {
    const name = getTableName(table);
    tables[name] = tables[name]!.filter(row => !match(row, condition));
    return Promise.resolve();
  } }; },
  transaction: async (run: (tx: object) => Promise<unknown>) => {
    const before = structuredClone(tables);
    try { return await run(db); } catch (e) { tables = before; throw e; }
  },
};
function box(kind: string, bytes: Buffer) { const h = Buffer.alloc(8); h.writeUInt32BE(8 + bytes.length); h.write(kind, 4); return Buffer.concat([h, bytes]); }
const handler = Buffer.alloc(24); handler.write("vide", 8);
const bytes = Buffer.concat([box("ftyp", Buffer.from("isom\0\0\0\0mp42")), box("moov", Buffer.concat([box("mvhd", Buffer.alloc(100)), box("trak", box("mdia", box("hdlr", handler)))])), box("mdat", Buffer.from([1, 2, 3]))]);
const conv = () => tables.conversation![0]! as unknown as typeof schema.conversation.$inferSelect;
async function seed(slot: DemoResourceSlot, org = "org_a") {
  const id = `ma_${org}_${slot}`;
  const storagePath = await saveMediaFile(org, id, bytes);
  tables.media_asset!.push({ id, organizationId: org, kind: "video", mimeType: "video/mp4", fileName: "demo.mp4", fileSize: bytes.length, storagePath, fetchStatus: "available" });
  tables.commercial_resource!.push({ id: `cr_${org}_${slot}`, organizationId: org, slot, mediaAssetId: id, payload: null });
  return id;
}
const turn = () => runSalesOrchestratorTurn({ organizationId: "org_a", conversationId: "cv_a", conversation: conv() });
const out = () => tables.message!.filter(m => m.direction === "out");
const fact = () => tables.lead![0]!.demoShownAt;
beforeAll(async () => { mediaDir = await mkdtemp(path.join(tmpdir(), "demo-delivery-")); });
afterAll(async () => { await rm(mediaDir, { recursive: true, force: true }); });
beforeEach(() => {
  vi.restoreAllMocks(); Object.values(mocks).forEach(m => m.mockReset()); failure = "";
  mocks.graph.mockResolvedValue({ messages: [{ id: "wamid.fixture" }] }); mocks.upload.mockResolvedValue("uploaded");
  mocks.writer.mockResolvedValue({ ok: true, text: "Así se registran los alumnos." });
  mocks.jev.mockResolvedValue({ ok: true, decision: makeDecision({ nextAction: "show_operations_demo" }), snapshot: {} });
  mocks.build.mockResolvedValue({ ok: true, persist: { leadId: "ld_a" }, playbook: null,
    state: { conversation: [{ from: "lead", text: "matrícula" }], product: {}, commercial_policy: {} } });
  tables = { commercial_resource: [], media_asset: [], message: [], kb_entry: [], agent_profile: [],
    contact: [{ id: "ct_a", organizationId: "org_a", phone: "51999000001" }],
    pipeline_stage: [{ id: "st_a", organizationId: "org_a", name: "En conversación", kind: "open" }],
    conversation: [{ id: "cv_a", organizationId: "org_a", contactId: "ct_a", isTest: false, lastInboundAt: new Date() }],
    lead: [{ id: "ld_a", organizationId: "org_a", stageId: "st_a", automationLane: "auto", demoShownAt: null, pricePresentedAt: null, paymentInstructionsSentAt: null }] };
});
describe("pipeline demo nativa", () => {
  it.each(DEMO_RESOURCE_SLOTS)("%s: Graph video+caption, hilo IA y fact después del sender", async slot => {
    await seed(slot);
    if (slot === "demo_online_enrollment") mocks.jev.mockResolvedValue({ ok: true, decision: makeDecision({ nextAction: "show_online_enrollment_demo" }), snapshot: {} });
    if (slot === "demo_payments_balances") mocks.build.mockResolvedValue({ ok: true, persist: { leadId: "ld_a" }, playbook: null,
      state: { conversation: [{ from: "lead", text: "saldos" }], product: {}, commercial_policy: {} } });
    mocks.graph.mockImplementation(async () => { expect(fact()).toBeNull(); return { messages: [{ id: "wamid.fixture" }] }; });
    await turn();
    expect(mocks.graph).toHaveBeenCalledOnce(); expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.graph.mock.calls[0]![1].body).toMatchObject({ type: "video", video: { id: "uploaded", caption: "Así se registran los alumnos." } });
    expect(out()).toHaveLength(1); expect(out()[0]).toMatchObject({ type: "video", text: null, origin: "ai", aiGenerated: true, status: "pending" });
    expect(fact()).toBeInstanceOf(Date); expect(mocks.manual).not.toHaveBeenCalled(); expect(mocks.follow).toHaveBeenCalledOnce();
    expect(tables.lead![0]!.pricePresentedAt).toBeNull();
  });
  it.each(["absent", "foreign", "lost", "corrupt"])("%s: texto honesto, sin video/fact/scheduling", async mode => {
    if (mode === "foreign") await seed("demo_enrollment_panel", "org_b");
    if (mode === "lost" || mode === "corrupt") { const id = await seed("demo_enrollment_panel");
      if (mode === "lost") await rm(path.join(mediaDir, "org_a", id));
      else await saveMediaFile("org_a", id, Buffer.alloc(bytes.length)); }
    await turn(); expect(fact()).toBeNull(); expect(mocks.upload).not.toHaveBeenCalled();
    expect(out()[0]?.text).toContain("no está disponible"); expect(mocks.follow).not.toHaveBeenCalled();
    expect(mocks.writer.mock.calls[0]![0].demo.available).toBe(false);
  });
  it.each(["upload", "meta", "id", "persist", "window", "disk"])("%s: ningún fact, segundo mensaje ni retry", async mode => {
    await seed("demo_enrollment_panel");
    if (mode === "upload") mocks.upload.mockRejectedValue(new Error("upload"));
    if (mode === "meta") mocks.graph.mockRejectedValue(new Error("Meta"));
    if (mode === "id") mocks.graph.mockResolvedValue({});
    if (mode === "persist") failure = "persist";
    if (mode === "window") tables.conversation![0]!.lastInboundAt = new Date(0);
    if (mode === "disk") vi.spyOn(media, "saveMediaFile").mockRejectedValue(new Error("disk"));
    await turn(); expect(fact()).toBeNull(); expect(mocks.follow).not.toHaveBeenCalled();
    expect(out().every(m => m.type === "video" && m.status === "failed" && m.origin === "ai" && m.aiGenerated === true)).toBe(true);
    expect(mocks.upload.mock.calls.length).toBeLessThanOrEqual(1); expect(mocks.graph.mock.calls.length).toBeLessThanOrEqual(1);
    if (mode === "window") expect(tables.conversation![0]!.handoffReason).toBe("ventana");
  });
  it("HUMAN tiene precedencia: no lee ni entrega demo", async () => {
    await seed("demo_enrollment_panel"); mocks.jev.mockResolvedValue({ ok: true, decision: makeDecision({ nextAction: "show_operations_demo", needsHumanNoul: 0.9 }), snapshot: {} });
    await turn(); expect(fact()).toBeNull(); expect(mocks.upload).not.toHaveBeenCalled(); expect(out()[0]?.type).toBe("text");
  });
  it("sandbox: media+caption reales locales, fact tras persistencia, cero sender/upload/Graph", async () => {
    await seed("demo_enrollment_panel"); tables.conversation![0]!.isTest = true;
    const spy = vi.spyOn(sender, "sendMediaMessage"); const textSpy = vi.spyOn(sender, "sendText");
    await turn(); expect(fact()).toBeInstanceOf(Date); expect(out()[0]).toMatchObject({ type: "video", text: null, status: "sent", origin: "ai", aiGenerated: true });
    const asset = tables.media_asset!.find(a => a.id === out()[0]!.mediaAssetId)!;
    expect(asset.caption).toBe("Así se registran los alumnos."); expect(await readFile(path.join(mediaDir, "org_a", String(asset.id)))).toEqual(bytes);
    expect(await readSandboxMessages({ organizationId: "org_a", conversationId: "cv_a" })).toEqual([{ direction: "out", text: "Así se registran los alumnos." }]);
    expect(await readSandboxMessages({ organizationId: "org_b", conversationId: "cv_a" })).toEqual([]);
    for (const check of [spy, textSpy, mocks.graph, mocks.upload, mocks.follow]) expect(check).not.toHaveBeenCalled();
  });
  it("cleanup sandbox elimina solo copia del caso, conserva fuente y tenant B", async () => {
    const sourceId = await seed("demo_enrollment_panel");
    const otherId = await seed("demo_enrollment_panel", "org_b");
    tables.media_asset!.find(a => a.id === otherId)!.payload = { sandboxConversationId: "cv_a" };
    tables.conversation![0]!.isTest = true;
    await turn();
    const copyId = String(out()[0]!.mediaAssetId);
    expect(copyId).not.toBe(sourceId);
    await cleanupSandboxCase({ organizationId: "org_a", contactId: "ct_a" });
    expect(tables.media_asset!.map(a => a.id)).toEqual([sourceId, otherId]);
    expect(await readFile(path.join(mediaDir, "org_a", sourceId))).toEqual(bytes);
    expect(await readFile(path.join(mediaDir, "org_b", otherId))).toEqual(bytes);
    await expect(readFile(path.join(mediaDir, "org_a", copyId))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("sandbox rollback no marca demo ni entra al sender", async () => {
    await seed("demo_enrollment_panel"); tables.conversation![0]!.isTest = true; failure = "message";
    await turn(); expect(fact()).toBeNull(); expect(out()).toEqual([]); expect(mocks.graph).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
  });
});
