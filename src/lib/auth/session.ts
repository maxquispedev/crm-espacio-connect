import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { resolveMembership } from "@/server/auth/on-signup";

export type SessionContext = {
  userId: string;
  organizationId: string;
  role: string;
};

export class UnauthorizedError extends Error {
  constructor(message = "No autenticado") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Sesión + organización activa para route handlers y server components.
 * La org activa es `session.activeOrganizationId` de Better Auth, revalidada
 * contra `member`. Si falta o no es membership del usuario → primera membership.
 * Lanza UnauthorizedError si no hay sesión u organización.
 */
export async function requireSession(): Promise<SessionContext> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError();

  const userId = session.user.id;
  const activeOrganizationId = session.session.activeOrganizationId ?? null;

  // Revalidar siempre: no confiar solo en que setActive ya comprobó membership.
  if (activeOrganizationId) {
    const active = await resolveMembership(userId, activeOrganizationId);
    if (active) {
      return {
        userId,
        organizationId: active.organizationId,
        role: active.role,
      };
    }
  }

  // Fallback: primera membership (comportamiento histórico / org inválida o null).
  const membership = await resolveMembership(userId);
  if (!membership) {
    throw new UnauthorizedError("Sesión sin organización activa");
  }
  return {
    userId,
    organizationId: membership.organizationId,
    role: membership.role,
  };
}

/** Igual que requireSession pero devuelve null en vez de lanzar. */
export async function getSessionOrNull(): Promise<SessionContext | null> {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}
