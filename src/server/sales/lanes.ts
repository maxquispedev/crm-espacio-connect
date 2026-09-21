import type { AutomationLane } from "@/lib/types";

export type { AutomationLane };

/**
 * Lanes persistidas en `lead.automation_lane`.
 * Independientes del pipeline (Nuevo → … → Perdido).
 */
export const AUTOMATION_LANES = [
  "auto",
  "auto_close",
  "wait",
  "human",
  "stop",
] as const satisfies readonly AutomationLane[];
