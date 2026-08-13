import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * Resolución de tenant autenticado: activeOrganizationId de Better Auth
 * revalidada contra member, con fallback a la primera membership.
 */

type MemberRow = {
  userId: string;
  organizationId: string;
  role: string;
};

let members: MemberRow[] = [];

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: (condition: SQL) => ({
            limit: (n: number) => {
              const query = new PgDialect().sqlToQuery(condition);
              const matched = members.filter((m) => {
                if (!query.params.includes(m.userId)) return false;
                const orgBound = query.params.filter(
                  (p) => p !== m.userId && typeof p === "string"
                );
                if (orgBound.length === 0) return true;
                return orgBound.includes(m.organizationId);
              });
              return Promise.resolve(
                matched.slice(0, n).map(({ organizationId, role }) => ({
                  organizationId,
                  role,
                }))
              );
            },
          }),
        }),
      }),
    }),
  };
});

const getSession = vi.fn();

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: { getSession },
  }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

import { resolveMembership } from "@/server/auth/on-signup";
import {
  requireSession,
  UnauthorizedError,
} from "@/lib/auth/session";

beforeEach(() => {
  members = [];
  getSession.mockReset();
});

describe("resolveMembership", () => {
  it("sin organizationId → primera membership del usuario", async () => {
    members = [
      { userId: "u1", organizationId: "org_a", role: "owner" },
      { userId: "u1", organizationId: "org_b", role: "member" },
      { userId: "u2", organizationId: "org_c", role: "owner" },
    ];
    await expect(resolveMembership("u1")).resolves.toEqual({
      organizationId: "org_a",
      role: "owner",
    });
  });

  it("con organizationId → membership exacta userId + org", async () => {
    members = [
      { userId: "u1", organizationId: "org_a", role: "owner" },
      { userId: "u1", organizationId: "org_b", role: "member" },
    ];
    await expect(resolveMembership("u1", "org_b")).resolves.toEqual({
      organizationId: "org_b",
      role: "member",
    });
  });

  it("con organizationId ajena → null (no acepta tenant)", async () => {
    members = [
      { userId: "u1", organizationId: "org_a", role: "owner" },
    ];
    await expect(resolveMembership("u1", "org_x")).resolves.toBeNull();
  });

  it("usuario sin memberships → null", async () => {
    members = [
      { userId: "u2", organizationId: "org_a", role: "owner" },
    ];
    await expect(resolveMembership("u1")).resolves.toBeNull();
  });
});

describe("requireSession", () => {
  it("active org válida → esa organización y su role (misma fila)", async () => {
    members = [
      { userId: "u1", organizationId: "org_a", role: "owner" },
      { userId: "u1", organizationId: "org_b", role: "member" },
    ];
    getSession.mockResolvedValue({
      user: { id: "u1" },
      session: { activeOrganizationId: "org_b" },
    });

    await expect(requireSession()).resolves.toEqual({
      userId: "u1",
      organizationId: "org_b",
      role: "member",
    });
  });

  it("active org null → fallback a primera membership", async () => {
    members = [
      { userId: "u1", organizationId: "org_a", role: "owner" },
      { userId: "u1", organizationId: "org_b", role: "member" },
    ];
    getSession.mockResolvedValue({
      user: { id: "u1" },
      session: { activeOrganizationId: null },
    });

    await expect(requireSession()).resolves.toEqual({
      userId: "u1",
      organizationId: "org_a",
      role: "owner",
    });
  });

  it("active org inexistente / no membership → fallback, no acepta ese tenant", async () => {
    members = [
      { userId: "u1", organizationId: "org_a", role: "owner" },
    ];
    getSession.mockResolvedValue({
      user: { id: "u1" },
      session: { activeOrganizationId: "org_fantasma" },
    });

    await expect(requireSession()).resolves.toEqual({
      userId: "u1",
      organizationId: "org_a",
      role: "owner",
    });
  });

  it("sin memberships → UnauthorizedError", async () => {
    members = [];
    getSession.mockResolvedValue({
      user: { id: "u1" },
      session: { activeOrganizationId: "org_a" },
    });

    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("sin sesión Better Auth → UnauthorizedError", async () => {
    getSession.mockResolvedValue(null);
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("una sola organización → mismo resultado con active o fallback", async () => {
    members = [
      { userId: "u1", organizationId: "org_unica", role: "owner" },
    ];

    getSession.mockResolvedValue({
      user: { id: "u1" },
      session: { activeOrganizationId: "org_unica" },
    });
    const withActive = await requireSession();

    getSession.mockResolvedValue({
      user: { id: "u1" },
      session: { activeOrganizationId: null },
    });
    const withFallback = await requireSession();

    expect(withActive).toEqual(withFallback);
    expect(withActive).toEqual({
      userId: "u1",
      organizationId: "org_unica",
      role: "owner",
    });
  });
});
