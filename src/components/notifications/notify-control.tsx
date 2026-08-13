"use client";

import { useEffect, useState } from "react";
import { Bell, Volume2, VolumeX } from "lucide-react";
import {
  isNotifySoundEnabled,
  readNotificationPermission,
  setNotifySoundEnabled,
} from "@/components/notifications/desktop";
import type { NotificationPermissionState } from "@/lib/notifications/inbound";

/**
 * Acción explícita para activar notificaciones. Nunca pide permiso al montar.
 */
export function NotifyPermissionControl() {
  const [permission, setPermission] =
    useState<NotificationPermissionState>("unsupported");
  const [sound, setSound] = useState(false);

  useEffect(() => {
    setPermission(readNotificationPermission());
    setSound(isNotifySoundEnabled());
  }, []);

  if (permission === "unsupported") return null;

  async function enable() {
    if (typeof Notification === "undefined") return;
    const next = await Notification.requestPermission();
    setPermission(next);
  }

  function toggleSound() {
    const next = !sound;
    setSound(next);
    setNotifySoundEnabled(next);
  }

  if (permission === "denied") {
    return (
      <p className="px-2 pt-1 text-[11px] text-text-3">
        Notificaciones bloqueadas en el navegador
      </p>
    );
  }

  if (permission === "default") {
    return (
      <button
        type="button"
        onClick={() => void enable()}
        className="mt-1 flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-[11px] font-medium text-text-2 hover:bg-accent hover:text-foreground"
      >
        <Bell className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
        Activar notificaciones
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleSound}
      title={sound ? "Silenciar sonido" : "Activar sonido"}
      className="mt-1 flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-[11px] font-medium text-text-3 hover:bg-accent hover:text-foreground"
    >
      {sound ? (
        <Volume2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
      ) : (
        <VolumeX className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
      )}
      {sound ? "Sonido de aviso" : "Sonido desactivado"}
    </button>
  );
}
