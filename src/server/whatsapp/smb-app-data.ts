import { graphRequest, MetaApiError } from "@/lib/meta/client";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";

/**
 * SMB App Data API: pide a Meta que empuje la agenda y/o el historial de la
 * WhatsApp Business App vía webhooks `smb_app_state_sync` / `history`.
 *
 * Solo se puede invocar una vez por onboarding, dentro de las 24 h. Un fallo
 * NO debe abortar la conexión (best-effort).
 */

export type SmbAppSyncType = "smb_app_state_sync" | "history";

export type SmbAppSyncAttempt = {
  ok: boolean;
  syncType: SmbAppSyncType;
  requestId: string | null;
  error?: string;
};

export type CoexistenceSyncResult = {
  contacts: SmbAppSyncAttempt;
  history: SmbAppSyncAttempt;
};

export async function requestSmbAppData(
  phoneNumberId: string,
  token: string,
  syncType: SmbAppSyncType
): Promise<{ requestId: string | null }> {
  const res = await graphRequest<{
    messaging_product?: string;
    request_id?: string;
  }>(`${phoneNumberId}/smb_app_data`, {
    method: "POST",
    token,
    body: {
      messaging_product: "whatsapp",
      sync_type: syncType,
    },
  });
  return { requestId: typeof res.request_id === "string" ? res.request_id : null };
}

async function trySync(
  phoneNumberId: string,
  token: string,
  syncType: SmbAppSyncType
): Promise<SmbAppSyncAttempt> {
  try {
    const { requestId } = await requestSmbAppData(phoneNumberId, token, syncType);
    console.log(
      `[coexistence] sync ${syncType} aceptado (request_id=${requestId ?? "n/a"}, phone_number_id=${phoneNumberId})`
    );
    return { ok: true, syncType, requestId };
  } catch (err) {
    const message =
      err instanceof MetaApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "error desconocido";
    console.warn(
      `[coexistence] sync ${syncType} falló (best-effort, phone_number_id=${phoneNumberId}): ${message}`
    );
    return { ok: false, syncType, requestId: null, error: message };
  }
}

/**
 * Solicita agenda e historial. Nunca lanza: cada sync se registra por separado.
 */
export async function requestCoexistenceSync(input: {
  phoneNumberId: string;
  token: string;
}): Promise<CoexistenceSyncResult> {
  const contacts = await trySync(
    input.phoneNumberId,
    input.token,
    "smb_app_state_sync"
  );
  const history = await trySync(input.phoneNumberId, input.token, "history");
  return { contacts, history };
}

export async function requestCoexistenceSyncForOrg(
  organizationId: string
): Promise<
  | { ok: true; phoneNumberId: string; result: CoexistenceSyncResult }
  | { ok: false; code: "not_connected" }
> {
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) return { ok: false, code: "not_connected" };
  const result = await requestCoexistenceSync({
    phoneNumberId: creds.phoneNumberId,
    token: creds.token,
  });
  return { ok: true, phoneNumberId: creds.phoneNumberId, result };
}
