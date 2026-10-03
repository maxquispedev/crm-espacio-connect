-- 011 C1: aditiva/re-ejecutable, sin seeds. FK compuesta impide media ajena.
CREATE UNIQUE INDEX IF NOT EXISTS "media_asset_org_id_uq"
  ON "media_asset" USING btree ("organization_id", "id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commercial_resource" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "slot" text NOT NULL,
  "media_asset_id" text,
  "payload" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "commercial_resource" ADD CONSTRAINT "commercial_resource_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "commercial_resource" ADD CONSTRAINT "commercial_resource_org_media_fk"
    FOREIGN KEY ("organization_id", "media_asset_id")
    REFERENCES "public"."media_asset"("organization_id", "id") ON DELETE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commercial_resource_org_slot_uq"
  ON "commercial_resource" USING btree ("organization_id", "slot");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commercial_resource_org_media_idx"
  ON "commercial_resource" USING btree ("organization_id", "media_asset_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "commercial_resource" ADD CONSTRAINT "commercial_resource_slot_check"
    CHECK ("slot" IN ('demo_enrollment_panel', 'demo_payments_balances', 'demo_online_enrollment', 'payment_instructions'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- Forma básica en SQL. Detalle de cuentas/Yape/link validado por Zod en store.
-- COALESCE false impide que claves ausentes pasen el CHECK como UNKNOWN.
DO $$ BEGIN
  ALTER TABLE "commercial_resource" ADD CONSTRAINT "commercial_resource_shape_check"
    CHECK (coalesce((
      ("slot" <> 'payment_instructions' AND "media_asset_id" IS NOT NULL AND "payload" IS NULL)
      OR ("slot" = 'payment_instructions' AND "media_asset_id" IS NULL AND "payload" IS NOT NULL
        AND jsonb_typeof("payload") = 'object'
        AND "payload" ?& ARRAY['transfers', 'yape', 'paymentLink']
        AND jsonb_typeof("payload"->'transfers') = 'array'
        AND CASE WHEN jsonb_typeof("payload"->'transfers') = 'array'
          THEN jsonb_array_length("payload"->'transfers') <= 5 ELSE false END
        AND jsonb_typeof("payload"->'yape') IN ('object', 'null')
        AND jsonb_typeof("payload"->'paymentLink') IN ('string', 'null'))
    ), false));
EXCEPTION WHEN duplicate_object THEN null; END $$;
