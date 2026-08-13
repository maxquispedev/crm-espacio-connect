/**
 * CLI one-shot: renombra únicamente organization.name de una org por slug.
 * No modifica slug, memberships, metadata ni datos de dominio.
 *
 *   pnpm org:rename --slug=principal --name="Vende Veloz 365"
 *
 * Se bundlea con esbuild (alias @ → ./src), igual que org:create.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import {
  parseRenameOrgArgs,
  runRenameOrgCommand,
} from "@/server/auth/rename-org-command";

function loadEnvVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(".env", "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

let args;
try {
  args = parseRenameOrgArgs(process.argv.slice(2));
} catch (err) {
  console.error(`[org:rename] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[org:rename] DATABASE_URL no está definida");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

try {
  const result = await runRenameOrgCommand(args, {
    findOrgBySlug: async (slug) => {
      const rows = await db
        .select({
          id: schema.organization.id,
          name: schema.organization.name,
          slug: schema.organization.slug,
        })
        .from(schema.organization)
        .where(eq(schema.organization.slug, slug))
        .limit(1);
      const row = rows[0];
      if (!row?.slug) return null;
      return { id: row.id, name: row.name, slug: row.slug };
    },
    updateOrganizationName: async (organizationId, name) => {
      await db
        .update(schema.organization)
        .set({ name })
        .where(eq(schema.organization.id, organizationId));
    },
  });

  if (result.status === "aborted") {
    console.error(
      `[org:rename] organización no encontrada: slug=${result.slug}`
    );
    process.exit(1);
  }

  console.log(
    `[org:rename] ${result.status === "renamed" ? "renombrada" : "sin cambios"}` +
      `\n  organizationId: ${result.organizationId}` +
      `\n  slug: ${result.slug}` +
      `\n  nombre anterior: ${result.previousName}` +
      `\n  nombre nuevo: ${result.name}` +
      `\n  estado: ${result.status === "renamed" ? "renombrada" : "sin cambios"}`
  );
  process.exit(0);
} catch (err) {
  console.error(
    `[org:rename] error: ${err instanceof Error ? err.message : err}`
  );
  process.exit(1);
} finally {
  await sql.end().catch(() => {});
}
