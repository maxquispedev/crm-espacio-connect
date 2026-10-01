/**
 * 008 Corte 7 — Saneado de PII para "Guardar conversación como caso".
 *
 * Helper PURO (sin BD, sin red, sin dependencias) para poder testear la
 * política de minimización sin levantar nada. Corre en el servidor
 * ANTES de persistir: el texto que se guarda en `lab_case.transcript`
 * ya viene pasado por aquí.
 *
 * POR QUÉ HAY UN SANEADOR Y NO SOLO "NO GUARDO LAS COLUMNAS":
 * la spec 008 exige que el caso NO contenga `phone`, `email`,
 * `wa_identity`, `ctwa_clid`, `source_id`, `source_url` ni IDs de Meta.
 * Eso se cumple de forma ESTRUCTURAL con la tabla `lab_case`, que no
 * tiene esas columnas. Pero un cliente puede **escribir su propio
 * número o su email dentro del texto** de un mensaje ("escríbeme al
 * 51 999 888 777"), y ese texto sí se persiste porque es el contenido
 * que el Laboratorio necesita para juzgar la conversación. Sin un
 * saneador, el caso volvería a ser un找回 camino a la identidad real.
 *
 * Lo que este módulo hace es reescribir el texto en語 con marcadores
 * neutros: `[telefono]`, `[email]`, `[enlace]`, `[id]`. La conversación
 * sigue siendo legible y evaluable (el juez no necesita el número
 * real), pero el caso ya no resuelve la identidad del lead.
 *
 * Decisión de diseño: el saneador es **conservador**. Ante duda,
 * reemplaza. Un caso de evaluación con `[telefono]` es tan útil como
 * uno con el número, y uno con el número es una fuga.
 */

/** Marcadores neutros que sustituyen a los datos identificantes. */
export const REDACTED = {
  phone: "[telefono]",
  email: "[email]",
  url: "[enlace]",
  id: "[id]",
} as const;

export type TranscriptTurn = { role: "cliente" | "agente"; text: string };

/** Turnos máximos que se persisten. conversations más largas se recortan. */
export const MAX_TURNS = 200;

/** Caracteres máximos por turno (best-effort, no trunca a media palabra). */
export const MAX_TURN_CHARS = 4000;

/**
 * Detección de teléfono. Cubre formatos Peruvianos y internacionales:
 * `+51 999 888 777`, `51 999888777`, `999-888-777`, `(999) 888 7777`.
 *
 * Exige al menos 9 dígitos IGNORANDO separadores para no destructurar
 * precios ("S/197", "S/1,500") ni fechas ("12/05"). Un precio suelto
 * nunca es una identidad.
 */
function redactPhones(input: string): string {
  // Separadores habituales entre dígitos: espacio, guion, punto, paréntesis,
  // guion medio/no-break. El separador NO puede aparecer solo: exigimos
  // dígitos a ambos lados para no comerse un "S/ 197".
  const digit = "[0-9]";
  const sep = "[\\s.\\-()\\u2013\\u2014]";

  // Un teléfono tiene 9+ dígitos en total. El `(?<![\dA-Za-z])` evita
  // comer dígitos que ya son parte de un token alfanumérico, y el `\+?`
  // inicial captura el prefijo internacional (`+51`, `+1`) sin exigir un
  // `\b`, que no puede ir justo antes de un `+`.
  const start = `(?<![\\dA-Za-z])\\+?${digit}{1,4}(?:${sep}*${digit}){7,14}`;
  const pattern = new RegExp(start, "g");

  return input.replace(pattern, (match) => {
    const digits = match.replace(/[^0-9]/g, "");
    // 9..15 dígitos = rango de teléfono válido (E.164). Menos de 9 puede
    // ser un precio, un año o un número de alumno: NO es identidad.
    if (digits.length < 9 || digits.length > 15) return match;
    return REDACTED.phone;
  });
}

/**
 * Detección de email. Primero intentamos un patrón estricto; los emails
 * mal formados con espacios (`nombre @ gmail . com`) los cubre el
 * segundo patrón, con espacios tolerados alrededor de `@` y `.`.
 */
function redactEmails(input: string): string {
  const strict = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const loose = /[A-Za-z0-9._%+-]+[\s]*@[\s]*[A-Za-z0-9.-]+[\s]*\.[\s]*[A-Za-z]{2,}/g;
  let out = input.replace(strict, REDACTED.email);
  out = out.replace(loose, REDACTED.email);
  return out;
}

/**
 * URLs. Se eliminan completas (query string incluida): los enlaces de
 * seguimiento de Meta y de UTM son el camino más directo a la campaña y
 * al anuncio que originó la conversación.
 */
function redactUrls(input: string): string {
  return input.replace(/\b(?:https?:\/\/|www\.)\S+/gi, REDACTED.url);
}

/**
 * Tokens que parecen identificadores de plataforma:
 * `ctwa_clid`, `wa_message_id`, `fbtrace_id`, `psid`, `ad_id`,
 * `waba_id`, `phone_number_id`, `bsuid:...` y similares.
 *
 * Se redactan por CLAVE (no por valor arbitrario) para no destruir el
 * texto normal del agente.
 */
const ID_KEYED_PATTERNS: RegExp[] = [
  // `ctwa_clid=...` y `fbclid=...` dentro o fuera de un query ya borrado.
  /\b(?:ctwa_clid|fbclid|gclid|msclkid|fbtrace_id|waba_id|phone_number_id|ad_id|adset_id|campaign_id|psid|wa_message_id|bsuid)\s*[:=]\s*\S+/gi,
  // BSUID completo con prefijo.
  /\bbsuid:\S+/gi,
];

/**
 * Secuencias largas de dígitos con letras mezcladas que son claramente
 * un token de plataforma (`g_abc123`, `spv_xyz`, `wa-9A8B7C`). Solo
 * cuando el prefijo es alfanumérico conocido; los números sueltos ya
 * los cubre `redactPhones`.
 */
const TOKEN_PREFIXES = [
  "g_",
  "sp_",
  "spv_",
  "ct_",
  "cv_",
  "ld_",
  "msg_",
  "adr_",
  "cev_",
  "ccs_",
  "sfj_",
  "case_",
  "lbc_",
  "run_",
];

function redactPlatformTokens(input: string): string {
  let out = input;
  for (const p of ID_KEYED_PATTERNS) {
    out = out.replace(p, REDACTED.id);
  }
  for (const prefix of TOKEN_PREFIXES) {
    const re = new RegExp(`\\b${prefix}[A-Za-z0-9_-]{6,}`, "g");
    out = out.replace(re, REDACTED.id);
  }
  return out;
}

/**
 * Sanea UN texto de mensaje. Aplica, en este orden:
 * URLs → emails → teléfonos → tokens de plataforma.
 *
 * El orden importa: primero las URLs (que arrastran emails y dígitos en
 * el query), luego emails, luego teléfonos (que podrían partir un id),
 * y al final los tokens.
 *
 * Nunca lanza. Si una regla falla, el texto original de ESA regla
 * sobrevive: un error de saneado nunca tumba la petición: degrada (y la
 * capa de arriba decide si eso es aceptable).
 */
export function sanitizeTranscriptText(input: string | null | undefined): string {
  if (!input) return "";
  let out = String(input);
  const rules: Array<(s: string) => string> = [
    redactUrls,
    redactEmails,
    redactPhones,
    redactPlatformTokens,
  ];
  for (const rule of rules) {
    try {
      out = rule(out);
    } catch {
      // Un turno que no se puede sanear se marca en vez de persistirlo crudo.
      out = out.replace(/\S/g, REDACTED.id);
      break;
    }
  }
  return out;
}

/**
 * Recorta un turno a `MAX_TURN_CHARS` sin cortar a media palabra cuando
 * es posible. Recortar es preferible a perder el turno completo: un
 * mensaje de 10 KB no es material de evaluación y sí es un vector de
 * fuga.
 */
export function clampTurn(text: string): string {
  if (text.length <= MAX_TURN_CHARS) return text;
  const slice = text.slice(0, MAX_TURN_CHARS);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > MAX_TURN_CHARS * 0.6 ? slice.slice(0, lastSpace) : slice) + "…";
}

/**
 * Sanea la lista completa de turnos: aplica `sanitizeTranscriptText` a
 * cada uno, descarta turnos vacíos y recorta a `MAX_TURNS`.
 */
export function sanitizeTranscript(turns: readonly TranscriptTurn[]): TranscriptTurn[] {
  const out: TranscriptTurn[] = [];
  for (const turn of turns) {
    if (!turn || (turn.role !== "cliente" && turn.role !== "agente")) continue;
    const text = clampTurn(sanitizeTranscriptText(turn.text).trim());
    if (!text) continue;
    out.push({ role: turn.role, text });
    if (out.length >= MAX_TURNS) break;
  }
  return out;
}

/**
 * Detección de idioma MUY simple y deliberadamente grosera: cuenta
 * palabras funcionales del español contra el inglés. No se usa para
 * decidir nada del motor, solo como metadata no identificante que ayuda
 * a elegir la persona del Laboratorio más parecida.
 */
export function detectLanguage(text: string): string {
  const es = (text.match(/\b(de|que|para|con|una|por|como|necesito|quiero|precio|hola|gracias|alumnos?|academia)\b/gi) ?? []).length;
  const en = (text.match(/\b(the|and|for|with|price|hello|thanks|i|we|need|want)\b/gi) ?? []).length;
  if (es === 0 && en === 0) return "und";
  if (es >= en) return "es";
  return "en";
}

/**
 * Metadata NO identificante y estrictamente necesaria. Deliberadamente
 * NO incluye: timestamps exactos, duración, cantidad de mensajes por
 * parte con marcas de tiempo, ni nada que permita alinear el caso con
 * una ventana temporal de la operación real.
 */
export function buildCaseMetadata(turns: readonly TranscriptTurn[]): {
  turns_approx: number;
  chars_total: number;
  detected_language: string;
} {
  const joined = turns.map((t) => t.text).join(" ");
  return {
    // "aproximado" a propósito: no guardamos el conteo exacto de
    // mensajes del cliente vs agente, que sí es una señal de patrón.
    turns_approx: Math.max(1, Math.round(turns.length / 2)),
    chars_total: joined.length,
    detected_language: detectLanguage(joined),
  };
}

/**
 * Lista explícita de claves que NUNCA deben aparecer en un caso.
 * Se exporta para que los tests iteren sobre ella y no dependan de que
 * alguien recuerde escribir la aserción.
 */
export const FORBIDDEN_CASE_KEYS = [
  "lead_id",
  "contact_id",
  "conversation_id",
  "conversationId",
  "phone",
  "email",
  "wa_identity",
  "waIdentity",
  "wa_user_id",
  "ctwa_clid",
  "source_id",
  "source_url",
  "sourceId",
  "sourceUrl",
  "image_asset_id",
  "ad_id",
  "fbtrace_id",
  "access_token",
  "token",
] as const;
