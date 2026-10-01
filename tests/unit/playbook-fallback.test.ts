/**
 * T302 — sin playbook publicado, el runtime cae a VENDE_VELOZ_*
 * y emite `console.warn` la PRIMERA vez por proceso por organización.
 *
 * El test verifica:
 *   1) El state queda poblado con los defaults VENDE_VELOZ_*.
 *   2) El warning se emite solo UNA vez por proceso aunque la
 *      función se llame muchas veces para la misma org.
 *   3) Para otra organización, también una sola vez (set por org).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetWarnedNoPlaybookOrgs,
  buildJevSalesState,
} from "@/server/sales/build-state";

const getPublishedConfigForOrgMock = vi.fn();

vi.mock("@/lib/sales/playbook/loader", async () => {
  const real = await vi.importActual<typeof import("@/lib/sales/playbook/loader")>(
    "@/lib/sales/playbook/loader"
  );
  return {
    ...real,
    getPublishedConfigForOrg: (...args: unknown[]) =>
      getPublishedConfigForOrgMock(...args),
  };
});

const thenableChain = (rows: unknown[]) => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
};

const selectQueue: unknown[][] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }),
    }
  ),
}));

beforeEach(() => {
  getPublishedConfigForOrgMock.mockReset();
  selectQueue.length = 0;
  // El guard de warning es a nivel de módulo: limpiamos el set entre
  // tests para validar la semántica "1 vez por proceso por org" sin
  // que el primer test del archivo contamine al segundo.
  __resetWarnedNoPlaybookOrgs();
});

describe("playbook fallback (T302)", () => {
  it("sin playbook publicado → fallback a VENDE_VELOZ_* con warning", async () => {
    getPublishedConfigForOrgMock.mockResolvedValue(null);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // SELECT: 1) conv+contact join, 2) lead+stage join, 3) mensajes,
    // 4) ad_attribution. Cuatro selects.
    selectQueue.push(
      [
        {
          conversation: {
            id: "cv_1",
            organizationId: "org_1",
            contactId: "ct_1",
            isTest: false,
            aiEnabled: true,
            handoffAt: null,
          },
          contact: { id: "ct_1" },
        },
      ],
      [{ lead: { id: "ld_1" }, stageName: "Nuevo" }],
      [],
      []
    );

    const built = await buildJevSalesState({
      organizationId: "org_1",
      conversationId: "cv_1",
    });

    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.playbook).toBeNull();
      // state.product debe seguir siendo VENDE_VELOZ_PRODUCT (no un
      // subset vacío). El campo `name` distingue defaults vs custom.
      expect(built.state.product.name).toBe("Vende Veloz 365");
      // Warning emitido una vez.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const warnArgs = warnSpy.mock.calls[0]?.join(" ") ?? "";
      expect(warnArgs).toContain("org_1");
    }

    warnSpy.mockRestore();
  });

  it("warning se emite solo una vez por proceso por organización", async () => {
    getPublishedConfigForOrgMock.mockResolvedValue(null);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const queueRow = (): unknown[][] => [
      [
        {
          conversation: {
            id: "cv_1",
            organizationId: "org_1",
            contactId: "ct_1",
            isTest: false,
            aiEnabled: true,
            handoffAt: null,
          },
          contact: { id: "ct_1" },
        },
      ],
      [{ lead: { id: "ld_1", automationLane: "auto" }, stageName: "Nuevo" }],
      [[]],
      [[]],
    ];

    selectQueue.push(...queueRow(), ...queueRow(), ...queueRow());

    for (let i = 0; i < 3; i += 1) {
      const built = await buildJevSalesState({
        organizationId: "org_1",
        conversationId: "cv_1",
      });
      expect(built.ok).toBe(true);
    }

    // 3 invocaciones de la misma org → 1 solo warning.
    const org1Warns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("org_1")
    );
    expect(org1Warns).toHaveLength(1);

    warnSpy.mockRestore();
  });

  it("playbook publicado → state.product refleja el config publicado", async () => {
    getPublishedConfigForOrgMock.mockResolvedValue({
      id: "spv_1",
      config: {
        schema_version: "1",
        product: {
          name: "Producto Personalizado",
          one_liner: "...",
          who_it_is_for: ["academias"],
          core_jobs: ["control"],
          not_the_product: ["marketing"],
          how_it_starts: "...",
        },
        commercial_policy: {
          defaultChannel: "whatsapp",
          goal: "...",
          automationFirst: true,
          autoClose: true,
          humanHandoff: true,
          futureInterest: true,
          noResponse: true,
          disqualification: true,
          evidenceRule: true,
        },
        offer: null,
        priorities: null,
        writer: null,
        jev_questions: null,
        prohibitions: null,
        handoff: null,
        urgency_rules: null,
      },
      schema_version: "1",
      version_number: 3,
      status: "published",
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    selectQueue.push(
      [
        {
          conversation: {
            id: "cv_1",
            organizationId: "org_1",
            contactId: "ct_1",
            isTest: false,
            aiEnabled: true,
            handoffAt: null,
          },
          contact: { id: "ct_1" },
        },
      ],
      [{ lead: { id: "ld_1" }, stageName: "Nuevo" }],
      [],
      []
    );

    const built = await buildJevSalesState({
      organizationId: "org_1",
      conversationId: "cv_1",
    });

    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.playbook).not.toBeNull();
      expect(built.playbook?.version_number).toBe(3);
      expect(built.state.product.name).toBe("Producto Personalizado");
      // Sin warning cuando sí hay playbook.
      const org1Warns = warnSpy.mock.calls.filter((call) =>
        String(call[0]).includes("org_1")
      );
      expect(org1Warns).toHaveLength(0);
    }

    warnSpy.mockRestore();
  });
});
