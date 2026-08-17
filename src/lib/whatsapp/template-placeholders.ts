/**
 * Placeholders de plantillas WhatsApp (`{{1}}`…`{{n}}`) y el payload Graph
 * de envío. Puro: lo usan el dominio, la UI y los tests unitarios.
 */

/** Tope alineado con Cloud API (parámetros de BODY). */
export const MAX_BODY_VARIABLES = 10;

function variableRegex(): RegExp {
  // Instancia nueva: el flag `g` muta lastIndex si se reutiliza el mismo RegExp.
  return /\{\{\s*(\d+)\s*\}\}/g;
}

function placeholderNumbers(body: string): number[] {
  return [...body.matchAll(variableRegex())].map((m) => Number(m[1]));
}

/** Cantidad de parámetros BODY que exige el texto: el índice máximo `{{n}}`. */
export function countVariables(body: string): number {
  const nums = placeholderNumbers(body);
  if (nums.length === 0) return 0;
  return Math.max(...nums);
}

/**
 * Exige placeholders consecutivos desde `{{1}}` (huecos, `{{0}}` o un `{{2}}`
 * suelto son inválidos). `null` = el cuerpo es aceptable.
 */
export function validateBodyVariables(body: string): string | null {
  const matches = [...body.matchAll(variableRegex())];
  if (matches.length === 0) return null;

  const indices: number[] = [];
  for (const match of matches) {
    const raw = match[1];
    if (raw === undefined || !/^[1-9]\d*$/.test(raw)) {
      return "Las variables deben numerarse desde {{1}}";
    }
    const n = Number(raw);
    if (n > MAX_BODY_VARIABLES) {
      return `El cuerpo admite como máximo ${MAX_BODY_VARIABLES} variables`;
    }
    indices.push(n);
  }

  const unique = [...new Set(indices)].sort((a, b) => a - b);
  for (let i = 0; i < unique.length; i++) {
    if (unique[i] !== i + 1) {
      return "Las variables del cuerpo deben ser consecutivas desde {{1}}";
    }
  }
  return null;
}

/**
 * Interpola el BODY. Acepta un string (`{{1}}`, compat) o un array en orden
 * `{{1}}`…`{{n}}`. Un índice sin valor queda como cadena vacía.
 */
export function renderBody(
  body: string,
  values?: string | readonly string[]
): string {
  const vars = typeof values === "string" ? [values] : (values ?? []);
  return body.replace(variableRegex(), (_whole, raw: string) => {
    const n = Number(raw);
    return vars[n - 1] ?? "";
  });
}

export type BodyValuesInput = {
  /** Compat: valor de `{{1}}`. Se ignora si `variables` está definido. */
  variable?: string;
  /** Valores BODY en orden `{{1}}`…`{{n}}`. */
  variables?: string[];
};

/**
 * Resuelve los valores a enviar. Si el cuerpo no pide variables, ignora
 * extras (compat con el composer de 0/1 campo).
 */
export function resolveBodyValues(
  expectedCount: number,
  input: BodyValuesInput
): { ok: true; values: string[] } | { ok: false; error: string } {
  if (expectedCount === 0) return { ok: true, values: [] };

  const raw =
    input.variables !== undefined
      ? input.variables
      : input.variable !== undefined
        ? [input.variable]
        : [];
  const values = raw.map((v) => v.trim());
  const complete =
    values.length === expectedCount && values.every((v) => v.length > 0);
  if (!complete) {
    const error =
      expectedCount === 1
        ? "La plantilla requiere el valor de {{1}}"
        : `La plantilla requiere ${expectedCount} valores ({{1}}…{{${expectedCount}}})`;
    return { ok: false, error };
  }
  return { ok: true, values };
}

export type GraphTemplateTextParam = { type: "text"; text: string };

export type GraphTemplateComponent =
  | { type: "body"; parameters: GraphTemplateTextParam[] }
  | {
      type: "button";
      sub_type: "url";
      index: string;
      parameters: GraphTemplateTextParam[];
    };

/**
 * Componentes de envío Cloud API. Sin BODY vars ni botón → `undefined`
 * (plantilla estática: Graph no lleva `components`).
 */
export function buildTemplateSendComponents(input: {
  bodyValues: string[];
  urlButtonSuffix?: string;
}): GraphTemplateComponent[] | undefined {
  const components: GraphTemplateComponent[] = [];
  if (input.bodyValues.length > 0) {
    components.push({
      type: "body",
      parameters: input.bodyValues.map((text) => ({ type: "text", text })),
    });
  }
  const suffix = input.urlButtonSuffix?.trim();
  if (suffix) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: suffix }],
    });
  }
  return components.length > 0 ? components : undefined;
}

/** Objeto `template` del POST `{phoneNumberId}/messages`. */
export function buildTemplateGraphMessage(input: {
  name: string;
  language: string;
  bodyValues: string[];
  urlButtonSuffix?: string;
}): {
  name: string;
  language: { code: string };
  components?: GraphTemplateComponent[];
} {
  const components = buildTemplateSendComponents({
    bodyValues: input.bodyValues,
    urlButtonSuffix: input.urlButtonSuffix,
  });
  return {
    name: input.name,
    language: { code: input.language },
    ...(components ? { components } : {}),
  };
}
