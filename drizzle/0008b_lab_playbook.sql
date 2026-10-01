-- 0008b - Sales Playbook: Laboratorio comercial (Corte 6, T603).
--
-- Aditiva y RE-EJECUTABLE (Constitución IV): todo es
-- `ADD COLUMN IF NOT EXISTS` / `CREATE [UNIQUE] INDEX IF NOT EXISTS`.
-- Postgres 9.6+ soporta `ADD COLUMN IF NOT EXISTS`.
--
-- Qué añade:
--   1. `agent_test_run.playbook_mode` — contra qué versión del playbook
--      corrió la corrida ('published' | 'draft' | 'archived:<id>').
--      El lock de concurrencia pasa de UNIQUE(organization_id) WHERE
--      running a UNIQUE(organization_id, playbook_mode) WHERE running,
--      para que `playbook_mode: "both"` pueda correr published y draft
--      EN PARALELO sin pisarse.
--   2. `agent_test_case.playbook_version_id` / `playbook_schema_version`
--      — qué versión atendió cada caso (trazabilidad de la comparación).
--   3. `agent_test_case.expected_*` — outcomes esperados, editados a
--      mano por el dueño (nunca autocompletados).
--   4. `agent_test_case.actual_*` — outcomes observados por el motor,
--      para poder pintar ✅/❌ sin recalcular en cada request.
--
-- NO toca datos existentes: todas las columnas nacen NULL y el
-- `playbook_mode` nace con DEFAULT 'published'. Las corridas legacy
-- siguen siendo legibles y los casos viejos se muestran con "—"
-- (sin expected, sin actual).

-- ============================================================
-- agent_test_run.playbook_mode
-- ============================================================

ALTER TABLE "agent_test_run"
  ADD COLUMN IF NOT EXISTS "playbook_mode" text NOT NULL DEFAULT 'published';
--> statement-breakpoint

-- El lock viejo era UNIQUE(organization_id) WHERE status='running':
-- impedía dos corridas simultáneas (published + draft). Se reemplaza por
-- un lock por (organización, modo).
DROP INDEX IF EXISTS "test_run_org_running_uq";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "test_run_org_mode_running_uq"
  ON "agent_test_run" ("organization_id", "playbook_mode")
  WHERE "agent_test_run"."status" = 'running';
--> statement-breakpoint

-- ============================================================
-- agent_test_case — versión de playbook + expected + actual
-- ============================================================

ALTER TABLE "agent_test_case"
  ADD COLUMN IF NOT EXISTS "playbook_version_id" text NULL;
--> statement-breakpoint

ALTER TABLE "agent_test_case"
  ADD COLUMN IF NOT EXISTS "playbook_schema_version" text NULL;
--> statement-breakpoint

ALTER TABLE "agent_test_case"
  ADD COLUMN IF NOT EXISTS "expected_next_action" text NULL;
--> statement-breakpoint

ALTER TABLE "agent_test_case"
  ADD COLUMN IF NOT EXISTS "expected_lane" text NULL;
--> statement-breakpoint

ALTER TABLE "agent_test_case"
  ADD COLUMN IF NOT EXISTS "expected_handoff" boolean NULL;
--> statement-breakpoint

ALTER TABLE "agent_test_case"
  ADD COLUMN IF NOT EXISTS "actual_next_action" text NULL;
--> statement-breakpoint

ALTER TABLE "agent_test_case"
  ADD COLUMN IF NOT EXISTS "actual_lane" text NULL;
--> statement-breakpoint

ALTER TABLE "agent_test_case"
  ADD COLUMN IF NOT EXISTS "actual_handoff" boolean NULL;
--> statement-breakpoint
