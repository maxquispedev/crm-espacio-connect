import { z } from "zod";
import { fromLocalWall } from "@/server/inbox/agenda-buckets";

export const EXPORT_TIME_ZONE = "America/Lima";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa YYYY-MM-DD").refine(
  value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
  "Fecha inválida"
);
export const exportInputSchema = z.object({
  date_from: date,
  date_to: date,
  ad_attributed_only: z.boolean().default(false),
  source_ids: z.array(z.string().trim().min(1).max(128)).max(20).default([]),
}).strict().refine(input => input.date_from <= input.date_to, {
  message: "Desde debe ser anterior o igual a Hasta", path: ["date_to"],
});
export type ExportInput = z.infer<typeof exportInputSchema>;
export function exportBounds(input: ExportInput) {
  return {
    from: new Date(fromLocalWall(Date.parse(`${input.date_from}T00:00:00Z`), EXPORT_TIME_ZONE)),
    until: new Date(fromLocalWall(Date.parse(`${input.date_to}T00:00:00Z`) + 86400000, EXPORT_TIME_ZONE)),
  };
}
