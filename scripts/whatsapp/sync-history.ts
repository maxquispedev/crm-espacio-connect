/**
 * CLI one-shot: solicita a Meta el sync de agenda + historial de coexistence
 * para una organización YA conectada (ventana de 24 h desde el onboarding).
 *
 *   pnpm whatsapp:sync-history
 *   pnpm whatsapp:sync-history --org-slug=mi-negocio
 *   pnpm whatsapp:sync-history --organization-id=org_xxx
 *
 * No imprime tokens. Usa las credenciales cifradas en BD.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";

function loadEnvFile(): void {
  try {
    const text = readFileSync(".env", "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eqAt = line.indexOf("=");
      if (eqAt < 1) continue;
      const key = line.slice(0, eqAt);
      let val = line.slice(eqAt + 1);
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // --env-file o variables ya inyectadas
  }
}

loadEnvFile();

let args;
try {
  const { parseSyncHistoryArgs } = await import(
    "@/server/whatsapp/sync-history-command"
  );
  args = parseSyncHistoryArgs(process.argv.slice(2));
} catch (err) {
  console.error(`[whatsapp:sync-history] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const { getDb, schema } = await import("@/lib/db");
const { requestCoexistenceSyncForOrg } = await import(
  "@/server/whatsapp/smb-app-data"
);
const { runSyncHistoryCommand } = await import(
  "@/server/whatsapp/sync-history-command"
);

const db = getDb();

try {
  const result = await runSyncHistoryCommand(args, {
    findOrgBySlug: async (slug) => {
      const rows = await db
        .select({
          id: schema.organization.id,
          slug: schema.organization.slug,
          name: schema.organization.name,
        })
        .from(schema.organization)
        .where(eq(schema.organization.slug, slug))
        .limit(1);
      return rows[0] ?? null;
    },
    findOrgById: async (id) => {
      const rows = await db
        .select({
          id: schema.organization.id,
          slug: schema.organization.slug,
          name: schema.organization.name,
        })
        .from(schema.organization)
        .where(eq(schema.organization.id, id))
        .limit(1);
      return rows[0] ?? null;
    },
    listConnectedOrgs: async () => {
      const rows = await db
        .select({
          id: schema.organization.id,
          slug: schema.organization.slug,
          name: schema.organization.name,
        })
        .from(schema.organization)
        .innerJoin(
          schema.metaCredentials,
          eq(schema.metaCredentials.organizationId, schema.organization.id)
        );
      return rows;
    },
    requestSync: requestCoexistenceSyncForOrg,
  });

  if (result.status === "aborted") {
    console.error(`[whatsapp:sync-history] ${result.detail}`);
    process.exit(1);
  }

  console.log(
    `[whatsapp:sync-history] solicitado` +
      `\n  organizationId: ${result.organizationId}` +
      `\n  slug: ${result.orgSlug ?? "(sin slug)"}` +
      `\n  phoneNumberId: ${result.phoneNumberId}` +
      `\n  contacts (smb_app_state_sync): ${result.contactsOk ? "ok" : "FALLÓ"}` +
      (result.contactsRequestId ? `  request_id=${result.contactsRequestId}` : "") +
      (result.contactsError ? `  (${result.contactsError})` : "") +
      `\n  history: ${result.historyOk ? "ok" : "FALLÓ"}` +
      (result.historyRequestId ? `  request_id=${result.historyRequestId}` : "") +
      (result.historyError ? `  (${result.historyError})` : "") +
      `\n  nota: Meta envía los webhooks después. Suscribe history y smb_app_state_sync en el dashboard de la app.`
  );

  if (!result.contactsOk && !result.historyOk) {
    process.exit(1);
  }
  process.exit(0);
} catch (err) {
  console.error(
    `[whatsapp:sync-history] error: ${err instanceof Error ? err.message : err}`
  );
  process.exit(1);
}
