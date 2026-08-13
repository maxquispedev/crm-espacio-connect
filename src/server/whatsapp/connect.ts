import { graphRequest, MetaApiError } from "@/lib/meta/client";

export type ConnectionCheck =
  | {
      ok: true;
      displayPhoneNumber: string;
      verifiedName: string | null;
    }
  | { ok: false; code: "invalid_token" | "meta_unavailable" | "meta_error"; message: string };

/**
 * Valida token↔número contra la Graph API SIN persistir nada (FR-040):
 * un GET del número con el token debe devolver su display_phone_number.
 */
export async function testConnection(
  phoneNumberId: string,
  token: string
): Promise<ConnectionCheck> {
  try {
    const res = await graphRequest<{
      display_phone_number?: string;
      verified_name?: string;
      id: string;
    }>(`${phoneNumberId}?fields=display_phone_number,verified_name`, {
      token,
    });
    if (!res.display_phone_number) {
      return {
        ok: false,
        code: "meta_error",
        message:
          "Meta no devolvió el número: verifica que el Phone Number ID sea correcto",
      };
    }
    return {
      ok: true,
      displayPhoneNumber: res.display_phone_number,
      verifiedName: res.verified_name ?? null,
    };
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        return {
          ok: false,
          code: "invalid_token",
          message:
            "El token no es válido o expiró. Verifica que corresponde a este número (modo directo: token de usuario del sistema; modo agencia: token entregado por tu backend).",
        };
      }
      if (err.status === 0 || err.status >= 500) {
        return {
          ok: false,
          code: "meta_unavailable",
          message: "Meta no está disponible en este momento; intenta de nuevo",
        };
      }
      return { ok: false, code: "meta_error", message: err.message };
    }
    throw err;
  }
}

/**
 * Suscribe la app al webhook de la WABA (POST /{WABA_ID}/subscribed_apps).
 * Sin override_callback_uri: todas las orgs usan el webhook de la instancia.
 *
 * `required: true` (Embedded Signup): el fallo aborta el onboarding.
 * Por defecto best-effort: el PUT manual histórico no debe romper el guardado
 * si Meta rechaza la suscripción (modo agencia legado).
 */
export async function subscribeAppToWaba(
  wabaId: string,
  token: string,
  opts?: { required?: boolean }
): Promise<void> {
  try {
    await graphRequest(`${wabaId}/subscribed_apps`, {
      method: "POST",
      token,
    });
  } catch (err) {
    if (opts?.required) throw err;
    console.warn(
      "[connect] subscribed_apps falló (esperado en modo agencia):",
      err instanceof Error ? err.message : err
    );
  }
}
