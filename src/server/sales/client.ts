import { getEnv, isJevConfigured } from "@/lib/env";
import type { SalesDecision } from "@/server/sales/decision";
import { normalizeJevResponse } from "@/server/sales/normalize";
import {
  JEV_SALES_QUESTIONS_V2,
  type JevSalesQuestionsV2,
} from "@/server/sales/questions";
import type { JevSalesState } from "@/server/sales/state";

/**
 * Cliente HTTP de Jev. Solo servidor.
 * El endpoint canónico es `TYPESAFE_JEV_ENDPOINT` (URL completa).
 * No hay path hardcodeado. No hay fallback a OpenRouter.
 */

const DEFAULT_TIMEOUT_MS = 60_000;
const REQUEST_ID_HEADER = "x-typesafe-request-id";

export type JevEvaluateInput = {
  state: JevSalesState;
  questions?: JevSalesQuestionsV2;
};

export type JevClientErrorCode =
  | "not_configured"
  | "timeout"
  | "provider_error"
  | "invalid_response";

export type JevClientSuccess = {
  ok: true;
  decision: SalesDecision;
  requestId?: string;
  model?: string;
  /** Opaco, para persistir en last_jev_decision. No usar para decidir. */
  snapshot: unknown;
};

export type JevClientFailure = {
  ok: false;
  error: JevClientErrorCode;
  detail: string;
  requestId?: string;
  snapshot?: unknown;
};

export type JevClientResult = JevClientSuccess | JevClientFailure;

/**
 * Evalúa state+questions contra Jev y devuelve `SalesDecision` normalizada.
 * Nunca lanza. Nunca loguea la API key.
 */
export async function evaluateJev(
  input: JevEvaluateInput,
  opts?: { timeoutMs?: number }
): Promise<JevClientResult> {
  if (!isJevConfigured()) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Faltan TYPESAFE_API_KEY, TYPESAFE_JEV_ENDPOINT o JEV_MODEL",
    };
  }

  const env = getEnv();
  const endpoint = env.TYPESAFE_JEV_ENDPOINT;
  const apiKey = env.TYPESAFE_API_KEY;
  const model = env.JEV_MODEL;
  if (!endpoint || !apiKey || !model) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Faltan TYPESAFE_API_KEY, TYPESAFE_JEV_ENDPOINT o JEV_MODEL",
    };
  }

  const questions = input.questions ?? JEV_SALES_QUESTIONS_V2;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let requestId: string | undefined;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        state: input.state,
        questions,
      }),
      signal: controller.signal,
    });

    requestId = response.headers.get(REQUEST_ID_HEADER) ?? undefined;
    const body = await readBody(response);

    if (!response.ok) {
      return {
        ok: false,
        error: "provider_error",
        detail: `Jev HTTP ${response.status}${bodyDetail(body)}`,
        requestId,
        snapshot: body,
      };
    }

    const normalized = normalizeJevResponse(body);
    if (!normalized.ok) {
      return {
        ok: false,
        error: "invalid_response",
        detail: normalized.error,
        requestId,
        snapshot: body,
      };
    }

    const reportedModel =
      isRecord(body) && typeof body.model === "string" ? body.model : model;

    return {
      ok: true,
      decision: normalized.decision,
      requestId,
      model: reportedModel,
      snapshot: body,
    };
  } catch (err) {
    if (isAbortError(err)) {
      return {
        ok: false,
        error: "timeout",
        detail: `Jev superó ${timeoutMs}ms`,
        requestId,
      };
    }
    return {
      ok: false,
      error: "provider_error",
      detail: errorMessage(err),
      requestId,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function bodyDetail(body: unknown): string {
  if (body === undefined) return "";
  const text = typeof body === "string" ? body : safeJson(body);
  return text ? `: ${truncate(text)}` : "";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return truncate(error.message);
  return "Error de red al llamar a Jev";
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || error.name === "TimeoutError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
