/**
 * Sales Playbook — Tipos del cliente (Corte 4, Feature 008).
 *
 * Espejo de los DTO que expone `/api/playbook*` (ver
 * `src/app/api/playbook/_dto.ts`). Los declaramos aquí, y no
 * importando de `_dto.ts`, porque aquel módulo arrastra tipos de BD
 * (server-only) al bundle del cliente; el contrato de red es lo único
 * que la UI necesita conocer.
 *
 * Si cambia el shape en `_dto.ts`, cambia aquí también.
 */

import type { ConfigV1 } from "@/lib/sales/playbook/schema";

export type PlaybookVersionStatus = "draft" | "published" | "archived";

/** Versión completa (GET /api/playbook, POST/PUT draft, publish…). */
export type PlaybookVersionDto = ConfigV1 & {
  id: string;
  version_number: number;
  status: PlaybookVersionStatus;
  notes: string | null;
  created_at: string;
  published_at: string | null;
  archived_at: string | null;
  size_bytes?: number;
};

/** Versión resumida (GET /api/playbook/versions). */
export type PlaybookVersionSummaryDto = Pick<
  PlaybookVersionDto,
  | "id"
  | "version_number"
  | "schema_version"
  | "status"
  | "notes"
  | "created_at"
  | "published_at"
  | "archived_at"
> & { size_bytes: number };

export type PlaybookHeaderDto = {
  id: string;
  organization_id: string;
  slug: string;
  label: string;
  created_at: string;
  updated_at: string;
};

/** Respuesta de GET /api/playbook (404 si no hay nada todavía). */
export type PlaybookStateDto = {
  playbook: PlaybookHeaderDto | null;
  published: PlaybookVersionDto | null;
  draft: PlaybookVersionDto | null;
};

/** Detalle de error del 422 de `/api/playbook/validate`. */
export type ValidationIssue = {
  code?: string;
  path: string;
  message: string;
};

export type ApiErrorBody = {
  code?: string;
  message?: string;
  details?: ValidationIssue[];
};

/**
 * Lee un body de error de la API y devuelve un mensaje apto para UI.
 * Los errores de la API siempre traen `message` en español legible
 * (ver `playbook-api.md`); si algo falla antes de generarse, caemos
 * al status HTTP.
 */
export async function readApiError(
  res: Response,
  fallback: string
): Promise<string> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return body.message ?? fallback;
  } catch {
    return `${fallback} (HTTP ${res.status})`;
  }
}
