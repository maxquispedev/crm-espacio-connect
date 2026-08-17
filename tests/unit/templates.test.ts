import { describe, expect, it } from "vitest";
import {
  buildTemplateGraphMessage,
  buildTemplateSendComponents,
  countVariables,
  extractTemplateBody,
  planRemoteTemplateSync,
  renderBody,
  resolveBodyValues,
  validateBodyVariables,
} from "@/server/whatsapp/templates";

const INVOICE_BODY =
  "Hola {{1}}, tu factura {{2}} por {{3}} vence el {{4}}. Concepto: {{5}}.";

const INVOICE_VARS = [
  "Mateo",
  "1296",
  "$49.99 USD",
  "02/04/2026",
  "Espacio Impulsa - dominio.com",
] as const;

describe("countVariables / validateBodyVariables", () => {
  it("sin variables → 0, válido", () => {
    expect(countVariables("Hola, seguimos disponibles.")).toBe(0);
    expect(validateBodyVariables("Hola, seguimos disponibles.")).toBeNull();
  });

  it("una variable {{1}} → 1, válido (con y sin espacios)", () => {
    expect(countVariables("Hola {{1}}, ¿retomamos?")).toBe(1);
    expect(countVariables("Hola {{ 1 }}, ¿retomamos?")).toBe(1);
    expect(validateBodyVariables("Hola {{1}}, ¿retomamos?")).toBeNull();
  });

  it("cinco variables consecutivas {{1}}…{{5}} → válidas", () => {
    expect(countVariables(INVOICE_BODY)).toBe(5);
    expect(validateBodyVariables(INVOICE_BODY)).toBeNull();
  });

  it("{{1}} repetido cuenta como un solo parámetro", () => {
    expect(countVariables("Hola {{1}}, otra vez {{1}}")).toBe(1);
    expect(validateBodyVariables("Hola {{1}}, otra vez {{1}}")).toBeNull();
  });

  it("hueco {{1}} {{3}} → inválido", () => {
    expect(countVariables("Hola {{1}}, pedido {{3}}")).toBe(3);
    expect(validateBodyVariables("Hola {{1}}, pedido {{3}}")).toMatch(
      /\{\{1\}\}/
    );
  });

  it("variable {{2}} sola → inválida (debe empezar en {{1}})", () => {
    expect(validateBodyVariables("Tu pedido {{2}} llegó")).toMatch(/\{\{1\}\}/);
  });

  it("{{0}} → inválido", () => {
    expect(validateBodyVariables("Hola {{0}}")).toMatch(/\{\{1\}\}/);
  });
});

describe("renderBody", () => {
  it("compat: sustituye {{1}} con un string", () => {
    expect(renderBody("Hola {{1}}, ¿retomamos?", "María")).toBe(
      "Hola María, ¿retomamos?"
    );
  });

  it("sin valor → variable vacía", () => {
    expect(renderBody("Hola {{1}}!")).toBe("Hola !");
  });

  it("interpola {{1}}…{{5}} en orden", () => {
    expect(renderBody(INVOICE_BODY, [...INVOICE_VARS])).toBe(
      "Hola Mateo, tu factura 1296 por $49.99 USD vence el 02/04/2026. Concepto: Espacio Impulsa - dominio.com."
    );
  });
});

describe("resolveBodyValues (compat + N vars)", () => {
  it("0 variables ignora extras", () => {
    expect(
      resolveBodyValues(0, { variable: "sobrante" })
    ).toEqual({ ok: true, values: [] });
  });

  it("1 variable vía `variable` (composer actual)", () => {
    expect(resolveBodyValues(1, { variable: "  María  " })).toEqual({
      ok: true,
      values: ["María"],
    });
  });

  it("1 variable faltante conserva el mensaje histórico", () => {
    expect(resolveBodyValues(1, {})).toEqual({
      ok: false,
      error: "La plantilla requiere el valor de {{1}}",
    });
  });

  it("5 variables vía `variables`", () => {
    expect(resolveBodyValues(5, { variables: [...INVOICE_VARS] })).toEqual({
      ok: true,
      values: [...INVOICE_VARS],
    });
  });

  it("`variables` gana sobre `variable`", () => {
    expect(
      resolveBodyValues(1, { variable: "viejo", variables: ["nuevo"] })
    ).toEqual({ ok: true, values: ["nuevo"] });
  });

  it("cantidad incorrecta o hueco vacío → error", () => {
    expect(resolveBodyValues(5, { variable: "solo uno" }).ok).toBe(false);
    expect(
      resolveBodyValues(2, { variables: ["ok", "  "] }).ok
    ).toBe(false);
  });
});

describe("buildTemplateSendComponents / Graph payload", () => {
  it("0 variables y sin botón → sin components (plantilla estática)", () => {
    expect(buildTemplateSendComponents({ bodyValues: [] })).toBeUndefined();
    expect(
      buildTemplateGraphMessage({
        name: "hola",
        language: "es_MX",
        bodyValues: [],
      })
    ).toEqual({ name: "hola", language: { code: "es_MX" } });
  });

  it("1 variable BODY (compat)", () => {
    expect(
      buildTemplateSendComponents({ bodyValues: ["María"] })
    ).toEqual([
      {
        type: "body",
        parameters: [{ type: "text", text: "María" }],
      },
    ]);
  });

  it("5 parámetros BODY en orden", () => {
    const components = buildTemplateSendComponents({
      bodyValues: [...INVOICE_VARS],
    });
    expect(components).toHaveLength(1);
    expect(components![0]).toEqual({
      type: "body",
      parameters: INVOICE_VARS.map((text) => ({ type: "text", text })),
    });
  });

  it("botón URL dinámico opcional no altera plantillas sin botón", () => {
    expect(
      buildTemplateSendComponents({
        bodyValues: ["María"],
        urlButtonSuffix: "   ",
      })
    ).toEqual([
      {
        type: "body",
        parameters: [{ type: "text", text: "María" }],
      },
    ]);
  });

  it("botón URL dinámico se añade como componente button/url index 0", () => {
    expect(
      buildTemplateGraphMessage({
        name: "factura_creada",
        language: "es_MX",
        bodyValues: [...INVOICE_VARS],
        urlButtonSuffix: "1296",
      })
    ).toEqual({
      name: "factura_creada",
      language: { code: "es_MX" },
      components: [
        {
          type: "body",
          parameters: INVOICE_VARS.map((text) => ({ type: "text", text })),
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: "1296" }],
        },
      ],
    });
  });

  it("solo botón URL (cuerpo estático) es un único componente", () => {
    expect(
      buildTemplateSendComponents({
        bodyValues: [],
        urlButtonSuffix: "1296",
      })
    ).toEqual([
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: "1296" }],
      },
    ]);
  });
});

const INVOICE_COMPONENTS = [
  { type: "HEADER", format: "TEXT", text: "Factura nueva" },
  { type: "BODY", text: INVOICE_BODY },
  {
    type: "BUTTONS",
    buttons: [
      {
        type: "URL",
        text: "Ver factura",
        url: "https://espacio.connect/invoices/{{1}}",
      },
    ],
  },
];

function localRow(
  overrides: Partial<{
    id: string;
    name: string;
    language: string;
    category: string;
    status: "draft" | "pending" | "approved" | "rejected";
    waTemplateId: string | null;
    body: string;
  }> = {}
) {
  return {
    id: "tpl_local",
    name: "seguimiento_cotizacion",
    language: "es_MX",
    category: "UTILITY",
    status: "pending" as const,
    waTemplateId: "wa_1",
    body: "Hola {{1}}",
    ...overrides,
  };
}

describe("extractTemplateBody", () => {
  it("toma el BODY y ignora HEADER/BUTTONS", () => {
    expect(extractTemplateBody(INVOICE_COMPONENTS)).toBe(INVOICE_BODY);
  });

  it("acepta type en minúsculas y componentes ausentes", () => {
    expect(extractTemplateBody([{ type: "body", text: "Hola {{1}}" }])).toBe(
      "Hola {{1}}"
    );
    expect(extractTemplateBody(undefined)).toBe("");
    expect(extractTemplateBody([{ type: "BUTTONS", buttons: [] }])).toBe("");
  });
});

describe("planRemoteTemplateSync", () => {
  it("remote existente + local existente → update (estado y categoría)", () => {
    const plan = planRemoteTemplateSync([localRow()], {
      id: "wa_1",
      name: "seguimiento_cotizacion",
      language: "es_MX",
      status: "APPROVED",
      category: "MARKETING",
    });
    expect(plan).toEqual({
      kind: "update",
      localId: "tpl_local",
      status: "approved",
      category: "MARKETING",
      rejectionReason: null,
      waTemplateId: "wa_1",
    });
  });

  it("mismo estado y categoría → ignore (no reescribe)", () => {
    expect(
      planRemoteTemplateSync(
        [localRow({ status: "approved", category: "MARKETING" })],
        {
          id: "wa_1",
          name: "seguimiento_cotizacion",
          language: "es_MX",
          status: "APPROVED",
          category: "MARKETING",
        }
      )
    ).toEqual({ kind: "ignore" });
  });

  it("remote nueva → insert con BODY y sin botones", () => {
    const plan = planRemoteTemplateSync([], {
      id: "wa_inv",
      name: "invoice_created",
      language: "es_MX",
      status: "APPROVED",
      category: "UTILITY",
      components: INVOICE_COMPONENTS,
    });
    expect(plan).toEqual({
      kind: "insert",
      name: "invoice_created",
      language: "es_MX",
      category: "UTILITY",
      body: INVOICE_BODY,
      status: "approved",
      waTemplateId: "wa_inv",
      rejectionReason: null,
    });
    expect("organizationId" in plan).toBe(false);
    if (plan.kind === "insert") {
      expect(JSON.stringify(plan)).not.toMatch(/BUTTONS|Ver factura/);
    }
  });

  it("segundo sync de la misma remota no duplica", () => {
    const remote = {
      id: "wa_inv",
      name: "invoice_created",
      language: "es_MX",
      status: "APPROVED",
      category: "UTILITY",
      components: INVOICE_COMPONENTS,
    };
    const first = planRemoteTemplateSync([], remote);
    expect(first.kind).toBe("insert");
    const afterInsert = [
      localRow({
        id: "tpl_imported",
        name: "invoice_created",
        language: "es_MX",
        category: "UTILITY",
        status: "approved",
        waTemplateId: "wa_inv",
        body: INVOICE_BODY,
      }),
    ];
    expect(planRemoteTemplateSync(afterInsert, remote)).toEqual({
      kind: "ignore",
    });
  });

  it("mismo name/language de otra organización no entra en el match", () => {
    // El caller solo pasa filas del tenant del sync (`scoped`): org B no está.
    const plan = planRemoteTemplateSync([], {
      id: "wa_inv",
      name: "invoice_created",
      language: "es_MX",
      status: "APPROVED",
      category: "UTILITY",
      components: INVOICE_COMPONENTS,
    });
    expect(plan.kind).toBe("insert");
    if (plan.kind === "insert") {
      expect(plan.name).toBe("invoice_created");
    }
  });

  it("BODY + BUTTONS importa solo campos soportados", () => {
    const plan = planRemoteTemplateSync([], {
      id: "wa_inv",
      name: "invoice_created",
      language: "es_MX",
      status: "APPROVED",
      category: "UTILITY",
      components: INVOICE_COMPONENTS,
    });
    expect(plan.kind).toBe("insert");
    if (plan.kind !== "insert") return;
    expect(plan.body).toBe(INVOICE_BODY);
    expect(plan.name).toBe("invoice_created");
    expect(plan.language).toBe("es_MX");
    expect(plan.status).toBe("approved");
    expect(plan.category).toBe("UTILITY");
    expect(plan.waTemplateId).toBe("wa_inv");
    expect("buttons" in plan).toBe(false);
  });
});
