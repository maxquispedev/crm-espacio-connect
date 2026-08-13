import { describe, expect, it, vi } from "vitest";
import {
  parseCreateOrgArgs,
  runCreateOrgCommand,
  type CreateOrgCommandDeps,
} from "@/server/auth/create-org-command";

function deps(
  overrides: Partial<CreateOrgCommandDeps> = {}
): CreateOrgCommandDeps {
  return {
    findUserByEmail: vi.fn().mockResolvedValue({
      id: "user_1",
      email: "owner@example.com",
    }),
    findOrgBySlug: vi.fn().mockResolvedValue(null),
    createOrganizationWithDefaults: vi
      .fn()
      .mockResolvedValue({ organizationId: "org_new" }),
    ...overrides,
  };
}

describe("parseCreateOrgArgs", () => {
  it("exige owner-email, name y slug", () => {
    expect(() => parseCreateOrgArgs([])).toThrow(/--owner-email/);
    expect(() =>
      parseCreateOrgArgs(["--owner-email=a@b.com", "--name=X"])
    ).toThrow(/--slug/);
  });

  it("parsea los tres flags", () => {
    expect(
      parseCreateOrgArgs([
        '--owner-email=a@b.com',
        '--name=Vende Veloz 365',
        '--slug=vende-veloz-365',
      ])
    ).toEqual({
      ownerEmail: "a@b.com",
      name: "Vende Veloz 365",
      slug: "vende-veloz-365",
    });
  });
});

describe("runCreateOrgCommand", () => {
  it("usuario inexistente → aborta y no crea", async () => {
    const d = deps({
      findUserByEmail: vi.fn().mockResolvedValue(null),
    });
    const result = await runCreateOrgCommand(
      {
        ownerEmail: "missing@example.com",
        name: "Negocio",
        slug: "negocio",
      },
      d
    );
    expect(result).toEqual({
      status: "aborted",
      reason: "user_not_found",
      ownerEmail: "missing@example.com",
    });
    expect(d.createOrganizationWithDefaults).not.toHaveBeenCalled();
  });

  it("slug existente → skip sin llamar al creador ni modificar", async () => {
    const create = vi.fn();
    const d = deps({
      findOrgBySlug: vi.fn().mockResolvedValue({
        id: "org_existing",
        name: "Nombre Viejo",
        slug: "vende-veloz-365",
      }),
      createOrganizationWithDefaults: create,
    });
    const result = await runCreateOrgCommand(
      {
        ownerEmail: "owner@example.com",
        name: "Vende Veloz 365",
        slug: "vende-veloz-365",
      },
      d
    );
    expect(result).toMatchObject({
      status: "skipped",
      organizationId: "org_existing",
      existingName: "Nombre Viejo",
      nameMismatch: true,
      slug: "vende-veloz-365",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("slug libre → llama createOrganizationWithDefaults con args correctos", async () => {
    const create = vi.fn().mockResolvedValue({ organizationId: "org_new" });
    const d = deps({
      findUserByEmail: vi.fn().mockResolvedValue({
        id: "user_42",
        email: "owner@example.com",
      }),
      createOrganizationWithDefaults: create,
    });
    const result = await runCreateOrgCommand(
      {
        ownerEmail: "Owner@Example.com",
        name: "  Espacio Veloz  ",
        slug: " espacio-veloz ",
      },
      d
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      name: "Espacio Veloz",
      slug: "espacio-veloz",
      ownerUserId: "user_42",
    });
    expect(result).toEqual({
      status: "created",
      organizationId: "org_new",
      name: "Espacio Veloz",
      slug: "espacio-veloz",
      ownerEmail: "owner@example.com",
    });
  });

  it("conflicto de slug (name distinto) → skipped, nunca modifica", async () => {
    const create = vi.fn();
    const d = deps({
      findOrgBySlug: vi.fn().mockResolvedValue({
        id: "org_principal_like",
        name: "Otra cosa",
        slug: "mi-slug",
      }),
      createOrganizationWithDefaults: create,
    });
    const result = await runCreateOrgCommand(
      { ownerEmail: "owner@example.com", name: "Nuevo Nombre", slug: "mi-slug" },
      d
    );
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.nameMismatch).toBe(true);
      expect(result.existingName).toBe("Otra cosa");
    }
    expect(create).not.toHaveBeenCalled();
  });
});
