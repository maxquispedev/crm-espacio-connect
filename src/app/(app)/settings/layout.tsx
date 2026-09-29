import { SettingsNav } from "@/components/settings/settings-nav";
import { isCapiEnabled } from "@/server/attribution/flag";

/**
 * 007 — Pestaña Anuncios se inyecta SOLO cuando la bandera ATRIBUCION está
 * encendida. Sin ATRIBUCION=on, ni el link se renderiza (404 duro en
 * /api/settings/capi* y superficie inexistente). El layout es server component
 * para leer `isCapiEnabled()` una vez por request sin exponer el flag al cliente.
 */
const BASE_TABS = [
  { href: "/settings/whatsapp", label: "WhatsApp" },
  { href: "/settings/branding", label: "Marca" },
  { href: "/settings/appearance", label: "Apariencia" },
  { href: "/settings/templates", label: "Plantillas" },
  { href: "/settings/team", label: "Equipo" },
] as const;

export default function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const tabs = isCapiEnabled()
    ? [...BASE_TABS, { href: "/settings/ads", label: "Anuncios" }]
    : [...BASE_TABS];

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-6 py-4">
        <h2 className="font-semibold">Configuración</h2>
      </header>
      <div className="flex min-h-0 flex-1">
        <SettingsNav tabs={tabs} />
        <div className="min-w-0 flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}
