/**
 * `POST /api/lab/preview` — Prueba rápida embebida (Feature 010, Corte 2).
 *
 * Ejecuta **un** caso ad-hoc por el **mismo** pipeline comercial sandbox que
 * el Laboratorio y devuelve decisión de Jev + plan + texto del writer.
 *
 * No es un motor nuevo: crea el caso con el MISMO helper que
 * `runConversation` (`src/server/lab/sandbox-case.ts`) y llama a la MISMA
 * función `runSalesOrchestratorTurn`. Los guards de sandbox (T306, T308,
 * `deliverReply` sin `sendText`, supresión de follow-ups) son los del pipeline,
 * no de este archivo.
 *
 * Contrato normativo: `specs/010-playbook-playground-ux/contracts/playground-preview-api.md`.
 *
 * Puntos de seguridad que no son negociables:
 *   - `organizationId` sale SIEMPRE de la sesión, nunca del body. Por eso no
 *     se puede pedir la versión de otra org.
 *   - El body NO acepta el documento del playbook: la versión probada se
 *     resuelve en BD. Es lo que hace imposible "probé algo que no publiqué".
 *   - Un fallo del proveedor se devuelve como error. Nunca como respuesta
 *     ficticia.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";

import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { isAiConfigured } from "@/lib/env";
import {
  getDraftConfigForOrg,
  getPublishedConfigForOrg,
} from "@/lib/sales/playbook/loader";
import { runSalesOrchestratorTurn } from "@/server/sales/orchestrator";
import {
  SandboxOpenStageNotFoundError,
  cleanupSandboxCase,
  createSandboxCase,
  readSandboxMessages,
  readSandboxSnapshot,
} from "@/server/lab/sandbox-case";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ *
 * Errores del contrato.
 * ------------------------------------------------------------------ */

class PreviewError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: string
  ) {
    super(message);
    this.name = "PreviewError";
  }
}

/* ------------------------------------------------------------------ *
 * Entrada (Zod en el borde: todo input externo se valida).
 * ------------------------------------------------------------------ */

const PreviewBody = z.object({
  mode: z.enum(["draft", "published"]).default("published"),
  // `from` solo admite "lead" por ahora: el lead es quien inicia. Reservado
  // para el futuro, no un contrato de dos lados.
  conversation: z
    .array(
      z.object({
        from: z.literal("lead"),
        text: z.string().min(1).max(2000),
      })
    )
    .min(1)
    .max(20),
});

export type PreviewResult = {
  ok: true;
  playbook: {
    mode: "draft" | "published";
    version_number: number | null;
    version_id: string | null;
    schema_version: string | null;
    is_draft: boolean;
  };
  jev: Record<string, unknown>;
  plan: Record<string, unknown>;
  writer: { text: string };
  turns: number;
};

/* ------------------------------------------------------------------ *
 * Handler.
 * ------------------------------------------------------------------ */

export const POST = withAuth(async (session, req: Request) => {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail(400, "invalid_body", "El body debe ser JSON válido");
  }
  const parsed = PreviewBody.safeParse(raw);
  if (!parsed.success) {
    return fail(
      400,
      "invalid_body",
      "El body no cumple el contrato de la prueba rápida",
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
        .join("; ")
    );
  }
  const { mode, conversation } = parsed.data;

  if (!isAiConfigured()) {
    return fail(
      503,
      "ai_not_configured",
      "Configura tu proveedor de IA para probar el playbook"
    );
  }

  const organizationId = session.organizationId;

  try {
    // --- Resolución de la versión: SIEMPRE con la org de la sesión. ---------
    // La MISMA función de loader que el Laboratorio usa para su override.
    // `draft` sin draft NO cae a published: es un error explícito.
    const loaded =
      mode === "draft"
        ? await getDraftConfigForOrg(organizationId)
        : await getPublishedConfigForOrg(organizationId);
    if (!loaded) {
      return mode === "draft"
        ? fail(
            409,
            "draft_not_found",
            "No hay ningún draft guardado. Guarda un draft para poder probarlo."
          )
        : fail(
            409,
            "published_not_found",
            "No hay ninguna versión publicada. Publica un draft para poder probarlo."
          );
    }

    // --- Caso sandbox: el MISMO helper que el Laboratorio. -------------------
    const contactId = newId("contact");
    const sandbox = await createSandboxCase({
      organizationId,
      contactId,
      // `preview:<contactId>` no colisiona con `lab:<runId>:<testCaseId>`.
      waIdentity: `preview:${contactId}`,
      contactName: "Prueba rápida",
      phone: null,
      withLead: true,
    });

    try {
      // --- Un turno real por línea, con la MISMA función que el Lab. --------
      // `playbookOverride` SOLO en Draft: en Published el orquestador carga
      // la publicada por su cuenta y así nunca se dispara el guard T306.
      const opts =
        mode === "draft"
          ? { playbookOverride: { versionId: loaded.id } }
          : {};

      let turns = 0;
      for (const line of conversation) {
        const now = new Date();
        await db().insert(schema.message).values({
          id: newId("message"),
          organizationId,
          conversationId: sandbox.conversationId,
          direction: "in",
          type: "text",
          text: line.text,
          status: "delivered",
          waTimestamp: now,
        });
        await db()
          .update(schema.conversation)
          .set({ lastInboundAt: now, lastMessageAt: now, updatedAt: now })
          .where(
            scoped(
              schema.conversation.organizationId,
              organizationId,
              eq(schema.conversation.id, sandbox.conversationId)
            )
          );

        const conv = await loadConversation(organizationId, sandbox.conversationId);
        if (conv) {
          try {
            await runSalesOrchestratorTurn(
              { organizationId, conversationId: sandbox.conversationId, conversation: conv },
              opts
            );
          } catch (err) {
            // El orquestador se traga el error de Jev y lo persiste; si algo
            // escapa hasta aquí, es un fallo del pipeline. Se reporta como
            // error, nunca como una respuesta inventada.
            throw new PreviewError(
              502,
              "jev_failed",
              "El pipeline comercial falló durante la prueba",
              sanitize(String(err))
            );
          }
        }
        turns += 1;

        // Corte por handoff: el MISMO criterio que el Laboratorio
        // (`runner.ts`: primer `handoffAt` → fin del guion).
        const rows = await db()
          .select({ handoffAt: schema.conversation.handoffAt })
          .from(schema.conversation)
          .where(
            scoped(
              schema.conversation.organizationId,
              organizationId,
              eq(schema.conversation.id, sandbox.conversationId)
            )
          )
          .limit(1);
        if (rows[0]?.handoffAt) break;
      }

      // --- Leer ANTES del cleanup (plan §3.3). ------------------------------
      const snapshot = await readSandboxSnapshot({ organizationId, contactId });
      if (!snapshot) {
        throw new PreviewError(
          502,
          "no_decision",
          "La prueba no produjo ninguna decisión comercial"
        );
      }
      if (!snapshot.decision) {
        // El orquestador persiste `lastJevError` y NO escribe snapshot cuando
        // el proveedor falla. Un fallo de proveedor es un error, no un `null`.
        if (snapshot.jevError) {
          throw new PreviewError(
            502,
            "jev_failed",
            "El proveedor de Jev falló en esta prueba",
            sanitize(snapshot.jevError)
          );
        }
        throw new PreviewError(
          502,
          "no_decision",
          "La prueba no produjo ninguna decisión comercial"
        );
      }

      const outMessages = (await readSandboxMessages({
        organizationId,
        conversationId: sandbox.conversationId,
      }))
        .filter((m) => m.direction === "out")
        .map((m) => m.text)
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0);
      if (outMessages.length === 0) {
        throw new PreviewError(
          502,
          "no_writer_output",
          "El escritor no produjo ninguna respuesta en esta prueba"
        );
      }

      const body = snapshot.decision as {
        decision?: unknown;
        plan?: { lane?: unknown; nextAction?: unknown; shouldHandoff?: unknown };
        playbook_version_id?: unknown;
        playbook_schema_version?: unknown;
        playbook_version_number?: unknown;
      };
      const stage = await loadStage(organizationId, snapshot.stageId);

      const result: PreviewResult = {
        ok: true,
        playbook: {
          mode,
          version_number: numberOrNull(body.playbook_version_number),
          version_id: stringOrNull(body.playbook_version_id),
          schema_version: stringOrNull(body.playbook_schema_version),
          is_draft: mode === "draft",
        },
        jev: projectDecision(body.decision),
        plan: {
          lane: stringOrNull(body.plan?.lane) ?? snapshot.lane,
          next_action: stringOrNull(body.plan?.nextAction),
          should_handoff:
            typeof body.plan?.shouldHandoff === "boolean"
              ? body.plan.shouldHandoff
              : null,
          stage_id: snapshot.stageId,
          stage_name: stage,
        },
        writer: { text: outMessages[outMessages.length - 1]! },
        turns,
      };
      return Response.json(result);
    } finally {
      // Cero filas residuales, pase lo que pase (incluido un error del proveedor).
      await cleanupSandboxCase({ organizationId, contactId });
    }
  } catch (err) {
    if (err instanceof SandboxOpenStageNotFoundError) {
      return fail(
        409,
        "no_open_stage",
        "Tu organización no tiene ninguna etapa de pipeline abierta"
      );
    }
    if (err instanceof PreviewError) {
      return fail(err.status, err.code, err.message, err.detail);
    }
    return fail(500, "internal", "Error interno", sanitize(String(err)));
  }
});

/* ------------------------------------------------------------------ *
 * Helpers.
 * ------------------------------------------------------------------ */

function db() {
  return getDb();
}

async function loadConversation(organizationId: string, conversationId: string) {
  const rows = await db()
    .select()
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Nombre de la etapa actual del lead, scopeado a la org.
 *
 * El schema no tiene columna `slug` en `pipeline_stage` (solo `name`), así que
 * la proyección honesta del campo es `stage_name`. Código y schema mandan sobre
 * el ejemplo del contrato.
 */
async function loadStage(organizationId: string, stageId: string | null) {
  if (!stageId) return null;
  const rows = await db()
    .select({ name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(
      scoped(
        schema.pipelineStage.organizationId,
        organizationId,
        eq(schema.pipelineStage.id, stageId)
      )
    )
    .limit(1);
  return rows[0]?.name ?? null;
}

function fail(status: number, code: string, message: string, detail?: string) {
  return Response.json(
    { ok: false, code, message, ...(detail ? { detail } : {}) },
    { status }
  );
}

/**
 * Sanita el detalle de un error de proveedor. Misma regla que
 * `sanitizeError` del orquestador: nada de cabeceras, URLs con credenciales ni
 * cuerpos crudos del proveedor. Los secretos no llegan al navegador.
 */
function sanitize(detail: string): string {
  return detail
    .replace(/[A-Za-z0-9_-]{32,}/g, "…")
    .replace(/https?:\/\/\S+/g, "…")
    .slice(0, 300);
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Orden de las señales para la vista de cliente. */
const JEV_KEYS = [
  "nextAction",
  "needsHumanCall",
  "realOperationalNeed",
  "productFit",
  "motivationToChange",
  "purchaseIntent",
  "buyingTiming",
  "mainValueProposition",
] as const;

/**
 * Proyecta la decisión de Jev a las señales del contrato, en `snake_case`.
 *
 * Cada señal conserva su `type` y su valor crudo: no se resume ni se inventa.
 * Si la decisión no trae la señal → `null`.
 */
function projectDecision(decision: unknown): Record<string, unknown> {
  const source =
    decision && typeof decision === "object"
      ? (decision as Record<string, unknown>)
      : {};
  const out: Record<string, unknown> = {};
  for (const key of JEV_KEYS) {
    out[snake(key)] = projectSignal(source[key]);
  }
  return out;
}

function projectSignal(value: unknown): unknown {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const type = typeof v.type === "string" ? v.type : null;
  if (type === null) return null;
  if (type === "choice") return { type, value: stringOrNull(v.choice) };
  if (type === "score" || type === "noul") {
    return { type, value: numberOrNull(v[type]) };
  }
  if (type === "boolean") return { type, value: v.boolean === true };
  return { type, value: null };
}

function snake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
