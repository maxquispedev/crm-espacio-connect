import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  bestEffortAttention,
  clearAttentionForContact,
} from "@/server/inbox/attention";

/**
 * Puerta única runtime para los cambios de `lead.stageId`.
 *
 * Antes de este módulo (corte A del spec 007), seis callsites escribían
 * `lead.stageId` por su cuenta: drag/drop del pipeline, bulk-move al eliminar
 * una etapa, reset de conversación de pruebas, acciones del agente inline
 * (Zod agent), persistDecision del Sales Orchestrator (Jev) y la asignación
 * inicial del lead al crear por inbound. Cada uno validaba el tenant a su
 * manera y era una puerta abierta que Meta CAPI no podría enganchar de forma
 * fiable en el corte B.
 *
 * Contrato del gateway (neutro, sin CAPI, sin eventos externos):
 *  - Toda escritura de `lead.stageId` pasa por aquí. No hay bypass runtime.
 *  - Tenant-safe: el lead y la etapa destino deben pertenecer a la misma
 *    organización (verificado con `scoped()`); un cross-tenant no compila
 *    de forma natural y, si lo hiciera, lanza `StageGatewayError`.
 *  - Conserva `updatedAt`, `lastActivityAt` y `position` tal y como estaban
 *    en cada callsite: el gateway acepta esos campos como opcionales y solo
 *    los escribe cuando el caller los pasa (con la salvedad de `updatedAt`,
 *    que siempre se refresca — es la regla común a todos los writes).
 *  - Acepta un `actor` opcional para que el reporte CAPI pueda discriminar
 *    sin re-arquitectura. Hoy no se usa más que para telemetría ligera.
 *  - Mover a la misma etapa en la que ya está el lead es no-op: no escribe
 *    nada (a menos que el caller pase `extra` o `position`, en cuyo caso sí
 *    se ejecuta el UPDATE conservando los demás campos).
 *  - Jev lo usa sin crear dependencia circular: la API recibe un `extra`
 *    opcional con el resto de campos que Jev ya actualizaba (lane, facts,
 *    snapshot) y los fusiona en el mismo UPDATE, preservando la atomicidad
 *    del `persistDecision` original.
 */

export type StageActor = "human" | "agent" | "bot" | "system";

export type StageGatewayErrorCode =
  | "lead_not_found"
  | "invalid_stage"
  | "stage_not_found";

export class StageGatewayError extends Error {
  readonly code: StageGatewayErrorCode;
  constructor(code: StageGatewayErrorCode, message: string) {
    super(message);
    this.name = "StageGatewayError";
    this.code = code;
  }
}

type Lead = typeof schema.lead.$inferSelect;
type PipelineStage = typeof schema.pipelineStage.$inferSelect;

export type MoveLeadStageInput = {
  organizationId: string;
  leadId: string;
  toStageId: string;
  /** Nueva posición dentro de la etapa destino. Si se omite, no se toca. */
  position?: number;
  /**
   * Override explícito de `last_activity_at`. Si se omite, no se toca (excepto
   * cuando hay cambio real de etapa: en ese caso se setea a `now` para reflejar
   * actividad).
   */
  lastActivityAt?: Date;
  /** Origen del cambio. Telemetría y futura discriminación CAPI. */
  actor: StageActor;
  /** Motivo opcional legible (ej. "drag_drop", "bulk_stage_delete"). */
  reason?: string;
  /**
   * Otros campos del lead a fusionar en el mismo UPDATE. Lo usa Jev para
   * preservar la atomicidad de su `persistDecision` (lane, snapshot, facts).
   * Si se omite, solo se escriben `stageId`/`position`/`lastActivityAt`/
   * `updatedAt` cuando apliquen.
   */
  extra?: Record<string, unknown>;
};

export type MoveLeadStageResult = {
  /** El lead ya actualizado (o el actual, si fue no-op). */
  lead: Lead;
  /** `true` si cambió `stageId`. `false` si ya estaba en la etapa destino. */
  moved: boolean;
  /** Etapa anterior del lead (igual a `toStageId` si `moved === false`). */
  fromStageId: string;
  /** Etapa destino efectiva. */
  toStageId: string;
};

/**
 * Mueve un lead existente a otra etapa del mismo tenant.
 *
 * - Valida que el lead y la etapa destino pertenezcan a `organizationId`.
 * - Si la etapa destino coincide con la actual y no hay `extra`/`position`,
 *   no escribe (no-op): devuelve `{ moved: false }`.
 * - Conserva `updatedAt` (siempre se refresca a `now`) y, cuando aplica,
 *   `lastActivityAt` y `position`.
 * - Lanza `StageGatewayError` con `code` específico si algo no es válido.
 */
export async function moveLeadStage(
  input: MoveLeadStageInput
): Promise<MoveLeadStageResult> {
  const db = getDb();
  const now = new Date();

  const currentRows = await db
    .select({
      id: schema.lead.id,
      organizationId: schema.lead.organizationId,
      contactId: schema.lead.contactId,
      stageId: schema.lead.stageId,
    })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        input.organizationId,
        eq(schema.lead.id, input.leadId)
      )
    )
    .limit(1);
  const current = currentRows[0];
  if (!current) {
    throw new StageGatewayError(
      "lead_not_found",
      "Lead no encontrado para este tenant"
    );
  }

  // Capturamos la etapa anterior ANTES de cualquier update: el gateway
  // devuelve `fromStageId` al caller (Jev / API / agente) para que sepa
  // desde dónde salió el lead sin tener que releer de la BD.
  const fromStageId = current.stageId;
  const moved = current.stageId !== input.toStageId;
  const hasExtra =
    input.extra !== undefined && Object.keys(input.extra).length > 0;
  const wantsPosition = input.position !== undefined;
  const wantsLastActivity = input.lastActivityAt !== undefined;
  // 013 C1 - Solo un cambio REAL de etapa decide si se limpia la atención humana:
  // un no-op a la misma etapa no lee nada más (contrato de rendimiento de arriba).
  let destKind: (typeof schema.pipelineStage.$inferSelect)["kind"] | null = null;

  // True no-op: ni cambia de etapa ni escribe nada extra. La etapa destino
  // se valida solo cuando se va a escribir un cambio de etapa real;
  // cualquier move a la misma etapa sin extras es seguro sin lectura extra.
  if (!moved && !hasExtra && !wantsPosition && !wantsLastActivity) {
    const full = await db
      .select()
      .from(schema.lead)
      .where(eq(schema.lead.id, current.id))
      .limit(1);
    return {
      lead: full[0] ?? ({ ...current } as Lead),
      moved: false,
      fromStageId,
      toStageId: input.toStageId,
    };
  }

  // Si hay cambio real de etapa, validamos la etapa destino contra el
  // tenant. Si no hay cambio de etapa pero sí hay extras/position/
  // lastActivity, la etapa destino ya sabemos que es del tenant porque
  // coincide con `current.stageId` (que pasó por `scoped()` al cargar el
  // lead), así que no necesitamos un SELECT extra.
  if (moved) {
    const destRows = await db
      .select({
        id: schema.pipelineStage.id,
        organizationId: schema.pipelineStage.organizationId,
        kind: schema.pipelineStage.kind,
      })
      .from(schema.pipelineStage)
      .where(
        scoped(
          schema.pipelineStage.organizationId,
          input.organizationId,
          eq(schema.pipelineStage.id, input.toStageId)
        )
      )
      .limit(1);
    const dest = destRows[0];
    if (!dest) {
      throw new StageGatewayError(
        "invalid_stage",
        "La etapa destino no pertenece a este tenant"
      );
    }
    destKind = dest.kind;
  }

  const patch: Record<string, unknown> = { ...input.extra, updatedAt: now };
  if (moved) {
    patch.stageId = input.toStageId;
    if (!wantsLastActivity) patch.lastActivityAt = now;
  }
  if (wantsPosition) patch.position = input.position;
  if (wantsLastActivity) patch.lastActivityAt = input.lastActivityAt;

  const updated = await db
    .update(schema.lead)
    .set(patch)
    .where(
      scoped(
        schema.lead.organizationId,
        input.organizationId,
        eq(schema.lead.id, input.leadId)
      )
    )
    .returning();
  const lead = updated[0];
  if (!lead) {
    throw new StageGatewayError(
      "lead_not_found",
      "Lead no encontrado tras actualizar"
    );
  }

  // 013 C1 - Llevar el lead a `cliente`/`perdido` deja sin sentido cualquier
  // compromiso humano previo ("pending", "esperando al cliente", recordatorio):
  // se limpia. Best-effort: la etapa manda, la atención es apoyo (plan §3.5).
  if (destKind === "won" || destKind === "lost") {
    await bestEffortAttention(`lead a ${destKind}`, () =>
      clearAttentionForContact({
        organizationId: input.organizationId,
        contactId: lead.contactId,
      })
    );
  }

  return {
    lead,
    moved,
    fromStageId,
    toStageId: input.toStageId,
  };
}

export type BulkMoveLeadsToStageInput = {
  organizationId: string;
  /** Etapa origen: se mueven todos los leads que estén en esta etapa. */
  fromStageId: string;
  toStageId: string;
  actor: StageActor;
  reason?: string;
};

export type BulkMoveLeadsToStageResult = {
  movedCount: number;
  fromStageId: string;
  toStageId: string;
};

/**
 * Mueve todos los leads de `fromStageId` a `toStageId` (mismo tenant) en un
 * único UPDATE. Usado por la ruta `DELETE /api/pipeline/stages/[id]?moveTo=`
 * para reasignar tarjetas al eliminar una etapa.
 *
 * - Valida la etapa destino contra el tenant antes de tocar nada.
 * - Devuelve `movedCount` con la cantidad de filas efectivamente reasignadas.
 * - Si la etapa origen y destino coinciden (no debería ocurrir — la ruta ya
 *   lo rechaza), devuelve `movedCount: 0` sin escribir.
 */
export async function bulkMoveLeadsToStage(
  input: BulkMoveLeadsToStageInput
): Promise<BulkMoveLeadsToStageResult> {
  const db = getDb();
  if (input.fromStageId === input.toStageId) {
    return {
      movedCount: 0,
      fromStageId: input.fromStageId,
      toStageId: input.toStageId,
    };
  }

  const destRows = await db
    .select({ id: schema.pipelineStage.id })
    .from(schema.pipelineStage)
    .where(
      scoped(
        schema.pipelineStage.organizationId,
        input.organizationId,
        eq(schema.pipelineStage.id, input.toStageId)
      )
    )
    .limit(1);
  if (!destRows[0]) {
    throw new StageGatewayError(
      "invalid_stage",
      "La etapa destino no pertenece a este tenant"
    );
  }

  const now = new Date();
  const updated = await db
    .update(schema.lead)
    .set({ stageId: input.toStageId, updatedAt: now })
    .where(
      scoped(
        schema.lead.organizationId,
        input.organizationId,
        eq(schema.lead.stageId, input.fromStageId)
      )
    )
    .returning({ id: schema.lead.id });

  return {
    movedCount: updated.length,
    fromStageId: input.fromStageId,
    toStageId: input.toStageId,
  };
}

export type CreateLeadInStageInput = {
  organizationId: string;
  contactId: string;
  toStageId: string;
  /**
   * Posición dentro de la etapa. Si se omite, se calcula como `max(position)
   * + 1` de los leads que ya están en la etapa destino.
   */
  position?: number;
  lastActivityAt?: Date;
  actor: StageActor;
  reason?: string;
};

export type CreateLeadInStageResult = {
  /** `null` si ya existía un lead para `contactId` (onConflictDoNothing). */
  lead: Lead | null;
  created: boolean;
  toStageId: string;
  position: number;
};

/**
 * Crea un lead nuevo en una etapa del mismo tenant. Usado por la asignación
 * inicial al detectar el primer inbound de un contacto.
 *
 * - Valida que la etapa destino pertenezca al tenant.
 * - `position` se calcula automáticamente si se omite.
 * - Idempotente vía `ON CONFLICT (contact_id) DO NOTHING`: si el contacto ya
 *   tiene un lead, devuelve `lead: null` y `created: false`.
 */
export async function createLeadInStage(
  input: CreateLeadInStageInput
): Promise<CreateLeadInStageResult> {
  const db = getDb();

  const destRows = await db
    .select({ id: schema.pipelineStage.id })
    .from(schema.pipelineStage)
    .where(
      scoped(
        schema.pipelineStage.organizationId,
        input.organizationId,
        eq(schema.pipelineStage.id, input.toStageId)
      )
    )
    .limit(1);
  if (!destRows[0]) {
    throw new StageGatewayError(
      "invalid_stage",
      "La etapa destino no pertenece a este tenant"
    );
  }

  const position =
    input.position ?? (await nextPosition(input.organizationId, input.toStageId));

  const now = input.lastActivityAt ?? new Date();
  const inserted = await db
    .insert(schema.lead)
    .values({
      id: newId("lead"),
      organizationId: input.organizationId,
      contactId: input.contactId,
      stageId: input.toStageId,
      position,
      lastActivityAt: now,
    })
    .onConflictDoNothing({ target: schema.lead.contactId })
    .returning();

  const lead = inserted[0] ?? null;
  return {
    lead,
    created: lead !== null,
    toStageId: input.toStageId,
    position,
  };
}

/**
 * Devuelve la primera etapa `kind = "open"` del pipeline del tenant (ordenada
 * por `position`). Helper para el camino "primer inbound → primer stage".
 */
export async function findFirstOpenStage(
  organizationId: string
): Promise<PipelineStage | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.pipelineStage)
    .where(
      and(
        eq(schema.pipelineStage.organizationId, organizationId),
        eq(schema.pipelineStage.kind, "open")
      )
    )
    .orderBy(asc(schema.pipelineStage.position))
    .limit(1);
  return rows[0] ?? null;
}

async function nextPosition(
  organizationId: string,
  stageId: string
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ max: sql<number>`coalesce(max(${schema.lead.position}), -1)` })
    .from(schema.lead)
    .where(
      and(
        eq(schema.lead.organizationId, organizationId),
        eq(schema.lead.stageId, stageId)
      )
    );
  return (rows[0]?.max ?? -1) + 1;
}

/**
 * Re-export del helper interno para tests que necesitan crear leads por
 * múltiples IDs en una sola operación. **No usar en runtime**: el camino
 * runtime canónico es `createLeadInStage`.
 */
export const __testing = { nextPosition };

// Re-export del conjunto de leads que se acaban de mover, para usos futuros
// (ej. eventos SSE por cada lead). Hoy CAPI no existe; se deja el gancho.
export type BulkStageMoveSideEffect = {
  organizationId: string;
  leadIds: string[];
  fromStageId: string;
  toStageId: string;
  actor: StageActor;
  reason?: string;
};

export function collectBulkSideEffect(
  input: BulkMoveLeadsToStageInput,
  result: BulkMoveLeadsToStageResult
): BulkStageMoveSideEffect {
  return {
    organizationId: input.organizationId,
    leadIds: [], // el caller puede poblarlo si necesita
    fromStageId: result.fromStageId,
    toStageId: result.toStageId,
    actor: input.actor,
    reason: input.reason,
  };
}

// Mantiene `inArray` exportado para consumidores que prefieran resolver por
// IDs explícitos; el runtime canónico es `bulkMoveLeadsToStage` (por etapa).
export { inArray };
