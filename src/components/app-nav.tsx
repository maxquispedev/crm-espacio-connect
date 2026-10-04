"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarClock,
  FlaskConical,
  Inbox,
  Kanban,
  LogOut,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import type { Branding } from "@/lib/branding";
import type { AgendaDto, ConversationDto } from "@/lib/types";
import { vencidosDeAgenda } from "@/lib/operational-state";
// 014 C7 — La definición de la cola se LLAMA, no se reimplementa: es la misma
// función pura que cuenta el chip de la Bandeja (`resumirBandeja` la usa), así que
// el badge del nav y el chip de "Por atender" son la misma operación leída dos
// veces (FR-2.7, FR-7.7).
import { necesitaAtencionAhora } from "@/components/inbox/bandeja-filtros";
import { cn, initials } from "@/lib/utils";
import { signOut } from "@/lib/auth/client";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { NotifyPermissionControl } from "@/components/notifications/notify-control";
import {
  isNotifySoundEnabled,
  playNotifyBeep,
  readNotificationPermission,
  showDesktopNotification,
} from "@/components/notifications/desktop";
import {
  decideInboundNotification,
  notificationFieldsFromEvent,
} from "@/lib/notifications/inbound";
import { useEvents } from "@/components/use-events";

/**
 * 014 C7 — El nav se organiza por PREGUNTA, no por superficie: primero lo que
 * decide el día ("qué tengo que hacer ahora" y "qué se me pasó") y después las
 * herramientas donde se configura. Seis items del mismo peso obligaban a leerlos
 * todos para encontrar la Bandeja; dos grupos lo dicen sin leer nada (FR-7.2).
 *
 * 013 C4 — Los contadores del nav son la longitud de un listado YA calculado: el
 * de la cola sale de la lista de conversaciones y el de vencidos del grupo
 * `overdue` que el servidor agrupó para la Agenda. Por eso el número del nav y el
 * chip de "Por atender" no pueden discrepar: salen de la MISMA lista con la MISMA
 * función (`necesitaAtencionAhora`), no de dos cálculos que puedan separarse.
 *
 * 014 C7 — El número de la Bandeja pasó de "no leídas" a la COLA. "No leídas"
 * respondía "¿qué no vi?", y casi siempre ya lo había contestado la IA; la pregunta
 * con la que arranca el día es "¿qué hago?". FR-7.7 pide que "Por atender" sea
 * evidente y, en el shell, no lo era en ninguna parte. Lo que se pierde no es
 * información: las no leídas siguen vivos como chip dentro de la propia Bandeja.
 */
const NAV: readonly {
  grupo: "trabajo" | "operacion";
  href: string;
  label: string;
  icon: typeof Inbox;
  badge: "por_atender" | "vencidos" | null;
}[] = [
  { grupo: "trabajo", href: "/inbox", label: "Bandeja", icon: Inbox, badge: "por_atender" },
  // Agenda de recordatorios humanos. Superficie PROPIA, no una pestaña más de la
  // Bandeja: agrupa compromisos con fecha, no mensajes (013 C3). Su contador es el
  // de VENCIDOS, que es el único grupo que vuelve a ser trabajo de hoy; lo que
  // todavía no toca no es urgencia, y sumarlo aquí mezclaría "¿qué hago ahora?"
  // con "¿qué tengo para después?" (FR-4.3).
  { grupo: "trabajo", href: "/agenda", label: "Agenda", icon: CalendarClock, badge: "vencidos" },
  { grupo: "operacion", href: "/pipeline", label: "Pipeline", icon: Kanban, badge: null },
  { grupo: "operacion", href: "/contacts", label: "Contactos", icon: Users, badge: null },
  { grupo: "operacion", href: "/agent", label: "Agente", icon: Sparkles, badge: null },
  { grupo: "operacion", href: "/lab", label: "Laboratorio", icon: FlaskConical, badge: null },
] as const;

const GRUPOS = [
  { id: "trabajo", label: "Tu trabajo" },
  { id: "operacion", label: "Operación" },
] as const;

type Contadores = { por_atender: number; vencidos: number };

export function AppNav({
  branding,
  organizationId,
  userName,
  role,
}: {
  branding: Branding;
  organizationId: string;
  userName: string;
  role: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [contadores, setContadores] = useState<Contadores>({
    por_atender: 0,
    vencidos: 0,
  });

  const seenInboundIds = useRef(new Set<string>());

  /**
   * Un solo refetch para los dos contadores, en paralelo e independientes: si la
   * Agenda falla, el contador de la cola sigue siendo correcto (y al revés). Un
   * `await` en cadena dejaría el primer número congelado cada vez que el segundo
   * endpoint fallara, que es justo el camino infeliz que no puede romper la
   * navegación.
   *
   * No hay temporizador: los contadores se refrescan al montar y con cada evento
   * SSE, igual que el badge que ya existía. Un recordatorio que vence solo se ve al
   * siguiente evento o al cambiar de sección, y es deliberado — un `setInterval` en
   * el nav sería trabajo en background para un número que la siguiente acción va a
   * mover igual.
   */
  async function refetchContadores() {
    const [conversaciones, agenda] = await Promise.all([
      fetch("/api/conversations").catch(() => null),
      fetch("/api/reminders").catch(() => null),
    ]);
    // 014 C7 — `necesitaAtencionAhora` es la MISMA función que usa el chip de la
    // Bandeja, sobre la MISMA lista. Por construcción el número del nav y el del
    // chip no pueden discrepar (FR-2.7); aquí no se reimplementa la definición de la
    // cola, se llama.
    const porAtender = conversaciones?.ok
      ? await conversaciones
          .json()
          .then(
            (data: { conversations: ConversationDto[] }) =>
              data.conversations.reduce(
                (a, c) => a + (necesitaAtencionAhora(c) ? 1 : 0),
                0
              )
          )
          .catch(() => null)
      : null;
    const vencidos = agenda?.ok
      ? await agenda
          .json()
          .then((data: unknown) => vencidosDeAgenda(data as AgendaDto))
          .catch(() => null)
      : null;
    if (porAtender === null && vencidos === null) return;
    setContadores((prev) => ({
      por_atender: porAtender ?? prev.por_atender,
      vencidos: vencidos ?? prev.vencidos,
    }));
  }

  useEffect(() => {
    void refetchContadores();
  }, []);

  useEvents({
    onMessageNew: (data) => {
      if (!data.organizationId || data.organizationId === organizationId) {
        void refetchContadores();
      }
      const fields = notificationFieldsFromEvent(data);
      const decision = decideInboundNotification({
        direction: fields.direction,
        messageId: fields.messageId,
        seenMessageIds: seenInboundIds.current,
        permission: readNotificationPermission(),
        tabVisible: document.visibilityState === "visible",
        activeOrganizationId: organizationId,
        eventOrganizationId: fields.organizationId,
        organizationName: fields.organizationName,
        contactName: fields.contactName,
        preview: fields.preview,
      });
      if (fields.direction === "in" && fields.messageId) {
        seenInboundIds.current.add(fields.messageId);
      }
      if (decision.action !== "notify") return;
      showDesktopNotification({
        title: decision.title,
        body: decision.body,
        tag: decision.tag,
        organizationId: fields.organizationId,
        contactId: fields.contactId,
        currentOrganizationId: organizationId,
      });
      if (isNotifySoundEnabled()) playNotifyBeep();
    },
    onConversationUpdated: () => void refetchContadores(),
  });

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-subtle px-3 pb-3.5 pt-4">
      {/* Brand white-label + selector de organización */}
      <div className="mb-4 px-2">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-sm bg-brand text-[15px] font-bold text-white"
            aria-hidden
          >
            {branding.name.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[16px] font-[650] leading-tight tracking-tight">
              {branding.name}
            </span>
            <span className="block text-[11px] text-text-3">CRM · WhatsApp</span>
          </span>
        </div>
        <OrganizationSwitcher organizationId={organizationId} />
        <NotifyPermissionControl />
      </div>

      <nav className="flex flex-col gap-4">
        {GRUPOS.map((grupo) => (
          <div key={grupo.id} className="flex flex-col gap-0.5">
            {/* 014 C7 — La etiqueta del grupo subordina la lista: se lee de un
                vistazo y no compite con los números, que son lo que hay que ver. */}
            <p className="px-2.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-text-4">
              {grupo.label}
            </p>
            {NAV.filter((item) => item.grupo === grupo.id).map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-[11px] rounded-sm px-2.5 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-brand-tint font-semibold text-brand-text"
                      : "text-text-2 hover:bg-accent"
                  )}
                >
                  <item.icon
                    className={cn("h-[18px] w-[18px]", active ? "text-brand" : "text-text-3")}
                    strokeWidth={1.7}
                  />
                  <span className="flex-1">{item.label}</span>
                  {item.badge && contadores[item.badge] > 0 && (
                    <span
                      // 014 C7 — Los dos números que quedan son TRABAJO, no
                      // información, así que los dos van en color de aviso siempre,
                      // incluso con la sección activa: antes `vencidos` solo se
                      // pintaba en rojo fuera de Agenda, y al entrar el número —que
                      // es justo lo que se abre a buscar— se volvía verde de marca.
                      // El sitio actual lo dice la fila con su tinte de marca.
                      //
                      // El `dark:` no es decoración: `--danger` es un rojo medio
                      // (#c46e6a) y el blanco encima se queda en 3.6:1, por debajo
                      // del 4.5:1 que pide un texto de 10.5 px. En oscuro el badge
                      // usa el tono suave, que sí pasa (6.6:1).
                      className={cn(
                        "flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold",
                        active
                          ? "bg-danger text-white dark:bg-danger-soft dark:text-danger-text"
                          : "bg-danger-soft text-danger-text"
                      )}
                      data-testid={`nav-contador-${item.badge}`}
                    >
                      {contadores[item.badge]}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex-1" />

      <Link
        href="/settings"
        className={cn(
          "flex items-center gap-[11px] rounded-sm px-2.5 py-2 text-sm font-medium transition-colors",
          pathname.startsWith("/settings")
            ? "bg-brand-tint font-semibold text-brand-text"
            : "text-text-2 hover:bg-accent"
        )}
      >
        <Settings
          className={cn(
            "h-[18px] w-[18px]",
            pathname.startsWith("/settings") ? "text-brand" : "text-text-3"
          )}
          strokeWidth={1.7}
        />
        Ajustes
      </Link>

      <div className="mt-1 flex items-center gap-2.5 rounded-sm px-2.5 py-2 hover:bg-accent">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-text">
          {initials(userName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{userName}</span>
          <span className="block text-[11px] text-text-3">
            {role === "owner" ? "Propietario" : "Equipo"} · En línea
          </span>
        </span>
        <button
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          className="rounded p-1 text-text-3 hover:text-foreground"
          onClick={async () => {
            await signOut();
            router.push("/login");
            router.refresh();
          }}
        >
          <LogOut className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>
    </aside>
  );
}
