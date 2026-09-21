import { mockGuard } from "@/lib/dev-guard";
import { mockJevRaw } from "@/server/dev/jev-mock";

export const dynamic = "force-dynamic";

/** POST compatible con `TYPESAFE_JEV_ENDPOINT` en modo mocks. */
export async function POST() {
  const guard = mockGuard();
  if (guard) return guard;
  return Response.json(mockJevRaw());
}
