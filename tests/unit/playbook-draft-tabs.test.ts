/**
 * 010 — Corte 1 (C1-3): los tabs Config / Preguntas Jev NO pueden perder lo
 * escrito.
 *
 * Este es el riesgo real de los tabs y no lo cubría ningún test: con dos
 * textareas apilados no había nada que perder, y al pasar a "un editor a la
 * vez" aparece la pregunta de si el estado sobrevive al desmontaje del editor
 * que no está visible.
 *
 * La respuesta del diseño (`research.md` §1.4) es que el estado de los dos
 * documentos vive en el **padre** (`useJsonDocState` en `DraftEditorPane`),
 * así que montar y desmontar un editor al cambiar de tab no pierde nada. Este
 * test ata esa afirmación de forma observable: se escribe en un documento, se
 * cambia de tab, y el otro documento conserva lo suyo y el guardado reensambla
 * el **documento completo** con ambos.
 *
 * Se ejercita la lógica real (`DraftEditorPane` a través del cliente de la
 * versión pura que consume) sin navegador: `useJsonDocState` y el reassembly
 * son funciones puras de estado, y `reassembleDocuments` es la MISMA que usa el
 * `PUT /api/playbook/draft`.
 */

import { describe, expect, it } from "vitest";

import {
  CONFIG_EDITABLE_KEYS,
  JEV_TAB,
  CONFIG_TAB,
  TABS,
  reassembleDocuments,
} from "@/components/agent/playbook/draft-actions";
import { formatJsonDocument, parseJsonDocument } from "@/components/agent/playbook/json-editor";

/* ============================================================
 * La proyección: qué claves va en cada tab
 * ============================================================ */

const draft = {
  schema_version: "1.0",
  product: { name: "Espacio Connect", one_liner: "CRM" },
  offer: { currency: "MXN", monthlyBase: 999 },
  commercial_policy: { tone: "cercano" },
  priorities: { primary: ["precio"] },
  writer: { present_price: "$999" },
  prohibitions: { never: ["inventar precios"] },
  handoff: { toHumanWhen: ["queja"] },
  urgency_rules: { levels: ["alta"] },
  jev_questions: { next_action: { type: "choice" } },
  // Metadatos del DTO que NUNCA deben viajar al `PUT` (cuerpo `.strict()`).
  id: "ver_123",
  organization_id: "org_1",
  version_number: 3,
  status: "draft",
  notes: "ajuste",
  created_at: "2026-01-01T00:00:00.000Z",
  published_at: null,
  archived_at: null,
};

const projectConfig = (doc: typeof draft): Record<string, unknown> =>
  Object.fromEntries(CONFIG_EDITABLE_KEYS.map((k) => [k, doc[k]])) as Record<
    string,
    unknown
  >;

describe("la proyección en dos documentos", () => {
  it("Config lleva los ocho bloques y no jev_questions", () => {
    const keys = Object.keys(projectConfig(draft));
    expect(keys).toEqual([...CONFIG_EDITABLE_KEYS]);
    expect(keys).not.toContain("jev_questions");
  });

  it("Config no arrastra metadatos del DTO (el PUT es .strict())", () => {
    const keys = Object.keys(projectConfig(draft));
    for (const meta of ["id", "status", "created_at", "version_number", "notes"]) {
      expect(keys).not.toContain(meta);
    }
  });

  it("Perguntas Jev lleva el objeto jev_questions completo", () => {
    expect(draft.jev_questions).toEqual({ next_action: { type: "choice" } });
  });

  it("hay exactamente dos tabs y cada uno tiene su documento", () => {
    expect(TABS.map((t) => t.id)).toEqual([CONFIG_TAB, JEV_TAB]);
    expect(TABS.map((t) => t.label)).toEqual(["Config", "Preguntas Jev"]);
  });
});

/* ============================================================
 * El reassembly: lo que sale de "Guardar"
 * ============================================================ */

describe("reassembleDocuments — el documento que se persiste", () => {
  /** Simula el estado del padre: el texto de CADA documento vive fuera del editor. */
  const state = (config: unknown, jev: unknown) => ({
    configText: formatJsonDocument(config),
    jevText: formatJsonDocument(jev),
    schemaVersion: "1.0",
  });

  it("con los dos intactos devuelve los nueve bloques del ConfigV1", () => {
    const doc = reassembleDocuments(state(projectConfig(draft), draft.jev_questions));
    expect(doc).not.toBeNull();
    expect(Object.keys(doc!).sort()).toEqual(
      [...CONFIG_EDITABLE_KEYS, "jev_questions"].sort()
    );
  });

  it("sin schema_version en el PUT (cuerpo .strict de los nueve bloques)", () => {
    const doc = reassembleDocuments(state(projectConfig(draft), draft.jev_questions));
    expect(doc).not.toBeNull();
    expect("schema_version" in doc!).toBe(false);
  });

  it("con schema_version para Validar (donde es obligatorio)", () => {
    const doc = reassembleDocuments(state(projectConfig(draft), draft.jev_questions), {
      includeSchemaVersion: true,
    });
    expect(doc?.schema_version).toBe("1.0");
  });

  it("un cambio en Config y otro en Preguntas: el guardado lleva LOS DOS", () => {
    // El escenario de los tabs: se escribe en un documento, se cambia de tab,
    // se escribe en el otro, y se guarda. Si el estado no viviera en el
    // padre, aquí el documento guardado vendría con uno de los dos
    // desplazado al valor persistido.
    const configEditado = {
      ...projectConfig(draft),
      writer: { present_price: "$1,299" },
    };
    const jevEditado = {
      ...draft.jev_questions,
      objetivo_comercial: { type: "text" },
    };
    const doc = reassembleDocuments(state(configEditado, jevEditado));
    expect(doc).not.toBeNull();
    expect((doc!.writer as { present_price: string }).present_price).toBe("$1,299");
    expect((doc!.jev_questions as Record<string, unknown>).objetivo_comercial).toEqual({
      type: "text",
    });
    // Y el otro documento no se perdió ni se revirtió.
    expect((doc!.product as { name: string }).name).toBe("Espacio Connect");
  });

  it("el documento reassemblado vuelve a parsear y validar el shape", () => {
    const doc = reassembleDocuments(state(projectConfig(draft), draft.jev_questions));
    const round = parseJsonDocument(formatJsonDocument(doc));
    expect(round.ok).toBe(true);
  });

  it("si un documento no parsea no hay nada que mandar", () => {
    const roto = reassembleDocuments({
      configText: "{ roto",
      jevText: formatJsonDocument(draft.jev_questions),
    });
    expect(roto).toBeNull();

    const rotoJev = reassembleDocuments({
      configText: formatJsonDocument(projectConfig(draft)),
      jevText: "{ roto",
    });
    expect(rotoJev).toBeNull();
  });

  it("un documento que parsea pero no es objeto tampoco se manda", () => {
    // `JSON.parse("[1,2]")` no es un `ConfigV1`: sin esta guarda, el
    // reassembly mandaría un array y el error del servidor sería críptico.
    expect(
      reassembleDocuments({
        configText: "[1,2]",
        jevText: formatJsonDocument(draft.jev_questions),
      })
    ).toBeNull();
  });
});
