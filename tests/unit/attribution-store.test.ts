import { describe, expect, it } from "vitest";
import {
  anuncioParaGuardar,
  anuncioDesdeRow,
  listaDesdeRow,
} from "@/lib/anuncios";
import type { AnuncioRowShape } from "@/lib/anuncios";

function row(opts: Partial<AnuncioRowShape> = {}): AnuncioRowShape {
  return {
    id: "adr_1",
    organizationId: "org_1",
    contactId: "ct_1",
    conversationId: "cv_1",
    ctwaClid: null,
    sourceId: "src_1",
    sourceType: "ad",
    sourceUrl: "https://x.com",
    headline: "Titular",
    body: null,
    mediaType: "image",
    raw: { source_url: "https://x.com" },
    imageAssetId: "ma_1",
    createdAt: new Date("2026-09-29T00:00:00Z"),
    ...opts,
  };
}

describe("006 — helpers de anuncios (DTO / persistencia)", () => {
  it("anuncioParaGuardar extrae solo lo persistible del normalizado", () => {
    const preparado = anuncioParaGuardar({
      sourceId: "sid",
      sourceType: "ad",
      sourceUrl: null,
      headline: "h",
      body: null,
      mediaType: null,
      imageUrl: null,
      ctwaClid: null,
      raw: { a: "b" },
    });
    expect(preparado).toEqual({
      ctwaClid: null,
      sourceId: "sid",
      sourceType: "ad",
      sourceUrl: null,
      headline: "h",
      body: null,
      mediaType: null,
      raw: { a: "b" },
    });
  });

  it("listaDesdeRow(null) → null y fila → subset reducido sin ctwa_clid", () => {
    expect(listaDesdeRow(null)).toBeNull();
    const dto = listaDesdeRow(row());
    expect(dto).toEqual({
      headline: "Titular",
      sourceId: "src_1",
      sourceType: "ad",
    });
  });

  it("anuncioDesdeRow REDUCE ctwa_clid a hasCtwaClid (boolean), nunca expone el valor", () => {
    const dtoCon = anuncioDesdeRow(row({ ctwaClid: "clid-secreto" }));
    expect(dtoCon).not.toBeNull();
    expect(dtoCon!.hasCtwaClid).toBe(true);
    // El valor jamás aparece en el DTO
    expect(JSON.stringify(dtoCon)).not.toContain("clid-secreto");

    const dtoSin = anuncioDesdeRow(row({ ctwaClid: null }));
    expect(dtoSin!.hasCtwaClid).toBe(false);

    const dtoEmpty = anuncioDesdeRow(null);
    expect(dtoEmpty).toBeNull();
  });

  it("capturedAt es ISO 8601", () => {
    const dto = anuncioDesdeRow(row({ createdAt: new Date("2026-01-02T03:04:05Z") }));
    expect(dto!.capturedAt).toBe("2026-01-02T03:04:05.000Z");
  });

  it("el DTO nunca incluye la clave cruda `ctwaClid` ni `raw`", () => {
    const dto = anuncioDesdeRow(row())!;
    expect(dto).not.toHaveProperty("ctwaClid");
    expect(dto).not.toHaveProperty("raw");
    // Y el campo se llama hasCtwaClid (boolean), no el valor
    expect(dto).toHaveProperty("hasCtwaClid");
  });
});
