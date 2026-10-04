import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 014 C7 — LA CABECERA DE PÁGINA, en un solo sitio.
 *
 * Antes cada pantalla tenía la suya y ninguna se parecían: Agenda usaba `h1` con
 * icono y `tracking-tight`, Pipeline y Contactos un `h2` pelado, y Configuración
 * otro `h2` pelado con otro padding. Con seis superficies distintas, "coherente"
 * era una aspiración y el rediseño tenía que repetirse seis veces (una por
 * pantalla, y la sexta se olvidaba). Aquí la jerarquía se declara una vez:
 *
 * 1. **título** — el nombre de la superficie, con su icono y su cuenta.
 * 2. **frase** — qué es esta pantalla y para qué, en una línea y en `text-3`:
 *    subordinada, nunca compitiendo con el título (FR-7.2).
 * 3. **acciones** — a la derecha, en el mismo ancho.
 *
 * No es un rediseño de arquitectura: es el mismo `header` que cada página ya
 * pintaba, con la misma estructura de flex, la misma franja `border-b` y el mismo
 * padding. Solo deja de haber cinco versiones.
 *
 * El `h1` lo usa esta cabecera y solo ella: una sola Cabecera por pantalla, como
 * manda la semántica de encabezados. La caja de la Bandeja es otra cosa —vive
 * dentro de un panel de 360 px, no es una página— y por eso NO usa este
 * componente: su título va en el tamaño de un panel, no de una página.
 */
export function PageHeader({
  title,
  icon: Icon,
  count,
  hint,
  actions,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  /** Contador a la derecha del título: "Bandeja 12". */
  count?: number;
  /** Una línea de contexto, subordinada al título. */
  hint?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        // 014 C8 — `flex-wrap` y padding que cede en pantallas estrechas: con
        // `justify-between` y las acciones con `shrink-0`, un móvil de 375 px
        // empujaba "Gestionar etapas" contra el título y los dos se comían.
        // Al envolver, las acciones bajan a su propia línea y el título conserva
        // el suyo entero. En `sm+` el resultado es idéntico al de CUT 7.
        "flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3.5 sm:px-6 sm:py-4",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          {Icon && <Icon className="h-5 w-5 shrink-0 text-text-3" strokeWidth={1.7} />}
          <span className="truncate">{title}</span>
          {count !== undefined && (
            <span className="text-base font-medium text-text-3">{count}</span>
          )}
        </h1>
        {hint && <p className="mt-0.5 text-xs text-text-3">{hint}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
