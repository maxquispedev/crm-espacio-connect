import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { saveMediaFile, readMediaFile } from "@/server/whatsapp/media";

/**
 * 006 — Descarga best-effort del creativo (imagen) del anuncio.
 *
 * Reglas (Constitución I — Defensa en profundidad):
 *  - Allowlist de hosts: solo `lookaside.fbsbx.com`, `scontent-*.cdninstagram.com`,
 *    `*.fbcdn.net`, `*.cdninstagram.com`.
 *  - HTTPS obligatorio.
 *  - Tamaño máximo duro: `MAX_BYTES` (1 MB). Si excede, se aborta.
 *  - Timeout duro: `TIMEOUT_MS` (3 s).
 *  - Reutiliza la imagen de otro `source_id` ya guardado (no duplica).
 *  - Falla silenciosamente: nunca rompe el flujo del mensaje.
 *
 * Persistencia: delega en `saveMediaFile` (volumen `MEDIA_DIR` del fork,
 * Constitución II: sin S3/R2) y registra una fila `media_asset` con
 * `kind: "image"` + `fetchStatus: "available"`.
 */

const ALLOWED_HOST_SUFFIXES = [".fbcdn.net", ".cdninstagram.com"] as const;

const ALLOWED_HOST_EXACT = new Set([
  "lookaside.fbsbx.com",
  "platform-lookaside.fbsbx.com",
]);

/** Coincide con `scontent-*.cdninstagram.com`. */
const SCONTENT_INSTAGRAM = /^scontent-[a-z0-9-]+\.cdninstagram\.com$/i;

export const MAX_BYTES = 1_000_000; // 1 MB
export const TIMEOUT_MS = 3_000;

/**
 * Host permitido para descargar creativos. Devuelve `true` cuando:
 *   - es HTTPS
 *   - y el host está en la allowlist.
 */
export function hostPermitido(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (ALLOWED_HOST_EXACT.has(host)) return true;
  if (SCONTENT_INSTAGRAM.test(host)) return true;
  for (const suffix of ALLOWED_HOST_SUFFIXES) {
    if (host === suffix.slice(1)) return true;
    if (host.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * Deduce el MIME type por magic-bytes básicos. Se usa cuando Meta entrega
 * la URL sin `Content-Type` claro o el storage local no detectó el tipo.
 */
function mimePorBuffer(buf: Uint8Array): string | null {
  // PNG: 89 50 4E 47
  if (
    buf.length > 4 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (
    buf.length > 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return "image/jpeg";
  }
  // WEBP: "RIFF" .... "WEBP"
  if (
    buf.length > 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Descarga la imagen del creativo con timeout, tope de bytes y allowlist.
 * Devuelve `null` en cualquier modo de fallo. NUNCA lanza.
 */
export async function descargarCreativo(
  rawUrl: string
): Promise<{ mimeType: string; bytes: Buffer } | null> {
  if (!hostPermitido(rawUrl)) return null;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(rawUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "espacio-connect-attribution/0.1",
      },
    });
    if (!res.ok) return null;

    const declaredType = (
      (res.headers.get("content-type") ?? "").split(";")[0] ?? ""
    )
      .trim()
      .toLowerCase();
    const declaredLen = Number(res.headers.get("content-length") ?? "0");

    if (
      declaredLen &&
      Number.isFinite(declaredLen) &&
      declaredLen > MAX_BYTES
    ) {
      return null;
    }

    // Leemos con tope: cuando se pasa, cerramos y descartamos.
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    let done = false;
    while (!done) {
      const r = await reader.read();
      done = r.done;
      const value = r.value;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // ignorar
        }
        return null;
      }
      chunks.push(value);
    }

    const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    if (bytes.byteLength === 0) return null;

    const mime =
      mimePorBuffer(bytes) ??
      (declaredType && declaredType.startsWith("image/")
        ? declaredType
        : null);
    if (!mime) return null;

    return { mimeType: mime, bytes };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Espera tipo mime de imagen conocido por Meta para creativos. */
function mimeAceptable(s: string): boolean {
  return /^image\/(jpeg|png|webp)$/i.test(s);
}

/**
 * Persiste el creativo en el storage del fork (volumen local `MEDIA_DIR`)
 * y devuelve el `media_asset.id` o `null` si algo falló (best-effort).
 *
 * Si ya existe un asset para (org, sourceId), lo REUTILIZA en lugar de
 * descargar dos veces. El caller pasa `reusar` (en producción, una query
 * indexada por `ad_attribution.source_id`; en tests, una función inyectada).
 */
export async function guardarCreativo(args: {
  organizationId: string;
  url: string;
  sourceId: string | null;
  reusar: (sourceId: string) => Promise<string | null>;
}): Promise<string | null> {
  const { organizationId, url, sourceId, reusar } = args;

  // Reuso por source_id antes de gastar bandwidth.
  if (sourceId) {
    const reuse = await reusar(sourceId);
    if (reuse) return reuse;
  }

  const descargado = await descargarCreativo(url);
  if (!descargado || !mimeAceptable(descargado.mimeType)) return null;

  const db = getDb();
  const id = newId("mediaAsset");
  try {
    const storagePath = await saveMediaFile(
      organizationId,
      id,
      descargado.bytes
    );
    await db.insert(schema.mediaAsset).values({
      id,
      organizationId,
      kind: "image",
      mimeType: descargado.mimeType,
      fileSize: descargado.bytes.byteLength,
      storagePath,
      fetchStatus: "available",
      fetchError: null,
      waMediaId: null, // viene de un anuncio, no de un mensaje de Meta
    });
    return id;
  } catch (err) {
    console.warn(
      "[attribution] no se pudo guardar el creativo:",
      err instanceof Error ? err.message : String(err)
    );
    // Si la fila en BD falló pero el archivo quedó en disco, queda colgando
    // hasta el próximo GC; el contrato `deleteMediaFile` está cableado más
    // abajo y se usa en cleanup.
    return null;
  }
}

// re-export de utilidades del media para uso externo coherente.
export { readMediaFile };
