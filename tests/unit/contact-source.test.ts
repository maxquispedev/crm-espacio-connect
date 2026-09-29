import { describe, expect, it } from "vitest";
import { effectiveSource } from "@/server/contact-source";
import type { AnuncioRowShape } from "@/lib/anuncios";

function row(opts: Partial<AnuncioRowShape> = {}): AnuncioRowShape {
  return {
    id: "adr_x",
    organizationId: "org_x",
    contactId: "ct_x",
    conversationId: "cv_x",
    ctwaClid: null,
    sourceId: "src_1",
    sourceType: "ad",
    sourceUrl: null,
    headline: null,
    body: null,
    mediaType: null,
    raw: {},
    imageAssetId: null,
    createdAt: new Date(),
    ...opts,
  };
}

describe("006 (US2) — effectiveSource", () => {
  it("lo capturado a mano manda (stored gana)", () => {
    expect(effectiveSource("whatsapp-direct", null)).toBe("whatsapp-direct");
    expect(
      effectiveSource("importado", row({ sourceType: "ad" }))
    ).toBe("importado");
    expect(
      effectiveSource("manual", row({ sourceType: "post" }))
    ).toBe("manual");
  });

  it("sin captura, un anuncio deduce 'anuncio'", () => {
    expect(effectiveSource(null, row({ sourceType: "ad" }))).toBe("anuncio");
    expect(effectiveSource("", row({ sourceType: "ad" }))).toBe("anuncio");
    expect(effectiveSource(undefined, row({ sourceType: "ad" }))).toBe(
      "anuncio"
    );
    // source_type desconocido: por defecto "anuncio"
    expect(effectiveSource(null, row({ sourceType: null }))).toBe("anuncio");
  });

  it("sin captura, una publicación deduce 'desconocida' (no cambia el badge)", () => {
    expect(effectiveSource(null, row({ sourceType: "post" }))).toBe(
      "desconocida"
    );
    expect(effectiveSource("", row({ sourceType: "post" }))).toBe(
      "desconocida"
    );
  });

  it("sin captura y sin anuncio deduce 'desconocida'", () => {
    expect(effectiveSource(null, null)).toBe("desconocida");
    expect(effectiveSource("", undefined)).toBe("desconocida");
  });

  it("trim del stored: vacío se trata como ausente", () => {
    expect(effectiveSource("   ", row({ sourceType: "ad" }))).toBe("anuncio");
  });
});
