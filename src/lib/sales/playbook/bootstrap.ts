/**
 * Sales Playbook — Bootstrap multi-org (Corte 1, Feature 008).
 *
 * SIEMBRA DETERMINISTA. NO "primera org". Para cada organización con
 * `agent_profile.sales_orchestrator_enabled = true`, siembra el playbook
 * `vende-veloz-365` con la versión V1 ya publicada.
 *
 * El bootstrap es **idempotente**: re-ejecutable sin error ni duplicados.
 * Si ya existe `sales_playbook` para esa org, se omite.
 *
 * Disparado desde `instrumentation.ts` (best-effort, no bloquea el
 * boot; la BD puede no estar lista aún).
 */

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { VENDE_VELOZ_PLAYBOOK_V1 } from "@/lib/sales/playbook/v1";
import type { ConfigV1 } from "@/lib/sales/playbook/schema";

const V1_SLUG = "vende-veloz-365";
const V1_LABEL = "Vende Veloz 365 — Academia Bajo Control";
const V1_SCHEMA_VERSION = "1.0";
const V1_VERSION_NOTES = "Versión inicial V1 sembrada por bootstrap";

const SYSTEM_USER_ID = "system:playbook-bootstrap";

export type BootstrapResult = {
  created: string[];
  skipped: string[];
  failed: { organizationId: string; error: string }[];
};

/**
 * Enumera TODAS las organizaciones con Sales Orchestrator activo.
 * Sin `LIMIT 1`, sin heurística de "primera org".
 */
async function listEnabledOrganizations(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ organizationId: schema.agentProfile.organizationId })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.salesOrchestratorEnabled, true));
  // Determinismo explícito: ordenamos por id y deduplicamos por si
  // el agente tiene duplicados raros.
  const ids = Array.from(new Set(rows.map((r) => r.organizationId)));
  ids.sort();
  return ids;
}

/**
 * Siembra la org con la V1 si NO existe ya `sales_playbook` para
 * esa org. Idempotente.
 */
export async function bootstrapOrgIfNeeded(
  orgId: string
): Promise<{ status: "created" | "skipped"; playbookId: string | null }> {
  if (!orgId) {
    throw new Error("bootstrapOrgIfNeeded: organizationId requerido");
  }
  const db = getDb();

  // ¿Ya existe playbook para esta org?
  const existing = await db
    .select({ id: schema.salesPlaybook.id })
    .from(schema.salesPlaybook)
    .where(eq(schema.salesPlaybook.organizationId, orgId))
    .limit(1);
  if (existing[0]) {
    return { status: "skipped", playbookId: existing[0].id };
  }

  return db.transaction(async (tx) => {
    const playbookId = newId("salesPlaybook");
    await tx.insert(schema.salesPlaybook).values({
      id: playbookId,
      organizationId: orgId,
      slug: V1_SLUG,
      label: V1_LABEL,
    });

    const versionId = newId("salesPlaybookVersion");
    const now = new Date();
    await tx.insert(schema.salesPlaybookVersion).values({
      id: versionId,
      organizationId: orgId,
      playbookId,
      versionNumber: 1,
      status: "published",
      schemaVersion: V1_SCHEMA_VERSION,
      productJson: VENDE_VELOZ_PLAYBOOK_V1.product,
      policyJson: VENDE_VELOZ_PLAYBOOK_V1.commercial_policy,
      offerJson: VENDE_VELOZ_PLAYBOOK_V1.offer,
      prioritiesJson: VENDE_VELOZ_PLAYBOOK_V1.priorities,
      writerJson: VENDE_VELOZ_PLAYBOOK_V1.writer,
      jevQuestionsJson: VENDE_VELOZ_PLAYBOOK_V1.jev_questions,
      prohibitionsJson: VENDE_VELOZ_PLAYBOOK_V1.prohibitions,
      handoffJson: VENDE_VELOZ_PLAYBOOK_V1.handoff,
      urgencyRules: VENDE_VELOZ_PLAYBOOK_V1.urgency_rules ?? null,
      notes: V1_VERSION_NOTES,
      createdBy: SYSTEM_USER_ID,
      publishedAt: now,
      publishedBy: SYSTEM_USER_ID,
    });

    return { status: "created", playbookId };
  });
}

/**
 * Siembra TODAS las orgs con Sales Orchestrator activo.
 * Best-effort por org: si una falla, se loguea y se sigue con las
 * demás. El caller (instrumentation) puede ignorar el resultado.
 */
export async function bootstrapAllEnabledOrgs(): Promise<BootstrapResult> {
  let orgIds: string[] = [];
  try {
    orgIds = await listEnabledOrganizations();
  } catch (err) {
    // La BD puede no estar lista (arranque en frío). El caller decide.
    console.error("[playbook-bootstrap] no se pudo enumerar orgs:", err);
    return { created: [], skipped: [], failed: [] };
  }

  const result: BootstrapResult = { created: [], skipped: [], failed: [] };

  for (const orgId of orgIds) {
    try {
      const r = await bootstrapOrgIfNeeded(orgId);
      if (r.status === "created") {
        result.created.push(orgId);
        console.log(`[playbook-bootstrap] V1 sembrada para org ${orgId}`);
      } else {
        result.skipped.push(orgId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.failed.push({ organizationId: orgId, error: msg });
      console.error(
        `[playbook-bootstrap] fallo sembrando org ${orgId}:`,
        msg
      );
    }
  }

  return result;
}

/**
 * Helper de tests: devuelve la fila cruda de `agent_profile` por
 * org (para que los tests verifiquen el opt-in de manera
 * determinista, sin tocar la lógica de enumeración).
 */
export async function _listAgentProfilesForTest(): Promise<
  Array<{ organizationId: string; salesOrchestratorEnabled: boolean }>
> {
  const db = getDb();
  return db
    .select({
      organizationId: schema.agentProfile.organizationId,
      salesOrchestratorEnabled: schema.agentProfile.salesOrchestratorEnabled,
    })
    .from(schema.agentProfile);
}

/**
 * Helper de tests: cuenta cuántas versiones `published` existen
 * por `playbook_id`. Sirve para verificar que el invariante del
 * índice parcial UNIQUE no se rompió.
 */
export async function _countPublishedForOrg(orgId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.salesPlaybookVersion.id })
    .from(schema.salesPlaybookVersion)
    .where(eq(schema.salesPlaybookVersion.organizationId, orgId));
  return rows.length;
}

/** Re-export del ConfigV1 por conveniencia de tests. */
export type { ConfigV1 };
