/**
 * 005 — Tests de la helper pura `applyContactNamePatch`.
 * La helper vive en `src/components/inbox/conversation-patch.ts` y sincroniza
 * el nombre del contacto en el array de conversaciones del inbox sin refetch.
 * Cobertura: ver specs/005-quick-lead-name/tasks.md §T102.
 */
import { describe, expect, it } from "vitest";
import { applyContactNamePatch } from "../../src/components/inbox/conversation-patch";
import type { ConversationDto } from "../../src/lib/types";

function conv(
  id: string,
  name: string,
  phone: string | null = null,
  overrides: Partial<ConversationDto> = {}
): ConversationDto {
  return {
    id,
    contact: { id: `ct_${id}`, name, phone },
    stageName: "Nuevo",
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: "2026-09-29T10:00:00.000Z",
    lastMessageAt: "2026-09-29T10:00:00.000Z",
    unreadCount: 0,
    windowOpen: true,
    windowRemainingMs: 1000,
    preview: "hola",
    anuncio: null,
    ...overrides,
  };
}

describe("applyContactNamePatch", () => {
  it("reemplaza el `name` cuando el `contact.id` coincide", () => {
    const list: ConversationDto[] = [
      conv("cv_1", "5215511111111"),
      conv("cv_2", "Juan Pérez"),
      conv("cv_3", "bsuid:abc"),
    ];
    const result = applyContactNamePatch(list, { id: "ct_cv_2", name: "Juan P." });
    expect(result).toHaveLength(3);
    expect(result[0]?.contact.name).toBe("5215511111111");
    expect(result[1]?.contact.name).toBe("Juan P.");
    expect(result[2]?.contact.name).toBe("bsuid:abc");
  });

  it("devuelve la misma referencia cuando el id no aparece", () => {
    const list: ConversationDto[] = [conv("cv_1", "Ana"), conv("cv_2", "Beto")];
    const result = applyContactNamePatch(list, { id: "ct_inexistente", name: "X" });
    expect(result).toBe(list); // misma referencia → no render espurio
  });

  it("reemplaza TODAS las conversaciones con el mismo contact.id", () => {
    // Defensivo: el dominio no debería permitirlo, pero la helper no rompe.
    const list: ConversationDto[] = [
      conv("cv_1", "Ana"),
      conv("cv_2", "Ana"),
    ];
    const result = applyContactNamePatch(list, { id: "ct_cv_1", name: "Anita" });
    // Solo cv_1 debería matchear (contact.id = ct_cv_1).
    expect(result[0]?.contact.name).toBe("Anita");
    expect(result[1]?.contact.name).toBe("Ana");
  });

  it("no muta ni el array ni los ConversationDto originales", () => {
    const original = conv("cv_1", "Ana", "+5215511111111");
    const list: ConversationDto[] = [original];
    const snapshotArray = list;
    const snapshotContact = original.contact;
    const snapshotContactName = original.contact.name;
    applyContactNamePatch(list, { id: "ct_cv_1", name: "Anita" });
    expect(list).toBe(snapshotArray); // misma referencia
    expect(original.contact).toBe(snapshotContact); // mismo objeto
    expect(original.contact.name).toBe(snapshotContactName); // string intacto
    expect(list[0]?.contact.name).toBe("Ana"); // no mutado
  });

  it("con `name` idéntico al actual: devuelve array nuevo, distinta referencia", () => {
    const list: ConversationDto[] = [conv("cv_1", "Ana"), conv("cv_2", "Beto")];
    const result = applyContactNamePatch(list, { id: "ct_cv_1", name: "Ana" });
    expect(result).not.toBe(list);
    expect(result[0]?.contact.name).toBe("Ana");
    expect(result[1]?.contact.name).toBe("Beto");
  });

  it("preserva el resto de los campos de la conversación reemplazada", () => {
    const list: ConversationDto[] = [
      conv("cv_1", "Ana", "+5215511111111", {
        stageName: "Interesado",
        aiEnabled: false,
        handoffAt: "2026-09-29T10:00:00.000Z",
        handoffReason: "manual_reply",
        unreadCount: 3,
        windowOpen: false,
        windowRemainingMs: 0,
        preview: "último mensaje",
        lastMessageAt: "2026-09-29T11:00:00.000Z",
        lastInboundAt: "2026-09-29T10:30:00.000Z",
      }),
    ];
    const result = applyContactNamePatch(list, { id: "ct_cv_1", name: "Anita" });
    const c = result[0];
    expect(c).toBeDefined();
    expect(c?.contact.name).toBe("Anita");
    expect(c?.stageName).toBe("Interesado");
    expect(c?.aiEnabled).toBe(false);
    expect(c?.handoffAt).toBe("2026-09-29T10:00:00.000Z");
    expect(c?.handoffReason).toBe("manual_reply");
    expect(c?.unreadCount).toBe(3);
    expect(c?.windowOpen).toBe(false);
    expect(c?.windowRemainingMs).toBe(0);
    expect(c?.preview).toBe("último mensaje");
    expect(c?.lastMessageAt).toBe("2026-09-29T11:00:00.000Z");
    expect(c?.lastInboundAt).toBe("2026-09-29T10:30:00.000Z");
  });

  it("no afecta a conversaciones distintas cuando hay match parcial", () => {
    const list: ConversationDto[] = [
      conv("cv_1", "Ana"),
      conv("cv_2", "Beto"),
      conv("cv_3", "Carla"),
    ];
    const result = applyContactNamePatch(list, { id: "ct_cv_2", name: "Roberto" });
    expect(result[0]).toBe(list[0]); // misma referencia: sin match
    expect(result[1]).not.toBe(list[1]); // nueva referencia: match
    expect(result[1]?.contact.name).toBe("Roberto");
    expect(result[2]).toBe(list[2]); // misma referencia: sin match
  });

  it("tolera un array vacío", () => {
    const result = applyContactNamePatch([], { id: "ct_x", name: "X" });
    expect(result).toEqual([]);
  });

  it("reemplaza solo el campo `name` del contact, preserva id y phone", () => {
    const list: ConversationDto[] = [conv("cv_1", "Ana", "+5215511111111")];
    const result = applyContactNamePatch(list, { id: "ct_cv_1", name: "Anita" });
    expect(result[0]?.contact.id).toBe("ct_cv_1");
    expect(result[0]?.contact.phone).toBe("+5215511111111");
    expect(result[0]?.contact.name).toBe("Anita");
  });
});
