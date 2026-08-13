import { and, count, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/** Etapas sembradas del pipeline (US2). */
const SEED_STAGES: { name: string; kind: "open" | "won" | "lost" }[] = [
  { name: "Nuevo", kind: "open" },
  { name: "En conversación", kind: "open" },
  { name: "Interesado", kind: "open" },
  { name: "Cliente", kind: "won" },
  { name: "Perdido", kind: "lost" },
];

export type CreateOrganizationWithDefaultsInput = {
  name: string;
  slug: string;
  ownerUserId: string;
};

/** Cliente de escritura compatible con `getDb()` y el `tx` de `transaction`. */
type DbWriter = {
  insert: ReturnType<typeof getDb>["insert"];
};

/**
 * Crea una organización nueva con membership owner, pipeline inicial y
 * agent_profile. Espera un `slug` aún no usado (no es upsert).
 *
 * Si se pasa `tx`, escribe en esa transacción; si no, abre una propia para
 * que la inicialización sea atómica.
 */
export async function createOrganizationWithDefaults(
  input: CreateOrganizationWithDefaultsInput,
  tx?: DbWriter
): Promise<{ organizationId: string }> {
  if (tx) {
    return insertOrganizationWithDefaults(tx, input);
  }
  return getDb().transaction((inner) =>
    insertOrganizationWithDefaults(inner, input)
  );
}

async function insertOrganizationWithDefaults(
  db: DbWriter,
  input: CreateOrganizationWithDefaultsInput
): Promise<{ organizationId: string }> {
  const organizationId = newId("organization");
  await db.insert(schema.organization).values({
    id: organizationId,
    name: input.name,
    slug: input.slug,
  });
  await db.insert(schema.member).values({
    id: newId("member"),
    organizationId,
    userId: input.ownerUserId,
    role: "owner",
  });
  await db.insert(schema.pipelineStage).values(
    SEED_STAGES.map((s, i) => ({
      id: newId("stage"),
      organizationId,
      name: s.name,
      position: i,
      kind: s.kind,
    }))
  );
  await db.insert(schema.agentProfile).values({
    id: newId("agentProfile"),
    organizationId,
  });
  return { organizationId };
}

/**
 * Primer registro de la instancia: crea la organización, deja al usuario como
 * propietario y siembra pipeline + perfil del agente.
 *
 * Solo actúa si NO existe ninguna organización (las cuentas de equipo las crea
 * el propietario y reciben su membresía explícita). Un advisory lock evita que
 * dos registros simultáneos en instancia vacía creen dos organizaciones.
 */
export async function onUserCreated(userId: string, userName: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    // Lock transaccional de "primer arranque" (clave arbitraria fija):
    // dos registros simultáneos en instancia vacía → solo uno crea la org.
    await tx.execute(sql`select pg_advisory_xact_lock(874201)`);
    const [orgs] = await tx
      .select({ n: count() })
      .from(schema.organization);
    if ((orgs?.n ?? 0) > 0) return;

    await createOrganizationWithDefaults(
      {
        name: userName ? `Negocio de ${userName}` : "Mi negocio",
        slug: "principal",
        ownerUserId: userId,
      },
      tx
    );
  });
}

/** Organización activa de un usuario (su primera membresía). */
export async function resolveActiveOrganizationId(
  userId: string
): Promise<string | null> {
  return (await resolveMembership(userId))?.organizationId ?? null;
}

export type Membership = {
  organizationId: string;
  role: string;
};

/**
 * Membresía del usuario. Si se pasa `organizationId`, exige coincidencia
 * exacta (userId + org) para revalidar la organización activa de sesión.
 * Sin `organizationId`, devuelve la primera membresía (fallback histórico).
 */
export async function resolveMembership(
  userId: string,
  organizationId?: string | null
): Promise<Membership | null> {
  const db = getDb();
  const condition = organizationId
    ? and(
        eq(schema.member.userId, userId),
        eq(schema.member.organizationId, organizationId)
      )
    : eq(schema.member.userId, userId);
  const rows = await db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
    })
    .from(schema.member)
    .where(condition)
    .limit(1);
  return rows[0] ?? null;
}
