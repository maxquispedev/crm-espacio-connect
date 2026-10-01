/**
 * T702 — Tests de minimización de PII de "Guardar conversación como caso"
 * (Corte 7, Feature 008).
 *
 * Este archivo es la EVIDENCIA de la promesa central del corte: el caso
 * persistido no permite reconstruir la identidad del lead, del contacto
 * ni de la conversación original.
 *
 * Se prueba en DOS niveles, porque la garantía tiene dos capas:
 *
 *   1. **Saneador de contenido** (`case-pii.ts`): el texto que el
 *      cliente escribió se sanea. Un cliente que dicta su número o su
 *      email dentro del mensaje no puede reintroducir PII.
 *   2. **Estructura de persistencia**: la fila insertada en `lab_case`
 *      no tiene columna de identidad, y el transcript guardado no la
 *      contiene.
 *
 * Para el nivel (2) se intercepta el `db.insert(schema.labCase)` con un
 * doble en memoria, de modo que el test lee EXACTAMENTE el objeto que
 * se habría enviado a Postgres. Es más fuerte que afirmar sobre el
 * schema: si alguien añade un campo al INSERT, el test falla.
 *
 * Además se itera sobre `FORBIDDEN_CASE_KEYS` para que la ausencia de
 * campos no dependa de que alguien recuerde escribir la aserción.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FORBIDDEN_CASE_KEYS,
  MAX_TURNS,
  buildCaseMetadata,
  clampTurn,
  detectLanguage,
  sanitizeTranscript,
  sanitizeTranscriptText,
} from "@/server/lab/case-pii";

/* ============================================================
 * Nivel 1 — el saneador de contenido (puro, sin mocks)
 * ============================================================ */

describe("case-pii · saneador de texto (T702)", () => {
  it("redacta teléfonos en formatos peruanos e internacionales", () => {
    const cases: Array<[string, string]> = [
      ["+51 999 888 777", "+51 999 888 777"],
      ["51 999888777", "51 999888777"],
      ["999-888-777", "999-888-777"],
      ["(999) 888 7777", "(999) 888 7777"],
      ["+1 (415) 555-0132", "+1 (415) 555-0132"],
      ["escríbeme al 51 999888777 por favor", "escríbeme al 51 999888777 por favor"],
    ];
    for (const [input] of cases) {
      const out = sanitizeTranscriptText(input);
      expect(out).toContain("[telefono]");
      // Ningún dígito del número sobrevive.
      expect(out).not.toMatch(/999\s*888\s*777|999888777/);
    }
  });

  it("NO destroza precios, fechas ni números cortos de alumno", () => {
    // El playbook y el writer citan precios: destruirlos haría el caso
    // inútil para el juez, y no son identidad.
    expect(sanitizeTranscriptText("El setup es S/497 y el mensual S/197")).toContain(
      "S/497"
    );
    expect(sanitizeTranscriptText("El mensual es S/197")).toContain("S/197");
    // Fechas legítimas.
    expect(sanitizeTranscriptText("empezamos el 12/05")).toContain("12/05");
    // Número de alumnos (corto, no es teléfono).
    expect(sanitizeTranscriptText("tenemos 45 alumnos")).toContain("45");
  });

  it("redacta emails, incluidos los mal formados con espacios", () => {
    expect(sanitizeTranscriptText("escribe a ana.lopez@gmail.com")).toBe(
      "escribe a [email]"
    );
    expect(sanitizeTranscriptText("mi correo es juan @ gmail . com")).toContain(
      "[email]"
    );
  });

  it("redacta URLs completas (tracking de Meta incluido)", () => {
    const out = sanitizeTranscriptText(
      "mira https://wa.me/51999888777?utm_source=facebook&utm_campaign=ad"
    );
    expect(out).toContain("[enlace]");
    // El utm de la campaña no puede sobrevivir: es el camino al anuncio.
    expect(out).not.toContain("facebook");
    expect(out).not.toContain("wa.me");
  });

  it("redacta tokens de plataforma por clave y por prefijo", () => {
    expect(sanitizeTranscriptText("ctwa_clid=abc123def")).toContain("[id]");
    expect(sanitizeTranscriptText("waba_id: 1234567890")).toContain("[id]");
    expect(sanitizeTranscriptText("el id es spv_abcdefgh123")).toBe("el id es [id]");
    expect(sanitizeTranscriptText("lead ld_abcdefgh123")).toBe("lead [id]");
    expect(sanitizeTranscriptText("bsuid:abc123")).toContain("[id]");
  });

  it("degrada a [id] en vez de persistir texto crudo si una regla falla", () => {
    // Un texto con un surrogate inválido no debe romper el endpoint.
    const weird = `hola \uD800 numero 51 999888777`;
    const out = sanitizeTranscriptText(weird);
    expect(typeof out).toBe("string");
    // No puede quedar el número en claro sea cual sea el camino.
    expect(out).not.toContain("999888777");
  });

  it("recorta turnos gigantes sin cortar a media palabra", () => {
    const long = `${"palabra ".repeat(2000)}final`;
    const out = clampTurn(long);
    expect(out.length).toBeLessThanOrEqual(4001);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("palabra\n");
  });

  it("sanea la lista completa y descarta turnos vacíos", () => {
    const out = sanitizeTranscript([
      { role: "cliente", text: "hola, mi numero es 51 999888777" },
      { role: "agente", text: "   " },
      { role: "agente", text: "gracias, escribe a info@academia.pe" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.text).toContain("[telefono]");
    expect(out[1]?.text).toContain("[email]");
    // Cada turno conserva SOLO role y text: ningún otro campo sobrevive.
    for (const turn of out) {
      expect(Object.keys(turn).sort()).toEqual(["role", "text"]);
    }
  });

  it("descarta turnos con role inválido", () => {
    const out = sanitizeTranscript([
      { role: "sistema", text: "x" } as never,
      { role: "cliente", text: "hola" },
    ]);
    expect(out).toHaveLength(1);
  });

  it("limita el número de turnos persistidos", () => {
    const many = Array.from({ length: MAX_TURNS + 50 }, () => ({
      role: "cliente" as const,
      text: "mensaje",
    }));
    expect(sanitizeTranscript(many)).toHaveLength(MAX_TURNS);
  });

  it("detecta idioma de forma gruesa sin depender del LLM", () => {
    expect(detectLanguage("hola, quiero el precio de la academia")).toBe("es");
    expect(detectLanguage("hello, I need the price for the academy")).toBe("en");
    expect(detectLanguage("...")).toBe("und");
  });

  it("la metadata NO incluye timestamps ni desglose por parte", () => {
    const meta = buildCaseMetadata([
      { role: "cliente", text: "hola" },
      { role: "agente", text: "qué tal" },
      { role: "cliente", text: "precio?" },
      { role: "agente", text: "S/497" },
    ]);
    expect(Object.keys(meta).sort()).toEqual([
      "chars_total",
      "detected_language",
      "turns_approx",
    ]);
    expect(meta).not.toHaveProperty("created_at");
    expect(meta).not.toHaveProperty("started_at");
    expect(meta).not.toHaveProperty("messages_in");
    expect(meta).not.toHaveProperty("messages_out");
  });
});

/* ============================================================
 * Nivel 2 — lo que REALMENTE se persiste en el endpoint
 * ============================================================ */

const fakeSession = { user: { id: "user_a" }, organizationId: "org_a" };

type InsertedLabCase = Record<string, unknown>;

const state = {
  conversation: null as { id: string; contactId: string } | null,
  salesEnabled: false as boolean,
  published: null as { id: string; schema_version: string } | null,
  messages: [] as Array<{ direction: string; type: string; text: string | null }>,
  inserted: [] as InsertedLabCase[],
};

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    withAuth:
      (handler: (s: unknown, ...args: unknown[]) => Promise<Response>) =>
      (...args: unknown[]) =>
        handler(fakeSession, ...args),
  };
});

/**
 * Doble de BD table-aware. Cada propiedad de `schema.X` es un objeto de
 * columna que lleva el nombre de la tabla (`__t`), así que la cadena
 * `.select().from(schema.labCase)` sabe a qué tabla pertenece y puede
 * devolver el dataset correcto. El INSERT de `lab_case` se captura tal
 * cual: el test lee EXACTAMENTE el objeto que habría ido a Postgres.
 */
function makeTable(name: string): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "__t") return name;
        if (typeof prop !== "string") return undefined;
        return { __col: prop, __t: name };
      },
    }
  );
}

function rowsFor(table: string): unknown[] {
  if (table === "conversation") {
    return state.conversation ? [state.conversation] : [];
  }
  if (table === "agentProfile") return [{ enabled: state.salesEnabled }];
  if (table === "message") return state.messages;
  if (table === "labCase") return state.inserted;
  return [];
}

vi.mock("@/lib/db", () => {
  function fluent(op: "select" | "insert") {
    const chain: Record<string, unknown> = {};
    let table = "";
    let values: Record<string, unknown> = {};
    const methods = ["where", "orderBy", "limit", "values", "returning"];
    for (const m of methods) {
      chain[m] = (...args: unknown[]) => {
        if (m === "values") values = (args[0] ?? {}) as Record<string, unknown>;
        return chain;
      };
    }
    chain.from = (t: unknown) => {
      table = (t as { __t?: string } | null)?.__t ?? "";
      return chain;
    };
    chain.then = (resolve: (v: unknown) => unknown, _reject?: unknown) => {
      if (op === "insert") {
        const row = { id: "lbc_generated", ...values };
        state.inserted.push(row);
        return Promise.resolve([{ id: "lbc_generated" }]).then(resolve);
      }
      void table;
      return Promise.resolve(rowsFor(table)).then(resolve);
    };
    return chain;
  }
  return {
    getDb: () => ({
      select: () => fluent("select"),
      insert: (t: unknown) => {
        const c = fluent("insert");
        void (t as { __t?: string });
        return c;
      },
      // UPDATE: aplica el patch a la fila de `lab_case` indicada por
      // `.returning()` y devuelve el objeto ya actualizado.
      update: () => {
        const chain: Record<string, unknown> = {};
        let table = "";
        let patch: Record<string, unknown> = {};
        chain.set = (v: Record<string, unknown>) => {
          patch = v;
          return chain;
        };
        chain.where = () => chain;
        chain.returning = () => chain;
        chain.then = (resolve: (v: unknown) => unknown) => {
          const target =
            table === "labCase"
              ? state.inserted.find((r) => r.id === patch.id) ?? state.inserted[0]
              : state.inserted[0];
          if (target) Object.assign(target, patch);
          void table;
          return Promise.resolve(target ? [target] : []).then(resolve);
        };
        // `.set()` debe conocer la tabla; se resuelve al primer uso.
        return Object.assign(chain, {
          __setTable: (t: string) => {
            table = t;
          },
        });
      },
    }),
    schema: new Proxy(
      {},
      {
        get(_t, prop) {
          if (typeof prop !== "string") return undefined;
          return makeTable(prop);
        },
      }
    ),
  };
});

vi.mock("@/lib/sales/playbook/loader", () => ({
  getPublishedConfigForOrg: async () => state.published,
}));

type RouteModule = typeof import("@/app/api/lab/cases/from-conversation/route");

function loadRoute(): Promise<RouteModule> {
  return import("@/app/api/lab/cases/from-conversation/route") as Promise<RouteModule>;
}

function post(route: RouteModule, body: unknown): Promise<Response> {
  return route.POST(
    new Request("http://localhost/api/lab/cases/from-conversation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never
  ) as Promise<Response>;
}

describe("POST /api/lab/cases/from-conversation (T702)", () => {
  beforeEach(() => {
    state.conversation = { id: "cv_real", contactId: "ct_real" };
    state.salesEnabled = true;
    state.published = { id: "spv_v1", schema_version: "1.0" };
    state.messages = [
      { direction: "in", type: "text", text: "hola, mi numero es 51 999888777" },
      { direction: "out", type: "text", text: "gracias, te escribo a info@vendeveloz.pe" },
      { direction: "in", type: "text", text: "el setup es S/497?" },
    ];
    state.inserted = [];
  });

  it("persiste el caso sin NINGÚN campo identificante", async () => {
    const route = await loadRoute();
    const res = await post(route, { conversation_id: "cv_real" });
    expect(res.status).toBe(201);

    const row = state.inserted[0];
    expect(row).toBeDefined();

    // Garantía explícita del corte: ninguna clave prohibida existe, ni
    // siquiera con valor null.
    for (const key of FORBIDDEN_CASE_KEYS) {
      expect(Object.keys(row!)).not.toContain(key);
    }

    const meta = row!.metadata as Record<string, unknown>;
    for (const key of FORBIDDEN_CASE_KEYS) {
      expect(Object.keys(meta)).not.toContain(key);
    }

    // transcript: solo role + text, texto ya saneado.
    const transcript = row!.transcript as Array<{ role: string; text: string }>;
    expect(transcript).toHaveLength(3);
    for (const turn of transcript) {
      expect(Object.keys(turn).sort()).toEqual(["role", "text"]);
    }
    expect(transcript[0]?.text).toContain("[telefono]");
    expect(transcript[1]?.text).toContain("[email]");
    // El precio NO es PII y debe sobrevivir: es lo que el juez evalúa.
    expect(transcript[2]?.text).toContain("S/497");

    expect(row!.playbookVersionId).toBe("spv_v1");
    expect(row!.playbookSchemaVersion).toBe("1.0");
    expect(row!.organizationId).toBe("org_a");
  });

  it("el transcript serializado no contiene ningún identificador del origen", async () => {
    const route = await loadRoute();
    await post(route, { conversation_id: "cv_real" });
    const row = state.inserted[0]!;
    // Barrido por TODO el JSON persistido: si alguien reintrodujera un
    // id como campo nuevo, esta aserción lo detecta.
    const dumped = JSON.stringify(row);
    expect(dumped).not.toContain("cv_real");
    expect(dumped).not.toContain("ct_real");
    expect(dumped).not.toContain("999888777");
    expect(dumped).not.toContain("vendeveloz.pe");
  });

  it("devuelve 404 si la conversación no existe", async () => {
    state.conversation = null;
    const route = await loadRoute();
    const res = await post(route, { conversation_id: "cv_nope" });
    expect(res.status).toBe(404);
    expect(state.inserted).toHaveLength(0);
  });

  it("devuelve 409 si el Sales Orchestrator está apagado", async () => {
    state.salesEnabled = false;
    const route = await loadRoute();
    const res = await post(route, { conversation_id: "cv_real" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("sales_orchestrator_disabled");
    expect(state.inserted).toHaveLength(0);
  });

  it("devuelve 422 si no hay conversation_id", async () => {
    const route = await loadRoute();
    const res = await post(route, {});
    expect(res.status).toBe(422);
    expect(state.inserted).toHaveLength(0);
  });

  it("omite adjuntos: solo persiste mensajes de texto", async () => {
    state.messages = [
      { direction: "in", type: "text", text: "mira esto" },
      { direction: "in", type: "image", text: null },
      { direction: "out", type: "audio", text: null },
      { direction: "out", type: "text", text: "lo veo" },
    ];
    const route = await loadRoute();
    const res = await post(route, { conversation_id: "cv_real" });
    expect(res.status).toBe(201);
    expect(state.inserted[0]!.transcript as unknown[]).toHaveLength(2);
  });

  it("devuelve 422 si la conversación no tiene texto guardable", async () => {
    state.messages = [{ direction: "in", type: "image", text: null }];
    const route = await loadRoute();
    const res = await post(route, { conversation_id: "cv_real" });
    expect(res.status).toBe(422);
    expect(state.inserted).toHaveLength(0);
  });

  it("guarda playbook_version_id null cuando no hay publicada", async () => {
    state.published = null;
    const route = await loadRoute();
    const res = await post(route, { conversation_id: "cv_real" });
    expect(res.status).toBe(201);
    expect(state.inserted[0]!.playbookVersionId).toBeNull();
    expect(state.inserted[0]!.playbookSchemaVersion).toBeNull();
  });
});

/* ============================================================
 * El editor de expected outcomes es el MISMO para los dos orígenes
 * de caso (corrida del Laboratorio y conversación real).
 * ============================================================ */

describe("PATCH /api/lab/cases/[id]/expected sobre un caso real (T702)", () => {
  beforeEach(() => {
    state.inserted = [];
    state.salesEnabled = true;
    state.published = { id: "spv_v1", schema_version: "1.0" };
  });

  it("edita los expected outcomes de un caso guardado desde conversación real", async () => {
    state.inserted = [
      {
        id: "lbc_1",
        organizationId: "org_a",
        transcript: [{ role: "cliente", text: "hola" }],
        playbookVersionId: "spv_v1",
        playbookSchemaVersion: "1.0",
        expectedNextAction: null,
        expectedLane: null,
        expectedHandoff: null,
      },
    ];
    const route = (await import(
      "@/app/api/lab/cases/[id]/expected/route"
    )) as unknown as {
      PATCH: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
    };
    const res = await route.PATCH(
      new Request("http://localhost/api/lab/cases/lbc_1/expected", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_next_action: "present_price",
          expected_lane: "human",
          expected_handoff: true,
        }),
      }),
      { params: Promise.resolve({ id: "lbc_1" }) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      case: { expectedNextAction: string; origin: string };
    };
    expect(body.case.expectedNextAction).toBe("present_price");
    expect(body.case.origin).toBe("from_conversation");
  });

  it("404 si el caso no existe en ninguna de las dos tablas", async () => {
    const route = (await import(
      "@/app/api/lab/cases/[id]/expected/route"
    )) as unknown as {
      PATCH: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
    };
    const res = await route.PATCH(
      new Request("http://localhost/api/lab/cases/nope/expected", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expected_lane: "human" }),
      }),
      { params: Promise.resolve({ id: "nope" }) }
    );
    expect(res.status).toBe(404);
  });

  it("rechaza un expected fuera del catálogo cerrado", async () => {
    const route = (await import(
      "@/app/api/lab/cases/[id]/expected/route"
    )) as unknown as {
      PATCH: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
    };
    const res = await route.PATCH(
      new Request("http://localhost/api/lab/cases/lbc_1/expected", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expected_next_action: "inventada" }),
      }),
      { params: Promise.resolve({ id: "lbc_1" }) }
    );
    expect(res.status).toBe(422);
  });
});
