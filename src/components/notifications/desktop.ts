"use client";

import { authClient } from "@/lib/auth/client";
import {
  inboxUrlForNotification,
  type NotificationPermissionState,
} from "@/lib/notifications/inbound";
import { switchActiveOrganization } from "@/lib/auth/switch-organization";

const SOUND_KEY = "vocero.notifySound";

export function readNotificationPermission(): NotificationPermissionState {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission;
}

export function isNotifySoundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(SOUND_KEY) === "true";
  } catch {
    return false;
  }
}

export function setNotifySoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, enabled ? "true" : "false");
  } catch {
    // storage bloqueado: ignorar
  }
}

/** Pitido corto. Si el navegador bloquea autoplay, no lanza. */
export function playNotifyBeep(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.07, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
    void ctx.resume().catch(() => {});
  } catch {
    // autoplay / AudioContext no disponible
  }
}

export function showDesktopNotification(input: {
  title: string;
  body: string;
  tag: string;
  organizationId: string;
  contactId: string;
  currentOrganizationId: string;
}): void {
  if (typeof Notification === "undefined") return;
  try {
    const n = new Notification(input.title, {
      body: input.body,
      tag: input.tag,
      silent: true,
    });
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        // sin ventana
      }
      n.close();
      void openInboxFromNotification({
        organizationId: input.organizationId,
        contactId: input.contactId,
        currentOrganizationId: input.currentOrganizationId,
      });
    };
  } catch {
    // Notification constructor puede fallar sin permiso real
  }
}

/**
 * Reutiliza setActive + recarga hacia `/inbox?contact=`.
 * No inventa un selector de organización paralelo.
 */
export async function openInboxFromNotification(input: {
  organizationId: string;
  contactId: string;
  currentOrganizationId: string;
}): Promise<void> {
  const dest = inboxUrlForNotification(input.contactId);
  const go = () => {
    window.location.assign(dest);
  };
  if (input.organizationId === input.currentOrganizationId) {
    go();
    return;
  }
  await switchActiveOrganization({
    currentOrganizationId: input.currentOrganizationId,
    selectedId: input.organizationId,
    setActive: (args) => authClient.organization.setActive(args),
    reload: go,
  });
}
