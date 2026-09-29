"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string };

/**
 * 007 — La pestaña "Anuncios" se inyecta desde el layout server component
 * (que lee `isCapiEnabled()`), no se decide dentro de este client component,
 * porque no hay manera limpia de leer process.env del lado del cliente.
 */
export function SettingsNav({ tabs }: { tabs: readonly Tab[] }) {
  const pathname = usePathname();
  return (
    <nav className="w-44 shrink-0 space-y-1 border-r p-3">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith(t.href)
              ? "bg-brand-tint text-brand-text"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
