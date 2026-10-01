/**
 * T208 — Tests unitarios de la API REST de Sales Playbook (Corte 2,
 * Feature 008).
 *
 * Cubre los doce escenarios del tasks.md:
 *   - tenant isolation (cross-org);
 *   - draft duplicado → 409;
 *   - payload inválido → 422 con `details[]`;
 *   - rollback cross-org → 404;
 *   - publish concurrente → 409;
 *   - GET /api/playbook cuando no hay playbook → 404;
 *   - GET /api/playbook con sesión OK → 200;
 *   - PUT con `next_action.criteria` que añade una option key fuera
 *     del set V1 → 422 con `code: 'choice_keys_mismatch'`;
 *   - PUT con `next_action.type` ≠ `choice` → 422 con
 *     `code: 'engine_required_type_mismatch'`;
 *   - PUT que elimina `next_action` → 422 con
 *     `code: 'engine_required_missing'`;
 *   - PUT con `next_action.enabled = false` → 422 con
 *     `code: 'engine_required_disabled'`;
 *   - PUT con `buying_timing.criteria` que renombra una option key →
 *     422 con `code: 'choice_keys_mismatch'`.
 *
 * Estrategia: mockeamos `@/lib/api` (con un `withAuth` que invoca el
 * handler con la sesión ficticia) y `@/lib/sales/playbook/store` (con
 * implementaciones en memoria). Así testeamos los handlers como
 * funciones puras, sin tocar BD.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { VENDE_VELOZ_PLAYBOOK_V1 } from "@/lib/sales/playbook/v1";
import type {
  PlaybookRow,
  PlaybookVersionRow,
} from "@/lib/sales/playbook/store";
import { DraftAlreadyOpenError } from "@/lib/sales/playbook/store";

/* ============================================================
 * Mocks — `withAuth` y store en memoria
 * ============================================================ */

const fakeSession = {
  user: { id: "user_a" },
  organizationId: "org_a",
};

const fakeSessionB = {
  user: { id: "user_b" },
  organizationId: "org_b",
};

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    // `withAuth` se reemplaza por un wrapper que resuelve la sesión
    // desde el closure del test. Los tests "loguean" la sesión
    // vía `setSession(...)`.
    withAuth: <Args extends unknown[], R extends Response>(
      handler: (session: typeof fakeSession, request: Request, ...args: Args) => Promise<R> | R
    ) => {
      return async (request: Request, ctx?: unknown) => {
        const session = currentSession;
        const args = ctx !== undefined ? ([ctx] as unknown as Args) : ([] as unknown as Args);
        return handler(session, request, ...args);
      };
    },
  };
});

let currentSession: typeof fakeSession = fakeSession;
function setSession(s: typeof fakeSession) {
  currentSession = s;
}

// Implementación en memoria del store. Cada función valida la
// organización y mantiene el invariante del índice parcial
// (un solo `published` y un solo `draft` por playbook).
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
    getPlaybookForOrg: vi.fn(async (orgId: string) => {
      return playbookByOrg.get(orgId) ?? null;
    }),
    getPublishedVersionForOrg: vi.fn(async (orgId: string) => {
      const published = (versionsByOrg.get(orgId) ?? []).filter(
        (v) => v.status === "published"
      );
      if (published.length === 0) return null;
      // Más reciente primero: por `publishedAt` desc; nulls al final.
      return [...published].sort((a, b) => {
        const ta = a.publishedAt?.getTime() ?? 0;
        const tb = b.publishedAt?.getTime() ?? 0;
        return tb - ta;
      })[0];
    }),
    getDraftVersionForOrg: vi.fn(async (orgId: string) => {
      return (
        versionsByOrg.get(orgId)?.find((v) => v.status === "draft") ?? null
      );
    }),
    getVersionById: vi.fn(async (orgId: string, versionId: string) => {
      return (
        versionsByOrg.get(orgId)?.find((v) => v.id === versionId) ?? null
      );
    }),
    listVersionsForOrg: vi.fn(async (orgId: string) => {
      return [...(versionsByOrg.get(orgId) ?? [])].sort((a, b) =>
        b.versionNumber - a.versionNumber
      );
    }),
    createDraft: vi.fn(
      async (
        orgId: string,
        input: {
          createdBy: string;
          notes: string | null;
          config: typeof VENDE_VELOZ_PLAYBOOK_V1;
        }
      ) => {
        const org = orgId;
        if (!playbookByOrg.has(org)) {
          playbookByOrg.set(org, {
            id: `pb_${org}`,
            organizationId: org,
            slug: "vende-veloz-365",
            label: "Vende Veloz 365",
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
        const existingDraft = versionsByOrg
          .get(org)
          ?.find((v) => v.status === "draft");
        if (existingDraft) {
          throw new DraftAlreadyOpenError();
        }
        versionCounter += 1;
        const id = `spv_${versionCounter}`;
        const newRow: PlaybookVersionRow = {
          id,
          organizationId: org,
          playbookId: playbookByOrg.get(org)!.id,
          versionNumber: (versionsByOrg.get(org)?.length ?? 0) + 1,
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
        const arr = versionsByOrg.get(org) ?? [];
        arr.push(newRow);
        versionsByOrg.set(org, arr);
        return newRow;
      }
    ),
    updateDraft: vi.fn(
      async (
        orgId: string,
        patch: {
          config?: typeof VENDE_VELOZ_PLAYBOOK_V1;
          notes?: string | null;
        }
      ) => {
        const draft = versionsByOrg
          .get(orgId)
          ?.find((v) => v.status === "draft");
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
    publishDraft: vi.fn(
      async (orgId: string, notes: string | null, publishedBy: string) => {
        const versions = versionsByOrg.get(orgId);
        const draft = versions?.find((v) => v.status === "draft");
        if (!draft) {
          const err = new Error("No hay draft abierto para publicar");
          err.name = "PlaybookVersionNotFoundError";
          throw err;
        }
        // Simulamos que el draft fue flippeado a `published` *antes*
        // de que el siguiente caller lo vea (permite probar 409).
        const publishedNow = versions?.find((v) => v.status === "published");
        if (publishedNow) {
          publishedNow.status = "archived";
          publishedNow.archivedAt = new Date();
        }
        draft.status = "published";
        draft.publishedAt = new Date();
        draft.publishedBy = publishedBy;
        draft.notes = notes ?? draft.notes;
        return draft;
      }
    ),
    rollbackToVersion: vi.fn(
      async (orgId: string, versionId: string, notes: string | null, publishedBy: string) => {
        const target = versionsByOrg
          .get(orgId)
          ?.find((v) => v.id === versionId);
        if (!target) {
          const err = new Error("Versión no encontrada");
          err.name = "PlaybookVersionNotFoundError";
          throw err;
        }
        const currentPub = versionsByOrg
          .get(orgId)
          ?.find((v) => v.status === "published");
        if (currentPub && currentPub.id !== target.id) {
          currentPub.status = "archived";
          currentPub.archivedAt = new Date();
        }
        target.status = "published";
        target.publishedAt = new Date();
        target.publishedBy = publishedBy;
        target.archivedAt = null;
        target.notes = notes ?? target.notes;
        return target;
      }
    ),
    loadActiveQuestionsForVersion: vi.fn(async () => null),
    _countDraftsForPlaybook: vi.fn(async () => 0),
  };
});

/* ============================================================
 * Helpers de tests
 * ============================================================ */

function resetStore() {
  playbookByOrg.clear();
  versionsByOrg.clear();
  versionCounter = 0;
}

function seedOrgWithPublishedV1(orgId: string): PlaybookVersionRow {
  const pb: PlaybookRow = {
    id: `pb_${orgId}`,
    organizationId: orgId,
    slug: "vende-veloz-365",
    label: "Vende Veloz 365",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  };
  playbookByOrg.set(orgId, pb);
  const v1: PlaybookVersionRow = {
    id: `spv_v1_${orgId}`,
    organizationId: orgId,
    playbookId: pb.id,
    versionNumber: 1,
    status: "published",
    schemaVersion: "1.0",
    productJson: VENDE_VELOZ_PLAYBOOK_V1.product,
    policyJson: VENDE_VELOZ_PLAYBOOK_V1.commercial_policy,
    offerJson: VENDE_VELOZ_PLAYBOOK_V1.offer,
    prioritiesJson: VENDE_VELOZ_PLAYBOOK_V1.priorities,
    writerJson: VENDE_VELOZ_PLAYBOOK_V1.writer,
    jevQuestionsJson: VENDE_VELOZ_PLAYBOOK_V1.jev_questions,
    prohibitionsJson: VENDE_VELOZ_PLAYBOOK_V1.prohibitions,
    handoffJson: VENDE_VELOZ_PLAYBOOK_V1.handoff,
    urgencyRules: VENDE_VELOZ_PLAYBOOK_V1.urgency_rules ?? null,
    notes: "V1 inicial",
    createdBy: "seed",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    publishedAt: new Date("2025-01-01T00:00:00Z"),
    publishedBy: "seed",
    archivedAt: null,
  };
  versionsByOrg.set(orgId, [v1]);
  return v1;
}

async function call(
  mod: Promise<{ [k: string]: unknown }>,
  exportName: string,
  request: Request,
  ctx?: unknown
): Promise<{ status: number; body: unknown }> {
  const m = await mod;
  const handler = m[exportName] as (
    req: Request,
    ctx?: unknown
  ) => Promise<Response>;
  const response = ctx !== undefined ? await handler(request, ctx) : await handler(request);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

/* ============================================================
 * Tests
 * ============================================================ */

beforeEach(() => {
  resetStore();
  setSession(fakeSession);
});

describe("GET /api/playbook (T201)", () => {
  it("404 cuando no hay playbook ni versiones", async () => {
    const { GET } = await import("@/app/api/playbook/route");
    const { status, body } = await call(Promise.resolve({ GET }), "GET", new Request("http://test/api/playbook"));
    expect(status).toBe(404);
    expect((body as { code: string }).code).toBe("not_found");
  });

  it("200 con playbook + published cuando la org tiene V1", async () => {
    seedOrgWithPublishedV1("org_a");
    const { GET } = await import("@/app/api/playbook/route");
    const { status, body } = await call(Promise.resolve({ GET }), "GET", new Request("http://test/api/playbook"));
    expect(status).toBe(200);
    const b = body as {
      playbook: { id: string; organization_id: string };
      published: { id: string; status: string; schema_version: string };
      draft: unknown;
    };
    expect(b.playbook.organization_id).toBe("org_a");
    expect(b.published.status).toBe("published");
    expect(b.published.schema_version).toBe("1.0");
    expect(b.draft).toBeNull();
  });
});

describe("POST /api/playbook/draft (T202)", () => {
  it("201 al crear el primer draft sobre la V1 publicada", async () => {
    seedOrgWithPublishedV1("org_a");
    const { POST } = await import("@/app/api/playbook/draft/route");
    const req = new Request("http://test/api/playbook/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "primer draft de prueba" }),
    });
    const { status, body } = await call(Promise.resolve({ POST }), "POST", req);
    expect(status).toBe(201);
    const b = body as { draft: { status: string; version_number: number } };
    expect(b.draft.status).toBe("draft");
    expect(b.draft.version_number).toBe(2);
  });

  it("409 al intentar crear un segundo draft duplicado", async () => {
    seedOrgWithPublishedV1("org_a");
    const { POST } = await import("@/app/api/playbook/draft/route");
    const req = new Request("http://test/api/playbook/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "primer draft" }),
    });
    await call(Promise.resolve({ POST }), "POST", req);
    const req2 = new Request("http://test/api/playbook/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "segundo draft" }),
    });
    const { status, body } = await call(Promise.resolve({ POST }), "POST", req2);
    expect(status).toBe(409);
    expect((body as { code: string }).code).toBe("draft_already_open");
  });

  it("422 no_published_baseline cuando no hay publicada", async () => {
    const { POST } = await import("@/app/api/playbook/draft/route");
    const req = new Request("http://test/api/playbook/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const { status, body } = await call(Promise.resolve({ POST }), "POST", req);
    expect(status).toBe(422);
    expect((body as { code: string }).code).toBe("no_published_baseline");
  });
});

describe("PUT /api/playbook/draft (T203) — guardarraíles Jev", () => {
  async function openDraft(): Promise<void> {
    const { POST } = await import("@/app/api/playbook/draft/route");
    const req = new Request("http://test/api/playbook/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "draft para tests" }),
    });
    const { status } = await call(Promise.resolve({ POST }), "POST", req);
    expect(status).toBe(201);
  }

  it("404 no_draft cuando no hay draft activo", async () => {
    const { PUT } = await import("@/app/api/playbook/draft/route");
    const req = new Request("http://test/api/playbook/draft", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ writer: VENDE_VELOZ_PLAYBOOK_V1.writer }),
    });
    const { status, body } = await call(Promise.resolve({ PUT }), "PUT", req);
    expect(status).toBe(404);
    expect((body as { code: string }).code).toBe("no_draft");
  });

  it("422 con choice_keys_mismatch al añadir una option key extra en next_action.criteria", async () => {
    seedOrgWithPublishedV1("org_a");
    await openDraft();
    const { PUT } = await import("@/app/api/playbook/draft/route");
    const tampered = structuredClone(VENDE_VELOZ_PLAYBOOK_V1);
    const nextAction = tampered.jev_questions.next_action as {
      type: "choice";
      enabled: boolean;
      instructions: string;
      criteria: Record<string, string>;
    };
    tampered.jev_questions.next_action = {
      ...nextAction,
      criteria: {
        ...nextAction.criteria,
        // key extra fuera del set V1
        new_action_not_in_v1: "inventada",
      },
    } as never;
    const req = new Request("http://test/api/playbook/draft", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jev_questions: tampered.jev_questions }),
    });
    const { status, body } = await call(Promise.resolve({ PUT }), "PUT", req);
    expect(status).toBe(422);
    const b = body as { code: string; details: { code: string; path: string }[] };
    expect(b.code).toBe("validation_failed");
    expect(b.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "choice_keys_mismatch",
          path: expect.stringContaining("next_action") as string,
        }),
      ])
    );
  });

  it("422 con engine_required_type_mismatch al cambiar next_action.type", async () => {
    seedOrgWithPublishedV1("org_a");
    await openDraft();
    const { PUT } = await import("@/app/api/playbook/draft/route");
    const tampered = structuredClone(VENDE_VELOZ_PLAYBOOK_V1);
    tampered.jev_questions.next_action = {
      // type ≠ choice → Zod dispara engine_required_type_mismatch
      type: "score",
      enabled: true,
      instructions: "x",
      criteria: ["a", "b"],
    } as never;
    const req = new Request("http://test/api/playbook/draft", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jev_questions: tampered.jev_questions }),
    });
    const { status, body } = await call(Promise.resolve({ PUT }), "PUT", req);
    expect(status).toBe(422);
    const b = body as { code: string; details: { code: string }[] };
    expect(b.code).toBe("validation_failed");
    expect(b.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "engine_required_type_mismatch" }),
      ])
    );
  });

  it("422 con engine_required_missing al eliminar next_action del payload", async () => {
    seedOrgWithPublishedV1("org_a");
    await openDraft();
    const { PUT } = await import("@/app/api/playbook/draft/route");
    const tampered = structuredClone(VENDE_VELOZ_PLAYBOOK_V1);
    delete (tampered.jev_questions as Record<string, unknown>).next_action;
    const req = new Request("http://test/api/playbook/draft", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jev_questions: tampered.jev_questions }),
    });
    const { status, body } = await call(Promise.resolve({ PUT }), "PUT", req);
    expect(status).toBe(422);
    const b = body as { code: string; details: { code: string }[] };
    expect(b.code).toBe("validation_failed");
    expect(b.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "engine_required_missing" }),
      ])
    );
  });

  it("422 con engine_required_disabled al poner next_action.enabled = false", async () => {
    seedOrgWithPublishedV1("org_a");
    await openDraft();
    const { PUT } = await import("@/app/api/playbook/draft/route");
    const tampered = structuredClone(VENDE_VELOZ_PLAYBOOK_V1);
    const nextAction = tampered.jev_questions.next_action as {
      type: "choice";
      enabled: boolean;
      instructions: string;
      criteria: Record<string, string>;
    };
    tampered.jev_questions.next_action = {
      ...nextAction,
      enabled: false,
    } as never;
    const req = new Request("http://test/api/playbook/draft", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jev_questions: tampered.jev_questions }),
    });
    const { status, body } = await call(Promise.resolve({ PUT }), "PUT", req);
    expect(status).toBe(422);
    const b = body as { code: string; details: { code: string }[] };
    expect(b.code).toBe("validation_failed");
    expect(b.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "engine_required_disabled" }),
      ])
    );
  });

  it("422 con choice_keys_mismatch al renombrar una option key de buying_timing", async () => {
    seedOrgWithPublishedV1("org_a");
    await openDraft();
    const { PUT } = await import("@/app/api/playbook/draft/route");
    const tampered = structuredClone(VENDE_VELOZ_PLAYBOOK_V1);
    // Renombramos `now` → `inmediatamente` (no permitido por el contrato)
    const buyingTiming = tampered.jev_questions.buying_timing as {
      type: "choice";
      enabled: boolean;
      instructions: string;
      criteria: Record<string, string>;
    };
    tampered.jev_questions.buying_timing = {
      ...buyingTiming,
      criteria: {
        inmediatamente: buyingTiming.criteria.now,
        soon: buyingTiming.criteria.soon,
        future_season: buyingTiming.criteria.future_season,
        unknown: buyingTiming.criteria.unknown,
        no_current_plan: buyingTiming.criteria.no_current_plan,
      },
    } as never;
    const req = new Request("http://test/api/playbook/draft", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jev_questions: tampered.jev_questions }),
    });
    const { status, body } = await call(Promise.resolve({ PUT }), "PUT", req);
    expect(status).toBe(422);
    const b = body as { code: string; details: { code: string; path: string }[] };
    expect(b.code).toBe("validation_failed");
    expect(b.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "choice_keys_mismatch",
          path: expect.stringContaining("buying_timing") as string,
        }),
      ])
    );
  });
});

describe("POST /api/playbook/publish (T205)", () => {
  it("409 publish_concurrency_lost cuando otro caller ya publicó", async () => {
    seedOrgWithPublishedV1("org_a");
    // Pre-poblamos un draft en el store.
    const { POST: createDraft } = await import("@/app/api/playbook/draft/route");
    await call(
      Promise.resolve({ POST: createDraft }),
      "POST",
      new Request("http://test/api/playbook/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: "draft" }),
      })
    );

    // Simulamos que otro caller ya publicó: cerramos el draft y
    // creamos una nueva `published` "ajena".
    const versions = versionsByOrg.get("org_a")!;
    const draft = versions.find((v) => v.status === "draft")!;
    draft.status = "archived";
    const otherPub: PlaybookVersionRow = {
      ...draft,
      id: "spv_other_pub",
      versionNumber: 99,
      status: "published",
      publishedAt: new Date(),
      publishedBy: "user_x",
    };
    versions.push(otherPub);

    const { POST } = await import("@/app/api/playbook/publish/route");
    const req = new Request("http://test/api/playbook/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "publish attempt" }),
    });
    const { status, body } = await call(Promise.resolve({ POST }), "POST", req);
    expect(status).toBe(409);
    expect((body as { code: string }).code).toBe("publish_concurrency_lost");
  });

  it("200 con published + archived cuando el flujo termina ok", async () => {
    seedOrgWithPublishedV1("org_a");
    const { POST: createDraft } = await import("@/app/api/playbook/draft/route");
    await call(
      Promise.resolve({ POST: createDraft }),
      "POST",
      new Request("http://test/api/playbook/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: "draft" }),
      })
    );

    const { POST } = await import("@/app/api/playbook/publish/route");
    const req = new Request("http://test/api/playbook/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "primer publish" }),
    });
    const { status, body } = await call(Promise.resolve({ POST }), "POST", req);
    expect(status).toBe(200);
    const b = body as {
      published: { status: string };
      archived: { status: string } | null;
    };
    expect(b.published.status).toBe("published");
    expect(b.archived?.status).toBe("archived");
  });
});

describe("POST /api/playbook/rollback (T206)", () => {
  it("404 version_not_found si la versión no pertenece a la org (cross-tenant)", async () => {
    const v1OrgA = seedOrgWithPublishedV1("org_a");
    seedOrgWithPublishedV1("org_b");
    setSession(fakeSessionB);

    const { POST } = await import("@/app/api/playbook/rollback/route");
    const req = new Request("http://test/api/playbook/rollback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version_id: v1OrgA.id,
        notes: "intento cross-tenant",
      }),
    });
    const { status, body } = await call(Promise.resolve({ POST }), "POST", req);
    expect(status).toBe(404);
    expect((body as { code: string }).code).toBe("version_not_found");
  });

  it("422 unknown_schema_version si la schema_version no es soportada", async () => {
    const v1OrgA = seedOrgWithPublishedV1("org_a");
    // Cambiamos la schema_version de la fila V1 para simular una versión legacy.
    v1OrgA.schemaVersion = "0.9";
    v1OrgA.status = "archived";

    const { POST } = await import("@/app/api/playbook/rollback/route");
    const req = new Request("http://test/api/playbook/rollback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version_id: v1OrgA.id,
        notes: "rollback a schema 0.9",
      }),
    });
    const { status, body } = await call(Promise.resolve({ POST }), "POST", req);
    expect(status).toBe(422);
    const b = body as { code: string; schema_version: string; supported: string[] };
    expect(b.code).toBe("unknown_schema_version");
    expect(b.schema_version).toBe("0.9");
    expect(b.supported).toContain("1.0");
  });

  it("200 cuando se rollabacka una versión archivada del mismo tenant", async () => {
    const v1 = seedOrgWithPublishedV1("org_a");
    v1.status = "archived";
    v1.archivedAt = new Date();
    // Creamos una "publicada" distinta para que archive algo.
    const versions = versionsByOrg.get("org_a")!;
    const currentPub: PlaybookVersionRow = {
      ...v1,
      id: "spv_current_pub",
      versionNumber: 5,
      status: "published",
      publishedAt: new Date(),
      publishedBy: "user_a",
      archivedAt: null,
    };
    versions.push(currentPub);

    const { POST } = await import("@/app/api/playbook/rollback/route");
    const req = new Request("http://test/api/playbook/rollback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version_id: v1.id,
        notes: "rollback OK",
      }),
    });
    const { status, body } = await call(Promise.resolve({ POST }), "POST", req);
    expect(status).toBe(200);
    const b = body as {
      published: { status: string; id: string };
      archived: { status: string } | null;
    };
    expect(b.published.id).toBe(v1.id);
    expect(b.published.status).toBe("published");
    expect(b.archived?.status).toBe("archived");
  });
});

describe("GET /api/playbook/versions (T207) — aislamiento por org", () => {
  it("solo lista versiones de la organización de la sesión", async () => {
    seedOrgWithPublishedV1("org_a");
    seedOrgWithPublishedV1("org_b");
    setSession(fakeSession);

    const { GET } = await import("@/app/api/playbook/versions/route");
    const { status, body } = await call(
      Promise.resolve({ GET }),
      "GET",
      new Request("http://test/api/playbook/versions")
    );
    expect(status).toBe(200);
    const b = body as { versions: { id: string; version_number: number }[] };
    expect(b.versions).toHaveLength(1);
    expect(b.versions[0]?.id).toBe("spv_v1_org_a");
  });
});
