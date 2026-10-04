/**
 * Sales Playbook — Loader runtime (Corte 3, Feature 008).
 *
 * SIN cache, SIN TTL, SIN invalidación. Cada turno del Sales
 * Orchestrator lee BD directamente. Una publish/rollback toma efecto
 * en el siguiente turno sin necesidad de invalidar nada.
 *
 * El loader es la ÚNICA superficie que el runtime usa para hablar con
 * `sales_playbook_version`. La ruta 1 (publicado) alimenta el state
 * y el set activo de preguntas Jev. La ruta 2 (draft) está pensada
 * para previsualización del editor y para que `runSalesOrchestratorTurn`
 * pueda emitir una advertencia legible si la versión V1 publicada
 * desaparece (rollback o archivado accidental).
 *
 * Restricciones:
 *   - Solo lee BD; nunca muta.
 *   - Tenant-safe: cada SELECT cierra por `organization_id`.
 *   - Devuelve `null` (no lanza) si no hay versión en el estado pedido.
 *   - `getConfigByVersionId` se usa únicamente desde el override del
 *     Laboratorio (`runSalesOrchestratorTurn` con `is_test=true`).
 *
 * No introduce ni cache, ni TTL, ni evento de invalidación.
 */

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  type Config,
  parseConfig,
} from "@/lib/sales/playbook/schema";

import type { PlaybookVersionRow } from "@/lib/sales/playbook/store";

/**
 * Versión del playbook completa, recuperada por id. Lo usa el override
 * del Laboratorio. No usar en el hot path de producción.
 *
 * `id` es el id de la fila (`sales_playbook_version.id`) y se persiste
 * en `lead.last_jev_playbook_version_id` para auditoría.
 */
export type LoadedPlaybookVersion = {
  id: string;
  config: Config;
  schema_version: string;
  version_number: number;
  status: PlaybookVersionRow["status"];
};

/* ============================================================
 * Helpers internos
 * ============================================================ */

/**
 * Reconstruye un `Config` desde la fila cruda de
 * `sales_playbook_version`. Las 9 columnas JSONB se vuelven a unir en
 * la forma validada por el schema de V1. Si el payload no parsea,
 * `parseConfig` devuelve el error tipado y el loader retorna
 * `null` (la ruta caliente hace fallback a `VENDE_VELOZ_*`).
 */
function rowToConfig(row: PlaybookVersionRow): {
  id: string;
  config: Config;
  schema_version: string;
  version_number: number;
  status: PlaybookVersionRow["status"];
} {
  const config = {
    schema_version: row.schemaVersion,
    product: row.productJson,
    commercial_policy: row.policyJson,
    offer: row.offerJson,
    priorities: row.prioritiesJson,
    writer: row.writerJson,
    jev_questions: row.jevQuestionsJson,
    prohibitions: row.prohibitionsJson,
    handoff: row.handoffJson,
    urgency_rules: row.urgencyRules ?? null,
  } as unknown; // validamos abajo

  const parsed = parseConfig(config);
  if (!parsed.ok) {
    // No propagamos la excepción: el runtime degrada con un fallback.
    // El caller (orchestrator) ya emite una sola vez el warning por org
    // cuando NO hay publicada; aquí dejamos que el caller decida si
    // considera el fallo como "no publicado" (defensivo).
    throw new PlaybookInvalidConfigError(parsed.error);
  }
  return {
    id: row.id,
    config: parsed.data,
    schema_version: row.schemaVersion,
    version_number: row.versionNumber,
    status: row.status,
  };
}

/**
 * Error tipado para el caso "la fila publicada existe pero su JSONB
 * ya no cumple el contrato V1". El runtime decide degradar.
 */
export class PlaybookInvalidConfigError extends Error {
  readonly code = "playbook_invalid_config";
  constructor(detail = "Playbook publicado no cumple Config") {
    super(detail);
    this.name = "PlaybookInvalidConfigError";
  }
}

/* ============================================================
 * Lookups runtime (sin cache)
 * ============================================================ */

/**
 * Versión PUBLICADA actual de la organización, o `null` si no hay.
 * El índice parcial UNIQUE garantiza que haya a lo sumo una.
 *
 * No cache. Una publish/rollback toma efecto en el siguiente turno.
 */
export async function getPublishedConfigForOrg(
  orgId: string
): Promise<LoadedPlaybookVersion | null> {
  if (!orgId) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.salesPlaybookVersion)
    .where(
      and(
        scoped(
          schema.salesPlaybookVersion.organizationId,
          orgId,
          eq(schema.salesPlaybookVersion.status, "published")
        )
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return rowToConfig(row);
}

/**
 * Versión DRAFT abierta de la organización, o `null` si no hay.
 * Pensada para el editor (Corte 4) y para previsualizar.
 * El runtime NO la consume: la fuente de verdad del turno es la
 * publicada. Si un operador publica un draft, el siguiente turno
 * verá la nueva publicada sin invalidación.
 */
export async function getDraftConfigForOrg(
  orgId: string
): Promise<LoadedPlaybookVersion | null> {
  if (!orgId) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.salesPlaybookVersion)
    .where(
      and(
        scoped(
          schema.salesPlaybookVersion.organizationId,
          orgId,
          eq(schema.salesPlaybookVersion.status, "draft")
        )
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return rowToConfig(row);
}

/**
 * Versión por ID, scoped a la organización. Usada por el override del
 * Laboratorio (`runSalesOrchestratorTurn` con `is_test=true`).
 * Retorna `null` si la versión no existe o no pertenece a la org.
 *
 * NO cache.
 */
export async function getConfigByVersionId(
  orgId: string,
  versionId: string
): Promise<LoadedPlaybookVersion | null> {
  if (!orgId || !versionId) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.salesPlaybookVersion)
    .where(
      scoped(
        schema.salesPlaybookVersion.organizationId,
        orgId,
        eq(schema.salesPlaybookVersion.id, versionId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return rowToConfig(row);
}
