/**
 * CLI one-shot: crea una organización adicional completa para un usuario
 * existente. Idempotente por slug (si existe → omitir, no modificar).
 *
 *   pnpm org:create --owner-email=user@dominio.com --name="Negocio" --slug=negocio
 *
 * Se bundlea con esbuild (alias @ → ./src), igual que seed:demo.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import {
  parseCreateOrgArgs,
  runCreateOrgCommand,
} from "@/server/auth/create-org-command";
import { createOrganizationWithDefaults } from "@/server/auth/on-signup";

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
  args = parseCreateOrgArgs(process.argv.slice(2));
} catch (err) {
  console.error(`[org:create] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[org:create] DATABASE_URL no está definida");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

try {
  const result = await runCreateOrgCommand(args, {
    findUserByEmail: async (email) => {
      const rows = await db
        .select({ id: schema.user.id, email: schema.user.email })
        .from(schema.user)
        .where(eq(schema.user.email, email))
        .limit(1);
      return rows[0] ?? null;
    },
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
    createOrganizationWithDefaults: (input) =>
      // Transacción propia del helper (sin pasar por getDb de la app).
      db.transaction((tx) => createOrganizationWithDefaults(input, tx)),
  });

  if (result.status === "aborted") {
    console.error(
      `[org:create] usuario no encontrado: ${result.ownerEmail}`
    );
    process.exit(1);
  }

  if (result.status === "skipped") {
    const conflict = result.nameMismatch
      ? ` (conflicto: existente name="${result.existingName}", solicitado name="${result.name}"; no se modificó nada)`
      : "";
    console.log(
      `[org:create] omitida` +
        `\n  name: ${result.existingName}` +
        `\n  slug: ${result.slug}` +
        `\n  organizationId: ${result.organizationId}` +
        `\n  owner email: ${result.ownerEmail}` +
        `\n  estado: omitida (slug ya existe)${conflict}`
    );
    process.exit(0);
  }

  console.log(
    `[org:create] creada` +
      `\n  name: ${result.name}` +
      `\n  slug: ${result.slug}` +
      `\n  organizationId: ${result.organizationId}` +
      `\n  owner email: ${result.ownerEmail}` +
      `\n  estado: creada`
  );
  process.exit(0);
} catch (err) {
  console.error(
    `[org:create] error: ${err instanceof Error ? err.message : err}`
  );
  process.exit(1);
} finally {
  await sql.end().catch(() => {});
}
