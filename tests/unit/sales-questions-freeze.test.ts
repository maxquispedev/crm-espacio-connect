import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JEV_SALES_QUESTIONS_V2 } from "@/server/sales/questions";
import {
  VENDE_VELOZ_COMMERCIAL_POLICY,
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
});
