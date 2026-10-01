import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Outcomes esperados por caso (Corte 6, T604).
 *
 * `next_action` y `lane` usan los catálogos CERRADOS del motor: son las
 * claves que el resolver y el writer consumen. Aceptarlos aquí evita que
 * la UI deje persistir una expectativa con typo que después siempre
 * compararía ❌ sin explicación.
 */
const LANES = [
  "auto",
  "auto_close",
  "wait",
  "human",
  "stop",
] as const;

const NEXT_ACTIONS = [
  "ask_more_questions",
  "show_operations_demo",
  "show_online_enrollment_demo",
  "present_price",
  "schedule_call",
  "schedule_follow_up",
  "disqualify",
] as const;

const ExpectedPatch = z.object({
  expected_next_action: z.enum(NEXT_ACTIONS).nullable().optional(),
  expected_lane: z.enum(LANES).nullable().optional(),
  expected_handoff: z.boolean().nullable().optional(),
});

/**
 * PATCH de los outcomes esperados de UN caso.
 *
 * Es **manual por diseño**: la UI no autocompleta el esperado a partir
 * del actual (eso haría la comparación tautológica). `null` limpia el
 * campo y la UI vuelve a mostrar "—".
 *
 * Corte 7 (T702): los casos guardados desde una conversación real viven
 * en `lab_case` (tabla sin columnas de identidad). El editor de
 * expected outcomes es el MISMO para los dos orígenes, así que este
 * endpoint acepta ambos: primero busca en `agent_test_case` y, si no
 * está, en `lab_case`. Ambas lecturas son tenant-safe, así que un id
 * de otra organización sigue siendo un 404 indistinguible de "no
 * existe".
 */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "invalid_body", "Se esperaba un cuerpo JSON");
  }
  const parsed = ExpectedPatch.safeParse(body);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return apiError(422, "validation_failed", `Outcomes esperados inválidos — ${detail}`);
  }

  const db = getDb();

  // Tenant-safe: el caso debe ser de la organización de la sesión.
  // Se prueban los dos orígenes (caso de corrida del Laboratorio y caso
  // guardado desde conversación real).
  const agentCases = await db
    .select({ id: schema.agentTestCase.id })
    .from(schema.agentTestCase)
    .where(
      scoped(
        schema.agentTestCase.organizationId,
        session.organizationId,
        eq(schema.agentTestCase.id, id)
      )
    )
    .limit(1);

  const fromConversation = agentCases[0]
    ? null
    : (
        await db
          .select({ id: schema.labCase.id })
          .from(schema.labCase)
          .where(
            scoped(
              schema.labCase.organizationId,
              session.organizationId,
              eq(schema.labCase.id, id)
            )
          )
          .limit(1)
      )[0];

  if (!agentCases[0] && !fromConversation) {
    return apiError(404, "not_found", "Caso no encontrado");
  }

  const patch: Record<string, string | boolean | null> = {};
  if (parsed.data.expected_next_action !== undefined) {
    patch.expectedNextAction = parsed.data.expected_next_action;
  }
  if (parsed.data.expected_lane !== undefined) {
    patch.expectedLane = parsed.data.expected_lane;
  }
  if (parsed.data.expected_handoff !== undefined) {
    patch.expectedHandoff = parsed.data.expected_handoff;
  }
  if (Object.keys(patch).length === 0) {
    return apiError(422, "empty_patch", "No enviaste ningún campo a actualizar");
  }

  if (fromConversation) {
    const updated = await db
      .update(schema.labCase)
      .set(patch)
      .where(
        scoped(
          schema.labCase.organizationId,
          session.organizationId,
          eq(schema.labCase.id, id)
        )
      )
      .returning();
    const c = updated[0];
    return Response.json({
      case: {
        id: c?.id ?? id,
        origin: "from_conversation",
        expectedNextAction: c?.expectedNextAction ?? null,
        expectedLane: c?.expectedLane ?? null,
        expectedHandoff: c?.expectedHandoff ?? null,
      },
    });
  }

  const updated = await db
    .update(schema.agentTestCase)
    .set(patch)
    .where(
      scoped(
        schema.agentTestCase.organizationId,
        session.organizationId,
        eq(schema.agentTestCase.id, id)
      )
    )
    .returning();

  const c = updated[0];
  return Response.json({
    case: {
      id: c?.id ?? id,
      origin: "lab_run",
      expectedNextAction: c?.expectedNextAction ?? null,
      expectedLane: c?.expectedLane ?? null,
      expectedHandoff: c?.expectedHandoff ?? null,
      actualNextAction: c?.actualNextAction ?? null,
      actualLane: c?.actualLane ?? null,
      actualHandoff: c?.actualHandoff ?? null,
    },
  });
});
