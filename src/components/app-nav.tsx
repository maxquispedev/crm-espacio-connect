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
import type { AgendaDto } from "@/lib/types";
import { vencidosDeAgenda } from "@/lib/operational-state";
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
 * 013 C4 — Los contadores del nav son la longitud de un listado YA calculado: el
 * de no leídas sale de la lista de conversaciones y el de vencidos del grupo
 * `overdue` que el servidor agrupó para la Agenda. Por eso el número del nav y el
 * chip de "Por atender" no pueden discrepar: un recordatorio vencido está en los
 * dos sitios por definición, no por dos cálculos que puedan separarse.
 */
const NAV = [
  { href: "/inbox", label: "Bandeja", icon: Inbox, badge: "no_leidas" as const },
  // Agenda de recordatorios humanos. Superficie PROPIA, no una pestaña más de la
  // Bandeja: agrupa compromisos con fecha, no mensajes (013 C3). Su contador es el
  // de VENCIDOS, que es el único grupo que vuelve a ser trabajo de hoy; lo que
  // todavía no toca no es urgencia, y sumarlo aquí mezclaría "¿qué hago ahora?"
  // con "¿qué tengo para después?" (FR-4.3).
  { href: "/agenda", label: "Agenda", icon: CalendarClock, badge: "vencidos" as const },
  { href: "/pipeline", label: "Pipeline", icon: Kanban, badge: null },
  { href: "/contacts", label: "Contactos", icon: Users, badge: null },
  { href: "/agent", label: "Agente", icon: Sparkles, badge: null },
  { href: "/lab", label: "Laboratorio", icon: FlaskConical, badge: null },
] as const;

type Contadores = { no_leidas: number; vencidos: number };

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
    no_leidas: 0,
    vencidos: 0,
  });

  const seenInboundIds = useRef(new Set<string>());

  /**
   * Un solo refetch para los dos contadores, en paralelo e independientes: si la
   * Agenda falla, el contador de no leídas sigue siendo correcto (y al revés). Un
   * `await` en cadena dejaría el primer número congelado cada vez que el segundo
   * endpoint fallara, que es justo el camino infeliz que no puede romper la
   * navegación.
   *
   * No hay temporizador: los contadores se refrescan al montar y con cada evento
   * SSE, igual que el badge de no leídas que ya existía. Un recordatorio que
   * vence solo se ve al siguiente evento o al cambiar de sección, y es
   * deliberado — un `setInterval` en el nav sería trabajo en background para
   * un número que la siguiente acción va a mover igual.
   */
  async function refetchContadores() {
    const [conversaciones, agenda] = await Promise.all([
      fetch("/api/conversations").catch(() => null),
      fetch("/api/reminders").catch(() => null),
    ]);
    const noLeidas = conversaciones?.ok
      ? await conversaciones
          .json()
          .then(
            (data: { conversations: { unreadCount: number }[] }) =>
              data.conversations.reduce((a, c) => a + c.unreadCount, 0)
          )
          .catch(() => null)
      : null;
    const vencidos = agenda?.ok
      ? await agenda
          .json()
          .then((data: unknown) => vencidosDeAgenda(data as AgendaDto))
          .catch(() => null)
      : null;
    if (noLeidas === null && vencidos === null) return;
    setContadores((prev) => ({
      no_leidas: noLeidas ?? prev.no_leidas,
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

      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
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
                  // `vencidos` va en el color de aviso: es un compromiso que ya
                  // tocaba, no un número informative como las no leídas.
                  className={cn(
                    "flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold",
                    active
                      ? "bg-brand text-white"
                      : item.badge === "vencidos"
                        ? "bg-danger-soft text-danger-text"
                        : "bg-border-strong text-text-2"
                  )}
                  data-testid={`nav-contador-${item.badge}`}
                >
                  {contadores[item.badge]}
                </span>
              )}
            </Link>
          );
        })}
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
