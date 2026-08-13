import { describe, expect, it, vi } from "vitest";
import {
  mapOrganizationList,
  switchActiveOrganization,
} from "@/lib/auth/switch-organization";

describe("mapOrganizationList", () => {
  it("lista de una organización", () => {
    expect(
      mapOrganizationList([{ id: "org_a", name: "Vende Veloz 365", slug: "a" }])
    ).toEqual([{ id: "org_a", name: "Vende Veloz 365" }]);
  });

  it("lista de múltiples organizaciones", () => {
    expect(
      mapOrganizationList([
        { id: "org_a", name: "Vende Veloz 365" },
        { id: "org_b", name: "Espacio Veloz" },
      ])
    ).toEqual([
      { id: "org_a", name: "Vende Veloz 365" },
      { id: "org_b", name: "Espacio Veloz" },
    ]);
  });

  it("ignora filas inválidas y no inventa orgs", () => {
    expect(
      mapOrganizationList([
        { id: "org_a", name: "OK" },
        { id: 1, name: "bad" },
        { name: "sin-id" },
        null,
      ])
    ).toEqual([{ id: "org_a", name: "OK" }]);
  });
});

describe("switchActiveOrganization", () => {
  it("organización activa se identifica por organizationId (misma → no setActive)", async () => {
    const setActive = vi.fn();
    const reload = vi.fn();
    const result = await switchActiveOrganization({
      currentOrganizationId: "org_a",
      selectedId: "org_a",
      setActive,
      reload,
    });
    expect(result).toEqual({ action: "noop" });
    expect(setActive).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("selección distinta → setActive con el id correcto y reload", async () => {
    const setActive = vi.fn().mockResolvedValue({ data: { id: "org_b" } });
    const reload = vi.fn();
    const result = await switchActiveOrganization({
      currentOrganizationId: "org_a",
      selectedId: "org_b",
      setActive,
      reload,
    });
    expect(setActive).toHaveBeenCalledTimes(1);
    expect(setActive).toHaveBeenCalledWith({ organizationId: "org_b" });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ action: "reloaded" });
  });

  it("error de setActive → no ejecuta reload", async () => {
    const setActive = vi.fn().mockResolvedValue({
      error: { message: "No eres miembro" },
    });
    const reload = vi.fn();
    const result = await switchActiveOrganization({
      currentOrganizationId: "org_a",
      selectedId: "org_x",
      setActive,
      reload,
    });
    expect(result).toEqual({
      action: "error",
      message: "No eres miembro",
    });
    expect(reload).not.toHaveBeenCalled();
  });
});
