import { beforeEach, describe, expect, it, vi } from "vitest";
import * as tables from "@/lib/db/schema";

/**
 * Extracción de createOrganizationWithDefaults / onUserCreated:
 * creación atómica de org + owner + stages + agent_profile, sin cambiar
 * el gate del primer signup.
 */

type OrgRow = { id: string; name: string; slug: string };
type MemberRow = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
};
type StageRow = {
  id: string;
  organizationId: string;
  name: string;
  position: number;
  kind: "open" | "won" | "lost";
};
type ProfileRow = { id: string; organizationId: string };

let organizations: OrgRow[] = [];
let members: MemberRow[] = [];
let stages: StageRow[] = [];
let profiles: ProfileRow[] = [];
/** Simula count(organization) dentro del gate de onUserCreated. */
let existingOrgCount = 0;

function insertFor(table: unknown) {
  return {
    values: (value: unknown) => {
      const rows = Array.isArray(value) ? value : [value];
      if (table === tables.organization) {
        organizations.push(...(rows as OrgRow[]));
      } else if (table === tables.member) {
        members.push(...(rows as MemberRow[]));
      } else if (table === tables.pipelineStage) {
        stages.push(...(rows as StageRow[]));
      } else if (table === tables.agentProfile) {
        profiles.push(...(rows as ProfileRow[]));
      }
      return Promise.resolve();
    },
  };
}

const tx = {
  execute: async () => undefined,
  select: () => ({
    from: () => Promise.resolve([{ n: existingOrgCount }]),
  }),
  insert: insertFor,
};

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      transaction: async <T>(fn: (executor: typeof tx) => Promise<T>) =>
        fn(tx),
      insert: insertFor,
    }),
  };
});

import {
  createOrganizationWithDefaults,
  onUserCreated,
} from "@/server/auth/on-signup";

const EXPECTED_STAGES: {
  name: string;
  kind: "open" | "won" | "lost";
  position: number;
}[] = [
  { name: "Nuevo", kind: "open", position: 0 },
  { name: "En conversación", kind: "open", position: 1 },
  { name: "Interesado", kind: "open", position: 2 },
  { name: "Cliente", kind: "won", position: 3 },
  { name: "Perdido", kind: "lost", position: 4 },
];

beforeEach(() => {
  organizations = [];
  members = [];
  stages = [];
  profiles = [];
  existingOrgCount = 0;
});

describe("createOrganizationWithDefaults", () => {
  it("crea org + owner + 5 stages + agent_profile con el mismo organizationId", async () => {
    const { organizationId } = await createOrganizationWithDefaults({
      name: "Vende Veloz 365",
      slug: "vende-veloz-365",
      ownerUserId: "user_owner",
    });

    expect(organizations).toHaveLength(1);
    expect(members).toHaveLength(1);
    expect(stages).toHaveLength(5);
    expect(profiles).toHaveLength(1);

    expect(organizations[0]).toMatchObject({
      id: organizationId,
      name: "Vende Veloz 365",
      slug: "vende-veloz-365",
    });
    expect(members[0]).toMatchObject({
      organizationId,
      userId: "user_owner",
      role: "owner",
    });
    expect(profiles[0]).toMatchObject({ organizationId });
    expect(stages.every((s) => s.organizationId === organizationId)).toBe(true);

    expect(
      [...stages]
        .sort((a, b) => a.position - b.position)
        .map((s) => ({ name: s.name, kind: s.kind, position: s.position }))
    ).toEqual(EXPECTED_STAGES);
  });
});

describe("onUserCreated", () => {
  it("no-op si ya existe una organización", async () => {
    existingOrgCount = 1;
    await onUserCreated("user_1", "Max");
    expect(organizations).toHaveLength(0);
    expect(members).toHaveLength(0);
    expect(stages).toHaveLength(0);
    expect(profiles).toHaveLength(0);
  });

  it("signup inicial: slug principal y naming actual, vía el helper", async () => {
    existingOrgCount = 0;
    await onUserCreated("user_1", "Max Quispe");

    expect(organizations).toHaveLength(1);
    expect(organizations[0]).toMatchObject({
      name: "Negocio de Max Quispe",
      slug: "principal",
    });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      userId: "user_1",
      role: "owner",
      organizationId: organizations[0]!.id,
    });
    expect(stages).toHaveLength(5);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.organizationId).toBe(organizations[0]!.id);
  });

  it("signup sin nombre de usuario → 'Mi negocio'", async () => {
    await onUserCreated("user_1", "");
    expect(organizations[0]).toMatchObject({
      name: "Mi negocio",
      slug: "principal",
    });
  });
});
