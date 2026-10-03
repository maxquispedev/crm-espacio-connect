/**
 * Sales Playbook — la regla de la action bar y la proyección en dos
 * documentos (Feature 010, Corte 1, C1-1 y C1-3).
 *
 * Este módulo es **puro y sin React** a propósito: es la parte de la pantalla
 * que decide si Publicar se puede pulsar, y una regla de seguridad tiene que
 * poder testearse sin navegador. El componente la consume; no la reimplementa.
 *
 * ## Por qué vive aquí la regla de Publicar
 *
 * `POST /api/playbook/publish` publica el draft **persistido**, no el texto
 * local. Con el botón habilitado en `dirty=true` el admin publicaba creyendo
 * que sube lo que está escribiendo, cuando en realidad se republicaba la
 * versión anterior de su draft y su trabajo seguía sin guardar. La regla
 * correcta es la inversa: con cambios sin guardar, Publicar está apagado y
 * dice por qué.
 *
 * **No hay autosave**: corregir la inversión no puede introducir un guardado
 * implícito. Guardar solo se habilita por `dirty` explícito.
 */

import { parseJsonDocument } from "./json-editor";

/* ============================================================
 * La proyección Config / Preguntas Jev (contrato §4)
 * ============================================================ */

/** Claves de `ConfigV1` que edita el documento de Config. */
export const CONFIG_EDITABLE_KEYS = [
  "product",
  "offer",
  "commercial_policy",
  "priorities",
  "writer",
  "prohibitions",
  "handoff",
  "urgency_rules",
] as const;

export const CONFIG_TAB = "config";
export const JEV_TAB = "jev";

export type DraftTab = typeof CONFIG_TAB | typeof JEV_TAB;

/** Los dos tabs. Uno visible a la vez; el estado de ambos vive en el padre. */
export const TABS: ReadonlyArray<{ id: DraftTab; label: string }> = [
  { id: CONFIG_TAB, label: "Config" },
  { id: JEV_TAB, label: "Preguntas Jev" },
];

/* ============================================================
 * La regla de la action bar (contrato §6, normativa)
 * ============================================================ */

export type DraftActionInput = {
  /** Hay una operación (guardar/validar/publicar/eliminar) en vuelo. */
  busy: boolean;
  /** El texto local difiere del draft persistido. */
  dirty: boolean;
  /** Alguno de los dos documentos no parsea o no es un objeto. */
  anySyntaxError: boolean;
  /** Hay una versión publicada: sin ella no se puede eliminar el draft. */
  canDelete: boolean;
};

export type DraftActions = {
  validate: boolean;
  save: boolean;
  publish: boolean;
  discard: boolean;
  remove: boolean;
  /** Por qué Publicar está (o no) disponible. */
  publishTitle: string;
};

/**
 * Las cinco acciones de la barra, como `disabled` de cada `Button`.
 *
 * Invariante 1: `publish` es `false` **siempre** que `dirty` sea `true`, y
 * también si hay JSON que no parsea. Lo segundo lo cubre un hueco del código
 * anterior: Publicar no miraba la sintaxis, así que un texto roto pero
 * persistido quedaba publicable.
 *
 * Invariante 2: `busy` apaga las cinco. Nadie publica ni borra mientras hay
 * otra operación en vuelo.
 */
export function draftActions({
  busy,
  dirty,
  anySyntaxError,
  canDelete,
}: DraftActionInput): DraftActions {
  return {
    validate: !(busy || anySyntaxError),
    save: !(busy || anySyntaxError || !dirty),
    publish: !(busy || dirty || anySyntaxError),
    discard: !(busy || !dirty),
    remove: !(busy || !canDelete),
    publishTitle: dirty
      ? "Guarda los cambios antes de publicar"
      : anySyntaxError
        ? "Corrige la sintaxis JSON antes de publicar"
        : "POST /api/playbook/publish: publica el draft guardado",
  };
}

/* ============================================================
 * El reassembly del documento completo
 * ============================================================ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Objeto parseado de un documento, o `null` si no parsea o no es objeto. */
function objectOf(text: string): Record<string, unknown> | null {
  const parsed = parseJsonDocument(text);
  return parsed.ok && isPlainObject(parsed.value) ? parsed.value : null;
}

export type ReassembleInput = {
  configText: string;
  jevText: string;
  schemaVersion?: string;
};

/**
 * Reensambla el `ConfigV1` completo desde los dos documentos editados.
 * Devuelve `null` si alguno no parsea o no es un objeto: entonces no hay nada
 * que mandar y la UI ya está mostrando el error de sintaxis.
 *
 * `includeSchemaVersion` NO es cosmético: `PUT /api/playbook/draft` usa un
 * cuerpo `.strict()` de los nueve bloques (el `schema_version` lo pone el
 * servidor al mergear con el draft), mientras que
 * `POST /api/playbook/validate` corre `ConfigV1Schema.safeParse` sobre el body
 * tal cual, y ahí `schema_version: z.literal("1.0")` es **obligatorio**.
 * Omitirlo haría que Validar fallara siempre.
 *
 * Los dos documentos entran siempre, esté visible el tab que esté: por eso
 * cambiar de tab no puede perder lo escrito.
 */
export function reassembleDocuments(
  { configText, jevText, schemaVersion }: ReassembleInput,
  { includeSchemaVersion = false }: { includeSchemaVersion?: boolean } = {}
): Record<string, unknown> | null {
  const config = objectOf(configText);
  const jev = objectOf(jevText);
  if (!config || !jev) return null;
  return {
    ...(includeSchemaVersion && schemaVersion
      ? { schema_version: schemaVersion }
      : {}),
    ...config,
    jev_questions: jev,
  };
}
