"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import type { Branding } from "@/lib/branding";
import { AppNav } from "@/components/app-nav";
import { cn } from "@/lib/utils";

/**
 * 014 C8 — El SHELL que hace la app usable también en un móvil (FR-8.1).
 *
 * Antes de este corte el `<aside>` era `w-56 shrink-0` dentro de una fila: 224 px
 * fijos de navegación antes de la primera columna de contenido. En un móvil de
 * 375 px eso deja 151 px, y la Bandeja encima pedía otros 360 px de lista: el
 * producto, que vive en el móvil, era literalmente inusable por debajo de ~900 px
 * de ancho. "Escritorio primero" no significa "solo escritorio": significa que el
 * escritorio es la referencia y que el móvil tiene que poder hacer lo mismo.
 *
 * Aquí no se rediseña el nav: se le da una segunda forma. En `md+` sigue siendo la
 * columna fija de siempre, byte a byte igual. Por debajo, la columna se convierte
 * en un cajón (drawer) que entra desde la izquierda sobre un velo, con una barra
 * superior mínima que lleva la marca y el botón de abrir.
 *
 * Tres detalles que no son decoración:
 *
 * 1. **Cierra al navegar.** Un cajón que tapa la pantalla y sobrevive al clic en
 *    "Bandeja" parece un bug: el usuario navega y no ve pasar nada.
 * 2. **Cierra con Escape.** Es un diálogo superpuesto aunque no tenga `role`, y
 *    quien navega solo con teclado necesita salir sin puntero.
 * 3. **La marca se repite arriba.** En el cajón cerrado la marca solo existe en la
 *    barra: sin ella, un móvil en la Bandeja no dice de qué app se trata.
 */
export function AppShell({
  branding,
  organizationId,
  userName,
  role,
  children,
}: {
  branding: Branding;
  organizationId: string;
  userName: string;
  role: string;
  children: React.ReactNode;
}) {
  const [navAbierto, setNavAbierto] = useState(false);
  const pathname = usePathname();
  const botonRef = useRef<HTMLButtonElement>(null);

  // Navegar es la forma normal de cerrar el cajón: el destino ya está en pantalla.
  useEffect(() => {
    setNavAbierto(false);
  }, [pathname]);

  // Escape cierra y devuelve el foco al botón que lo abrió: sin esto, el foco se
  // queda en un enlace que ya no está visible y el teclado se queda sin salida.
  useEffect(() => {
    if (!navAbierto) return;
    const alPulsar = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setNavAbierto(false);
      botonRef.current?.focus();
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [navAbierto]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background md:flex-row">
      {/* Barra mínima de móvil: marca + abrir. `md:hidden` — en escritorio no existe. */}
      <div className="flex items-center gap-2.5 border-b bg-subtle px-3 py-2 md:hidden">
        <button
          ref={botonRef}
          type="button"
          data-testid="nav-abrir"
          aria-label="Abrir navegación"
          aria-expanded={navAbierto}
          aria-controls="app-nav-cajon"
          onClick={() => setNavAbierto(true)}
          className="rounded-sm p-1.5 text-text-2 transition-colors hover:bg-accent"
        >
          <Menu className="h-5 w-5" strokeWidth={1.7} />
        </button>
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-brand text-[13px] font-bold text-white"
          aria-hidden
        >
          {branding.name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 truncate text-[15px] font-[650] leading-tight tracking-tight">
          {branding.name}
        </span>
      </div>

      {/* El cajón: fijo sobre el contenido en móvil, columna normal en escritorio. */}
      <div
        id="app-nav-cajon"
        data-testid="nav-cajon"
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-56 shadow-pop transition-transform duration-200 md:static md:z-auto md:shrink-0 md:shadow-none",
          navAbierto ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        <AppNav
          branding={branding}
          organizationId={organizationId}
          userName={userName}
          role={role}
        />
      </div>

      {/* Velo: cierra el cajón al tocar fuera. No es decorativo, es la salida. */}
      {navAbierto && (
        <button
          type="button"
          data-testid="nav-velo"
          aria-label="Cerrar navegación"
          onClick={() => setNavAbierto(false)}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      )}

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
