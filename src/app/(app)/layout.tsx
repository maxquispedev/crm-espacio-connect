import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getSessionOrNull } from "@/lib/auth/session";
import { getBranding } from "@/server/branding";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  const branding = await getBranding(session.organizationId);
  const authSession = await getAuth().api.getSession({
    headers: await headers(),
  });

  return (
    // 014 C8 — El shell (fila en escritorio, columna con cajón en móvil) vive en
    // `AppShell`: aquí solo se resuelve la sesión y se le pasan los datos.
    <AppShell
      branding={branding}
      organizationId={session.organizationId}
      userName={authSession?.user.name ?? "Usuario"}
      role={session.role}
    >
      {children}
    </AppShell>
  );
}
