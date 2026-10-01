-- 0008c - Sales Playbook: "Guardar conversación como caso" (Corte 7, T702).
--
-- Aditiva y RE-EJECUTABLE (Constitución IV): todo es
-- `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`.
--
-- Por qué una tabla NUEVA y no reusar `agent_test_case`:
-- la política de PII minimizada de la spec 008 exige que el caso
-- persistido NO contenga conversation_id, contact_id, lead_id, phone,
-- email, wa_identity, ctwa_clid, source_id, source_url ni IDs de Meta.
-- `agent_test_case` tiene una columna `conversation_id` y un `run_id`
-- NOT NULL: guardar una conversación real ahí obligaría a fabricar una
-- corrida y dejaría una columna de identidad lista para colar un id.
-- En `lab_case` la garantía es ESTRUCTURAL: la columna no existe, así
-- que no se puede filtrar aunque alguien añada un campo al INSERT.
--
-- Lo ÚNICO que viaja desde la conversación real es el texto ya
-- saneado del transcript ({role, text}[]), la versión de playbook
-- publicada al momento de guardar y tres contadores no identificantes.

CREATE TABLE IF NOT EXISTS "lab_case" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL
    REFERENCES "organization"("id") ON DELETE cascade,
  "transcript" jsonb NOT NULL,
  "playbook_version_id" text,
  "playbook_schema_version" text,
  "expected_next_action" text,
  "expected_lane" text,
  "expected_handoff" boolean,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "lab_case_org_idx"
  ON "lab_case" ("organization_id", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "lab_case_playbook_version_idx"
  ON "lab_case" ("playbook_version_id");
