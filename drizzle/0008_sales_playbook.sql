-- 008 - Sales Playbook: modelo + versionado (Corte 1).
--
-- Aditiva: dos tablas nuevas (`sales_playbook`, `sales_playbook_version`)
-- + dos columnas nuevas en `lead` (snapshot del playbook en uso).
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitución IV):
-- IF NOT EXISTS en tablas/índices/checks/columns, y bloque DO con
-- EXCEPTION WHEN duplicate_object para las FK.
--
-- Puramente ADITIVA. No toca tablas existentes. El runtime productivo
-- no se ve afectado: las nuevas columnas son NULL mientras no haya
-- playbook publicado, y el loader no entra hasta Corte 3.

-- ============================================================
-- sales_playbook — un playbook por organización en V1
-- ============================================================

CREATE TABLE IF NOT EXISTS "sales_playbook" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "slug" text NOT NULL,
  "label" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sales_playbook"
    ADD CONSTRAINT "sales_playbook_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- Un playbook por organización en V1.
CREATE UNIQUE INDEX IF NOT EXISTS "sales_playbook_org_uq"
  ON "sales_playbook" USING btree ("organization_id");
--> statement-breakpoint

-- Lookup por slug (preparado para multi-playbook futuro; V1 solo usa uno).
CREATE INDEX IF NOT EXISTS "sales_playbook_slug_idx"
  ON "sales_playbook" USING btree ("slug");
--> statement-breakpoint

-- ============================================================
-- sales_playbook_version — historial inmutable de versiones
-- ============================================================

CREATE TABLE IF NOT EXISTS "sales_playbook_version" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "playbook_id" text NOT NULL,
  "version_number" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "schema_version" text NOT NULL,
  "product_json" jsonb NOT NULL,
  "policy_json" jsonb NOT NULL,
  "offer_json" jsonb NOT NULL,
  "priorities_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "writer_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "jev_questions_json" jsonb NOT NULL,
  "prohibitions_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "handoff_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "urgency_rules" text,
  "notes" text,
  "created_by" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "published_at" timestamp,
  "published_by" text,
  "archived_at" timestamp
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sales_playbook_version"
    ADD CONSTRAINT "sales_playbook_version_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sales_playbook_version"
    ADD CONSTRAINT "sales_playbook_version_playbook_id_sales_playbook_id_fk"
    FOREIGN KEY ("playbook_id") REFERENCES "public"."sales_playbook"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- version_number único por playbook.
CREATE UNIQUE INDEX IF NOT EXISTS "sales_playbook_version_playbook_number_uq"
  ON "sales_playbook_version" USING btree ("playbook_id","version_number");
--> statement-breakpoint

-- Solo una fila `published` por playbook (índice parcial UNIQUE).
CREATE UNIQUE INDEX IF NOT EXISTS "sales_playbook_version_published_uq"
  ON "sales_playbook_version" USING btree ("playbook_id")
  WHERE "status" = 'published';
--> statement-breakpoint

-- Solo una fila `draft` por playbook (índice parcial UNIQUE).
CREATE UNIQUE INDEX IF NOT EXISTS "sales_playbook_version_draft_uq"
  ON "sales_playbook_version" USING btree ("playbook_id")
  WHERE "status" = 'draft';
--> statement-breakpoint

-- Listados por organización, filtrando por status.
CREATE INDEX IF NOT EXISTS "sales_playbook_version_org_status_idx"
  ON "sales_playbook_version" USING btree ("organization_id","status");
--> statement-breakpoint

-- Listados cronológicos por organización.
CREATE INDEX IF NOT EXISTS "sales_playbook_version_org_created_idx"
  ON "sales_playbook_version" USING btree ("organization_id","created_at" DESC);
--> statement-breakpoint

-- Catálogo cerrado de status (corte 1: solo draft/published/archived).
DO $$ BEGIN
  ALTER TABLE "sales_playbook_version"
    ADD CONSTRAINT "sales_playbook_version_status_check"
    CHECK ("status" IN ('draft','published','archived'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- ============================================================
-- lead — snapshot del playbook que atendió al lead
-- ============================================================

ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "last_jev_playbook_version_id" text;
--> statement-breakpoint

ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "last_jev_playbook_schema_version" text;
