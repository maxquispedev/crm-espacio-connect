ALTER TABLE "agent_profile" ADD COLUMN "sales_orchestrator_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "automation_lane" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "demo_shown_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "price_presented_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "payment_instructions_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "human_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "next_follow_up_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "follow_up_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "follow_up_reason" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "last_jev_evaluated_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "last_jev_decision" jsonb;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "last_jev_error" text;