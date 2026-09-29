import { mockGuard } from "@/lib/dev-guard";

/**
 * 006 — Binarios de creativo del wa-mock.
 *
 * El módulo `creativo` de 006 descarga la imagen desde la URL del `referral`
 * de Meta (allowlist de fbcdn/cdninstagram/lookaside.fbsbx.com). Para probar
 * ese flujo end-to-end sin red, este endpoint simula los creativos en hosts
 * permitidos por el runtime del test:
 *
 *   - creativo-ok      → 200 con un PNG válido de 1x1 (200 bytes aprox.)
 *   - creativo-grande  → 200 con un cuerpo que excede el tope (test del guard)
 *   - creativo-404     → 404 (test de fallo permanente)
 *   - creativo-503     → 503 (test de fallo transitorio)
 *   - creativo-timeout → 200 con un header `delay-ms` que el handler NO
 *                        respeta: en el runtime de test forzamos el
 *                        `AbortController` desde fuera. Aquí devolvemos 200
 *                        rápido para no colgar al gateway.
 *
 * El id de URL lo sirve el caller (`creativo/ok`, `creativo/404`, etc).
 * El path completo queda como `…/api/dev/wa-mock/media-file/creativo/ok`.
 */
export const dynamic = "force-dynamic";

const PNG_1x1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const guard = mockGuard();
  if (guard) return guard;
  const { id } = await ctx.params;

  switch (id) {
    case "ok":
      return new Response(PNG_1x1, {
        headers: { "content-type": "image/png" },
      });
    case "grande":
      // 2 MB de ceros: supera MAX_BYTES (1 MB) en el reader.
      return new Response(Buffer.alloc(2_000_000), {
        headers: { "content-type": "image/png" },
      });
    case "404":
      return new Response("not found", { status: 404 });
    case "503":
      return new Response("down", { status: 503 });
    case "timeout":
      // Nunca termina; el caller debe abortar antes de TIMEOUT_MS.
      return new Response(
        new ReadableStream({
          start(controller) {
            // No cierra nunca el stream: cuelga.
            void controller;
          },
        }),
        { headers: { "content-type": "image/png" } }
      );
    default:
      return new Response("creativo mock no encontrado", { status: 404 });
  }
}
