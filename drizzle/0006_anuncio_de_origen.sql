-- 006 - De que anuncio de Meta llego cada conversacion (sin CAPI todavia).
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitucion IV):
-- IF NOT EXISTS en tabla e indices, y bloque DO con
-- EXCEPTION WHEN duplicate_object para las FK.
--
-- Puramente ADITIVA: una tabla nueva + tres FK + dos indices. No toca
-- tablas existentes.
--
-- Mismos nombres de columna que la 0014 del upstream 018
-- (kevinrivm/vocero-crm) para que el shape sea compatible si en el futuro
-- se sincronizan las dos bases.

CREATE TABLE IF NOT EXISTS "ad_attribution" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "contact_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "ctwa_clid" text,
  "source_id" text,
  "source_type" text,
  "source_url" text,
  "headline" text,
  "body" text,
  "media_type" text,
  "raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "image_asset_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ad_attribution"
    ADD CONSTRAINT "ad_attribution_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ad_attribution"
    ADD CONSTRAINT "ad_attribution_contact_id_contact_id_fk"
    FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ad_attribution"
    ADD CONSTRAINT "ad_attribution_conversation_id_conversation_id_fk"
    FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ad_attribution"
    ADD CONSTRAINT "ad_attribution_image_asset_id_media_asset_id_fk"
    FOREIGN KEY ("image_asset_id") REFERENCES "public"."media_asset"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ad_attribution_org_conversation_uq"
  ON "ad_attribution" USING btree ("organization_id","conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_attribution_org_source_idx"
  ON "ad_attribution" USING btree ("organization_id","source_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_attribution_org_created_idx"
  ON "ad_attribution" USING btree ("organization_id","created_at");
