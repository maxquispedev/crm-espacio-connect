/**
 * 009 — Corte 1 (T911/T912): el parseo y el formato del editor técnico JSON.
 *
 * Cubre la lógica pura de `json-editor.tsx`: la traducción de `position` a
 * línea/columna (que es lo que hace el error de sintaxis utilizable), el
 * formateo que nunca escribe un documento sin parsear, y el reparto de los
 * `details[]` del servidor entre los dos editores.
 *
 * Son las piezas donde un error silencioso costaría caro: una línea/columna
 * inventada hace que el admin vaya a la línea equivocada, y formatear sin
 * parsear destruiría lo que estaba escribiendo.
 */

import { describe, expect, it } from "vitest";

import { ConfigV1Schema } from "@/lib/sales/playbook/schema";
import { VENDE_VELOZ_PLAYBOOK_V1 } from "@/lib/sales/playbook/v1";
import {
  formatJsonDocument,
  issuesForConfig,
  issuesForJev,
  parseJsonDocument,
} from "@/components/agent/playbook/json-editor";

describe("parseJsonDocument — línea y columna", () => {
  it("traduce la position de V8 a línea y columna", () => {
    const text = '{\n  "product": {\n    "name": "X",\n  },\n}';
    const res = parseJsonDocument(text);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.line).not.toBeNull();
    expect(res.error.column).not.toBeNull();
    if (res.error.line === null || res.error.column === null) return;
    // La ubicación calculada debe señalar el carácter que V8 señala: aquí la
    // `,` sobrante hace que el parser espere otra clave y tropiece en el `}`
    // que cierra "product" (línea 4, columna 3). Verificamos el carácter en
    // vez de fijar el número, para que el test no dependa de la versión.
    const lines = text.split("\n");
    expect(lines[res.error.line - 1]?.[res.error.column - 1]).toBe("}");
  });

  it("da línea 1 para un error en la primera línea", () => {
    const res = parseJsonDocument("{ oops }");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.line).toBe(1);
    expect(res.error.message).toMatch(/position \d+/);
  });

  it("no inventa línea si el motor no da posición", () => {
    // Entrada que ni siquiera es texto: el error no trae `position`.
    const res = parseJsonDocument("");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // V8 sí suele dar posición aquí; lo que exigimos es que, si no la hay,
    // el campo quede en null en vez de un número inventado.
    if (res.error.line === null) {
      expect(res.error.column).toBeNull();
    }
  });

  it("parsea un documento válido y devuelve el valor", () => {
    const res = parseJsonDocument('{"a":1,"b":[2,3]}');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual({ a: 1, b: [2, 3] });
  });

  it("acepta literales que el editor deja pasar tal cual", () => {
    for (const src of ["null", "0", '"texto"', "true", "[]", "{}"]) {
      expect(parseJsonDocument(src).ok).toBe(true);
    }
  });
});

describe("formatJsonDocument", () => {
  it("serializa a 2 espacios", () => {
    expect(formatJsonDocument({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("el resultado formateado vuelve a parsear igual", () => {
    const original = { offer: { monthlyBase: 247 }, jev_questions: { next_action: { type: "choice" } } };
    const formatted = formatJsonDocument(original);
    const res = parseJsonDocument(formatted);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual(original);
  });
});

describe("el documento que se manda a cada endpoint", () => {
  // El editor técnico proyecta el ConfigV1 a dos textareas SIN
  // `schema_version` (es lo que el cuerpo `.strict()` del PUT acepta). Pero
  // `POST /api/playbook/validate` corre `ConfigV1Schema.safeParse` sobre el
  // body tal cual, y ahí `schema_version` es `z.literal("1.0")` obligatorio.
  //
  // Por eso el cliente reinyecta `schema_version` al validar y lo omite al
  // guardar. Este test ata esa asimetría: si alguien la rompe en el futuro,
  // falla aquí y no en producción con un 422 que parece de Zod.
  const { jev_questions: _jev, schema_version: _sv, ...sinSchemaVersion } =
    VENDE_VELOZ_PLAYBOOK_V1;

  it("el ConfigV1 de la V1 pasa el schema tal cual", () => {
    expect(ConfigV1Schema.safeParse(VENDE_VELOZ_PLAYBOOK_V1).success).toBe(true);
  });

  it("sin schema_version el servidor RECHAZA (por eso hay que reinyectarlo)", () => {
    const res = ConfigV1Schema.safeParse(sinSchemaVersion);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(
      res.error.issues.some((i) => i.path.join(".") === "schema_version")
    ).toBe(true);
  });

  it("el documento proyectado (8 bloques + jev_questions) sí es un objeto plano", () => {
    expect(Object.keys(sinSchemaVersion).sort()).toEqual([
      "commercial_policy",
      "handoff",
      "offer",
      "priorities",
      "product",
      "prohibitions",
      "urgency_rules",
      "writer",
    ]);
  });

  it("reinyectar schema_version devuelve un documento válido", () => {
    const doc = { schema_version: "1.0", ...sinSchemaVersion, jev_questions: _jev };
    expect(ConfigV1Schema.safeParse(doc).success).toBe(true);
    // Y sigue siendo un JSON que el editor puede parsear y formatear.
    const round = parseJsonDocument(formatJsonDocument(doc));
    expect(round.ok).toBe(true);
  });
});

describe("reparto de details[] entre los dos editores", () => {
  const details = [
    { path: "offer.monthlyBase", message: "Expected number" },
    { path: "jev_questions.next_action", message: "clave protegida" },
    { path: "product.name", message: "too small" },
  ];

  it("manda a Config todo lo que no es jev_questions", () => {
    const paths = issuesForConfig(details).map((i) => i.path);
    expect(paths).toEqual(["offer.monthlyBase", "product.name"]);
  });

  it("manda a Preguntas Jev lo que empieza por jev_questions", () => {
    const paths = issuesForJev(details).map((i) => i.path);
    expect(paths).toEqual(["jev_questions.next_action"]);
  });

  it("un fallo de forma en la raíz de jev_questions va al editor 2", () => {
    const root = [{ path: "jev_questions", message: "expected object" }];
    expect(issuesForJev(root)).toHaveLength(1);
    expect(issuesForConfig(root)).toHaveLength(0);
  });

  it("ningún detail se pierde ni se duplica entre los dos editores", () => {
    expect(issuesForConfig(details).length + issuesForJev(details).length).toBe(
      details.length
    );
  });
});
