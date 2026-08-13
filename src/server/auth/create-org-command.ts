import type { createOrganizationWithDefaults } from "@/server/auth/on-signup";

export type CreateOrgCommandInput = {
  ownerEmail: string;
  name: string;
  slug: string;
};

export type CreateOrgCommandResult =
  | {
      status: "created";
      organizationId: string;
      name: string;
      slug: string;
      ownerEmail: string;
    }
  | {
      status: "skipped";
      organizationId: string;
      name: string;
      slug: string;
      ownerEmail: string;
      existingName: string;
      nameMismatch: boolean;
    }
  | {
      status: "aborted";
      reason: "user_not_found";
      ownerEmail: string;
    };

export type CreateOrgCommandDeps = {
  findUserByEmail: (
    email: string
  ) => Promise<{ id: string; email: string } | null>;
  findOrgBySlug: (
    slug: string
  ) => Promise<{ id: string; name: string; slug: string } | null>;
  createOrganizationWithDefaults: typeof createOrganizationWithDefaults;
};

/**
 * One-shot: crea una organización adicional completa para un usuario existente.
 * Idempotencia: si el slug ya existe → skip (nunca modifica la org existente).
 */
export async function runCreateOrgCommand(
  input: CreateOrgCommandInput,
  deps: CreateOrgCommandDeps
): Promise<CreateOrgCommandResult> {
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const name = input.name.trim();
  const slug = input.slug.trim();

  const user = await deps.findUserByEmail(ownerEmail);
  if (!user) {
    return { status: "aborted", reason: "user_not_found", ownerEmail };
  }

  const existing = await deps.findOrgBySlug(slug);
  if (existing) {
    return {
      status: "skipped",
      organizationId: existing.id,
      name,
      slug: existing.slug ?? slug,
      ownerEmail: user.email,
      existingName: existing.name,
      nameMismatch: existing.name !== name,
    };
  }

  const { organizationId } = await deps.createOrganizationWithDefaults({
    name,
    slug,
    ownerUserId: user.id,
  });

  return {
    status: "created",
    organizationId,
    name,
    slug,
    ownerEmail: user.email,
  };
}

/** Parsea `--owner-email=`, `--name=`, `--slug=` desde argv. */
export function parseCreateOrgArgs(argv: string[]): CreateOrgCommandInput {
  const get = (key: string): string | undefined => {
    const prefix = `--${key}=`;
    const hit = argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };

  const ownerEmail = get("owner-email")?.trim();
  const name = get("name")?.trim();
  const slug = get("slug")?.trim();

  const missing: string[] = [];
  if (!ownerEmail) missing.push("--owner-email");
  if (!name) missing.push("--name");
  if (!slug) missing.push("--slug");
  if (missing.length > 0) {
    throw new Error(
      `Faltan argumentos obligatorios: ${missing.join(", ")}\n` +
        `Uso: pnpm org:create --owner-email=user@dominio.com --name="Mi negocio" --slug=mi-negocio`
    );
  }

  return { ownerEmail: ownerEmail!, name: name!, slug: slug! };
}
