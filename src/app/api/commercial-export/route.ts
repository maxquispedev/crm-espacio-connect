import { withAuth, parseBody } from "@/lib/api";
import { exportInputSchema } from "@/server/commercial-export/input";
import { exportCommercialDataset } from "@/server/commercial-export/dataset";

export const dynamic = "force-dynamic";
export const POST = withAuth(async (session, req: Request) => {
  const parsed = await parseBody(req, exportInputSchema);
  if (!parsed.ok) return parsed.response;
  const dataset = await exportCommercialDataset(session.organizationId, exportInputSchema.parse(parsed.data));
  const filename = `espacio-connect-commercial-export-${dataset.exported_at.slice(0, 10)}.json`;
  return new Response(JSON.stringify(dataset, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
});
