import { getEnv } from "@/lib/env";

/**
 * Cliente propio de la Graph API de Meta (WhatsApp Cloud API).
 * Única frontera de salida hacia Meta (Constitución II): todo request pasa
 * por graphRequest. En self-test, META_GRAPH_BASE_URL apunta al wa-mock.
 */

export class MetaApiError extends Error {
  status: number;
  code: number | null;
  type: string | null;
  details: unknown;

  constructor(
    message: string,
    opts: { status: number; code?: number | null; type?: string | null; details?: unknown }
  ) {
    super(message);
    this.name = "MetaApiError";
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.type = opts.type ?? null;
    this.details = opts.details;
  }

  /**
   * Token vencido/revocado → la conexión requiere re-autenticación.
   * Meta etiqueta como "OAuthException" también errores transitorios 5xx
   * (ej. código 2 "service temporarily unavailable"), así que el type por sí
   * solo NO basta: solo 401 o código 190, y jamás con status ≥ 500.
   */
  get isAuthError(): boolean {
    if (this.status >= 500) return false;
    return this.status === 401 || this.code === 190;
  }
}

export async function graphRequest<T>(
  path: string,
  opts: {
    method?: "GET" | "POST" | "DELETE";
    token: string;
    body?: unknown;
  }
): Promise<T> {
  const env = getEnv();
  const url = `${env.META_GRAPH_BASE_URL}/${env.META_GRAPH_API_VERSION}/${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        ...(opts.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar la API de Meta", {
      status: 0,
      details: cause,
    });
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // respuesta no-JSON: se conserva el texto crudo en details
  }

  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: number; type?: string } })
      ?.error;
    throw new MetaApiError(err?.message ?? `Meta respondió ${res.status}`, {
      status: res.status,
      code: err?.code ?? null,
      type: err?.type ?? null,
      details: json ?? text,
    });
  }
  return json as T;
}

/**
 * Canje servidor-a-servidor de un `code` de Embedded Signup por access token.
 * No usa Bearer: App ID + App Secret van como query params oficiales.
 * Nunca loguea code, App Secret ni el token resultante.
 */
export async function exchangeOAuthCode(code: string): Promise<string> {
  const env = getEnv();
  const appId = env.META_APP_ID?.trim();
  const appSecret = env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    throw new MetaApiError(
      "Falta META_APP_ID o META_APP_SECRET en el servidor",
      { status: 500, code: null, type: "configuration" }
    );
  }

  const url = new URL(
    `${env.META_GRAPH_BASE_URL}/${env.META_GRAPH_API_VERSION}/oauth/access_token`
  );
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("code", code);

  let res: Response;
  try {
    res = await fetch(url, { method: "GET" });
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar la API de Meta", {
      status: 0,
      details: cause instanceof Error ? cause.name : "network",
    });
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const err = (
      json as { error?: { message?: string; code?: number; type?: string } }
    )?.error;
    throw new MetaApiError(
      err?.message ?? `Meta respondió ${res.status} al canjear el código`,
      {
        status: res.status,
        code: err?.code ?? null,
        type: err?.type ?? null,
        details: redactOAuthPayload(json) ?? "non-json",
      }
    );
  }

  const token = (json as { access_token?: unknown } | null)?.access_token;
  if (typeof token !== "string" || token.length === 0) {
    throw new MetaApiError("Meta no devolvió un access_token", {
      status: res.status,
      code: null,
      type: "invalid_response",
    });
  }
  return token;
}

/** Quita secretos de payloads de OAuth antes de guardarlos en errores. */
export function redactOAuthPayload(json: unknown): unknown {
  if (!json || typeof json !== "object") return json;
  const src = json as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (
      k === "access_token" ||
      k === "client_secret" ||
      k === "code" ||
      k === "app_secret"
    ) {
      out[k] = "[redacted]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Normaliza un número al formato canónico. Números móviles de México llegan
 * de Meta como `521` + 10 dígitos (13 en total); enviar con ese `1` extra
 * produce el error 131030 — se usa `52` + 10 dígitos.
 *
 * Desde la identidad resiliente (003) esta normalización es SIMÉTRICA: se
 * aplica también al escribir la identidad del contacto en la ingesta
 * (`wa_identity`), para que `521...` y `52...` resuelvan al mismo contacto.
 */
export function normalizeMx(phone: string): string {
  if (/^521\d{10}$/.test(phone)) {
    return `52${phone.slice(3)}`;
  }
  return phone;
}

/** Alias histórico (envío). */
export const normalizeRecipient = normalizeMx;
