import { describe, expect, it } from "vitest";
import {
  channelsForUser,
  resolveSseOrganizationIds,
} from "@/server/events/memberships";
import { publish, subscribeMany } from "@/server/events/bus";
import type { SseEvent } from "@/server/events/bus";

describe("channelsForUser", () => {
  const rows = [
    { userId: "u1", organizationId: "org_a", name: "Vende Veloz" },
    { userId: "u1", organizationId: "org_b", name: "Espacio Veloz" },
    { userId: "u2", organizationId: "org_c", name: "Ajena" },
    { userId: "u1", organizationId: "org_a", name: "Vende Veloz" },
  ];

  it("solo memberships del usuario, sin duplicados ni orgs ajenas", () => {
    expect(channelsForUser(rows, "u1")).toEqual([
      { organizationId: "org_a", name: "Vende Veloz" },
      { organizationId: "org_b", name: "Espacio Veloz" },
    ]);
  });

  it("usuario sin filas → lista vacía (no inventa canales)", () => {
    expect(channelsForUser(rows, "u9")).toEqual([]);
  });
});

describe("resolveSseOrganizationIds", () => {
  it("usa las memberships, no un id arbitrario de cliente", () => {
    expect(
      resolveSseOrganizationIds({
        membershipOrganizationIds: ["org_a", "org_b"],
        activeOrganizationId: "org_a",
      })
    ).toEqual(["org_a", "org_b"]);
  });

  it("sin memberships listadas → fallback a la org ya validada de sesión", () => {
    expect(
      resolveSseOrganizationIds({
        membershipOrganizationIds: [],
        activeOrganizationId: "org_a",
      })
    ).toEqual(["org_a"]);
  });

  it("no añade la org activa si no está en memberships (no hay parámetro extra)", () => {
    const ids = resolveSseOrganizationIds({
      membershipOrganizationIds: ["org_b"],
      activeOrganizationId: "org_b",
    });
    expect(ids).toEqual(["org_b"]);
    expect(ids).not.toContain("org_x");
  });
});

describe("subscribeMany aislamiento entre organizaciones", () => {
  it("el listener no recibe eventos de canales a los que no se suscribió", () => {
    const received: string[] = [];
    const unsub = subscribeMany(["org_a", "org_b"], (event: SseEvent) => {
      if (event.type === "conversation.updated") {
        received.push(
          (event.data.conversation as { id?: string }).id ?? event.type
        );
      }
    });
    publish("org_a", {
      type: "conversation.updated",
      data: { conversation: { id: "from-a" } },
    });
    publish("org_c", {
      type: "conversation.updated",
      data: { conversation: { id: "from-c" } },
    });
    publish("org_b", {
      type: "conversation.updated",
      data: { conversation: { id: "from-b" } },
    });
    unsub();
    expect(received).toEqual(["from-a", "from-b"]);
  });
});
