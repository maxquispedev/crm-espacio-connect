import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  StageGatewayError,
  bulkMoveLeadsToStage,
  createLeadInStage,
  findFirstOpenStage,
  moveLeadStage,
} from "@/server/leads/stage-gateway";

/**
 * Tests del gateway único de cambios de etapa (corte A del spec 007).
 *
 * Cobertura exigida por A9:
 *  - tenant isolation (cross-tenant → rechazo)
 *  - no-op mismo stage (no escribe)
 *  - operador/API (drag/drop conserva misma respuesta)
 *  - movimiento producido por Jev (lane/facts intactos)
 *  - won/lost/open aceptados
 *  - regresión del Sales Orchestrator (ver `sales-orchestrator.test.ts`
 *    que sigue pasando tras la migración).
 */

type Lead = {
  id: string;
  organizationId: string;
  contactId: string;
  stageId: string;
  position: number;
  lastActivityAt: Date | null;
  automationLane: string;
  updatedAt: Date;
};
type Stage = {
  id: string;
  organizationId: string;
  name: string;
  position: number;
  kind: "open" | "won" | "lost";
};

const orgLeads: Lead[] = [];
const orgStages: Stage[] = [];
const updateCalls: {
  where: { org: string; id?: string; stageId?: string; contactId?: string };
  set: Record<string, unknown>;
}[] = [];
const insertCalls: { values: Record<string, unknown> }[] = [];
/** Cola FIFO de respuestas para cada `.select()...limit(1)`. */
const selectQueue: unknown[][] = [];

function seedFixtures() {
  orgLeads.length = 0;
  orgStages.length = 0;
  orgLeads.push({
    id: "ld_alpha",
    organizationId: "org_a",
    contactId: "ct_alpha",
    stageId: "st_a1",
    position: 0,
    lastActivityAt: null,
    automationLane: "auto",
    updatedAt: new Date("2026-09-01T00:00:00Z"),
  });
  orgStages.push(
    { id: "st_a1", organizationId: "org_a", name: "Nuevo", position: 0, kind: "open" },
    { id: "st_a2", organizationId: "org_a", name: "En conversación", position: 1, kind: "open" },
    { id: "st_aw", organizationId: "org_a", name: "Cliente", position: 2, kind: "won" },
    { id: "st_al", organizationId: "org_a", name: "Perdido", position: 3, kind: "lost" },
    { id: "st_b1", organizationId: "org_b", name: "Otro org", position: 0, kind: "open" }
  );
}

/** Cadena SELECT awaitable con .from/.where/.orderBy/.limit encadenables. */
function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit", "groupBy"]) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

function buildDb() {
  return {
    select: () => thenableChain(selectQueue.shift() ?? []),
    update: (_table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (clause: {
          organizationId: string;
          conditions?: unknown[];
        }) => {
          const captured: {
            where: { org: string; id?: string; stageId?: string; contactId?: string };
            set: Record<string, unknown>;
          } = {
            where: { org: clause.organizationId },
            set: patch,
          };
          for (const cond of clause.conditions ?? []) {
            const c = cond as { queryChunks?: unknown[] };
            const chunks = c?.queryChunks;
            if (Array.isArray(chunks) && chunks.length >= 3) {
              const col = chunks[0] as { name?: string };
              const val = chunks[2];
              if (col?.name === "id") captured.where.id = String(val);
              if (col?.name === "stageId") captured.where.stageId = String(val);
              if (col?.name === "contactId") captured.where.contactId = String(val);
            }
          }
          updateCalls.push(captured);
          const matches = orgLeads.filter((l) => {
            if (l.organizationId !== captured.where.org) return false;
            if (captured.where.id && l.id !== captured.where.id) return false;
            if (captured.where.stageId && l.stageId !== captured.where.stageId)
              return false;
            if (
              captured.where.contactId &&
              l.contactId !== captured.where.contactId
            )
              return false;
            return true;
          });
          for (const m of matches) Object.assign(m, patch);
          return {
            returning: () =>
              Promise.resolve(matches.map((m) => ({ ...m }))),
          };
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertCalls.push({ values });
        const dup = orgLeads.find(
          (l) => l.contactId === (values.contactId as string)
        );
        if (dup) {
          const chain = {
            onConflictDoNothing: () => chain,
            returning: () => Promise.resolve([]),
            then: (resolve: (v: unknown) => void) =>
              Promise.resolve([]).then(resolve),
          };
          return chain;
        }
        const row: Lead = {
          id: (values.id as string) ?? `ld_new_${orgLeads.length}`,
          organizationId: values.organizationId as string,
          contactId: values.contactId as string,
          stageId: values.stageId as string,
          position: (values.position as number) ?? 0,
          lastActivityAt: (values.lastActivityAt as Date | null) ?? null,
          automationLane: "auto",
          updatedAt: new Date(),
        };
        orgLeads.push(row);
        const chain = {
          onConflictDoNothing: () => chain,
          returning: () => Promise.resolve([row]),
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve([row]).then(resolve),
        };
        return chain;
      },
    }),
  };
}

vi.mock("@/lib/db", () => ({
  getDb: () => buildDb(),
  schema: new Proxy(
    {},
    {
      get: (_t, name) => {
        const t = name as string;
        return new Proxy(
          { _: t },
          {
            get: (_t2, col) =>
              typeof col === "string" ? { name: col, _: `${t}.${col}` } : col,
          }
        );
      },
    }
  ),
}));

vi.mock("@/lib/db/tenant", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db/tenant")>();
  return {
    ...original,
    scoped: (
      organizationColumn: unknown,
      organizationId: string,
      ...conditions: unknown[]
    ) => {
      const col = organizationColumn as { name: string; _: string };
      return {
        organizationColumn: col,
        organizationId,
        conditions,
        queryChunks: [col, "=", organizationId],
      };
    },
  };
});

vi.mock("@/lib/db/ids", () => ({
  newId: (kind: string) => `${kind}_generated_${Math.random().toString(36).slice(2, 8)}`,
}));

beforeEach(() => {
  seedFixtures();
  updateCalls.length = 0;
  insertCalls.length = 0;
  selectQueue.length = 0;
});

describe("moveLeadStage", () => {
  it("mueve un lead a otra etapa del mismo tenant", async () => {
    // SELECT del lead actual + SELECT de la etapa destino.
    selectQueue.push([orgLeads[0]], [orgStages[1]]);
    const result = await moveLeadStage({
      organizationId: "org_a",
      leadId: "ld_alpha",
      toStageId: "st_a2",
      actor: "human",
      reason: "drag_drop",
    });
    expect(result.moved).toBe(true);
    expect(result.fromStageId).toBe("st_a1");
    expect(result.toStageId).toBe("st_a2");
    expect(result.lead.stageId).toBe("st_a2");
    expect(result.lead.lastActivityAt).toBeInstanceOf(Date);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.set).toMatchObject({
      stageId: "st_a2",
      lastActivityAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
  });

  it("acepta position explícita y la escribe", async () => {
    selectQueue.push([orgLeads[0]], [orgStages[1]]);
    await moveLeadStage({
      organizationId: "org_a",
      leadId: "ld_alpha",
      toStageId: "st_a2",
      position: 7,
      actor: "human",
    });
    expect(updateCalls[0]?.set.position).toBe(7);
  });

  it("rechaza etapa destino de otro tenant (tenant isolation)", async () => {
    selectQueue.push([orgLeads[0]], []); // SELECT destino devuelve vacío → stage no encontrado
    await expect(
      moveLeadStage({
        organizationId: "org_a",
        leadId: "ld_alpha",
        toStageId: "st_b1",
        actor: "human",
      })
    ).rejects.toMatchObject({
      name: "StageGatewayError",
      code: "invalid_stage",
    });
    expect(updateCalls).toHaveLength(0);
  });

  it("rechaza lead inexistente", async () => {
    selectQueue.push([]); // SELECT lead devuelve vacío
    await expect(
      moveLeadStage({
        organizationId: "org_a",
        leadId: "ld_no_existe",
        toStageId: "st_a2",
        actor: "human",
      })
    ).rejects.toBeInstanceOf(StageGatewayError);
  });

  it("no-op si ya está en la etapa destino y no hay extra/position/lastActivityAt", async () => {
    const before = new Date(orgLeads[0]!.updatedAt);
    // Solo se hace SELECT del lead (no SELECT de stage porque no se llega a él).
    selectQueue.push([orgLeads[0]]);
    const result = await moveLeadStage({
      organizationId: "org_a",
      leadId: "ld_alpha",
      toStageId: "st_a1",
      actor: "human",
    });
    expect(result.moved).toBe(false);
    expect(result.fromStageId).toBe("st_a1");
    expect(result.toStageId).toBe("st_a1");
    expect(updateCalls).toHaveLength(0);
    expect(orgLeads[0]!.updatedAt).toEqual(before);
  });

  it("con extra sí escribe aunque no haya cambio de etapa", async () => {
    selectQueue.push([orgLeads[0]]); // solo SELECT del lead (stage == actual → no-op path)
    await moveLeadStage({
      organizationId: "org_a",
      leadId: "ld_alpha",
      toStageId: "st_a1",
      actor: "agent",
      extra: { automationLane: "human", lastJevEvaluatedAt: new Date() },
    });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.set).toMatchObject({
      automationLane: "human",
      updatedAt: expect.any(Date),
    });
    expect(updateCalls[0]?.set).not.toHaveProperty("stageId");
  });

  it("preserva lanes y facts de Jev (extra) en el mismo UPDATE", async () => {
    selectQueue.push([orgLeads[0]], [orgStages[2]]); // lead + stage won
    const decisionSnapshot = { snapshot: { answers: {} } };
    await moveLeadStage({
      organizationId: "org_a",
      leadId: "ld_alpha",
      toStageId: "st_aw",
      actor: "agent",
      reason: "jev:present_price",
      extra: {
        automationLane: "auto_close",
        lastJevEvaluatedAt: new Date(),
        lastJevDecision: decisionSnapshot,
        lastJevError: null,
        lastActivityAt: new Date(),
        followUpReason: "scheduled_follow_up",
      },
    });
    expect(updateCalls).toHaveLength(1);
    const set = updateCalls[0]!.set;
    expect(set).toMatchObject({
      stageId: "st_aw",
      automationLane: "auto_close",
      lastJevDecision: decisionSnapshot,
      lastJevError: null,
      followUpReason: "scheduled_follow_up",
      updatedAt: expect.any(Date),
    });
  });

  it("acepta mover a etapa won", async () => {
    selectQueue.push([orgLeads[0]], [orgStages[2]]);
    const result = await moveLeadStage({
      organizationId: "org_a",
      leadId: "ld_alpha",
      toStageId: "st_aw",
      actor: "agent",
    });
    expect(result.moved).toBe(true);
    expect(result.toStageId).toBe("st_aw");
  });

  it("acepta mover a etapa lost", async () => {
    selectQueue.push([orgLeads[0]], [orgStages[3]]);
    const result = await moveLeadStage({
      organizationId: "org_a",
      leadId: "ld_alpha",
      toStageId: "st_al",
      actor: "agent",
    });
    expect(result.moved).toBe(true);
    expect(result.toStageId).toBe("st_al");
  });

  it("acepta mover entre etapas open", async () => {
    selectQueue.push([orgLeads[0]], [orgStages[1]]);
    const result = await moveLeadStage({
      organizationId: "org_a",
      leadId: "ld_alpha",
      toStageId: "st_a2",
      actor: "human",
    });
    expect(result.toStageId).toBe("st_a2");
  });

  it("acepta lastActivityAt explícito sin pisarlo cuando hay cambio de etapa", async () => {
    selectQueue.push([orgLeads[0]], [orgStages[1]]);
    const explicit = new Date("2026-09-15T10:00:00Z");
    await moveLeadStage({
      organizationId: "org_a",
      leadId: "ld_alpha",
      toStageId: "st_a2",
      lastActivityAt: explicit,
      actor: "agent",
    });
    expect(updateCalls[0]?.set.lastActivityAt).toEqual(explicit);
    expect(updateCalls[0]?.set.stageId).toBe("st_a2");
  });
});

describe("bulkMoveLeadsToStage", () => {
  it("rechaza etapa destino de otro tenant", async () => {
    selectQueue.push([]); // SELECT destino vacío
    await expect(
      bulkMoveLeadsToStage({
        organizationId: "org_a",
        fromStageId: "st_a1",
        toStageId: "st_b1",
        actor: "human",
      })
    ).rejects.toMatchObject({ code: "invalid_stage" });
    expect(updateCalls).toHaveLength(0);
  });

  it("no-op si fromStageId === toStageId", async () => {
    const result = await bulkMoveLeadsToStage({
      organizationId: "org_a",
      fromStageId: "st_a1",
      toStageId: "st_a1",
      actor: "human",
    });
    expect(result.movedCount).toBe(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("reasigna todos los leads de la etapa origen", async () => {
    selectQueue.push([orgStages[1]]); // SELECT destino válido
    orgLeads[0]!.stageId = "st_a1";
    orgLeads.push({
      id: "ld_beta",
      organizationId: "org_a",
      contactId: "ct_beta",
      stageId: "st_a1",
      position: 1,
      lastActivityAt: null,
      automationLane: "auto",
      updatedAt: new Date(),
    });

    const result = await bulkMoveLeadsToStage({
      organizationId: "org_a",
      fromStageId: "st_a1",
      toStageId: "st_a2",
      actor: "human",
      reason: "bulk_stage_delete",
    });

    expect(result.movedCount).toBe(2);
    expect(result.toStageId).toBe("st_a2");
    expect(orgLeads.every((l) => l.stageId === "st_a2")).toBe(true);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.set).toMatchObject({
      stageId: "st_a2",
      updatedAt: expect.any(Date),
    });
  });
});

describe("createLeadInStage", () => {
  it("crea el lead con lastActivityAt explícito", async () => {
    selectQueue.push([orgStages[0]]); // SELECT destino válido
    const at = new Date("2026-09-20T12:00:00Z");
    const result = await createLeadInStage({
      organizationId: "org_a",
      contactId: "ct_new",
      toStageId: "st_a1",
      lastActivityAt: at,
      actor: "system",
      reason: "first_inbound",
    });
    expect(result.created).toBe(true);
    expect(result.lead).not.toBeNull();
    expect(result.lead?.stageId).toBe("st_a1");
    expect(result.lead?.lastActivityAt).toEqual(at);
    expect(insertCalls).toHaveLength(1);
  });

  it("rechaza etapa destino de otro tenant", async () => {
    selectQueue.push([]); // SELECT destino vacío
    await expect(
      createLeadInStage({
        organizationId: "org_a",
        contactId: "ct_new",
        toStageId: "st_b1",
        actor: "system",
      })
    ).rejects.toMatchObject({ code: "invalid_stage" });
  });

  it("es idempotente (onConflictDoNothing) si el contacto ya tiene lead", async () => {
    selectQueue.push([orgStages[0]]); // SELECT destino válido
    const result = await createLeadInStage({
      organizationId: "org_a",
      contactId: "ct_alpha", // ya tiene lead
      toStageId: "st_a1",
      actor: "system",
    });
    expect(result.created).toBe(false);
    expect(result.lead).toBeNull();
  });

  it("calcula position automática como max+1 dentro de la etapa destino", async () => {
    // SELECT destino + SELECT max position (nextPosition).
    selectQueue.push([orgStages[0]], [{ max: 5 }]);
    const result = await createLeadInStage({
      organizationId: "org_a",
      contactId: "ct_brandnew",
      toStageId: "st_a1",
      actor: "system",
    });
    expect(result.position).toBe(6);
    expect(result.lead?.position).toBe(6);
  });
});

describe("findFirstOpenStage", () => {
  it("devuelve la primera etapa open ordenada por position", async () => {
    selectQueue.push([orgStages[0]]);
    const stage = await findFirstOpenStage("org_a");
    expect(stage).not.toBeNull();
    expect(stage?.kind).toBe("open");
    expect(stage?.id).toBe("st_a1");
  });

  it("ignora etapas won/lost", async () => {
    // Devolvemos solo la etapa open de mayor position (st_a2).
    selectQueue.push([orgStages[1]]);
    const stage = await findFirstOpenStage("org_a");
    expect(stage?.id).toBe("st_a2");
  });
});
