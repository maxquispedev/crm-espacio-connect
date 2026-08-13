/**
 * Lógica pura del selector de organización (testeable sin React/DOM).
 * Better Auth sigue siendo la fuente de verdad de list/setActive.
 */

export type OrgOption = {
  id: string;
  name: string;
};

export type SetActiveResult = {
  error?: { message?: string | null } | null;
};

/**
 * Normaliza la respuesta de `organization.list()` a opciones de UI.
 * Ignora entradas incompletas; nunca inventa organizaciones.
 */
export function mapOrganizationList(data: unknown): OrgOption[] {
  if (!Array.isArray(data)) return [];
  const out: OrgOption[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    const name = (row as { name?: unknown }).name;
    if (typeof id !== "string" || !id) continue;
    if (typeof name !== "string" || !name) continue;
    out.push({ id, name });
  }
  return out;
}

/**
 * Cambia la organización activa. Misma org → no-op.
 * Éxito → `reload()` (recarga completa intencional).
 * Error → no recarga; mensaje para la UI.
 */
export async function switchActiveOrganization(input: {
  currentOrganizationId: string;
  selectedId: string;
  setActive: (args: {
    organizationId: string;
  }) => Promise<SetActiveResult>;
  reload: () => void;
}): Promise<
  | { action: "noop" }
  | { action: "reloaded" }
  | { action: "error"; message: string }
> {
  if (input.selectedId === input.currentOrganizationId) {
    return { action: "noop" };
  }

  const result = await input.setActive({
    organizationId: input.selectedId,
  });

  if (result.error) {
    return {
      action: "error",
      message:
        result.error.message?.trim() ||
        "No se pudo cambiar de organización",
    };
  }

  input.reload();
  return { action: "reloaded" };
}
