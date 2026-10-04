/** Opt-in contra BD LOCAL DEDICADA; nunca usa DATABASE_URL ni .env del operador. */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { getAttention, markAttentionPending } from "@/server/inbox/attention";

/**
 * 013 C1 — La migración de `conversation_attention` (plan §3.2, T103).
 *
 * Dos capas, porque los dobles en memoria NO sustituyen a PostgreSQL:
 *  - SIEMPRE se ejecuta: el SQL es aditivo y re-ejecutable POR CONSTRUCCIÓN
 *    (todo `CREATE ... IF NOT EXISTS`, todo `ADD CONSTRAINT` dentro de un
 *    `DO $$ ... EXCEPTION WHEN duplicate_object`), el journal apunta al fichero
 *    correcto y los CHECK declarados son los del plan. Un doble en memoria no
 *    puede comprobar nada de esto, pero SÍ puede comprobar que el fichero lo
 *    sigue teniendo.
 *  - OPT-IN (requiere `ATTENTION_TEST_DATABASE_URL`): aplica el SQL dos veces
 *    contra una BD real y comprueba UNIQUE, CHECK de estado, coherencia
 *    `deferred`<->`due_at`, NOT NULL de organización, FK, cascade y aislamiento
 *    A/B. Sin PostgreSQL en la máquina, esta capa NO se ejecuta y hay que
 *    decirlo explícitamente: el gate no la sustituye.
 */

const MIGRATION = "drizzle/0010_conversation_attention.sql";
const migrationSql = await readFile(path.resolve(import.meta.dirname, "../..", MIGRATION), "utf8");
const journal = JSON.parse(
  await readFile(path.resolve(import.meta.dirname, "../../drizzle/meta/_journal.json"), "utf8")
) as { entries: { idx: number; tag: string; when: number }[] };

describe("013 C1 — la migración es aditiva y re-ejecutable por construcción", () => {
  it("el journal registra 0010 con idx 12 y sin duplicados", () => {
    const entry = journal.entries.find((candidate) => candidate.tag === "0010_conversation_attention");
    expect(entry).toBeDefined();
    expect(entry!.idx).toBe(12);
    expect(new Set(journal.entries.map((candidate) => candidate.idx)).size).toBe(journal.entries.length);
    expect(new Set(journal.entries.map((candidate) => candidate.tag)).size).toBe(journal.entries.length);
  });

  it("todo CREATE TABLE/INDEX lleva IF NOT EXISTS", () => {
    const creates = migrationSql.match(/CREATE\s+(TABLE|INDEX)/g) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    const sinIfNotExists = [...migrationSql.matchAll(/CREATE\s+(TABLE|INDEX)(?!\s+UNIQUE\s+INDEX)([^;]*);/g)]
      .filter((match) => !/IF NOT EXISTS/i.test(match[0]));
    expect(sinIfNotExists.map((match) => match[0].slice(0, 80))).toEqual([]);
  });

  it("todo ADD CONSTRAINT está protegido con EXCEPTION WHEN duplicate_object", () => {
    const adds = [...migrationSql.matchAll(/ALTER TABLE[^;]*;/g)].map((match) => match[0]);
    expect(adds.length).toBeGreaterThan(0);
    for (const statement of adds) {
      const index = migrationSql.indexOf(statement);
      const bloque = migrationSql.slice(Math.max(0, index - 60), index);
      expect(bloque, statement).toMatch(/DO \$\$ BEGIN\s*$/);
    }
    expect(migrationSql.match(/EXCEPTION WHEN duplicate_object THEN null; END \$\$/g) ?? [])
      .toHaveLength(adds.length);
  });

  it("declara los CHECK del plan: estado cerrado y coherencia deferred<->due_at", () => {
    expect(migrationSql).toContain("conversation_attention_state_check");
    expect(migrationSql).toMatch(/IN \('pending', 'waiting_client', 'deferred'\)/);
    expect(migrationSql).toContain("conversation_attention_due_coherence_check");
    // Bidireccional: deferred exige fecha, y sin recordatorio no hay fecha.
    expect(migrationSql).toMatch(/"state" = 'deferred' AND "due_at" IS NOT NULL/);
    expect(migrationSql).toMatch(/"state" <> 'deferred' AND "due_at" IS NULL/);
  });

  it("organization_id es NOT NULL con FK y los índices son org-first", () => {
    expect(migrationSql).toMatch(/"organization_id" text NOT NULL/);
    expect(migrationSql).toContain("conversation_attention_organization_id_organization_id_fk");
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "conversation_attention_org_conv_uq"\s*\n?\s*ON "conversation_attention" USING btree \("organization_id", "conversation_id"\)/
    );
    expect(migrationSql).toMatch(
      /CREATE INDEX IF NOT EXISTS "conversation_attention_org_state_due_idx"\s*\n?\s*ON "conversation_attention" USING btree \("organization_id", "state", "due_at"\)/
    );
  });

  it("no trae migración de datos, seeds ni backfill", () => {
    expect(migrationSql).not.toMatch(/INSERT INTO|UPDATE |DELETE FROM|TRUNCATE/i);
  });
});

// ---------------------------------------------------------------------------

const testUrl = process.env.ATTENTION_TEST_DATABASE_URL;
let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
const orgA = `org_test_${randomUUID()}`;
const orgB = `org_test_${randomUUID()}`;
vi.mock("@/lib/db", async () => ({ schema: await import("@/lib/db/schema"), getDb: () => db }));

async function seedConversation(organizationId: string, id: string, contactId: string) {
  // `contact.name` es NOT NULL desde 010-quick-lead-name. El fixture lo omitía, y
  // como esta suite opt-in se escribió sin poder ejecutarse nunca contra una BD
  // real, reventaba con "null value in column name" antes de comprobar nada.
  await client`INSERT INTO contact (id, organization_id, wa_identity, name) VALUES (${contactId}, ${organizationId}, ${`52${contactId}`}, ${`Lead ${contactId}`})`;
  await client`INSERT INTO conversation (id, organization_id, contact_id) VALUES (${id}, ${organizationId}, ${contactId})`;
}

describe.skipIf(!testUrl)("013 C1 — conversation_attention en PostgreSQL real", () => {
  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      !/^\/attention_test(?:_[a-z0-9_]+)?$/.test(url.pathname)
    ) {
      throw new Error("La prueba requiere host local y BD attention_test[_sufijo]");
    }
    client = postgres(testUrl!, { max: 1, onnotice: () => {} });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
    await client`INSERT INTO organization (id, name) VALUES (${orgA}, 'A'), (${orgB}, 'B')`;
    await seedConversation(orgA, "cv_a", "ct_a");
    await seedConversation(orgB, "cv_b", "ct_b");
  }, 30000);

  afterAll(async () => {
    if (client) {
      try {
        await client`DELETE FROM organization WHERE id IN (${orgA}, ${orgB})`;
      } finally {
        await client.end();
      }
    }
  });

  it("aplicar la migración dos veces no falla ni duplica nada", async () => {
    for (let repeat = 0; repeat < 2; repeat++) {
      for (const statement of migrationSql.split("--> statement-breakpoint")) {
        await client.unsafe(statement);
      }
    }
    const count = await client`SELECT count(*)::int AS n FROM conversation_attention`;
    expect(count[0]?.n).toBe(0);
  });

  it("UNIQUE (organization_id, conversation_id) y CHECK de estado", async () => {
    await client`INSERT INTO conversation_attention (id, organization_id, conversation_id, state) VALUES ('ca_ok', ${orgA}, 'cv_a', 'pending')`;
    await expect(
      client`INSERT INTO conversation_attention (id, organization_id, conversation_id, state) VALUES ('ca_dup', ${orgA}, 'cv_a', 'pending')`
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      client`INSERT INTO conversation_attention (id, organization_id, conversation_id, state) VALUES ('ca_bad', ${orgA}, 'cv_b', 'archivado')`
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("coherencia deferred <-> due_at en ambos sentidos", async () => {
    await expect(
      client`INSERT INTO conversation_attention (id, organization_id, conversation_id, state) VALUES ('ca_nodate', ${orgB}, 'cv_b', 'deferred')`
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client`UPDATE conversation_attention SET due_at = now() + interval '2 days' WHERE id = 'ca_ok'`
    ).rejects.toMatchObject({ code: "23514" });
    await client`UPDATE conversation_attention SET state = 'deferred', due_at = now() + interval '2 days' WHERE id = 'ca_ok'`;
    const fila = await client`SELECT state, due_at FROM conversation_attention WHERE id = 'ca_ok'`;
    expect(fila[0]?.state).toBe("deferred");
    expect(fila[0]?.due_at).not.toBeNull();
  });

  it("organization_id NOT NULL, y el aislamiento A/B lo da el scope, no la FK", async () => {
    await expect(
      client`INSERT INTO conversation_attention (id, organization_id, conversation_id, state) VALUES ('ca_noorg', NULL, 'cv_b', 'pending')`
    ).rejects.toMatchObject({ code: "23502" });

    // La fila legítimamente de B es INVISIBLE para las lecturas de A: es lo que
    // impide que una conversación ajena aparezca en la cola o en la Agenda.
    await client`INSERT INTO conversation_attention (id, organization_id, conversation_id, state) VALUES ('ca_b', ${orgB}, 'cv_b', 'pending')`;
    expect(await getAttention(orgA, "cv_b")).toBeNull();
    expect((await getAttention(orgB, "cv_b"))?.state).toBe("pending");

    // Y el otro lado del mismo candado: A tampoco puede ESCRIBIR sobre la
    // conversación de B. Se declara humana a propósito, para que el rechazo
    // venga del scope y no de "la IA es la dueña" (que sería un no-op por otro
    // motivo y no probaría nada del aislamiento).
    await client`UPDATE conversation SET handoff_at = now(), ai_enabled = false WHERE id = 'cv_b'`;
    expect(await markAttentionPending({ organizationId: orgA, conversationId: "cv_b" })).toBeNull();
    const huerfanas = await client`SELECT count(*)::int AS n FROM conversation_attention
      WHERE organization_id = ${orgA} AND conversation_id = 'cv_b'`;
    expect(huerfanas[0]?.n).toBe(0);
    // La misma operación con la organización Dueña sí escribe: el rechazo de
    // arriba fue por tenant, no por el estado de la conversación.
    expect((await markAttentionPending({ organizationId: orgB, conversationId: "cv_b" }))?.state)
      .toBe("pending");
    await client`UPDATE conversation_attention SET state = 'pending' WHERE id = 'ca_b'`;

    // LIMITACIÓN CONOCIDA de la migración, deliberadamente ASERTADA en vez de
    // oculta: `drizzle/0010_conversation_attention.sql` declara DOS FK de una
    // columna en lugar de una FK COMPUESTA, así que PostgreSQL acepta una fila
    // que dice "organización A" apuntando a una conversación de B (cada columna
    // es válida por separado). Esa fila NO es invisible —una lectura scropeada
    // de A la encuentra, porque la fila se declara de A—, y por eso la
    // garantía NO está en la base: está en que la app solo escribe el par que su
    // propio scope resolvió, como se acaba de comprobar arriba. La versión
    // anterior de este test afirmaba que la base rechazaba esa inserción (23503)
    // y que la lectura la ocultaba: las dos cosas eran falsas, y como la suite
    // es opt-in y nunca se ejecutó, nadie lo había visto. Si algún día se añade
    // la FK compuesta (migración propia, fuera de 013), esta aserción falla y
    // avisa de que la garantía pasó de la aplicación a la base.
    await client`INSERT INTO conversation_attention (id, organization_id, conversation_id, state) VALUES ('ca_ajena', ${orgA}, 'cv_b', 'pending')`;
    const espurias = await client`SELECT count(*)::int AS n FROM conversation_attention
      WHERE organization_id = ${orgA} AND conversation_id = 'cv_b'`;
    expect(espurias[0]?.n).toBe(1);
    // Limpieza: el resto de la suite cuenta filas de A y no debe heredar esta.
    await client`DELETE FROM conversation_attention WHERE id = 'ca_ajena'`;
  });

  it("borrar la organización se lleva su atención en cascade", async () => {
    const antes = await client`SELECT count(*)::int AS n FROM conversation_attention WHERE organization_id = ${orgA}`;
    expect(antes[0]?.n).toBe(1);
    await client`DELETE FROM organization WHERE id = ${orgA}`;
    const despues = await client`SELECT count(*)::int AS n FROM conversation_attention WHERE organization_id = ${orgA}`;
    expect(despues[0]?.n).toBe(0);
  });
});
