/**
 * POST /api/playbook/validate — T204 (Corte 2, Feature 008).
 *
 * Recibe un documento de playbook completo (no patch) y devuelve
 * 200 `{ ok: true }` si pasa `ConfigSchema.safeParse` (con todas
 * las guardarraíles Jev del Corte 1, T103), o 422 `validation_failed`
 * con `details[]` si no.
 *
 * NO persiste nada. Es solo el "probar antes de pegar" del editor.
 * Tenant-safe: no toca BD; el body es del propio caller.
 */

import { withAuth } from "@/lib/api";
import { ConfigSchema } from "@/lib/sales/playbook/schema";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, request: Request) => {
  // El caller puede mandar `Content-Type: application/json` con el
  // documento entero o `{}`. Usamos `parseBody` con `z.unknown()` y
  // luego validamos contra `ConfigSchema` para reportar detalles
  // enriquecidos (no los genéricos de `parseBody`).
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json(
      { code: "bad_json", message: "Body no es JSON válido" },
      { status: 400 }
    );
  }

  // El handler de auth no se usa más allá del tenant; cualquier
  // usuario de la org puede validar (es solo CPU + Zod).
  void session;

  const result = ConfigSchema.safeParse(json);
  if (!result.success) {
    return Response.json(
      {
        code: "validation_failed",
        message: "El playbook no pasa las guardarraíles Jev",
        details: result.error.issues.map((i) => ({
          code:
            (i as unknown as { params?: { code?: string } }).params?.code ??
            i.code,
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 422 }
    );
  }

  return Response.json({ ok: true });
});
