/**
 * T507 — Guardarraíles de las tres clases de preguntas Jev
 * (Corte 5, Feature 008).
 *
 * Complementa a `playbook-api.test.ts` (Corte 2, T208). Ese test
 * cubría los candados de `next_action` que ya existían; aquí
 * añadimos la clase `known signal` y la `analytical`, que es donde
 * el Corte 5 mete casi toda su política:
 *
 *   - `engine-required` (2): presencia, `type` y `enabled` fijos.
 *   - `known signal` (6): `type` fijo (esto NO lo cubría el Zod: un
 *     `noul -> score` con criterios nuevos es estructuralmente
 *     válido) y option keys fijas en las dos `choice`.
 *     Desactivables: desactivar una `known signal` es un 200.
 *   - `analytical` (∞): libres. Crear una nueva es un 200.
 *
 * Estrategia: mismos mocks que `playbook-api.test.ts` — `withAuth`
 * resuelto desde un closure y el store en memoria — para poder
 * ejercitar el handler del PUT como función pura, sin BD.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { VENDE_VELOZ_PLAYBOOK_V1 } from "@/lib/sales/playbook/v1";
import {
  assertJevProtectedKeys,
  type ConfigV1,
} from "@/lib/sales/playbook/schema";
import type {
  PlaybookRow,
  PlaybookVersionRow,
} from "@/lib/sales/playbook/store";
import { DraftAlreadyOpenError } from "@/lib/sales/playbook/store";

/* ============================================================
 * Mocks — `withAuth` y store en memoria
 * ============================================================ */

const fakeSession = { user: { id: "user_a" }, organizationId: "org_a" };
let currentSession = fakeSession;

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    withAuth:
      <Args extends unknown[], R extends Response>(
        handler: (
          session: typeof fakeSession,
          request: Request,
          ...args: Args
        ) => Promise<R> | R
      ) =>
      async (request: Request, ctx?: unknown) => {
        const session = currentSession;
        const args =
          ctx !== undefined ? ([ctx] as unknown as Args) : ([] as unknown as Args);
        return handler(session, request, ...args);
      },
  };
});

const playbookByOrg = new Map<string, PlaybookRow>();
const versionsByOrg = new Map<string, PlaybookVersionRow[]>();
let versionCounter = 0;

vi.mock("@/lib/sales/playbook/store", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/sales/playbook/store")>(
      "@/lib/sales/playbook/store"
    );
  return {
    ...actual,
    DraftAlreadyOpenError: actual.DraftAlreadyOpenError,
    PlaybookVersionNotFoundError: actual.PlaybookVersionNotFoundError,
    getPlaybookForOrg: vi.fn(async (orgId: string) => playbookByOrg.get(orgId) ?? null),
    getPublishedVersionForOrg: vi.fn(async (orgId: string) => {
      const found = (versionsByOrg.get(orgId) ?? []).filter(
        (v) => v.status === "published"
      );
      return found[0] ?? null;
    }),
    getDraftVersionForOrg: vi.fn(
      async (orgId: string) =>
        versionsByOrg.get(orgId)?.find((v) => v.status === "draft") ?? null
    ),
    getVersionById: vi.fn(
      async (orgId: string, id: string) =>
        versionsByOrg.get(orgId)?.find((v) => v.id === id) ?? null
    ),
    listVersionsForOrg: vi.fn(async (orgId: string) => [
      ...(versionsByOrg.get(orgId) ?? []),
    ]),
    createDraft: vi.fn(
      async (
        orgId: string,
        input: { createdBy: string; notes: string | null; config: ConfigV1 }
      ) => {
        if (!playbookByOrg.has(orgId)) {
          playbookByOrg.set(orgId, {
            id: `pb_${orgId}`,
            organizationId: orgId,
            slug: "vende-veloz-365",
            label: "Vende Veloz 365",
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
        if (versionsByOrg.get(orgId)?.some((v) => v.status === "draft")) {
          throw new DraftAlreadyOpenError();
        }
        versionCounter += 1;
        const row: PlaybookVersionRow = {
          id: `spv_${versionCounter}`,
          organizationId: orgId,
          playbookId: playbookByOrg.get(orgId)!.id,
          versionNumber: (versionsByOrg.get(orgId)?.length ?? 0) + 1,
          status: "draft",
          schemaVersion: input.config.schema_version,
          productJson: input.config.product,
          policyJson: input.config.commercial_policy,
          offerJson: input.config.offer,
          prioritiesJson: input.config.priorities,
          writerJson: input.config.writer,
          jevQuestionsJson: input.config.jev_questions,
          prohibitionsJson: input.config.prohibitions,
          handoffJson: input.config.handoff,
          urgencyRules: input.config.urgency_rules ?? null,
          notes: input.notes,
          createdBy: input.createdBy,
          createdAt: new Date(),
          publishedAt: null,
          publishedBy: null,
          archivedAt: null,
        };
        versionsByOrg.set(orgId, [...(versionsByOrg.get(orgId) ?? []), row]);
        return row;
      }
    ),
    updateDraft: vi.fn(
      async (orgId: string, patch: { config?: ConfigV1; notes?: string | null }) => {
        const draft = versionsByOrg.get(orgId)?.find((v) => v.status === "draft");
        if (!draft) return null;
        if (patch.config) {
          draft.schemaVersion = patch.config.schema_version;
          draft.productJson = patch.config.product;
          draft.policyJson = patch.config.commercial_policy;
          draft.offerJson = patch.config.offer;
          draft.prioritiesJson = patch.config.priorities;
          draft.writerJson = patch.config.writer;
          draft.jevQuestionsJson = patch.config.jev_questions;
          draft.prohibitionsJson = patch.config.prohibitions;
          draft.handoffJson = patch.config.handoff;
          draft.urgencyRules = patch.config.urgency_rules ?? null;
        }
        if (patch.notes !== undefined) draft.notes = patch.notes;
        return draft;
      }
    ),
    publishDraft: vi.fn(async () => null),
    rollbackToVersion: vi.fn(async () => null),
    deleteDraft: vi.fn(async () => null),
    loadActiveQuestionsForVersion: vi.fn(async () => null),
    _countDraftsForPlaybook: vi.fn(async () => 0),
  };
});

/* ============================================================
 * Helpers
 * ============================================================ */

const V1 = VENDE_VELOZ_PLAYBOOK_V1;

/** Copia profunda del V1 para poder mutar sin tocar el original. */
function tamperedQuestions(): ConfigV1["jev_questions"] {
  return structuredClone(V1.jev_questions);
}

type ErrorBody = {
  code?: string;
  message?: string;
  details?: { code?: string; path?: string; message?: string }[];
};

/** Códigos de validación presentes en un 422. */
function detailCodes(body: unknown): string[] {
  const b = body as ErrorBody;
  return (b.details ?? []).map((d) => d.code ?? "");
}

function seedOrgWithPublishedV1(orgId: string): void {
  const pb: PlaybookRow = {
    id: `pb_${orgId}`,
    organizationId: orgId,
    slug: "vende-veloz-365",
    label: "Vende Veloz 365",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  };
  playbookByOrg.set(orgId, pb);
  versionsByOrg.set(orgId, [
    {
      id: `spv_v1_${orgId}`,
      organizationId: orgId,
      playbookId: pb.id,
      versionNumber: 1,
      status: "published",
      schemaVersion: "1.0",
      productJson: V1.product,
      policyJson: V1.commercial_policy,
      offerJson: V1.offer,
      prioritiesJson: V1.priorities,
      writerJson: V1.writer,
      jevQuestionsJson: V1.jev_questions,
      prohibitionsJson: V1.prohibitions,
      handoffJson: V1.handoff,
      urgencyRules: V1.urgency_rules ?? null,
      notes: "V1 inicial",
      createdBy: "seed",
      createdAt: new Date("2025-01-01T00:00:00Z"),
      publishedAt: new Date("2025-01-01T00:00:00Z"),
      publishedBy: "seed",
      archivedAt: null,
    },
  ]);
}

async function callHandler(
  exportName: string,
  request: Request
): Promise<{ status: number; body: unknown }> {
  const mod = await import("@/app/api/playbook/draft/route");
  const handler = mod[exportName as "PUT"] as (req: Request) => Promise<Response>;
  const response = await handler(request);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

/** Crea el draft una vez por test (el PUT exige un draft abierto). */
async function openDraft(): Promise<void> {
  const { status } = await callHandler(
    "POST",
    new Request("http://test/api/playbook/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
  );
  expect(status).toBe(201);
}

function putQuestions(questions: unknown) {
  return callHandler(
    "PUT",
    new Request("http://test/api/playbook/draft", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jev_questions: questions }),
    })
  );
}

/* ============================================================
 * Tests
 * ============================================================ */

beforeEach(() => {
  playbookByOrg.clear();
  versionsByOrg.clear();
  versionCounter = 0;
  currentSession = fakeSession;
  seedOrgWithPublishedV1("org_a");
});

describe("engine-required (2): presencia, type y enabled fijos", () => {
  it("422 engine_required_type_mismatch si next_action pasa a noul", async () => {
    await openDraft();
    const qs = tamperedQuestions();
    qs.next_action = {
      type: "noul",
      enabled: true,
      instructions: "instrucciones",
      criteria: { true: "sí", false: "no" },
    };
    const { status, body } = await putQuestions(qs);
    expect(status).toBe(422);
    expect(detailCodes(body)).toContain("engine_required_type_mismatch");
  });

  it("422 engine_required_missing si next_action desaparece del payload", async () => {
    await openDraft();
    const qs = tamperedQuestions();
    delete (qs as Record<string, unknown>).next_action;
    const { status, body } = await putQuestions(qs);
    expect(status).toBe(422);
    expect(detailCodes(body)).toContain("engine_required_missing");
  });

  it("422 engine_required_disabled si next_action.enabled = false", async () => {
    await openDraft();
    const qs = tamperedQuestions();
    const next = qs.next_action;
    if (next === undefined) throw new Error("next_action ausente en el V1");
    qs.next_action = { ...next, enabled: false };
    const { status, body } = await putQuestions(qs);
    expect(status).toBe(422);
    expect(detailCodes(body)).toContain("engine_required_disabled");
  });

  it("422 engine_required_type_mismatch si se intenta 'crear' next_action como noul", async () => {
    // Crear una pregunta con una key del contrato no es crear: es
    // reemplazar una engine-required. El Zod lo corta por type.
    await openDraft();
    const qs = tamperedQuestions();
    qs.next_action = {
      type: "noul",
      enabled: true,
      instructions: "intento de alta con key protegida",
      criteria: { true: "sí", false: "no" },
    };
    const { status, body } = await putQuestions(qs);
    expect(status).toBe(422);
    expect(detailCodes(body)).toContain("engine_required_type_mismatch");
  });
});

describe("known signal (6): type fijo, option keys fijas, desactivables", () => {
  it("422 protected_type_change si real_operational_need cambia de noul a score", async () => {
    await openDraft();
    const qs = tamperedQuestions();
    // `score` con criterios válidos: el `discriminatedUnion` lo
    // acepta (por eso hace falta `assertJevProtectedKeys`).
    qs.real_operational_need = {
      type: "score",
      enabled: true,
      instructions: "¿Hay necesidad operativa real?",
      criteria: ["Nada", "Nada", "Algo", "Nada", "Nada", "Mucho", "Total"],
    };
    const { status, body } = await putQuestions(qs);
    expect(status).toBe(422);
    expect(detailCodes(body)).toContain("protected_type_change");
  });

  it("200 si se desactiva product_fit (known signal desactivable)", async () => {
    await openDraft();
    const qs = tamperedQuestions();
    const fit = qs.product_fit;
    if (fit === undefined) throw new Error("product_fit ausente en el V1");
    qs.product_fit = { ...fit, enabled: false };
    const { status, body } = await putQuestions(qs);
    expect(status).toBe(200);
    const draft = (body as { draft: ConfigV1 }).draft;
    const saved = draft.jev_questions.product_fit;
    expect(saved?.enabled).toBe(false);
  });

  it("422 choice_keys_mismatch al renombrar una option key de buying_timing", async () => {
    await openDraft();
    const qs = tamperedQuestions();
    const timing = qs.buying_timing;
    if (timing === undefined || timing.type !== "choice") {
      throw new Error("buying_timing no es choice en el V1");
    }
    const renamed: Record<string, string> = {};
    for (const [k, v] of Object.entries(timing.criteria)) {
      renamed[k === "soon" ? "right_away" : k] = v;
    }
    qs.buying_timing = { ...timing, criteria: renamed };
    const { status, body } = await putQuestions(qs);
    expect(status).toBe(422);
    expect(detailCodes(body)).toContain("choice_keys_mismatch");
  });

  it("422 choice_keys_mismatch al añadir una key fuera del set V1 en main_value_proposition", async () => {
    await openDraft();
    const qs = tamperedQuestions();
    const mvp = qs.main_value_proposition;
    if (mvp === undefined || mvp.type !== "choice") {
      throw new Error("main_value_proposition no es choice en el V1");
    }
    qs.main_value_proposition = {
      ...mvp,
      criteria: { ...mvp.criteria, invierte_en_marketing: "Invierte en publicidad" },
    };
    const { status, body } = await putQuestions(qs);
    expect(status).toBe(422);
    expect(detailCodes(body)).toContain("choice_keys_mismatch");
  });

  it("200 si solo se edita la DESCRIPCIÓN de una option key protegida", async () => {
    await openDraft();
    const qs = tamperedQuestions();
    const timing = qs.buying_timing;
    if (timing === undefined || timing.type !== "choice") {
      throw new Error("buying_timing no es choice en el V1");
    }
    qs.buying_timing = {
      ...timing,
      criteria: { ...timing.criteria, now: "Está comprando para este ciclo." },
    };
    const { status, body } = await putQuestions(qs);
    expect(status).toBe(200);
    const draft = (body as { draft: ConfigV1 }).draft;
    const saved = draft.jev_questions.buying_timing;
    expect(saved?.type === "choice" && saved.criteria.now).toBe(
      "Está comprando para este ciclo."
    );
  });
});

describe("analytical: libres, el motor no las consume", () => {
  it("200 al añadir una pregunta analítica nueva (foo_bar, noul)", async () => {
    await openDraft();
    const qs = tamperedQuestions();
    qs.foo_bar = {
      type: "noul",
      enabled: true,
      instructions: "¿Ha mencionado el precio de un competidor?",
      criteria: { true: "Sí, hay precio explícito.", false: "No lo mencionó." },
    };
    const { status, body } = await putQuestions(qs);
    expect(status).toBe(200);
    const draft = (body as { draft: ConfigV1 }).draft;
    expect(draft.jev_questions.foo_bar).toBeDefined();
  });

  it("200 al editar y eliminar preguntas analíticas sin tocar el contrato", async () => {
    await openDraft();
    const qs = tamperedQuestions();
    qs.foo_bar = {
      type: "noul",
      enabled: true,
      instructions: "pregunta propia",
      criteria: { true: "sí", false: "no" },
    };
    const created = await putQuestions(qs);
    expect(created.status).toBe(200);

    // Borramos partiendo de lo que quedó guardado, no del V1: así
    // el test ejercita el ciclo crear → eliminar de verdad.
    const saved = (created.body as { draft: ConfigV1 }).draft
      .jev_questions as ConfigV1["jev_questions"];
    expect(saved.foo_bar).toBeDefined();
    delete (saved as Record<string, unknown>).foo_bar;

    const { status, body } = await putQuestions(saved);
    expect(status).toBe(200);
    const draft = (body as { draft: ConfigV1 }).draft;
    expect(draft.jev_questions.foo_bar).toBeUndefined();
    // El contrato sigue intacto tras borrar una analítica.
    expect(draft.jev_questions.next_action).toBeDefined();
  });

  it("422 por key mal formada (números y mayúsculas) en una analítica", async () => {
    await openDraft();
    const qs = tamperedQuestions();
    qs.fooBar2 = {
      type: "noul",
      enabled: true,
      instructions: "key inválida",
      criteria: { true: "sí", false: "no" },
    };
    const { status } = await putQuestions(qs);
    expect(status).toBe(422);
  });
});

describe("assertJevProtectedKeys (unidad)", () => {
  it("no emite issues para la V1 contra sí misma", () => {
    expect(assertJevProtectedKeys(V1.jev_questions, V1.jev_questions)).toEqual([]);
  });

  it("detecta el cambio de type de una known signal", () => {
    const next = tamperedQuestions();
    next.product_fit = {
      type: "noul",
      enabled: true,
      instructions: "x",
      criteria: { true: "sí", false: "no" },
    };
    const issues = assertJevProtectedKeys(next, V1.jev_questions);
    expect(issues.map((i) => i.code)).toContain("protected_type_change");
  });

  it("detecta la eliminación de una pregunta protegida", () => {
    const next = tamperedQuestions();
    delete (next as Record<string, unknown>).next_action;
    const issues = assertJevProtectedKeys(next, V1.jev_questions);
    expect(issues.map((i) => i.code)).toContain("protected_key_removed");
  });

  it("tolera que una analítica se añada o se quite", () => {
    const withAnalytical = tamperedQuestions();
    withAnalytical.foo_bar = {
      type: "noul",
      enabled: true,
      instructions: "x",
      criteria: { true: "sí", false: "no" },
    };
    expect(assertJevProtectedKeys(withAnalytical, V1.jev_questions)).toEqual([]);
    const without = tamperedQuestions();
    delete (without as Record<string, unknown>).foo_bar;
    expect(assertJevProtectedKeys(without, withAnalytical)).toEqual([]);
  });

  it("tolera desactivar una known signal (cambio de enabled, no de type)", () => {
    const next = tamperedQuestions();
    const fit = next.product_fit;
    if (fit === undefined) throw new Error("product_fit ausente en el V1");
    next.product_fit = { ...fit, enabled: false };
    expect(assertJevProtectedKeys(next, V1.jev_questions)).toEqual([]);
  });
});
