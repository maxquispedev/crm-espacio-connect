export type RenameOrgCommandInput = {
  slug: string;
  name: string;
};

export type RenameOrgCommandResult =
  | {
      status: "renamed";
      organizationId: string;
      slug: string;
      previousName: string;
      name: string;
    }
  | {
      status: "unchanged";
      organizationId: string;
      slug: string;
      previousName: string;
      name: string;
    }
  | {
      status: "aborted";
      reason: "not_found";
      slug: string;
    };

export type RenameOrgCommandDeps = {
  findOrgBySlug: (
    slug: string
  ) => Promise<{ id: string; name: string; slug: string } | null>;
  /** Actualiza únicamente `organization.name` de la fila con ese id. */
  updateOrganizationName: (
    organizationId: string,
    name: string
  ) => Promise<void>;
};

/**
 * One-shot: renombra el `name` visible de una organización identificada por slug.
 * No toca slug, memberships, metadata ni datos de dominio.
 */
export async function runRenameOrgCommand(
  input: RenameOrgCommandInput,
  deps: RenameOrgCommandDeps
): Promise<RenameOrgCommandResult> {
  const slug = input.slug.trim();
  const name = input.name.trim();

  const existing = await deps.findOrgBySlug(slug);
  if (!existing) {
    return { status: "aborted", reason: "not_found", slug };
  }

  if (existing.name === name) {
    return {
      status: "unchanged",
      organizationId: existing.id,
      slug: existing.slug,
      previousName: existing.name,
      name,
    };
  }

  await deps.updateOrganizationName(existing.id, name);

  return {
    status: "renamed",
    organizationId: existing.id,
    slug: existing.slug,
    previousName: existing.name,
    name,
  };
}

/** Parsea `--slug=` y `--name=` desde argv. */
export function parseRenameOrgArgs(argv: string[]): RenameOrgCommandInput {
  const get = (key: string): string | undefined => {
    const prefix = `--${key}=`;
    const hit = argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };

  const slug = get("slug")?.trim();
  const name = get("name")?.trim();

  const missing: string[] = [];
  if (!slug) missing.push("--slug");
  if (!name) missing.push("--name");
  if (missing.length > 0) {
    throw new Error(
      `Faltan argumentos obligatorios: ${missing.join(", ")}\n` +
        `Uso: pnpm org:rename --slug=mi-slug --name="Nuevo nombre"`
    );
  }

  return { slug: slug!, name: name! };
}
