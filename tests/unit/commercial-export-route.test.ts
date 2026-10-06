import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError, requireSession } from "@/lib/auth/session";
import { exportCommercialDataset } from "@/server/commercial-export/dataset";
import { POST } from "@/app/api/commercial-export/route";

vi.mock("@/lib/auth/session", () => ({
  requireSession: vi.fn(), UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/server/commercial-export/dataset", () => ({ exportCommercialDataset: vi.fn() }));
const request = (body: unknown) => new Request("http://localhost/api/commercial-export", { method: "POST", body: JSON.stringify(body) });
const valid = { date_from: "2026-10-06", date_to: "2026-10-06" };
describe("commercial export authenticated route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireSession).mockResolvedValue({ userId: "user", organizationId: "A", role: "member" });
    vi.mocked(exportCommercialDataset).mockResolvedValue({ exported_at: "2026-10-06T12:00:00Z", schema_version: "1.0" } as Awaited<ReturnType<typeof exportCommercialDataset>>);
  });
  it("uses authenticated active org and returns non-cacheable attachment", async () => {
    const response = await POST(request(valid));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="espacio-connect-commercial-export-2026-10-06.json"');
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(exportCommercialDataset).toHaveBeenCalledWith("A", { ...valid, ad_attributed_only: false, source_ids: [] });
    expect(await response.json()).toHaveProperty("schema_version", "1.0");
  });
  it("rejects unauthenticated requests before querying", async () => {
    vi.mocked(requireSession).mockRejectedValue(new UnauthorizedError());
    expect((await POST(request(valid))).status).toBe(401);
    expect(exportCommercialDataset).not.toHaveBeenCalled();
  });
  it("rejects tenant overrides and invalid dates before querying", async () => {
    for (const input of [{ ...valid, organization_id: "B" }, { ...valid, date_to: "2026-02-30" }]) {
      expect((await POST(request(input))).status).toBe(422);
    }
    expect(exportCommercialDataset).not.toHaveBeenCalled();
  });
  it("returns generic error without provider or DB details", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(exportCommercialDataset).mockRejectedValue(new Error("internal connection secret"));
    const response = await POST(request(valid));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret");
    logger.mockRestore();
  });
});
