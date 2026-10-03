/** Opt-in contra BD LOCAL DEDICADA; nunca usa DATABASE_URL ni .env del operador. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { upsertCommercialResource, getCommercialResource } from "@/lib/commercial/store";

const testUrl = process.env.COMMERCIAL_RESOURCES_TEST_DATABASE_URL;
let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let mediaDir: string;
const orgA = `org_test_${randomUUID()}`;
const orgB = `org_test_${randomUUID()}`;
const assetId = `ma_test_${randomUUID()}`;
const empty = { transfers: [], yape: null, paymentLink: null };
vi.mock("@/lib/db", async () => ({ schema: await import("@/lib/db/schema"), getDb: () => db }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ MEDIA_DIR: mediaDir }) }));

describe.skipIf(!testUrl)("commercial resources PostgreSQL local dedicado", () => {
  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        !/^\/commercial_resources_test(?:_[a-z0-9_]+)?$/.test(url.pathname)) {
      throw new Error("La prueba requiere host local y BD commercial_resources_test[_sufijo]");
    }
    client = postgres(testUrl!, { max: 1, onnotice: () => {} });
    db = drizzle(client, { schema });
    mediaDir = await mkdtemp(path.join(tmpdir(), "commercial-pg-"));
    await migrate(db, { migrationsFolder: "drizzle" });
    await client`INSERT INTO organization (id, name) VALUES (${orgA}, 'Test A'), (${orgB}, 'Test B')`;
    await mkdir(path.join(mediaDir, orgA));
    await writeFile(path.join(mediaDir, orgA, assetId), Buffer.from("synthetic"));
    await db.insert(schema.mediaAsset).values({
      id: assetId, organizationId: orgA, kind: "video", mimeType: "video/mp4", fileSize: 9,
      storagePath: `${orgA}/${assetId}`, fetchStatus: "available",
    });
  }, 30000);
  afterAll(async () => {
    if (client) {
      try { await client`DELETE FROM organization WHERE id IN (${orgA}, ${orgB})`; }
      finally { await client.end(); }
    }
    if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
  });

  it("store real: upsert por slot y aislamiento A/B", async () => {
    const first = await upsertCommercialResource(orgA, { slot: "payment_instructions", mediaAssetId: null, payload: empty });
    const second = await upsertCommercialResource(orgA, { slot: "payment_instructions", mediaAssetId: null, payload: { ...empty, yape: { phone: "+51 999888777", holder: "Prueba" } } });
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toEqual(first.createdAt);
    expect(await getCommercialResource(orgB, "payment_instructions")).toBeNull();
    const b = await upsertCommercialResource(orgB, { slot: "payment_instructions", mediaAssetId: null, payload: empty });
    expect(b.id).not.toBe(first.id);
    expect((await getCommercialResource(orgA, "payment_instructions"))?.payload?.yape?.phone).toBe("999888777");
    await upsertCommercialResource(orgA, { slot: "demo_enrollment_panel", mediaAssetId: assetId, payload: null });
    await expect(upsertCommercialResource(orgB, { slot: "demo_enrollment_panel", mediaAssetId: assetId, payload: null })).rejects.toThrow();
  });
  it("migrador y SQL repetidos preservan datos y no duplican recursos", async () => {
    const payment = { slot: "payment_instructions", mediaAssetId: null, payload: empty } as const;
    const before = await upsertCommercialResource(orgA, payment);
    await migrate(db, { migrationsFolder: "drizzle" });
    const migration = await readFile("drizzle/0009_commercial_resources.sql", "utf8");
    for (let repeat = 0; repeat < 2; repeat++) {
      for (const statement of migration.split("--> statement-breakpoint")) await client.unsafe(statement);
    }
    expect(await getCommercialResource(orgA, payment.slot)).toEqual(before);
    const count = await client`SELECT count(*)::int AS n FROM commercial_resource WHERE organization_id = ${orgA} AND slot = 'payment_instructions'`;
    expect(count[0]?.n).toBe(1);
  });
  it("SQL directo rechaza media ajena, slot abierto, shape inválido y duplicado", async () => {
    await expect(client`INSERT INTO commercial_resource (id, organization_id, slot, media_asset_id) VALUES ('cr_cross', ${orgB}, 'demo_online_enrollment', ${assetId})`).rejects.toMatchObject({ code: "23503" });
    await expect(client`INSERT INTO commercial_resource (id, organization_id, slot) VALUES ('cr_slot', ${orgA}, 'other')`).rejects.toMatchObject({ code: "23514" });
    await expect(client`INSERT INTO commercial_resource (id, organization_id, slot, payload) VALUES ('cr_shape', ${orgA}, 'demo_payments_balances', '{}'::jsonb)`).rejects.toMatchObject({ code: "23514" });
    // Falta de claves no debe pasar el CHECK por SQL UNKNOWN.
    await expect(client`UPDATE commercial_resource SET payload = '{}'::jsonb WHERE organization_id = ${orgA} AND slot = 'payment_instructions'`).rejects.toMatchObject({ code: "23514" });
    await expect(client`INSERT INTO commercial_resource (id, organization_id, slot, payload) VALUES ('cr_duplicate', ${orgA}, 'payment_instructions', ${client.json(empty)})`).rejects.toMatchObject({ code: "23505" });
  });
  it("FK impide borrar media referenciada; organización elimina sus recursos en cascade", async () => {
    await upsertCommercialResource(orgA, { slot: "demo_enrollment_panel", mediaAssetId: assetId, payload: null });
    await expect(client`DELETE FROM media_asset WHERE organization_id = ${orgA} AND id = ${assetId}`).rejects.toMatchObject({ code: "23503" });
    await client`DELETE FROM organization WHERE id = ${orgA}`;
    expect(await getCommercialResource(orgA, "demo_enrollment_panel")).toBeNull();
    expect(await getCommercialResource(orgB, "payment_instructions")).not.toBeNull();
  });
});
