import { describe, expect, it, vi } from "vitest";
import {
  parseRenameOrgArgs,
  runRenameOrgCommand,
  type RenameOrgCommandDeps,
} from "@/server/auth/rename-org-command";

function deps(
  overrides: Partial<RenameOrgCommandDeps> = {}
): RenameOrgCommandDeps {
  return {
    findOrgBySlug: vi.fn().mockResolvedValue({
      id: "org_1",
      name: "Negocio de Max",
      slug: "principal",
    }),
    updateOrganizationName: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("parseRenameOrgArgs", () => {
  it("exige slug y name", () => {
    expect(() => parseRenameOrgArgs([])).toThrow(/--slug/);
    expect(() => parseRenameOrgArgs(["--slug=principal"])).toThrow(/--name/);
  });

  it("parsea los dos flags", () => {
    expect(
      parseRenameOrgArgs([
        "--slug=principal",
        '--name=Vende Veloz 365',
      ])
    ).toEqual({
      slug: "principal",
      name: "Vende Veloz 365",
    });
  });
});

describe("runRenameOrgCommand", () => {
  it("slug inexistente → error y ningún update", async () => {
    const update = vi.fn();
    const d = deps({
      findOrgBySlug: vi.fn().mockResolvedValue(null),
      updateOrganizationName: update,
    });
    const result = await runRenameOrgCommand(
      { slug: "no-existe", name: "Cualquiera" },
      d
    );
    expect(result).toEqual({
      status: "aborted",
      reason: "not_found",
      slug: "no-existe",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("nombre igual → no-op sin update", async () => {
    const update = vi.fn();
    const d = deps({
      findOrgBySlug: vi.fn().mockResolvedValue({
        id: "org_1",
        name: "Vende Veloz 365",
        slug: "principal",
      }),
      updateOrganizationName: update,
    });
    const result = await runRenameOrgCommand(
      { slug: "principal", name: "Vende Veloz 365" },
      d
    );
    expect(result).toEqual({
      status: "unchanged",
      organizationId: "org_1",
      slug: "principal",
      previousName: "Vende Veloz 365",
      name: "Vende Veloz 365",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("nombre distinto → update solo del name por id encontrado", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const d = deps({
      findOrgBySlug: vi.fn().mockResolvedValue({
        id: "org_abc",
        name: "Negocio de Max",
        slug: "principal",
      }),
      updateOrganizationName: update,
    });
    const result = await runRenameOrgCommand(
      { slug: " principal ", name: "  Vende Veloz 365  " },
      d
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("org_abc", "Vende Veloz 365");
    expect(result).toEqual({
      status: "renamed",
      organizationId: "org_abc",
      slug: "principal",
      previousName: "Negocio de Max",
      name: "Vende Veloz 365",
    });
  });
});
