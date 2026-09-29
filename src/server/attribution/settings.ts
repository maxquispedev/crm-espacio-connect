import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

/**
 * 007 — Configuración CAPI por organización (lectura/escritura).
 *
 * Reglas (Constitución I + IV):
 *  - El token opcional se cifra con la misma capa AES-256-GCM que el
 *    token de WhatsApp. Hacia el cliente solo `last4`.
 *  - El ciphertext NUNCA sale al cliente ni a logs.
 *  - Idempotencia vía UNIQUE (organization_id): un solo POST/PATCH por
 *    organización; los updates reutilizan la misma fila.
 *  - Tenant-safe: `scoped()` en cada query.
 *  - `qualifiedStageId` se valida contra `pipelineStage` del mismo tenant
 *    con `kind = "open"`. El caller es responsable de esa validación.
 */

export type CapiSettingsRow = {
  id: string;
  organizationId: string;
  datasetId: string;
  /** Token descifrado. SOLO server-side — jamás se loguea ni se expone. */
  accessToken: string | null;
  accessTokenLast4: string | null;
  /** Token viene del tenant (true) o se reusa del WhatsApp business (false). */
  hasCustomToken: boolean;
  qualifiedStageId: string | null;
  updatedAt: Date;
};

/**
 * DTO hacia el cliente (Corte C, Ajustes → Anuncios). Sin ciphertext, sin
 * token descifrado: solo `datasetId`, `last4`, `qualifiedStageId` y estado.
 */
export type CapiSettingsDto = {
  datasetId: string;
  accessTokenLast4: string | null;
  hasCustomToken: boolean;
  qualifiedStageId: string | null;
  updatedAt: string;
};

export function toCapiSettingsDto(row: CapiSettingsRow): CapiSettingsDto {
  return {
    datasetId: row.datasetId,
    accessTokenLast4: row.accessTokenLast4,
    hasCustomToken: row.hasCustomToken,
    qualifiedStageId: row.qualifiedStageId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Devuelve la fila cruda descifrada para el server-side (reportes CAPI). */
export async function getCapiSettings(
  organizationId: string
): Promise<CapiSettingsRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.capiSettings)
    .where(scoped(schema.capiSettings.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const accessToken =
    row.accessTokenCipher &&
    row.accessTokenIv &&
    row.accessTokenTag
      ? decryptSecret({
          cipher: row.accessTokenCipher,
          iv: row.accessTokenIv,
          tag: row.accessTokenTag,
        })
      : null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    datasetId: row.datasetId,
    accessToken,
    accessTokenLast4: row.accessTokenLast4,
    hasCustomToken: accessToken !== null,
    qualifiedStageId: row.qualifiedStageId,
    updatedAt: row.updatedAt,
  };
}

/** DTO saneado hacia el cliente. */
export async function getCapiSettingsDto(
  organizationId: string
): Promise<CapiSettingsDto | null> {
  const row = await getCapiSettings(organizationId);
  return row ? toCapiSettingsDto(row) : null;
}

export type UpsertCapiSettingsInput = {
  organizationId: string;
  datasetId: string;
  /**
   * Token opcional. Si viene vacío/undefined y ya existía uno, se CONSERVA
   * el existente (no se borra). Si viene `null` explícito, se borra y se
   * vuelve a reusar el token de WhatsApp business. Si viene string, se
   * cifra y reemplaza.
   */
  accessToken?: string | null;
  qualifiedStageId: string | null;
};

export async function upsertCapiSettings(
  input: UpsertCapiSettingsInput
): Promise<CapiSettingsRow> {
  const db = getDb();
  const existing = await getCapiSettings(input.organizationId);

  let cipher: string | null = existing?.accessToken
    ? encryptSecret(existing.accessToken).cipher
    : null;
  let iv: string | null = null;
  let tag: string | null = null;
  let last4: string | null = existing?.accessTokenLast4 ?? null;

  if (input.accessToken === null) {
    // Borrado explícito: vuelve a reusar el token de WhatsApp business.
    cipher = null;
    iv = null;
    tag = null;
    last4 = null;
  } else if (typeof input.accessToken === "string" && input.accessToken.length > 0) {
    const enc = encryptSecret(input.accessToken);
    cipher = enc.cipher;
    iv = enc.iv;
    tag = enc.tag;
    last4 = input.accessToken.slice(-4);
  }

  if (existing) {
    const updated = await db
      .update(schema.capiSettings)
      .set({
        datasetId: input.datasetId,
        accessTokenCipher: cipher,
        accessTokenIv: iv,
        accessTokenTag: tag,
        accessTokenLast4: last4,
        qualifiedStageId: input.qualifiedStageId,
        updatedAt: new Date(),
      })
      .where(eq(schema.capiSettings.id, existing.id))
      .returning();
    const row = updated[0];
    if (!row) throw new Error("capi_settings disappeared mid-update");
    return readCapiSettingsRow(row);
  }

  const inserted = await db
    .insert(schema.capiSettings)
    .values({
      id: newId("capiSettings"),
      organizationId: input.organizationId,
      datasetId: input.datasetId,
      accessTokenCipher: cipher,
      accessTokenIv: iv,
      accessTokenTag: tag,
      accessTokenLast4: last4,
      qualifiedStageId: input.qualifiedStageId,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("capi_settings insert returned nothing");
  return readCapiSettingsRow(row);
}

function readCapiSettingsRow(
  row: typeof schema.capiSettings.$inferSelect
): CapiSettingsRow {
  const accessToken =
    row.accessTokenCipher && row.accessTokenIv && row.accessTokenTag
      ? decryptSecret({
          cipher: row.accessTokenCipher,
          iv: row.accessTokenIv,
          tag: row.accessTokenTag,
        })
      : null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    datasetId: row.datasetId,
    accessToken,
    accessTokenLast4: row.accessTokenLast4,
    hasCustomToken: accessToken !== null,
    qualifiedStageId: row.qualifiedStageId,
    updatedAt: row.updatedAt,
  };
}

/**
 * Valida que una etapa candidata sea `kind = "open"` del mismo tenant.
 * Devuelve `true` si la etapa es válida para ser la "calificada" del
 * tenant. `null` es válido (sin etapa calificada → QualifiedLead skipped
 * con motivo, Purchase sigue funcionando).
 */
export async function isQualifiedStageForTenant(input: {
  organizationId: string;
  stageId: string | null;
}): Promise<boolean> {
  if (input.stageId === null) return true;
  const db = getDb();
  const rows = await db
    .select({ kind: schema.pipelineStage.kind })
    .from(schema.pipelineStage)
    .where(
      scoped(
        schema.pipelineStage.organizationId,
        input.organizationId,
        eq(schema.pipelineStage.id, input.stageId)
      )
    )
    .limit(1);
  const stage = rows[0];
  return stage?.kind === "open";
}
