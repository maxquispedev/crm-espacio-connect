import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect, type PgColumn } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { UnauthorizedError } from "@/lib/auth/session";
import { DEMO_RESOURCE_SLOTS } from "@/lib/commercial/resources";
import { GET, PUT } from "@/app/api/commercial-resources/route";
import { PUT as VIDEO } from "@/app/api/commercial-resources/videos/[slot]/route";
import { GET as PREVIEW } from "@/app/api/media/[assetId]/route";
import * as media from "@/server/whatsapp/media";
import { validateMp4 } from "@/server/commercial/resources";

// Auth doble; handlers/withAuth/scoped/ORM/store/FS reales. PostgreSQL opt-in aparte.
let org: string | null = "org_a";
let mediaDir: string;
vi.mock("@/lib/auth/session", async (original) => ({ ...await original<object>(),
  requireSession: async () => { if (!org) throw new UnauthorizedError(); return { userId: "u_test", organizationId: org, role: "member" }; },
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ MEDIA_DIR: mediaDir }) }));
vi.mock("@/lib/db", async () => ({ schema: await import("@/lib/db/schema"), getDb: () => db }));
const graph = vi.hoisted(() => vi.fn(() => { throw new Error("Graph forbidden"); }));
vi.mock("@/lib/meta/client", () => ({ graphRequest: graph }));
vi.mock("@/server/whatsapp/credentials", () => ({ getCredentialsByOrg: graph }));

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = { commercial_resource: [], media_asset: [] };
let failure = "";
const dialect = new PgDialect();
const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
function matches(row: Row, condition: SQL) {
  const query = dialect.sqlToQuery(condition);
  const filters = [...query.sql.matchAll(/"\w+"\."(\w+)" = \$(\d+)/g)];
  expect(filters.length).toBe(query.params.length);
  expect(query.sql).toContain('"organization_id"');
  return filters.every((m) => row[camel(m[1]!)] === query.params[Number(m[2]) - 1]);
}
const db = {
  select: () => ({ from: (table: typeof schema.mediaAsset) => ({ where: (condition: SQL) => ({ limit: (n: number) => {
    if (failure === "read" || failure === "unavailable") throw new Error("database path /private secret");
    return tables[getTableName(table)]!.filter((row) => matches(row, condition)).slice(0, n).map((row) => ({ ...row }));
  } }) }) }),
  insert: (table: typeof schema.mediaAsset) => ({ values: (value: Row) => {
    const name = getTableName(table);
    const returning = () => {
      if (failure === name || failure === "unavailable") throw new Error("database secret");
      const row = { createdAt: new Date(), updatedAt: new Date(), ...value };
      tables[name]!.push(row); return [{ ...row }];
    };
    return { returning, onConflictDoUpdate: (conflict: { target: PgColumn[]; set: Row; setWhere: SQL }) => ({ returning: () => {
      if (failure === name) throw new Error("database secret");
      const previous = tables[name]!.find((row) => conflict.target.every((col) => row[camel(col.name)] === value[camel(col.name)]));
      if (!previous) return returning();
      if (!matches(previous, conflict.setWhere)) return [];
      Object.assign(previous, conflict.set); return [{ ...previous }];
    } }) };
  } }),
  transaction: async (run: (tx: object) => Promise<unknown>): Promise<unknown> => {
    const before = structuredClone(tables);
    let result;
    try { result = await run(db); }
    catch (error) { tables = before; throw error; }
    if (failure === "rollback_commit") { tables = before; throw new Error("rollback before commit"); }
    if (failure === "commit_uncertain") throw new Error("commit response lost");
    return result;
  },
};

function box(kind: string, bytes: Buffer) {
  const header = Buffer.alloc(8); header.writeUInt32BE(8 + bytes.length); header.write(kind, 4); return Buffer.concat([header, bytes]);
}
// Estructura sintética mínima, sin afirmar decodificación; video E2E real generado fuera de Git.
const handler = Buffer.alloc(24); handler.write("vide", 8);
const mp4 = Buffer.concat([box("ftyp", Buffer.from("isom\0\0\0\0mp42")),
  box("moov", Buffer.concat([box("mvhd", Buffer.alloc(100)), box("trak", box("mdia", box("hdlr", handler)))])),
  box("mdat", Buffer.from([1, 2, 3]))]);
const empty = { transfers: [], yape: null, paymentLink: null };
const full = { transfers: [{ bank: " Banco ", holder: " Titular ", currency: "PEN", accountNumber: "001-002" }],
  yape: { phone: "+51 999888777", holder: " Prueba " }, paymentLink: "https://payments.example.test/pay" };
function json(body: unknown) { return new Request("http://localhost/api/commercial-resources", { method: "PUT", body: JSON.stringify(body) }); }
function upload(slot: string, bytes: Buffer = mp4, mime = "video/mp4", extras = false) {
  const form = new FormData(); form.set("file", new File([new Uint8Array(bytes)], "../demo<test>.mp4", { type: mime }));
  if (extras) form.set("organizationId", "org_b");
  return VIDEO(new Request("http://localhost/upload", { method: "PUT", body: form }), { params: Promise.resolve({ slot }) });
}
const preview = (assetId: string) => PREVIEW(new Request("http://localhost/preview"), { params: Promise.resolve({ assetId }) });
async function files() { return readdir(path.join(mediaDir, "org_a")).catch(() => []); }

beforeAll(async () => { mediaDir = await mkdtemp(path.join(tmpdir(), "commercial-api-")); });
afterAll(async () => { await rm(mediaDir, { recursive: true, force: true }); });
beforeEach(async () => {
  org = "org_a"; failure = ""; tables = { commercial_resource: [], media_asset: [] };
  vi.restoreAllMocks(); graph.mockClear(); await rm(path.join(mediaDir, "org_a"), { recursive: true, force: true });
});

describe("API recursos autenticada y local", () => {
  it("ausente devuelve tres demos vacías y cobro vacío, sin seed", async () => {
    expect(await (await GET()).json()).toEqual({ videos: DEMO_RESOURCE_SLOTS.map((slot) => ({ slot, configured: false, media: null })), paymentInstructions: empty });
    expect(tables.commercial_resource).toHaveLength(0);
  });
  it.each(DEMO_RESOURCE_SLOTS)("sube y reemplaza %s, conserva preview histórica y bytes", async (slot) => {
    const firstResponse = await upload(slot); expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    const second = await (await upload(slot)).json();
    expect(second.media.assetId).not.toBe(first.media.assetId);
    expect(first.media.fileName).toBe("demo_test_.mp4");
    expect(first.media).not.toHaveProperty("storagePath"); expect(first.media).not.toHaveProperty("waMediaId");
    expect(tables.media_asset).toHaveLength(2); expect(tables.commercial_resource).toHaveLength(1);
    const current = await (await GET()).json();
    expect(current.videos.find((v: { slot: string }) => v.slot === slot)).toEqual(second);
    for (const id of [first.media.assetId, second.media.assetId]) {
      const res = await preview(id); expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("video/mp4");
      expect(Buffer.from(await res.arrayBuffer())).toEqual(mp4);
    }
    expect(graph).not.toHaveBeenCalled();
  });
  it("guarda/relee cobro completo normalizado y luego vacío sin modificar videos", async () => {
    await upload(DEMO_RESOURCE_SLOTS[0]); const videos = tables.media_asset!.length;
    expect((await PUT(json({ paymentInstructions: full }))).status).toBe(200);
    const result = await (await GET()).json();
    expect(result.paymentInstructions.transfers[0].accountNumber).toBe("001-002");
    expect(result.paymentInstructions.yape).toEqual({ phone: "999888777", holder: "Prueba" });
    expect((await PUT(json({ paymentInstructions: empty }))).status).toBe(200);
    expect((await (await GET()).json()).paymentInstructions).toEqual(empty);
    expect(tables.media_asset).toHaveLength(videos); expect(graph).not.toHaveBeenCalled();
  });
  it.each([
    { ...empty, yape: { phone: "999888777", holder: "" } },
    { ...empty, transfers: [{ bank: "Banco", holder: "Titular", currency: "PEN" }] },
    { ...empty, paymentLink: "https://localhost/pay" },
    { ...empty, paymentLink: "https://user:password@example.test/pay" },
  ])("cobro incompleto/inválido 422 conserva bloque previo %j", async (paymentInstructions) => {
    await PUT(json({ paymentInstructions: full })); const before = (await (await GET()).json()).paymentInstructions;
    expect((await PUT(json({ paymentInstructions }))).status).toBe(422);
    expect((await (await GET()).json()).paymentInstructions).toEqual(before);
  });
  it.each([
    [Buffer.alloc(0), "video/mp4", 422], [Buffer.from("fake.mp4"), "video/mp4", 415],
    [mp4, "application/octet-stream", 415], [Buffer.alloc(media.MEDIA_LIMITS.video.maxBytes + 1), "video/mp4", 413],
  ] as const)("rechaza vacío/falso/MIME/oversized antes de escribir", async (bytes, mime, status) => {
    expect((await upload(DEMO_RESOURCE_SLOTS[0], bytes, mime)).status).toBe(status);
    expect(await files()).toHaveLength(0); expect(tables.media_asset).toHaveLength(0); expect(graph).not.toHaveBeenCalled();
  });
  it("slot inválido 404, JSON/multipart inválidos 400 y campos externos rechazados", async () => {
    expect((await upload("../other")).status).toBe(404);
    expect((await upload(DEMO_RESOURCE_SLOTS[0], mp4, "video/mp4", true)).status).toBe(400);
    expect((await PUT(new Request("http://localhost", { method: "PUT", body: "{" }))).status).toBe(400);
    expect((await PUT(json({ paymentInstructions: empty, organizationId: "org_b" }))).status).toBe(422);
    expect((await VIDEO(json({ file: "path" }), { params: Promise.resolve({ slot: DEMO_RESOURCE_SLOTS[0] }) })).status).toBe(400);
    const form = new FormData(); form.set("file", "/private/path.mp4");
    expect((await VIDEO(new Request("http://localhost", { method: "PUT", body: form }), { params: Promise.resolve({ slot: DEMO_RESOURCE_SLOTS[0] }) })).status).toBe(400);
  });
  it("sin sesión: GET/PUT/upload/preview 401, sin escrituras", async () => {
    org = null;
    expect((await GET()).status).toBe(401); expect((await PUT(json({ paymentInstructions: empty }))).status).toBe(401);
    expect((await upload(DEMO_RESOURCE_SLOTS[0])).status).toBe(401); expect((await preview("ma_foreign")).status).toBe(401);
    expect(tables.media_asset).toHaveLength(0); expect(await files()).toHaveLength(0);
  });
  it("org de sesión scopea recursos y preview; B no lee ni reemplaza los de A", async () => {
    const a = await (await upload(DEMO_RESOURCE_SLOTS[0])).json();
    await PUT(json({ paymentInstructions: full })); org = "org_b";
    const b = await (await GET()).json(); expect(b.videos.every((v: { configured: boolean }) => !v.configured)).toBe(true);
    expect(b.paymentInstructions).toEqual(empty); expect((await preview(a.media.assetId)).status).toBe(404);
    await upload(DEMO_RESOURCE_SLOTS[0]); org = "org_a";
    expect((await (await GET()).json()).videos[0]).toEqual(a); expect(graph).not.toHaveBeenCalled();
  });
  it.each(["media_asset", "commercial_resource", "rollback_commit"])("fallo BD %s revierte asset+vínculo y compensa solo el archivo nuevo", async (mode) => {
    const before = await (await upload(DEMO_RESOURCE_SLOTS[0])).json(); const originalFiles = await files();
    failure = mode;
    const res = await upload(DEMO_RESOURCE_SLOTS[0]); expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/secret|private/);
    failure = "";
    expect(await files()).toEqual(originalFiles); expect((await (await GET()).json()).videos[0]).toEqual(before);
    expect(tables.media_asset).toHaveLength(1);
  });
  it("fallo disco tras escritura parcial conserva previo y elimina archivo nuevo", async () => {
    const before = await (await upload(DEMO_RESOURCE_SLOTS[0])).json(); const originalFiles = await files();
    const save = media.saveMediaFile;
    vi.spyOn(media, "saveMediaFile").mockImplementation(async (...args) => { await save(...args); throw new Error("disk secret /private"); });
    expect((await upload(DEMO_RESOURCE_SLOTS[0])).status).toBe(500);
    expect(await files()).toEqual(originalFiles); expect((await (await GET()).json()).videos[0]).toEqual(before);
  });
  it("replacements concurrentes conservan ambos assets; último vínculo válido", async () => {
    const responses = await Promise.all([upload(DEMO_RESOURCE_SLOTS[0]), upload(DEMO_RESOURCE_SLOTS[0])]);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const ids = await Promise.all(responses.map(async (response) => (await response.json()).media.assetId));
    expect(await files()).toHaveLength(2);
    expect(ids).toContain((await (await GET()).json()).videos[0].media.assetId);
    for (const id of ids) expect((await preview(id)).status).toBe(200);
  });
  it("commit incierto conserva nuevo archivo si asset persistió; nunca elimina referencias", async () => {
    failure = "commit_uncertain";
    expect((await upload(DEMO_RESOURCE_SLOTS[0])).status).toBe(500);
    expect(await files()).toHaveLength(1); expect(tables.media_asset).toHaveLength(1);
    failure = ""; const current = await (await GET()).json();
    expect((await preview(current.videos[0].media.assetId)).status).toBe(200);
  });
  it("BD inaccesible impide probar ausencia: conserva nuevo archivo por seguridad", async () => {
    failure = "unavailable";
    expect((await upload(DEMO_RESOURCE_SLOTS[0])).status).toBe(500);
    expect(await files()).toHaveLength(1); expect(tables.media_asset).toHaveLength(0);
  });
  it("errores leer/guardar cobro 500 controlados sin datos internos", async () => {
    failure = "read"; const res = await GET(); expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/secret|private/);
    failure = "commercial_resource"; expect((await PUT(json({ paymentInstructions: full }))).status).toBe(500);
  });
  it("firma valida estructura completa y rechaza truncados/ftyp solo/box mal formada", () => {
    expect(() => validateMp4(mp4, "video/mp4")).not.toThrow();
    const audioOnly = Buffer.from(mp4); audioOnly.write("soun", audioOnly.indexOf("vide"));
    expect(() => validateMp4(audioOnly, "video/mp4")).toThrow();
    const spoof = Buffer.concat([box("ftyp", Buffer.from("isom\0\0\0\0mp42")), box("moov", box("mvhd", Buffer.alloc(100))), box("mdat", Buffer.from([1]))]);
    expect(() => validateMp4(spoof, "video/mp4")).toThrow();
    const tooLong = Buffer.from(mp4); tooLong.writeUInt32BE(0xffffffff);
    for (const invalid of [mp4.subarray(0, 20), mp4.subarray(0, mp4.length - 1), tooLong,
      Buffer.concat([mp4, Buffer.from([1])]), Buffer.from("\0\0\0\x10ftypisom"),
      Buffer.concat([box("ftyp", Buffer.from("qt  \0\0\0\0qt  ")), mp4.subarray(20)])]) {
      expect(() => validateMp4(invalid, "video/mp4")).toThrow();
    }
  });
  it("acepta límite exacto y boxes extendidas válidas sin confiar en extensión", async () => {
    const extended = Buffer.alloc(19); extended.writeUInt32BE(1); extended.write("mdat", 4); extended.writeBigUInt64BE(19n, 8); extended.fill(1, 16);
    const header = mp4.subarray(0, mp4.length - 11);
    expect(() => validateMp4(Buffer.concat([header, extended]), "video/mp4")).not.toThrow();
    const padding = box("free", Buffer.alloc(media.MEDIA_LIMITS.video.maxBytes - mp4.length - 8));
    expect(() => validateMp4(Buffer.concat([mp4, padding]), "video/mp4")).not.toThrow();
    expect((await upload(DEMO_RESOURCE_SLOTS[0], Buffer.concat([mp4, padding]))).status).toBe(200);
    const file = tables.media_asset![0]!;
    expect((await readFile(path.join(mediaDir, "org_a", file.id as string))).length).toBe(media.MEDIA_LIMITS.video.maxBytes);
  });
});
