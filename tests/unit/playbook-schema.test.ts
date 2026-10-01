import { describe, expect, it } from "vitest";

import {
  parseConfigV1,
  ConfigV1Schema,
  type ConfigV1,
} from "@/lib/sales/playbook/schema";
import { VENDE_VELOZ_PLAYBOOK_V1 } from "@/lib/sales/playbook/v1";

/* ============================================================
 * Helpers
 * ============================================================ */

type ChoiceQ = {
  type: "choice";
  enabled: boolean;
  instructions: string;
  criteria: Record<string, string>;
};

type NoulQ = {
  type: "noul";
  enabled: boolean;
  instructions: string;
  criteria: { true: string; false: string };
};

function buildValidConfig(): ConfigV1 {
  return JSON.parse(JSON.stringify(VENDE_VELOZ_PLAYBOOK_V1));
}

function mutate(
  base: ConfigV1,
  fn: (draft: ConfigV1) => void
): unknown {
  const draft: ConfigV1 = JSON.parse(JSON.stringify(base));
  fn(draft);
  return draft;
}

function asChoice(q: unknown): ChoiceQ {
  if (!q || typeof q !== "object" || (q as { type?: string }).type !== "choice") {
    throw new Error("expected choice question");
  }
  return q as ChoiceQ;
}

function asNoul(q: unknown): NoulQ {
  if (!q || typeof q !== "object" || (q as { type?: string }).type !== "noul") {
    throw new Error("expected noul question");
  }
  return q as NoulQ;
}

/* ============================================================
 * Tests
 * ============================================================ */

describe("ConfigV1Schema — payload completo válido", () => {
  it("acepta el V1 literal exportado", () => {
    const r = parseConfigV1(VENDE_VELOZ_PLAYBOOK_V1);
    expect(r.ok).toBe(true);
  });

  it("ConfigV1Schema.parse(VENDE_VELOZ_PLAYBOOK_V1) no lanza (snapshot)", () => {
    expect(() =>
      ConfigV1Schema.parse(VENDE_VELOZ_PLAYBOOK_V1)
    ).not.toThrow();
  });

  it("devuelve { ok: true, data } cuando el payload es válido", () => {
    const r = parseConfigV1(buildValidConfig());
    if (!r.ok) {
      throw new Error(
        "expected ok=true; got details=" + JSON.stringify(r.details)
      );
    }
    expect(r.ok).toBe(true);
    expect(r.data.schema_version).toBe("1.0");
  });

  it("schema_version incorrecto → fail", () => {
    const broken = mutate(buildValidConfig(), (d) => {
      (d as unknown as { schema_version: string }).schema_version = "2.0";
    });
    const r = parseConfigV1(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const schemaIssue = r.details.find(
        (d) => d.path.join(".") === "schema_version"
      );
      expect(schemaIssue).toBeDefined();
    }
  });

  it("next_action sin type choice → fail con detalle", () => {
    const broken = mutate(buildValidConfig(), (d) => {
      const na = d.jev_questions.next_action;
      if (na) {
        (na as unknown as { type: string }).type = "score";
      }
    });
    const r = parseConfigV1(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Zod puede fallar en structural (discriminated union) ANTES de
      // superRefine. Verificamos que el detalle apunte a
      // `jev_questions.next_action` y mencione type mismatch o el
      // type esperado.
      const mismatch = r.details.find(
        (d) =>
          d.path.join(".").startsWith("jev_questions.next_action") &&
          (d.message.includes("type mismatch") ||
            d.message.toLowerCase().includes("expected"))
      );
      expect(mismatch).toBeDefined();
    }
  });

  it("needs_human_call sin type noul → fail con detalle", () => {
    const broken = mutate(buildValidConfig(), (d) => {
      const n = d.jev_questions.needs_human_call;
      if (n) {
        (n as unknown as { type: string }).type = "choice";
      }
    });
    const r = parseConfigV1(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const mismatch = r.details.find(
        (d) =>
          d.path.join(".").startsWith("jev_questions.needs_human_call") &&
          (d.message.includes("type mismatch") ||
            d.message.toLowerCase().includes("expected"))
      );
      expect(mismatch).toBeDefined();
    }
  });

  it("next_action.enabled = false → fail con mensaje engine-required deshabilitado", () => {
    const broken = mutate(buildValidConfig(), (d) => {
      const na = d.jev_questions.next_action;
      if (na) na.enabled = false;
    });
    const r = parseConfigV1(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const detail = r.details.find((d) =>
        d.path.join(".").startsWith("jev_questions.next_action.enabled")
      );
      expect(detail).toBeDefined();
      expect(detail?.message).toContain("engine-required deshabilitado");
    }
  });

  it("next_action.criteria con key extra → fail choice_keys_mismatch", () => {
    const broken = mutate(buildValidConfig(), (d) => {
      const na = d.jev_questions.next_action;
      if (na) {
        const choice = asChoice(na);
        choice.criteria = {
          ...choice.criteria,
          extra_option: "key inventada",
        };
      }
    });
    const r = parseConfigV1(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const detail = r.details.find((d) =>
        d.path.join(".").startsWith("jev_questions.next_action.criteria")
      );
      expect(detail).toBeDefined();
      expect(detail?.message).toContain("keys mismatch");
    }
  });

  it("buying_timing.criteria con key renombrada → fail choice_keys_mismatch", () => {
    const broken = mutate(buildValidConfig(), (d) => {
      const bt = d.jev_questions.buying_timing;
      if (bt) {
        const choice = asChoice(bt);
        const newCriteria: Record<string, string> = {};
        for (const [k, v] of Object.entries(choice.criteria)) {
          if (k !== "soon") newCriteria[k] = v;
        }
        newCriteria.soon_renamed = "ahora";
        choice.criteria = newCriteria;
      }
    });
    const r = parseConfigV1(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const detail = r.details.find((d) =>
        d.path.join(".").startsWith("jev_questions.buying_timing.criteria")
      );
      expect(detail).toBeDefined();
      expect(detail?.message).toContain("keys mismatch");
    }
  });

  it("main_value_proposition.criteria con key fuera del set V1 → fail", () => {
    const broken = mutate(buildValidConfig(), (d) => {
      const m = d.jev_questions.main_value_proposition;
      if (m) {
        const choice = asChoice(m);
        choice.criteria = {
          ...choice.criteria,
          some_random_key: "fuera del contrato",
        };
      }
    });
    const r = parseConfigV1(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const detail = r.details.find((d) =>
        d.path
          .join(".")
          .startsWith("jev_questions.main_value_proposition.criteria")
      );
      expect(detail).toBeDefined();
      expect(detail?.message).toContain("keys mismatch");
    }
  });

  it("descriptions editables: cambiar texto de un criterio sigue siendo válido", () => {
    const edited = mutate(buildValidConfig(), (d) => {
      const na = d.jev_questions.next_action;
      if (na) {
        const choice = asChoice(na);
        choice.criteria.ask_more_questions = "Descripción re-escrita";
      }
      const m = d.jev_questions.main_value_proposition;
      if (m) {
        const choice = asChoice(m);
        choice.criteria.operational_control =
          "Descripción re-escrita para reflejar Academia Bajo Control";
      }
    });
    const r = parseConfigV1(edited);
    expect(r.ok).toBe(true);
  });

  it("writer.instruction > 1500 → fail", () => {
    const longText = "x".repeat(1501);
    const broken = mutate(buildValidConfig(), (d) => {
      d.writer.ask_more_questions = longText;
    });
    const r = parseConfigV1(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const detail = r.details.find((d) =>
        d.path.join(".").startsWith("writer.ask_more_questions")
      );
      expect(detail).toBeDefined();
    }
  });

  it("priorities.primary vacío → fail", () => {
    const broken = mutate(buildValidConfig(), (d) => {
      d.priorities.primary = [];
    });
    const r = parseConfigV1(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const detail = r.details.find((d) =>
        d.path.join(".").startsWith("priorities.primary")
      );
      expect(detail).toBeDefined();
    }
  });

  it("pregunta analítica libre con key fuera del regex → fail", () => {
    const broken = mutate(buildValidConfig(), (d) => {
      const q = d.jev_questions as unknown as Record<
        string,
        { type: string; enabled: boolean; instructions: string; criteria: unknown }
      >;
      q["Invalid-Key"] = {
        type: "choice",
        enabled: true,
        instructions: "test",
        criteria: { foo: "bar" },
      };
    });
    const r = parseConfigV1(broken);
    expect(r.ok).toBe(false);
  });

  it("pregunta analítica libre con regex válido y shape correcto → ok", () => {
    const mutated = mutate(buildValidConfig(), (d) => {
      const q = d.jev_questions as unknown as Record<
        string,
        { type: string; enabled: boolean; instructions: string; criteria: unknown }
      >;
      q["custom_metric"] = {
        type: "noul",
        enabled: true,
        instructions: "¿Métrica propia?",
        criteria: { true: "sí", false: "no" },
      };
    });
    const r = parseConfigV1(mutated);
    expect(r.ok).toBe(true);
  });

  it("engine-required ausente (sin next_action) → fail con engine-required ausente", () => {
    const broken = mutate(buildValidConfig(), (d) => {
      delete (d.jev_questions as Record<string, unknown>).next_action;
    });
    const r = parseConfigV1(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const detail = r.details.find((d) =>
        d.path.join(".").startsWith("jev_questions.next_action")
      );
      expect(detail).toBeDefined();
      expect(detail?.message).toContain("engine-required ausente");
    }
  });

  it("needs_human_call con type incorrecto queda como noul tras parse en V1", () => {
    // Sanity check: el V1 exportado debe tener needs_human_call como noul.
    const n = VENDE_VELOZ_PLAYBOOK_V1.jev_questions.needs_human_call;
    expect(asNoul(n).type).toBe("noul");
  });
});
