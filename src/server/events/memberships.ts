import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Canales SSE autorizados: solo organizaciones donde el usuario es miembro.
 * Nunca se aceptan organization IDs del cliente.
 */

export type SseOrgChannel = {
  organizationId: string;
  name: string;
};

/**
 * Filtra filas de membership+org al usuario dado. Ignora tenants ajenos y
 * duplicados. Pura: el SQL ya restringe por userId; esta función es el
 * contrato testeable de aislamiento.
 */
export function channelsForUser(
  rows: readonly {
    userId: string;
    organizationId: string;
    name: string;
  }[],
  userId: string
): SseOrgChannel[] {
  const seen = new Set<string>();
  const out: SseOrgChannel[] = [];
  for (const row of rows) {
    if (row.userId !== userId) continue;
    if (!row.organizationId || seen.has(row.organizationId)) continue;
    seen.add(row.organizationId);
    out.push({ organizationId: row.organizationId, name: row.name });
  }
  return out;
}

/**
 * IDs a los que el stream SSE puede suscribirse.
 * `activeOrganizationId` debe ser ya una membership validada (requireSession);
 * no se añaden IDs que no vengan de memberships.
 */
export function resolveSseOrganizationIds(input: {
  membershipOrganizationIds: readonly string[];
  activeOrganizationId: string;
}): string[] {
  const ids = [
    ...new Set(
      input.membershipOrganizationIds.filter((id) => id.length > 0)
    ),
  ];
  if (ids.length === 0) return [input.activeOrganizationId];
  return ids;
}

/** Memberships reales del usuario (JOIN member → organization). */
export async function listUserOrganizationChannels(
  userId: string
): Promise<SseOrgChannel[]> {
  const db = getDb();
  const rows = await db
    .select({
      userId: schema.member.userId,
      organizationId: schema.member.organizationId,
      name: schema.organization.name,
    })
    .from(schema.member)
    .innerJoin(
      schema.organization,
      eq(schema.member.organizationId, schema.organization.id)
    )
    .where(eq(schema.member.userId, userId));
  return channelsForUser(rows, userId);
}
