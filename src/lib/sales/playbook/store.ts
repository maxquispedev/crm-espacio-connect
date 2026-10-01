/**
 * Sales Playbook — Store (Corte 1, Feature 008).
 *
 * Funciones puras sobre BD, todas con `scoped()` (Constitución III).
 * No toca runtime productivo: el loader runtime entra en Corte 3.
 *
 * Convenciones:
 *  - Cada función exige `organizationId` explícito (sin `LIMIT 1`, sin
 *    "primera org"): una query cross-org debe ser estructuralmente
 *    imposible.
 *  - `publishDraft` / `rollbackToVersion` corren en transacción
 *    atómica: archive del `published` actual + flip del nuevo →
 *    `published`. El índice parcial UNIQUE garantiza el invariante.
 *  - `createDraft` calcula `version_number = max + 1` por playbook;
 *    si ya existe un `draft` activo lanza `DraftAlreadyOpenError`.
 *  - `loadActiveQuestionsForVersion` es para el loader runtime;
 *    **sin cache en memoria** (Corte 3).
 */

import { and, desc, eq, max, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { ConfigV1 } from "@/lib/sales/playbook/schema";

/* ============================================================
 * Tipos públicos
 * ============================================================ */

export type PlaybookRow = typeof schema.salesPlaybook.$inferSelect;
export type PlaybookVersionRow = typeof schema.salesPlaybookVersion.$inferSelect;

export type PlaybookVersionStatus = "draft" | "published" | "archived";

/**
 * Error lanzado cuando se intenta crear un draft y ya existe un
 * draft abierto para el mismo playbook. El caller (API) lo mapea
 * a HTTP 409.
 */
export class DraftAlreadyOpenError extends Error {
  readonly code = "draft_already_open";
  constructor(message = "Ya existe un draft abierto para este playbook") {
    super(message);
    this.name = "DraftAlreadyOpenError";
  }
}

/**
 * Error lanzado cuando se intenta publicar / rollback una versión
 * que no existe o que pertenece a otro tenant.
 */
export class PlaybookVersionNotFoundError extends Error {
  readonly code = "version_not_found";
  constructor(message = "Versión no encontrada para esta organización") {
    super(message);
    this.name = "PlaybookVersionNotFoundError";
  }
}

export type CreateDraftInput = {
  notes: string | null;
  createdBy: string;
  config: ConfigV1;
  /** Label del playbook (si se omite, mantiene el actual). */
  label?: string;
  /** Slug del playbook (si se omite, mantiene el actual). */
  slug?: string;
};

export type UpdateDraftPatch = {
  notes?: string | null;
  config?: ConfigV1;
  label?: string;
  slug?: string;
};

/**
 * Error lanzado al intentar eliminar el draft cuando la organización
 * no tiene ninguna versión `published` activa. Sin esePublished, borrar
 * el único documento dejaría al negocio sin playbook en vigor, así que
 * la operación se rechaza (el caller la mapea a HTTP 409).
 */
export class NoPublishedVersionError extends Error {
  readonly code = "no_published_version";
  constructor(
    message = "No se puede eliminar el draft sin una versión publicada activa"
  ) {
    super(message);
    this.name = "NoPublishedVersionError";
  }
}

/* ============================================================
 * Helpers internos
 * ============================================================ */

type DbClient = ReturnType<typeof getDb>;

/**
 * Serializa un `ConfigV1` a las 9 columnas JSONB de la tabla de
 * versiones. Mantiene `notes`/`urgency_rules` aparte.
 */
function configToRow(config: ConfigV1) {
  return {
    schemaVersion: config.schema_version,
    productJson: config.product,
    policyJson: config.commercial_policy,
    offerJson: config.offer,
    prioritiesJson: config.priorities,
    writerJson: config.writer,
    jevQuestionsJson: config.jev_questions,
    prohibitionsJson: config.prohibitions,
    handoffJson: config.handoff,
    urgencyRules: config.urgency_rules ?? null,
  };
}

/* ============================================================
 * Lookups (read-only, sin cache)
 * ============================================================ */

/** Devuelve el playbook de la organización (cabecera) o null. */
export async function getPlaybookForOrg(
  orgId: string
): Promise<PlaybookRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.salesPlaybook)
    .where(scoped(schema.salesPlaybook.organizationId, orgId))
    .limit(1);
  return rows[0] ?? null;
}

/** Devuelve la versión publicada actual o null. */
export async function getPublishedVersionForOrg(
  orgId: string
): Promise<PlaybookVersionRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.salesPlaybookVersion)
    .where(
      scoped(schema.salesPlaybookVersion.organizationId, orgId, eq(
        schema.salesPlaybookVersion.status,
        "published"
      ))
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Devuelve el draft abierto actual o null. */
export async function getDraftVersionForOrg(
  orgId: string
): Promise<PlaybookVersionRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.salesPlaybookVersion)
    .where(
      scoped(schema.salesPlaybookVersion.organizationId, orgId, eq(
        schema.salesPlaybookVersion.status,
        "draft"
      ))
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Devuelve una versión por ID, scoped a la organización. */
export async function getVersionById(
  orgId: string,
  versionId: string
): Promise<PlaybookVersionRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.salesPlaybookVersion)
    .where(
      scoped(schema.salesPlaybookVersion.organizationId, orgId, eq(
        schema.salesPlaybookVersion.id,
        versionId
      ))
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Lista todas las versiones de un playbook, de mayor a menor version_number. */
export async function listVersionsForOrg(
  orgId: string
): Promise<PlaybookVersionRow[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.salesPlaybookVersion)
    .where(scoped(schema.salesPlaybookVersion.organizationId, orgId))
    .orderBy(desc(schema.salesPlaybookVersion.versionNumber));
}

/* ============================================================
 * Mutations
 * ============================================================ */

/**
 * Crea un nuevo draft para el playbook de la org. Si ya hay draft
 * abierto lanza `DraftAlreadyOpenError`. El `version_number` se
 * calcula como `max + 1` por playbook (atómico).
 */
export async function createDraft(
  orgId: string,
  input: CreateDraftInput
): Promise<PlaybookVersionRow> {
  if (!orgId) throw new Error("createDraft: organizationId requerido");
  if (!input.createdBy) throw new Error("createDraft: createdBy requerido");
  if (!input.config) throw new Error("createDraft: config requerido");

  const db = getDb();

  // ¿Ya hay draft abierto? Lo detectamos antes de tocar nada.
  const existingDraft = await getDraftVersionForOrg(orgId);
  if (existingDraft) {
    throw new DraftAlreadyOpenError();
  }

  // Asegurar que existe el playbook (cabecera) para esta org.
  const playbook = await ensurePlaybookRow(db, orgId, {
    slug: input.slug,
    label: input.label,
  });

  // version_number = max + 1 dentro del playbook (no global).
  const [{ nextVersion } = { nextVersion: 1 }] = await db
    .select({ nextVersion: max(schema.salesPlaybookVersion.versionNumber) })
    .from(schema.salesPlaybookVersion)
    .where(eq(schema.salesPlaybookVersion.playbookId, playbook.id));
  const versionNumber = (nextVersion ?? 0) + 1;

  const id = newId("salesPlaybookVersion");
  const inserted = await db
    .insert(schema.salesPlaybookVersion)
    .values({
      id,
      organizationId: orgId,
      playbookId: playbook.id,
      versionNumber,
      status: "draft",
      createdBy: input.createdBy,
      notes: input.notes,
      ...configToRow(input.config),
    })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new Error("createDraft: INSERT no retornó fila");
  }
  return row;
}

/**
 * Actualiza el draft abierto. `patch.config` se valida en el caller
 * (Corte 2, route handler); aquí se confía en el shape ya validado.
 * No-op si no hay draft abierto.
 */
export async function updateDraft(
  orgId: string,
  patch: UpdateDraftPatch
): Promise<PlaybookVersionRow | null> {
  if (!orgId) throw new Error("updateDraft: organizationId requerido");
  const db = getDb();
  const draft = await getDraftVersionForOrg(orgId);
  if (!draft) return null;

  const setClause: Partial<typeof schema.salesPlaybookVersion.$inferInsert> = {};
  if (patch.notes !== undefined) setClause.notes = patch.notes;
  if (patch.config !== undefined) Object.assign(setClause, configToRow(patch.config));

  if (Object.keys(setClause).length === 0) {
    return draft;
  }

  const updated = await db
    .update(schema.salesPlaybookVersion)
    .set(setClause)
    .where(eq(schema.salesPlaybookVersion.id, draft.id))
    .returning();
  const row = updated[0];
  if (!row) {
    throw new Error("updateDraft: UPDATE no retornó fila");
  }
  return row;
}

/**
 * Publica el draft abierto: archiva el `published` actual y hace
 * flip del draft → `published`. Atómico en una sola transacción.
 */
export async function publishDraft(
  orgId: string,
  notes: string | null,
  publishedBy: string
): Promise<PlaybookVersionRow> {
  if (!orgId) throw new Error("publishDraft: organizationId requerido");
  if (!publishedBy) throw new Error("publishDraft: publishedBy requerido");

  const db = getDb();
  return db.transaction(async (tx) => {
    const draftRows = await tx
      .select()
      .from(schema.salesPlaybookVersion)
      .where(
        scoped(schema.salesPlaybookVersion.organizationId, orgId, eq(
          schema.salesPlaybookVersion.status,
          "draft"
        ))
      )
      .limit(1);
    const draft = draftRows[0];
    if (!draft) {
      throw new PlaybookVersionNotFoundError(
        "No hay draft abierto para publicar"
      );
    }

    // Archivar la publicada actual (si existe).
    const currentPublishedRows = await tx
      .select()
      .from(schema.salesPlaybookVersion)
      .where(
        scoped(schema.salesPlaybookVersion.organizationId, orgId, eq(
          schema.salesPlaybookVersion.status,
          "published"
        ))
      )
      .limit(1);
    const currentPublished = currentPublishedRows[0];

    const now = new Date();

    if (currentPublished) {
      await tx
        .update(schema.salesPlaybookVersion)
        .set({
          status: "archived",
          archivedAt: now,
        })
        .where(eq(schema.salesPlaybookVersion.id, currentPublished.id));
    }

    // Flip draft → published. El índice parcial UNIQUE garantiza
    // que no haya dos `published` simultáneos.
    const updatedRows = await tx
      .update(schema.salesPlaybookVersion)
      .set({
        status: "published",
        publishedAt: now,
        publishedBy,
        notes: notes ?? draft.notes,
      })
      .where(eq(schema.salesPlaybookVersion.id, draft.id))
      .returning();
    const row = updatedRows[0];
    if (!row) {
      throw new Error("publishDraft: UPDATE no retornó fila");
    }
    return row;
  });
}

/**
 * Rollback: republica una versión archivada. La versión objetivo
 * debe existir y pertenecer a la organización; si está en
 * `published` (sería la actual) es un no-op explícito.
 */
export async function rollbackToVersion(
  orgId: string,
  versionId: string,
  notes: string | null,
  publishedBy: string
): Promise<PlaybookVersionRow> {
  if (!orgId) throw new Error("rollbackToVersion: organizationId requerido");
  if (!versionId) {
    throw new Error("rollbackToVersion: versionId requerido");
  }
  if (!publishedBy) {
    throw new Error("rollbackToVersion: publishedBy requerido");
  }

  const db = getDb();
  return db.transaction(async (tx) => {
    const targetRows = await tx
      .select()
      .from(schema.salesPlaybookVersion)
      .where(
        scoped(schema.salesPlaybookVersion.organizationId, orgId, eq(
          schema.salesPlaybookVersion.id,
          versionId
        ))
      )
      .limit(1);
    const target = targetRows[0];
    if (!target) {
      throw new PlaybookVersionNotFoundError();
    }

    // Si ya está publicada, no hay nada que hacer.
    if (target.status === "published") {
      return target;
    }

    // Archivar el published actual.
    const currentPublishedRows = await tx
      .select()
      .from(schema.salesPlaybookVersion)
      .where(
        scoped(schema.salesPlaybookVersion.organizationId, orgId, eq(
          schema.salesPlaybookVersion.status,
          "published"
        ))
      )
      .limit(1);
    const currentPublished = currentPublishedRows[0];

    const now = new Date();

    if (currentPublished) {
      await tx
        .update(schema.salesPlaybookVersion)
        .set({ status: "archived", archivedAt: now })
        .where(eq(schema.salesPlaybookVersion.id, currentPublished.id));
    }

    // Flip target → published. Mantener versionNumber original.
    const updatedRows = await tx
      .update(schema.salesPlaybookVersion)
      .set({
        status: "published",
        publishedAt: now,
        publishedBy,
        archivedAt: null,
        notes: notes ?? target.notes,
      })
      .where(eq(schema.salesPlaybookVersion.id, target.id))
      .returning();
    const row = updatedRows[0];
    if (!row) {
      throw new Error("rollbackToVersion: UPDATE no retornó fila");
    }
    return row;
  });
}

/* ============================================================
 * Loader runtime helper (sin cache)
 * ============================================================ */

/**
 * Devuelve el set activo de preguntas Jev para una versión dada.
 * El runtime (Corte 3) lo invoca por turno: **sin cache**, **sin
 * TTL**. Una publish/rollback toma efecto en el siguiente turno.
 *
 * El filtro de `enabled` lo aplica el caller (ver T303).
 * Aquí solo se devuelve la fila cruda.
 */
export async function loadActiveQuestionsForVersion(
  versionId: string,
  _schemaVersion: string
): Promise<PlaybookVersionRow | null> {
  if (!versionId) {
    throw new Error("loadActiveQuestionsForVersion: versionId requerido");
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.salesPlaybookVersion)
    .where(eq(schema.salesPlaybookVersion.id, versionId))
    .limit(1);
  return rows[0] ?? null;
}

/* ============================================================
 * Helpers internos (no exportados)
 * ============================================================ */

async function ensurePlaybookRow(
  db: DbClient,
  orgId: string,
  init: { slug?: string; label?: string }
): Promise<PlaybookRow> {
  const existing = await getPlaybookForOrg(orgId);
  if (existing) {
    // Si llega slug/label nuevos, actualiza en sitio (idempotente).
    const patch: Partial<typeof schema.salesPlaybook.$inferInsert> = {};
    if (init.slug && init.slug !== existing.slug) patch.slug = init.slug;
    if (init.label && init.label !== existing.label) patch.label = init.label;
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = new Date();
      const updated = await db
        .update(schema.salesPlaybook)
        .set(patch)
        .where(eq(schema.salesPlaybook.id, existing.id))
        .returning();
      return updated[0] ?? existing;
    }
    return existing;
  }
  const id = newId("salesPlaybook");
  const inserted = await db
    .insert(schema.salesPlaybook)
    .values({
      id,
      organizationId: orgId,
      slug: init.slug ?? "vende-veloz-365",
      label: init.label ?? "Vende Veloz 365 — Academia Bajo Control",
    })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new Error("ensurePlaybookRow: INSERT no retornó fila");
  }
  return row;
}

/* ============================================================
 * Borrado del draft (Corte 4, T406)
 * ============================================================ */

/**
 * Elimina (hard delete) el draft abierto de la organización.
 *
 * Guardarraíl de negocio: **solo** se permite si existe una versión
 * `published` activa. Así la UI no puede dejar al negocio sin playbook
 * en vigor borrando el único documento disponible.
 *
 * Semánticas de retorno:
 *  - `null` si no había draft abierto (idempotente: no es error).
 *  - la fila eliminada si sí lo había.
 *  - lanza `NoPublishedVersionError` si no hay `published` activo.
 *
 * El borrado es duro (no archivamos): un draft nunca fue published, así
 * que no tiene valor histórico ni aparece en el historial publicado.
 * Las versiones ya publicadas/archivadas NUNCA se tocan aquí.
 */
export async function deleteDraft(
  orgId: string
): Promise<PlaybookVersionRow | null> {
  if (!orgId) throw new Error("deleteDraft: organizationId requerido");
  const db = getDb();

  const published = await getPublishedVersionForOrg(orgId);
  if (!published) {
    throw new NoPublishedVersionError();
  }

  const draft = await getDraftVersionForOrg(orgId);
  if (!draft) return null;

  const deleted = await db
    .delete(schema.salesPlaybookVersion)
    .where(
      scoped(
        schema.salesPlaybookVersion.organizationId,
        orgId,
        eq(schema.salesPlaybookVersion.id, draft.id)
      )
    )
    .returning();

  const row = deleted[0];
  if (!row) {
    // Carrera: otro caller borró el draft entre SELECT y DELETE.
    return null;
  }
  return row;
}

/* ============================================================
 * Helper para tests: contar drafts abiertos por playbook.
 * Útil para verificar el invariante del índice parcial UNIQUE.
 * ============================================================ */
export async function _countDraftsForPlaybook(
  playbookId: string
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.salesPlaybookVersion)
    .where(
      and(
        eq(schema.salesPlaybookVersion.playbookId, playbookId),
        eq(schema.salesPlaybookVersion.status, "draft")
      )
    );
  return rows[0]?.n ?? 0;
}

export async function _countPublishedForPlaybook(
  playbookId: string
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.salesPlaybookVersion)
    .where(
      and(
        eq(schema.salesPlaybookVersion.playbookId, playbookId),
        eq(schema.salesPlaybookVersion.status, "published")
      )
    );
  return rows[0]?.n ?? 0;
}
