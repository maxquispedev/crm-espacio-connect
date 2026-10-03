import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const nano = customAlphabet(alphabet, 20);

const prefixes = {
  organization: "org",
  member: "mem",
  contact: "ct",
  conversation: "cv",
  message: "msg",
  lead: "ld",
  stage: "stg",
  credentials: "cred",
  agentProfile: "agp",
  kbEntry: "kb",
  template: "tpl",
  testRun: "run",
  testCase: "case",
  mediaAsset: "ma",
  commercialResource: "cr",
  integrationEvent: "iev",
  salesFollowUpJob: "sfj",
  adAttribution: "adr",
  conversionEvent: "cev",
  capiSettings: "ccs",
  /** 008 — Sales Playbook (config contenedor por organización). */
  salesPlaybook: "sp",
  /** 008 — Versión inmutable de un playbook (draft/published/archived). */
  salesPlaybookVersion: "spv",
  /** 008 Corte 7 — Caso de evaluación anonimizado desde conversación real. */
  labCase: "lbc",
} as const;

export type IdKind = keyof typeof prefixes;

export function newId(kind: IdKind): string {
  return `${prefixes[kind]}_${nano()}`;
}
