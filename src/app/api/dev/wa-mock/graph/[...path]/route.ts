import { mockGuard } from "@/lib/dev-guard";
import {
  getWaMockState,
  nextN,
  nextOutboundWamid,
  type MockTemplate,
} from "@/server/dev/wa-mock-state";

/**
 * Imitación de la Graph API (contrato mocks.md). El cliente real apunta aquí
 * cuando META_GRAPH_BASE_URL = <app>/api/dev/wa-mock/graph — el código de
 * producción no sabe que habla con un mock.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string[] }> };

function bearerToken(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function invalidTokenResponse(): Response {
  return Response.json(
    {
      error: {
        message: "Invalid OAuth access token - Cannot parse access token",
        type: "OAuthException",
        code: 190,
        fbtrace_id: "mock",
      },
    },
    { status: 401 }
  );
}

/** Quita el segmento de versión (v25.0/...) si viene en la ruta. */
function normalizePath(path: string[]): string[] {
  return path[0] && /^v\d+/.test(path[0]) ? path.slice(1) : path;
}

export async function GET(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const path = normalizePath((await ctx.params).path);

  // GET oauth/access_token?code=... — canje Embedded Signup (sin Bearer).
  if (path.length === 2 && path[0] === "oauth" && path[1] === "access_token") {
    const url = new URL(req.url);
    const code = url.searchParams.get("code") ?? "";
    const clientId = url.searchParams.get("client_id") ?? "";
    if (!code || code.endsWith("-invalid")) {
      return Response.json(
        {
          error: {
            message: "Invalid verification code format",
            type: "OAuthException",
            code: 100,
            fbtrace_id: "mock",
          },
        },
        { status: 400 }
      );
    }
    if (!clientId) {
      return Response.json(
        {
          error: {
            message: "Missing client_id",
            type: "OAuthException",
            code: 101,
            fbtrace_id: "mock",
          },
        },
        { status: 400 }
      );
    }
    return Response.json({
      access_token: "EAAG-mock-oauth",
      token_type: "bearer",
    });
  }

  const token = bearerToken(req);
  if (token.endsWith("-invalid")) return invalidTokenResponse();

  // GET {wabaId}/message_templates → lista para el sync
  if (path.length === 2 && path[1] === "message_templates") {
    const state = getWaMockState();
    return Response.json({
      data: state.templates.map((t) => ({
        id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        components: [{ type: "BODY", text: t.body }],
      })),
    });
  }

  // GET {mediaId} (ids "media...") → metadata de adjunto (media proxy del bot)
  if (path.length === 1 && path[0]!.startsWith("media")) {
    const origin = new URL(req.url).origin;
    return Response.json({
      id: path[0],
      mime_type: path[0]!.includes("pdf") ? "application/pdf" : "image/jpeg",
      file_size: 13,
      url: `${origin}/api/dev/wa-mock/media-file/${path[0]}`,
    });
  }

  // GET {phoneNumberId}?fields=... → validación del wizard
  if (path.length === 1) {
    return Response.json({
      display_phone_number: "+52 55 0000 0000",
      verified_name: "Número de prueba Vocero",
      id: path[0],
    });
  }

  return Response.json({});
}

export async function POST(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const path = normalizePath((await ctx.params).path);
  const token = bearerToken(req);
  if (token.endsWith("-invalid")) return invalidTokenResponse();

  // POST {phoneNumberId}/media (multipart, 008) → id de media subido.
  // Va ANTES del parseo JSON: el body es form-data.
  if (path.length === 2 && path[1] === "media") {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob)) {
      return Response.json(
        { error: { message: "missing file", type: "GraphMethodException", code: 100 } },
        { status: 400 }
      );
    }
    // El id arranca con "media" para que el GET de metadata lo resuelva.
    return Response.json({ id: `media-up-${nextN()}` });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // POST {phoneNumberId}/messages con status:"read" → typing/leído:
  // NO es un mensaje saliente — no contamina el outbox.
  if (path.length === 2 && path[1] === "messages" && body.status === "read") {
    return Response.json({ success: true });
  }

  // POST {phoneNumberId}/messages → registra en el outbox
  if (path.length === 2 && path[1] === "messages") {
    const state = getWaMockState();
    const n = nextN();
    const waMessageId = nextOutboundWamid();
    state.outbox.push({
      n,
      waMessageId,
      phoneNumberId: path[0]!,
      to: String(body.to ?? ""),
      type: String(body.type ?? "text"),
      body,
      at: new Date().toISOString(),
    });
    return Response.json({
      messaging_product: "whatsapp",
      contacts: [{ input: body.to, wa_id: body.to }],
      messages: [{ id: waMessageId }],
    });
  }

  // POST {wabaId}/message_templates → alta de plantilla (queda PENDING)
  if (path.length === 2 && path[1] === "message_templates") {
    const state = getWaMockState();
    const bodyComponent = (
      body.components as { type?: string; text?: string }[] | undefined
    )?.find((c) => (c.type ?? "").toUpperCase() === "BODY");
    const tpl: MockTemplate = {
      id: `tplmock_${nextN()}`,
      name: String(body.name ?? ""),
      language: String(body.language ?? "es_MX"),
      category: String(body.category ?? "UTILITY"),
      status: "PENDING",
      body: bodyComponent?.text ?? "",
    };
    state.templates.push(tpl);
    return Response.json({ id: tpl.id, status: "PENDING", category: tpl.category });
  }

  // POST {wabaId}/subscribed_apps → suscripción (sin override).
  // WABA-NOSUB simula rechazo de Meta para el onboarding estricto.
  if (path.length === 2 && path[1] === "subscribed_apps") {
    if (path[0] === "WABA-NOSUB" || token.includes("nosub")) {
      return Response.json(
        {
          error: {
            message: "Cannot subscribe app",
            type: "OAuthException",
            code: 100,
            fbtrace_id: "mock",
          },
        },
        { status: 400 }
      );
    }
    return Response.json({ success: true });
  }

  // POST {phoneNumberId}/smb_app_data → sync de coexistence (agenda / historial)
  if (path.length === 2 && path[1] === "smb_app_data") {
    if (path[0] === "PN-NOSYNC") {
      return Response.json(
        {
          error: {
            message: "Cannot sync SMB app data",
            type: "OAuthException",
            code: 100,
            fbtrace_id: "mock",
          },
        },
        { status: 400 }
      );
    }
    return Response.json({
      messaging_product: "whatsapp",
      request_id: `req_mock_${nextN()}`,
    });
  }

  return Response.json({});
}

export async function DELETE(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const token = bearerToken(req);
  if (token.endsWith("-invalid")) return invalidTokenResponse();
  await ctx.params;
  return Response.json({ success: true });
}
