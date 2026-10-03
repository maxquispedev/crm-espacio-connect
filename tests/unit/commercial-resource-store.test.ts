import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect, type PgColumn } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_RESOURCE_SLOTS } from "@/lib/commercial/resources";
import { CommercialResourceMediaError, getCommercialResource, upsertCommercialResource } from "@/lib/commercial/store";
import * as schema from "@/lib/db/schema";

// ORM, schema y scoped REALES; solo el ejecutor de BD es un doble en memoria.
// Esto no comprueba constraints PostgreSQL; la suite opt-in de BD lo hace.
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = { commercial_resource: [], media_asset: [] };
let mediaDir: string;
vi.mock("@/lib/env", () => ({ getEnv: () => ({ MEDIA_DIR: mediaDir }) }));
vi.mock("@/lib/db", async () => ({ schema: await import("@/lib/db/schema"), getDb: () => db }));

const dialect = new PgDialect();
const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
function matches(row: Row, condition: SQL): boolean {
  const query = dialect.sqlToQuery(condition);
  const filters = [...query.sql.matchAll(/"\w+"\."(\w+)" = \$(\d+)/g)];
  expect(filters.length).toBe(query.params.length);
  expect(filters.length).toBeGreaterThan(0);
  return filters.every((m) => row[camel(m[1]!)] === query.params[Number(m[2]) - 1]);
}
const db = {
  select: () => ({ from: (table: typeof schema.commercialResource | typeof schema.mediaAsset) => ({
    where: (condition: SQL) => ({ limit: (n: number) =>
      tables[getTableName(table)]!.filter((r) => matches(r, condition)).slice(0, n).map((r) => ({ ...r })),
    }),
  }) }),
  insert: (table: typeof schema.commercialResource) => ({ values: (value: Row) => ({
    onConflictDoUpdate: (conflict: { target: PgColumn[]; set: Row; setWhere: SQL }) => ({
      returning: () => {
        const bucket = tables[getTableName(table)]!;
        const previous = bucket.find((r) => conflict.target.every((col) => r[camel(col.name)] === value[camel(col.name)]));
        if (previous) {
          if (!matches(previous, conflict.setWhere)) return [];
          Object.assign(previous, conflict.set);
          return [{ ...previous }];
        }
        const row = { createdAt: new Date(), updatedAt: new Date(), ...value };
        bucket.push(row);
        return [{ ...row }];
      },
    }),
  }) }),
};

const empty = { transfers: [], yape: null, paymentLink: null };
const payment = { slot: "payment_instructions", mediaAssetId: null, payload: empty } as const;
async function seedVideo(org: string, id: string, overrides: Row = {}) {
  await mkdir(path.join(mediaDir, org), { recursive: true });
  await writeFile(path.join(mediaDir, org, id), Buffer.from("synthetic"));
  const asset = { id, organizationId: org, kind: "video", mimeType: "video/mp4", fileSize: 9,
    fetchStatus: "available", storagePath: `${org}/${id}`, ...overrides };
  tables.media_asset!.push(asset);
  return asset;
}

beforeAll(async () => { mediaDir = await mkdtemp(path.join(tmpdir(), "commercial-store-")); });
afterAll(async () => { await rm(mediaDir, { recursive: true, force: true }); });
beforeEach(() => { tables.commercial_resource = []; tables.media_asset = []; });

describe("commercial store scoped", () => {
  it("sin fila retorna null y no crea recursos", async () => {
    for (const slot of [...DEMO_RESOURCE_SLOTS, "payment_instructions"] as const) {
      expect(await getCommercialResource("org_a", slot)).toBeNull();
    }
    expect(tables.commercial_resource).toHaveLength(0);
  });
  it("guarda/lee cobro normalizado y upsert conserva id/createdAt", async () => {
    const first = await upsertCommercialResource("org_a", payment);
    expect(first.id).toMatch(/^cr_[a-z0-9]{20}$/);
    const second = await upsertCommercialResource("org_a", { ...payment, payload: {
      ...empty, yape: { phone: "+51 999888777", holder: " Prueba " },
    } });
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toEqual(first.createdAt);
    expect(second.payload?.yape).toEqual({ phone: "999888777", holder: "Prueba" });
    expect(await getCommercialResource("org_a", "payment_instructions")).toEqual(second);
    expect(tables.commercial_resource).toHaveLength(1);
  });
  it("A/B independientes para el mismo slot; upsert A jamás modifica B", async () => {
    const b = await upsertCommercialResource("org_b", { ...payment, payload: { ...empty, paymentLink: "https://payments.example.test/b" } });
    expect(await getCommercialResource("org_a", "payment_instructions")).toBeNull();
    await upsertCommercialResource("org_a", payment);
    await upsertCommercialResource("org_a", { ...payment, payload: { ...empty, paymentLink: "https://payments.example.test/a" } });
    expect(await getCommercialResource("org_b", "payment_instructions")).toEqual(b);
    expect(tables.commercial_resource).toHaveLength(2);
  });
  it("los tres demos se leen y reemplazan por slot sin duplicados", async () => {
    await seedVideo("org_a", "ma_one");
    await seedVideo("org_a", "ma_two");
    for (const slot of DEMO_RESOURCE_SLOTS) {
      const first = await upsertCommercialResource("org_a", { slot, mediaAssetId: "ma_one", payload: null });
      const second = await upsertCommercialResource("org_a", { slot, mediaAssetId: "ma_two", payload: null });
      expect(second.id).toBe(first.id);
      expect((await getCommercialResource("org_a", slot))?.mediaAssetId).toBe("ma_two");
      expect(await getCommercialResource("org_b", slot)).toBeNull();
    }
    expect(tables.commercial_resource).toHaveLength(3);
  });
  it("media de B o inexistente se rechaza y conserva el recurso anterior", async () => {
    await seedVideo("org_a", "ma_a");
    await seedVideo("org_b", "ma_b");
    const input = { slot: "demo_enrollment_panel", mediaAssetId: "ma_a", payload: null } as const;
    const first = await upsertCommercialResource("org_a", input);
    for (const mediaAssetId of ["ma_b", "ma_missing"]) {
      await expect(upsertCommercialResource("org_a", { ...input, mediaAssetId })).rejects.toBeInstanceOf(CommercialResourceMediaError);
      expect(await getCommercialResource("org_a", input.slot)).toEqual(first);
    }
  });
  it.each([
    { kind: "document" }, { mimeType: "video/3gpp" }, { fetchStatus: "pending" },
    { fetchStatus: "failed" }, { storagePath: null }, { storagePath: "org_b/ma_bad" },
    { fileSize: 0 }, { fileSize: -1 }, { fileSize: 16 * 1024 * 1024 + 1 }, { fileSize: 8 },
  ])("rechaza metadata incompatible o tamaño de disco distinto: %j", async (patch) => {
    await seedVideo("org_a", "ma_bad", patch);
    await expect(upsertCommercialResource("org_a", { slot: "demo_enrollment_panel", mediaAssetId: "ma_bad", payload: null })).rejects.toBeInstanceOf(CommercialResourceMediaError);
    expect(tables.commercial_resource).toHaveLength(0);
  });
  it("disco perdido degrada a null y rechaza nuevas escrituras", async () => {
    await seedVideo("org_a", "ma_lost");
    const input = { slot: "demo_enrollment_panel", mediaAssetId: "ma_lost", payload: null } as const;
    await upsertCommercialResource("org_a", input);
    await rm(path.join(mediaDir, "org_a", "ma_lost"));
    expect(await getCommercialResource("org_a", input.slot)).toBeNull();
    await expect(upsertCommercialResource("org_a", input)).rejects.toBeInstanceOf(CommercialResourceMediaError);
    expect(tables.commercial_resource).toHaveLength(1);
  });
  it("lectura defensiva nunca resuelve referencia corrupta cross-tenant", async () => {
    await seedVideo("org_b", "ma_foreign");
    tables.commercial_resource!.push({ id: "cr_corrupt", organizationId: "org_a", slot: "demo_enrollment_panel", mediaAssetId: "ma_foreign", payload: null });
    expect(await getCommercialResource("org_a", "demo_enrollment_panel")).toBeNull();
  });
  it("rechaza tenant vacío y payload inválido antes de INSERT, conserva cobro", async () => {
    await expect(upsertCommercialResource("", payment)).rejects.toThrow("organizationId");
    await expect(getCommercialResource("", "payment_instructions")).rejects.toThrow("organizationId");
    const first = await upsertCommercialResource("org_a", payment);
    await expect(upsertCommercialResource("org_a", { ...payment, payload: { ...empty, yape: { phone: "123", holder: "Prueba" } } })).rejects.toThrow();
    expect(await getCommercialResource("org_a", "payment_instructions")).toEqual(first);
    expect(tables.commercial_resource).toHaveLength(1);
  });
});
