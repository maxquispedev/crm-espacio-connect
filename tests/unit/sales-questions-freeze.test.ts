import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JEV_SALES_QUESTIONS_V2 } from "@/server/sales/questions";
import canonicalQuestions from "../fixtures/jev-questions-v2.json";
import { VENDE_VELOZ_PLAYBOOK_V1 } from "@/lib/sales/playbook/v1";
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
  it("la fixture conserva el blob validado de upstream (excepto newline final)", () => {
    const content = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/jev-questions-v2.json")
    );
    const source = content.subarray(0, content.length - 1);
    expect(content.at(-1)).toBe(10);
    const blob = createHash("sha1")
      .update(`blob ${source.length}\0`)
      .update(source)
      .digest("hex");
    expect(blob).toBe("fe3e075ca43aec8f82e5bc34eb677ae6dcf82b68");
  });

  it("las ocho preguntas coinciden con la fuente upstream independiente", () => {
    expect(JEV_SALES_QUESTIONS_V2).toEqual(canonicalQuestions);
    expect(Object.keys(JEV_SALES_QUESTIONS_V2)).toHaveLength(8);
  });

  it.each(["product_fit", "motivation_to_change", "purchase_intent"] as const)(
    "%s usa la lista canónica de cinco criterios, también en ConfigV1",
    (key) => {
      const question = JEV_SALES_QUESTIONS_V2[key];
      expect(Array.isArray(question.criteria)).toBe(true);
      expect(question.criteria).toHaveLength(5);
      expect(question.criteria).toEqual(canonicalQuestions[key].criteria);
      expect(VENDE_VELOZ_PLAYBOOK_V1.jev_questions[key]?.criteria).toEqual(question.criteria);
    }
  );

  it("choice conserva records y noul conserva exclusivamente true/false", () => {
    for (const [key, question] of Object.entries(JEV_SALES_QUESTIONS_V2)) {
      if (question.type === "score") continue;
      expect(Array.isArray(question.criteria)).toBe(false);
      expect(question.criteria).toEqual(canonicalQuestions[key as keyof typeof canonicalQuestions].criteria);
      if (question.type === "noul") {
        expect(Object.keys(question.criteria)).toEqual(["true", "false"]);
      }
    }
  });

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

  it("VENDE_VELOZ_OFFER conserva el contrato de precio del writer (baseline cohorte 1)", () => {
    expect(VENDE_VELOZ_OFFER.currency).toBe("PEN");
    expect(VENDE_VELOZ_OFFER.setup).toBe(0);
    expect(VENDE_VELOZ_OFFER.monthlyBase).toBe(247);
    expect(VENDE_VELOZ_OFFER.includedActiveStudents).toBe(50);
    expect(VENDE_VELOZ_OFFER.extraPerActiveStudent).toBe(1);
    expect(VENDE_VELOZ_OFFER.setupIsOneTime).toBe(true);
  });

  it("con setup 0 la implementación se declara incluida y la renovación de dominio va aparte", () => {
    expect(VENDE_VELOZ_OFFER.implementation.purpose).toMatch(/incluida/i);
    expect(VENDE_VELOZ_OFFER.implementation.includes.join(" ")).toMatch(/incluida|primer pago/i);
    expect(VENDE_VELOZ_OFFER.implementation.includes.join(" ")).toMatch(/primer pago inicia la implementación e incluye los primeros 30 días/i);
    expect(VENDE_VELOZ_OFFER.implementation.includes.join(" ")).toMatch(/sin permanencia obligatoria/i);
    expect(VENDE_VELOZ_OFFER.neverPromise.join(" ")).toMatch(/renovaci[oó]n del dominio/i);
    // El fallback no puede seguir anunciando los precios de la cohorte anterior.
    expect(JSON.stringify(VENDE_VELOZ_OFFER)).not.toMatch(/497/);
    expect(JSON.stringify(VENDE_VELOZ_OFFER)).not.toMatch(/\b197\b/);
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
