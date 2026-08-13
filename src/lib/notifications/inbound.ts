import type { MessageNewPayload } from "@/lib/types";

export type NotificationPermissionState =
  | "default"
  | "granted"
  | "denied"
  | "unsupported";

export type NotifyDecision =
  | {
      action: "notify";
      title: string;
      body: string;
      tag: string;
    }
  | {
      action: "skip";
      reason:
        | "outbound"
        | "duplicate"
        | "tab-visible"
        | "no-permission"
        | "unsupported";
    };

export function formatNotificationTitle(
  organizationName: string,
  contactName: string
): string {
  return `[${organizationName}] ${contactName}`;
}

export function inboxUrlForNotification(contactId: string): string {
  return `/inbox?contact=${encodeURIComponent(contactId)}`;
}

/**
 * Decide si un `message.new` debe generar notificación de escritorio.
 * Recuerda inbound (caller) aunque se omita por pestaña visible, para no
 * avisarlo al pasar a segundo plano después.
 */
export function decideInboundNotification(input: {
  direction: string;
  messageId: string;
  seenMessageIds: ReadonlySet<string>;
  permission: NotificationPermissionState;
  tabVisible: boolean;
  /** Org activa de la sesión (la que se está viendo). */
  activeOrganizationId: string;
  /** Org dueña del mensaje. */
  eventOrganizationId: string;
  organizationName: string;
  contactName: string;
  preview: string;
}): NotifyDecision {
  if (input.direction !== "in") {
    return { action: "skip", reason: "outbound" };
  }
  if (!input.messageId || input.seenMessageIds.has(input.messageId)) {
    return { action: "skip", reason: "duplicate" };
  }
  if (input.permission === "unsupported") {
    return { action: "skip", reason: "unsupported" };
  }
  if (input.permission !== "granted") {
    return { action: "skip", reason: "no-permission" };
  }
  // Pestaña visible + misma org: el operador ya está en ese CRM.
  // Otra org (pestaña visible o no): sí avisar — no sabemos la conversación
  // abierta y no acoplamos AppNav al hilo.
  if (
    input.tabVisible &&
    input.eventOrganizationId === input.activeOrganizationId
  ) {
    return { action: "skip", reason: "tab-visible" };
  }
  return {
    action: "notify",
    title: formatNotificationTitle(input.organizationName, input.contactName),
    body: input.preview,
    tag: input.messageId,
  };
}

/** Extrae los campos de notificación de un payload SSE, con fallbacks. */
export function notificationFieldsFromEvent(data: MessageNewPayload): {
  direction: string;
  messageId: string;
  organizationId: string;
  organizationName: string;
  contactId: string;
  contactName: string;
  preview: string;
} {
  return {
    direction: data.direction,
    messageId: data.messageId || data.message?.id || "",
    organizationId: data.organizationId,
    organizationName: data.organizationName,
    contactId: data.contactId,
    contactName: data.contactName,
    preview: data.preview,
  };
}
