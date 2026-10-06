ALTER TABLE "sales_follow_up_job" ADD COLUMN IF NOT EXISTS "source_message_id" text;
--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "latest_inbound_message_id" text;
--> statement-breakpoint
-- 017: additive/re-executable. No historical facts/backfill or reservation invention.
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_org_id_safety_uq" ON "conversation" ("organization_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_org_id_safety_uq" ON "message" ("organization_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lead_org_id_safety_uq" ON "lead" ("organization_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_follow_up_job_org_id_safety_uq" ON "sales_follow_up_job" ("organization_id", "id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_outbound_delivery" (
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "message_id" text PRIMARY KEY,
  "conversation_id" text NOT NULL,
  "lead_id" text,
  "inbound_message_id" text NOT NULL,
  "manual_message_id" text,
  "plan" jsonb,
  "demo_slot" text,
  "payment_group_id" text,
  "payment_part" integer,
  "payment_parts" integer,
  "follow_up_job_id" text,
  "expected_handoff_at" timestamp,
  "confirmed_at" timestamp,
  "failed_at" timestamp,
  "invalidated_at" timestamp,
  "fact_previous" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  FOREIGN KEY ("organization_id", "message_id") REFERENCES "message" ("organization_id", "id") ON DELETE CASCADE,
  FOREIGN KEY ("organization_id", "conversation_id") REFERENCES "conversation" ("organization_id", "id") ON DELETE CASCADE,
  FOREIGN KEY ("organization_id", "lead_id") REFERENCES "lead" ("organization_id", "id") ON DELETE CASCADE,
  FOREIGN KEY ("organization_id", "follow_up_job_id") REFERENCES "sales_follow_up_job" ("organization_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_outbound_delivery_org_conv_idx" ON "sales_outbound_delivery" ("organization_id", "conversation_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_demo_reservation" (
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "id" text PRIMARY KEY,
  "conversation_id" text NOT NULL,
  "slot" text NOT NULL CHECK ("slot" IN ('demo_enrollment_panel', 'demo_payments_balances', 'demo_online_enrollment')),
  "inbound_message_id" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  FOREIGN KEY ("organization_id", "conversation_id") REFERENCES "conversation" ("organization_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_demo_reservation_org_conv_slot_uq" ON "sales_demo_reservation" ("organization_id", "conversation_id", "slot");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wa_status_receipt" (
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "id" text PRIMARY KEY,
  "wa_message_id" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('sent', 'delivered', 'read', 'failed')),
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wa_status_receipt_org_wamid_status_uq" ON "wa_status_receipt" ("organization_id", "wa_message_id", "status");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION invalidate_sales_delivery_on_pause() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.ai_enabled IS DISTINCT FROM OLD.ai_enabled) OR (NEW.handoff_at IS DISTINCT FROM OLD.handoff_at) THEN
    UPDATE sales_outbound_delivery SET invalidated_at = COALESCE(invalidated_at, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    WHERE organization_id = NEW.organization_id AND conversation_id = NEW.id
      AND (expected_handoff_at IS NULL OR expected_handoff_at IS DISTINCT FROM NEW.handoff_at);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS sales_delivery_pause_guard ON "conversation";
--> statement-breakpoint
CREATE TRIGGER sales_delivery_pause_guard AFTER UPDATE OF ai_enabled, handoff_at ON "conversation" FOR EACH ROW EXECUTE FUNCTION invalidate_sales_delivery_on_pause();
