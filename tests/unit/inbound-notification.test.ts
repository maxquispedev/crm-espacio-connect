import { describe, expect, it } from "vitest";
import {
  decideInboundNotification,
  formatNotificationTitle,
  inboxUrlForNotification,
} from "@/lib/notifications/inbound";

const base = {
  messageId: "msg_1",
  seenMessageIds: new Set<string>(),
  permission: "granted" as const,
  tabVisible: false,
  activeOrganizationId: "org_a",
  eventOrganizationId: "org_b",
  organizationName: "Espacio Veloz",
  contactName: "Ana",
  preview: "hola desde WhatsApp",
};

describe("decideInboundNotification", () => {
  it("inbound + permiso + pestaña oculta → notifica", () => {
    expect(
      decideInboundNotification({ ...base, direction: "in" })
    ).toEqual({
      action: "notify",
      title: "[Espacio Veloz] Ana",
      body: "hola desde WhatsApp",
      tag: "msg_1",
    });
  });

  it("outbound (composer o eco del celular) → no notifica", () => {
    expect(
      decideInboundNotification({ ...base, direction: "out" })
    ).toEqual({ action: "skip", reason: "outbound" });
  });

  it("mismo message.id → duplicate", () => {
    expect(
      decideInboundNotification({
        ...base,
        direction: "in",
        seenMessageIds: new Set(["msg_1"]),
      })
    ).toEqual({ action: "skip", reason: "duplicate" });
  });

  it("pestaña visible + misma org → no muestra Notification API", () => {
    expect(
      decideInboundNotification({
        ...base,
        direction: "in",
        tabVisible: true,
        eventOrganizationId: "org_a",
        activeOrganizationId: "org_a",
      })
    ).toEqual({ action: "skip", reason: "tab-visible" });
  });

  it("pestaña visible + otra org → sí notifica", () => {
    expect(
      decideInboundNotification({
        ...base,
        direction: "in",
        tabVisible: true,
        activeOrganizationId: "org_a",
        eventOrganizationId: "org_b",
      }).action
    ).toBe("notify");
  });

  it("permiso default o denied → no lanza Notification", () => {
    expect(
      decideInboundNotification({
        ...base,
        direction: "in",
        permission: "default",
      })
    ).toEqual({ action: "skip", reason: "no-permission" });
    expect(
      decideInboundNotification({
        ...base,
        direction: "in",
        permission: "denied",
      })
    ).toEqual({ action: "skip", reason: "no-permission" });
  });

  it("API ausente → unsupported, sin error", () => {
    expect(
      decideInboundNotification({
        ...base,
        direction: "in",
        permission: "unsupported",
      })
    ).toEqual({ action: "skip", reason: "unsupported" });
  });
});

describe("formato de notificación", () => {
  it("título [Organización] Contacto", () => {
    expect(formatNotificationTitle("Vende Veloz", "Max")).toBe(
      "[Vende Veloz] Max"
    );
  });

  it("click navega con el deep-link actual de inbox", () => {
    expect(inboxUrlForNotification("ct_abc")).toBe("/inbox?contact=ct_abc");
  });
});
