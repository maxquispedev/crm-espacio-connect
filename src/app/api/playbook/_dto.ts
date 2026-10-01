/**
 * Sales Playbook — DTO helpers (Corte 2, Feature 008).
 *
 * Convierte una fila de `sales_playbook_version` al shape JSON que
 * expone la API REST (`/api/playbook`, `/api/playbook/versions`).
 * El shape sigue el contrato de `specs/008-sales-playbook/contracts/playbook-api.md`.
 *
 * - `urgency_rules` puede llegar `null` desde BD; el Zod del schema lo
 *   declara opcional/nullable.
 * - `notes` y `urgency_rules` son columnas de texto separadas; los
 *   bloques JSONB guardan el resto del config.
 * - `size_bytes` se calcula como la suma aproximada del tamaño de
 *   cada bloque JSONB en bytes UTF-8 (sin contar overhead).
 */

import type {
  PlaybookRow,
  PlaybookVersionRow,
} from "@/lib/sales/playbook/store";
import type { ConfigV1 } from "@/lib/sales/playbook/schema";

/**
 * Schema versions soportadas por el loader/UI en V1. Cualquier otro
 * `schema_version` se rechaza con `422 unknown_schema_version`
 * (rollback no migrador).
 */
export const SUPPORTED_SCHEMA_VERSIONS = ["1.0"] as const;

/**
 * Reconstruye un `ConfigV1` desde las columnas JSONB separadas.
 * Asume que los JSONB ya fueron validados por Zod al INSERT/UPDATE.
 */
function rowToConfigV1(row: PlaybookVersionRow): ConfigV1 {
  return {
    schema_version: row.schemaVersion as ConfigV1["schema_version"],
    product: row.productJson as ConfigV1["product"],
    offer: row.offerJson as ConfigV1["offer"],
    commercial_policy: row.policyJson as ConfigV1["commercial_policy"],
    priorities: row.prioritiesJson as ConfigV1["priorities"],
    writer: row.writerJson as ConfigV1["writer"],
    jev_questions: row.jevQuestionsJson as ConfigV1["jev_questions"],
    prohibitions: row.prohibitionsJson as ConfigV1["prohibitions"],
    handoff: row.handoffJson as ConfigV1["handoff"],
    urgency_rules: row.urgencyRules,
  };
}

/** Tamaño aproximado del config (bytes UTF-8) para `size_bytes`. */
function approxConfigSizeBytes(row: PlaybookVersionRow): number {
  const parts = [
    JSON.stringify(row.productJson),
    JSON.stringify(row.policyJson),
    JSON.stringify(row.offerJson),
    JSON.stringify(row.prioritiesJson),
    JSON.stringify(row.writerJson),
    JSON.stringify(row.jevQuestionsJson),
    JSON.stringify(row.prohibitionsJson),
    JSON.stringify(row.handoffJson),
    row.urgencyRules ?? "",
    row.notes ?? "",
  ];
  return parts.reduce((acc, s) => acc + Buffer.byteLength(s, "utf8"), 0);
}

/** Forma completa de una versión (la que devuelven GET y POST/PUT). */
export type PlaybookVersionDto = {
  id: string;
  version_number: number;
  schema_version: string;
  status: "draft" | "published" | "archived";
  product: ConfigV1["product"];
  offer: ConfigV1["offer"];
  commercial_policy: ConfigV1["commercial_policy"];
  priorities: ConfigV1["priorities"];
  writer: ConfigV1["writer"];
  jev_questions: ConfigV1["jev_questions"];
  prohibitions: ConfigV1["prohibitions"];
  handoff: ConfigV1["handoff"];
  urgency_rules: string | null;
  notes: string | null;
  created_at: string;
  published_at: string | null;
  archived_at: string | null;
  /** Incluido solo en GET /api/playbook (omitido en listVersions para brevedad). */
  size_bytes?: number;
};

/** Forma resumida para GET /api/playbook/versions. */
export type PlaybookVersionSummaryDto = Pick<
  PlaybookVersionDto,
  | "id"
  | "version_number"
  | "schema_version"
  | "status"
  | "notes"
  | "created_at"
  | "published_at"
  | "archived_at"
> & { size_bytes: number };

/** Forma de la cabecera de playbook. */
export type PlaybookHeaderDto = {
  id: string;
  organization_id: string;
  slug: string;
  label: string;
  created_at: string;
  updated_at: string;
};

export function playbookRowToDto(row: PlaybookRow): PlaybookHeaderDto {
  return {
    id: row.id,
    organization_id: row.organizationId,
    slug: row.slug,
    label: row.label,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function versionRowToDto(row: PlaybookVersionRow): PlaybookVersionDto {
  const config = rowToConfigV1(row);
  return {
    id: row.id,
    version_number: row.versionNumber,
    schema_version: row.schemaVersion,
    status: row.status as PlaybookVersionDto["status"],
    product: config.product,
    offer: config.offer,
    commercial_policy: config.commercial_policy,
    priorities: config.priorities,
    writer: config.writer,
    jev_questions: config.jev_questions,
    prohibitions: config.prohibitions,
    handoff: config.handoff,
    urgency_rules: config.urgency_rules ?? null,
    notes: row.notes ?? null,
    created_at: row.createdAt.toISOString(),
    published_at: row.publishedAt ? row.publishedAt.toISOString() : null,
    archived_at: row.archivedAt ? row.archivedAt.toISOString() : null,
    size_bytes: approxConfigSizeBytes(row),
  };
}

export function versionRowToSummaryDto(
  row: PlaybookVersionRow
): PlaybookVersionSummaryDto {
  return {
    id: row.id,
    version_number: row.versionNumber,
    schema_version: row.schemaVersion,
    status: row.status as PlaybookVersionDto["status"],
    notes: row.notes,
    created_at: row.createdAt.toISOString(),
    published_at: row.publishedAt ? row.publishedAt.toISOString() : null,
    archived_at: row.archivedAt ? row.archivedAt.toISOString() : null,
    size_bytes: approxConfigSizeBytes(row),
  };
}
