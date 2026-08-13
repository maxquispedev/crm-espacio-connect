import { z } from "zod";
import { exchangeOAuthCode, MetaApiError } from "@/lib/meta/client";
import {
  saveCredentials,
  tokenLast4,
} from "@/server/whatsapp/credentials";
import { subscribeAppToWaba, testConnection } from "@/server/whatsapp/connect";
import { requestCoexistenceSync } from "@/server/whatsapp/smb-app-data";

export const embeddedSignupBodySchema = z.object({
  code: z.string().trim().min(1),
  wabaId: z.string().trim().min(1),
  phoneNumberId: z.string().trim().min(1),
});

export type EmbeddedSignupBody = z.infer<typeof embeddedSignupBodySchema>;

export type EmbeddedSignupOk = {
  ok: true;
  displayPhoneNumber: string;
  verifiedName: string | null;
  tokenLast4: string;
};

export type EmbeddedSignupFail = {
  ok: false;
  status: number;
  code: string;
  message: string;
};

/**
 * Completa Embedded Signup para UNA organización (la de la sesión).
 * Orden: code→token → validar número → subscribed_apps (obligatorio) → guardar.
 * Si la suscripción falla, no persiste credenciales ni reporta "conectado".
 */
export async function completeEmbeddedSignup(input: {
  organizationId: string;
  code: string;
  wabaId: string;
  phoneNumberId: string;
}): Promise<EmbeddedSignupOk | EmbeddedSignupFail> {
  let token: string;
  try {
    token = await exchangeOAuthCode(input.code);
  } catch (err) {
    if (err instanceof MetaApiError) {
      const status = err.status === 0 || err.status >= 500 ? 503 : 422;
      return {
        ok: false,
        status,
        code: err.type === "configuration" ? "not_configured" : "oauth_failed",
        message:
          err.type === "configuration"
            ? "Embedded Signup no está configurado en el servidor (App ID / App Secret)."
            : "No se pudo canjear el código de Meta. Cierra el popup e intenta de nuevo.",
      };
    }
    throw err;
  }

  const check = await testConnection(input.phoneNumberId, token);
  if (!check.ok) {
    const status = check.code === "meta_unavailable" ? 503 : 422;
    return {
      ok: false,
      status,
      code: check.code,
      message: check.message,
    };
  }

  try {
    await subscribeAppToWaba(input.wabaId, token, { required: true });
  } catch (err) {
    const message =
      err instanceof MetaApiError
        ? "Meta rechazó la suscripción de la app a la cuenta de WhatsApp. El número no quedó conectado."
        : "No se pudo suscribir la app a la cuenta de WhatsApp. El número no quedó conectado.";
    return {
      ok: false,
      status: 422,
      code: "subscribe_failed",
      message,
    };
  }

  await saveCredentials({
    organizationId: input.organizationId,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    token,
    displayPhoneNumber: check.displayPhoneNumber,
    verifiedName: check.verifiedName,
  });

  // Best-effort: si Meta rechaza el sync, el número YA quedó conectado.
  // Debe ir DESPUÉS de saveCredentials para que los webhooks history/
  // smb_app_state_sync puedan enrutarse por phone_number_id.
  await requestCoexistenceSync({
    phoneNumberId: input.phoneNumberId,
    token,
  });

  return {
    ok: true,
    displayPhoneNumber: check.displayPhoneNumber,
    verifiedName: check.verifiedName,
    tokenLast4: tokenLast4(token),
  };
}
