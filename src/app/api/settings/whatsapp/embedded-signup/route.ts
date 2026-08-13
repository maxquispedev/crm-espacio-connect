import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  completeEmbeddedSignup,
  embeddedSignupBodySchema,
} from "@/server/whatsapp/embedded-signup";

export const dynamic = "force-dynamic";

/**
 * Onboarding Embedded Signup: code + waba + phone → token cifrado por org.
 * organizationId sale SOLO de la sesión. Sin override_callback_uri.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, embeddedSignupBodySchema);
  if (!body.ok) return body.response;

  const result = await completeEmbeddedSignup({
    organizationId: session.organizationId,
    code: body.data.code,
    wabaId: body.data.wabaId,
    phoneNumberId: body.data.phoneNumberId,
  });

  if (!result.ok) {
    return apiError(result.status, result.code, result.message);
  }

  return Response.json({
    ok: true,
    displayPhoneNumber: result.displayPhoneNumber,
    verifiedName: result.verifiedName,
    tokenLast4: result.tokenLast4,
  });
});
