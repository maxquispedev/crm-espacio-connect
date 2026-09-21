import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JEV_SALES_QUESTIONS_V2 } from "@/server/sales/questions";
import {
  VENDE_VELOZ_COMMERCIAL_POLICY,
  VENDE_VELOZ_OFFER,
  VENDE_VELOZ_PRODUCT,
} from "@/server/sales/vende-veloz";

const md = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/SALES_ORCHESTRATOR.md"),
  "utf8"
);

function jsonAfterHeading(heading: string): unknown {
  const idx = md.indexOf(heading);
  expect(idx).toBeGreaterThanOrEqual(0);
  const slice = md.slice(idx);
  const start = slice.indexOf("```json");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = slice.indexOf("```", start + 7);
  return JSON.parse(slice.slice(start + 7, end).trim()) as unknown;
}

describe("contrato congelado Jev V2 / producto / política", () => {
  it("JEV_SALES_QUESTIONS_V2 equivale exactamente al bloque §7 del documento", () => {
    const frozen = jsonAfterHeading("## 7. Jev V2");
    expect(JEV_SALES_QUESTIONS_V2).toEqual(frozen);
  });

  it("VENDE_VELOZ_PRODUCT equivale exactamente al bloque §5 del documento", () => {
    const frozen = jsonAfterHeading("## 5. Producto");
    expect(VENDE_VELOZ_PRODUCT).toEqual(frozen);
  });

  it("VENDE_VELOZ_COMMERCIAL_POLICY equivale exactamente al bloque §6 del documento", () => {
    const frozen = jsonAfterHeading("## 6. Política comercial");
    expect(VENDE_VELOZ_COMMERCIAL_POLICY).toEqual(frozen);
  });

  it("la política comercial congela las claves del contrato validado", () => {
    expect(Object.keys(VENDE_VELOZ_COMMERCIAL_POLICY)).toEqual([
      "default_channel",
      "goal",
      "automation_first",
      "auto_close",
      "human_handoff",
      "future_interest",
      "no_response",
      "disqualification",
      "evidence_rule",
    ]);
  });

  it("VENDE_VELOZ_OFFER conserva el contrato de precio del writer", () => {
    expect(VENDE_VELOZ_OFFER.currency).toBe("PEN");
    expect(VENDE_VELOZ_OFFER.setup).toBe(497);
    expect(VENDE_VELOZ_OFFER.monthlyBase).toBe(197);
    expect(VENDE_VELOZ_OFFER.includedActiveStudents).toBe(50);
    expect(VENDE_VELOZ_OFFER.extraPerActiveStudent).toBe(1);
    expect(VENDE_VELOZ_OFFER.setupIsOneTime).toBe(true);
  });

  it("el shape del State en §8 es product/policy/crm_state/conversation con speakers lead|seller", () => {
    const frozen = jsonAfterHeading("## 8. State") as Record<string, unknown>;
    expect(Object.keys(frozen)).toEqual([
      "product",
      "commercial_policy",
      "crm_state",
      "conversation",
    ]);
    expect(frozen).not.toHaveProperty("commercial_offer");
    const conversation = frozen.conversation as { from: string }[];
    expect(conversation.map((turn) => turn.from)).toEqual(["lead", "seller"]);
  });
});
