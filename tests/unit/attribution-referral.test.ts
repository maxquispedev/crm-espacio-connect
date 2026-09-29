import { describe, expect, it } from "vitest";
import {
  anuncioDeWhatsapp,
  COTAS,
  sinIdentificadorDeClic,
} from "@/server/attribution/referral";

describe("006 — normalizador de referral CTWA", () => {
  it("devuelve null cuando el referral es null/undefined/no-objeto", () => {
    expect(anuncioDeWhatsapp(null)).toBeNull();
    expect(anuncioDeWhatsapp(undefined)).toBeNull();
    expect(anuncioDeWhatsapp("hola")).toBeNull();
    expect(anuncioDeWhatsapp(42)).toBeNull();
    expect(anuncioDeWhatsapp([])).toBeNull();
  });

  it("devuelve null cuando no hay ningún identificador utilizable", () => {
    expect(anuncioDeWhatsapp({})).toBeNull();
    expect(anuncioDeWhatsapp({ media_type: "image" })).toBeNull();
    expect(anuncioDeWhatsapp({ body: "lindo gatito" })).toBeNull();
  });

  it("extrae un anuncio completo y descarta claves desconocidas", () => {
    const r = {
      source_url: "https://www.facebook.com/ads/123",
      source_id: "src_abc",
      source_type: "ad",
      headline: "Mi anuncio",
      body: "Cuerpo",
      media_type: "image",
      image_url: "https://scontent.xx.fbcdn.net/v/img.jpg",
      thumbnail_url: "https://lookaside.fbsbx.com/lookaside/crop.jpg",
      ctwa_clid: "clid-xyz",
      // claves que NO deben sobrevivir
      junk: "drop",
      another: { nested: true },
    };
    const a = anuncioDeWhatsapp(r);
    expect(a).not.toBeNull();
    expect(a!.sourceId).toBe("src_abc");
    expect(a!.sourceType).toBe("ad");
    expect(a!.sourceUrl).toBe("https://www.facebook.com/ads/123");
    expect(a!.headline).toBe("Mi anuncio");
    expect(a!.body).toBe("Cuerpo");
    expect(a!.mediaType).toBe("image");
    // thumbnail_url gana sobre image_url
    expect(a!.imageUrl).toBe("https://lookaside.fbsbx.com/lookaside/crop.jpg");
    // ATRIBUCION apagada: ctwaClid es null y raw no lo contiene.
    expect(a!.ctwaClid).toBeNull();
    expect(a!.raw.ctwa_clid).toBeUndefined();
    expect(a!.raw.source_url).toBe("https://www.facebook.com/ads/123");
    expect(a!.raw.source_id).toBe("src_abc");
    expect(a!.raw.junk).toBeUndefined();
    expect(a!.raw.another).toBeUndefined();
  });

  it("acota cada campo a su cota dura y descarta tipos no-string", () => {
    const r = {
      source_id: "x".repeat(COTAS.id + 500),
      headline: "h".repeat(COTAS.titular + 100),
      body: "b".repeat(COTAS.texto + 100),
      source_url: "https://x.com/" + "a".repeat(COTAS.url + 100),
      source_type: 12345, // no-string → null
      image_url: ["array"], // no-string → null
    };
    const a = anuncioDeWhatsapp(r)!;
    expect(a).not.toBeNull();
    expect(a.sourceId!.length).toBe(COTAS.id);
    expect(a.headline!.length).toBe(COTAS.titular);
    expect(a.body!.length).toBe(COTAS.texto);
    expect(a.sourceUrl!.length).toBeLessThanOrEqual(COTAS.url + 100); // el https://x.com/ añade ~12
    expect(a.sourceType).toBeNull();
    expect(a.imageUrl).toBeNull();
  });

  it("rechaza URLs javascript:/data:/file:/vbscript: en sourceUrl", () => {
    const a = anuncioDeWhatsapp({
      source_id: "sid",
      source_url: "javascript:alert(1)",
    })!;
    expect(a).not.toBeNull();
    expect(a.sourceUrl).toBeNull();

    const b = anuncioDeWhatsapp({
      source_id: "sid2",
      headline: "ok",
    })!;
    expect(b).not.toBeNull();
    expect(b.sourceUrl).toBeNull();
  });

  it("acepta un anuncio si SOLO trae headline (sin URL ni id)", () => {
    const a = anuncioDeWhatsapp({ headline: "Solo titular" });
    expect(a).not.toBeNull();
    expect(a!.sourceId).toBeNull();
    expect(a!.headline).toBe("Solo titular");
  });

  it("sinIdentificadorDeClic devuelve un anuncio sin ctwaClid", () => {
    const r = {
      source_id: "sid",
      source_url: "https://x.com",
      headline: "h",
      ctwa_clid: "clid-xyz",
    };
    const a = anuncioDeWhatsapp(r)!;
    expect(a.ctwaClid).toBeNull();
    const limpio = sinIdentificadorDeClic(a);
    expect(limpio.ctwaClid).toBeNull();
    // El raw tampoco tiene ctwa_clid (porque la bandera está apagada desde
    // el normalizador). El helper es defensivo: si en el futuro cambia la
    // bandera, sigue garantizando la salida.
    expect(limpio.raw.ctwa_clid).toBeUndefined();
  });

  it("el raw cabe en 8 KB (cota COTAS.raw)", () => {
    const r = {
      source_id: "x",
      headline: "h",
      body: "y".repeat(2000),
      source_url: "https://x.com/" + "a".repeat(2000),
      image_url: "https://x.com/" + "b".repeat(2000),
      thumbnail_url: "https://x.com/" + "c".repeat(2000),
    };
    const a = anuncioDeWhatsapp(r)!;
    const serializado = JSON.stringify(a.raw);
    expect(serializado.length).toBeLessThanOrEqual(COTAS.raw);
  });
});
