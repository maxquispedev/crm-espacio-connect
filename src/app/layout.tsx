import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { cookies } from "next/headers";
import { accentCssVariables, DEFAULT_BRANDING } from "@/lib/branding";
import { getBranding } from "@/server/branding";
import {
  parseThemePreference,
  resolvedThemeFromCookies,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_COOKIE,
  THEME_RESOLVED_COOKIE,
} from "@/lib/theme";
import { cn } from "@/lib/utils";
import { ThemeSync } from "@/components/theme-sync";
import "./globals.css";

// next/font descarga la fuente en BUILD y la sirve self-hosted (sin CDN).
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  return {
    title: `${branding.name} — CRM de WhatsApp`,
    description: "CRM de WhatsApp con agente de IA y Laboratorio de auto-evaluación",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  const cookieStore = await cookies();
  const preference = parseThemePreference(cookieStore.get(THEME_COOKIE)?.value);
  const resolved = resolvedThemeFromCookies(
    preference,
    cookieStore.get(THEME_RESOLVED_COOKIE)?.value
  );

  return (
    <html
      lang="es"
      className={cn(geist.variable, resolved === "dark" && "dark")}
      suppressHydrationWarning
    >
      <head>
        {/* Antes del paint: resuelve `system` y evita flash del tema incorrecto. */}
        <script
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
        {/* Acento white-label inyectado en SSR: reglas light/dark, sin flash */}
        <style
          dangerouslySetInnerHTML={{ __html: accentCssVariables(branding.accent) }}
        />
      </head>
      <body className="font-sans">
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
