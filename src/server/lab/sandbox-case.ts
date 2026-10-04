/**
 * Sandbox case — el andamiaje compartido del Laboratorio (Feature 010, Corte 2).
 *
 * Esto **no es un motor comercial**. Es el código que ya existía en
 * `src/server/lab/runner.ts:410-444`, movido aquí tal cual para que dos
 * consumidores lo usen sin divergir:
 *
 *   - `runConversation` (Laboratorio, `/api/lab/runs`) — sin cambio de
 *     comportamiento; su bucle, su orden y sus resultados son los mismos.
 *   - `POST /api/lab/preview` (Prueba rápida) — el atajo ad-hoc.
 *
 * Por qué vive aquí y no en el endpoint: la garantía de no-paralelo del corte 2
 * es **estructural**, no de disciplina. Si el preview y el Laboratorio llaman a
 * la misma función exportada de este módulo, divergir exige duplicar código, y
 * el test estructural lo delata.
 *
 * Qué garantiza el sandbox (y por qué no se reimplementa ninguno de estos
 * guards aquí — ya existen más abajo en el pipeline):
 *   - `is_test=true` en la conversación: `deliverReply` persiste el outbound y
 *     `return true` ANTES de `sendText` (`src/server/ai/delivery.ts:24-27`).
 *     Cero WhatsApp real.
 *   - `is_test=true` suprime `scheduleNextFollowUp`
 *     (`src/server/sales/orchestrator.ts:212-220`). Cero follow-ups.
 *   - El override de playbook solo se acepta con `is_test=true` (guard T306,
 *     `orchestrator.ts:77-80`).
 *   - `organization_id` en toda fila y `scoped()` en cada query.
 *
 * El helper devuelve el **snapshot crudo** y cada consumidor proyecta lo que
 * necesita: el Laboratorio conserva sus 3 escalares (`readActualOutcome`), el
 * preview proyecta decisión + plan + writer.
 */

import { asc, eq, isNotNull, and, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { deleteMediaFile } from "@/server/whatsapp/media";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { createLeadInStage, findFirstOpenStage } from "@/server/leads/stage-gateway";

/** Sin `pipeline_stage` abierto en la org. Prerrequisito del pipeline comercial. */
export class SandboxOpenStageNotFoundError extends Error {
  constructor() {
    // El mensaje literal es el que el Laboratorio ya propagaba a `failRun`:
    // `tests/unit/lab-pipeline-real.test.ts` lo afirma. No se cambia.
    super("lab_sales_open_stage_not_found");
    this.name = "SandboxOpenStageNotFoundError";
  }
}

/** `createLeadInStage` no creó el lead (idempotencia por `contact_id`). */
export class SandboxLeadNotCreatedError extends Error {
  constructor() {
    super("lab_sales_lead_not_created");
    this.name = "SandboxLeadNotCreatedError";
  }
}

/** Identificadores de un caso sandbox vivo. */
export type SandboxCase = {
  contactId: string;
  /** `null` en la cohorte `legacy` (sin pipeline comercial). */
  leadId: string | null;
  conversationId: string;
};

export type CreateSandboxCaseInput = {
  organizationId: string;
  /**
   * Id del contacto. Lo reserva el caller ANTES del try para que su `finally`
   * cubra también un fallo parcial de este helper.
   */
  contactId: string;
  /** `wa_identity` sintética: identifica el caso sin colisionar con contactos reales. */
  waIdentity: string;
  /** `contact.name` es NOT NULL en el schema. */
  contactName: string;
  /** `contact.phone` es un atributo opcional (nullable). */
  phone?: string | null;
  /**
   * `true` para la cohorte comercial: crea el lead en el primer stage abierto.
   * `false` para la cohorte legacy del Laboratorio, que no usa el pipeline
   * comercial y por tanto no necesita lead.
   */
  withLead: boolean;
};

/**
 * Crea el caso sandbox completo: contacto archivado + (opcional) lead en el
 * primer stage abierto + conversación `is_test`.
 *
 * Extraído de `runner.ts:410-444` sin cambios de lógica: mismo orden de
 * inserts, mismos valores, mismos errores.
 */
export async function createSandboxCase(
  input: CreateSandboxCaseInput
): Promise<SandboxCase> {
  const db = getDb();
  const { organizationId, contactId } = input;

  // Contacto nuevo incluso para la misma persona/version en otra corrida.
  // `archivedAt` ya puesto: el board lo excluye (también para contactos reales).
  await db.insert(schema.contact).values({
    id: contactId,
    organizationId,
    phone: input.phone ?? null,
    waIdentity: input.waIdentity,
    name: input.contactName,
    archivedAt: new Date(),
  });

  let leadId: string | null = null;
  if (input.withLead) {
    const stage = await findFirstOpenStage(organizationId);
    if (!stage) throw new SandboxOpenStageNotFoundError();
    // INSERT nuevo: todos los facts comerciales usan los defaults limpios
    // del schema (auto, timestamps/snapshot null, followUpCount=0).
    const created = await createLeadInStage({
      organizationId,
      contactId,
      toStageId: stage.id,
      position: 0,
      actor: "system",
      reason: "lab_sandbox",
    });
    if (!created.created || !created.lead) throw new SandboxLeadNotCreatedError();
    leadId = created.lead.id;
  }

  const conversationId = newId("conversation");
  await db.insert(schema.conversation).values({
    id: conversationId,
    organizationId,
    contactId,
    // `isTest: true` es lo que activa TODA la cadena de sandbox de más abajo.
    isTest: true,
    aiEnabled: true,
  });

  return { contactId, leadId, conversationId };
}

/**
 * Limpia el caso sandbox. La FK cascade borra lead/conversation/messages; el
 * `isNotNull(archivedAt)` evita borrar por accidente un contacto real si un
 * caller futuro cambiara la creación del contacto.
 */
export async function cleanupSandboxCase(input: {
  organizationId: string;
  contactId: string;
}): Promise<void> {
  const db = getDb();
  // Solo copias creadas por deliverDemo en casos is_test; nunca recursos fuente.
  const conversations = await db.select({ id: schema.conversation.id }).from(schema.conversation).where(
    scoped(schema.conversation.organizationId, input.organizationId,
      eq(schema.conversation.contactId, input.contactId), eq(schema.conversation.isTest, true))
  );
  for (const conversation of conversations) {
    const assets = await db.select({ id: schema.mediaAsset.id }).from(schema.mediaAsset).where(
      scoped(schema.mediaAsset.organizationId, input.organizationId,
        sql`${schema.mediaAsset.payload}->>'sandboxConversationId' = ${conversation.id}`)
    );
    for (const asset of assets) {
      await db.delete(schema.mediaAsset).where(scoped(schema.mediaAsset.organizationId, input.organizationId,
        eq(schema.mediaAsset.id, asset.id), sql`${schema.mediaAsset.payload}->>'sandboxConversationId' = ${conversation.id}`));
      await deleteMediaFile(input.organizationId, asset.id);
    }
  }
  await db.delete(schema.contact).where(
    scoped(
      schema.contact.organizationId,
      input.organizationId,
      eq(schema.contact.id, input.contactId),
      isNotNull(schema.contact.archivedAt)
    )
  );
}

/**
 * Snapshot CRUDO del lead del caso: el `last_jev_decision` durable más el lane
 * de automatización. Es exactamente lo que el orquestador escribe en cada turno,
 * así que no depende de memoria del proceso.
 *
 * Devuelve `null` si el caso no tiene lead (cohorte legacy) o aún no corrió un
 * turno. Cada consumidor proyecta: el Laboratorio saca 3 escalares, el preview
 * la decisión completa.
 */
export async function readSandboxSnapshot(input: {
  organizationId: string;
  contactId: string;
}): Promise<{
  lane: string | null;
  decision: unknown;
  stageId: string | null;
  jevError: string | null;
} | null> {
  const db = getDb();
  const rows = await db
    .select({
      lane: schema.lead.automationLane,
      decision: schema.lead.lastJevDecision,
      stageId: schema.lead.stageId,
      jevError: schema.lead.lastJevError,
    })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        input.organizationId,
        eq(schema.lead.contactId, input.contactId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    lane: row.lane ?? null,
    decision: row.decision ?? null,
    stageId: row.stageId ?? null,
    jevError: row.jevError ?? null,
  };
}

/** Mensajes del caso sandbox en orden de creación (los `out` son del writer). */
export async function readSandboxMessages(input: {
  organizationId: string;
  conversationId: string;
}): Promise<{ direction: string; text: string | null }[]> {
  const db = getDb();
  const rows = await db
    .select({ direction: schema.message.direction, text: schema.message.text, caption: schema.mediaAsset.caption })
    .from(schema.message)
    .leftJoin(schema.mediaAsset, and(
      eq(schema.message.mediaAssetId, schema.mediaAsset.id),
      eq(schema.mediaAsset.organizationId, schema.message.organizationId)
    ))
    .where(
      scoped(
        schema.message.organizationId,
        input.organizationId,
        eq(schema.message.conversationId, input.conversationId)
      )
    )
    .orderBy(asc(schema.message.createdAt));
  return rows.map((r) => ({ direction: r.direction, text: r.text ?? r.caption ?? null }));
}
