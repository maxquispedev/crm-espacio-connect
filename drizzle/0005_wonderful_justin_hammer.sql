CREATE TABLE "sales_follow_up_job" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"reason" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"due_at" timestamp NOT NULL,
	"anchor_at" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"run_attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp,
	"message_id" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "sales_follow_ups_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "sales_follow_up_template_id" text;--> statement-breakpoint
ALTER TABLE "sales_follow_up_job" ADD CONSTRAINT "sales_follow_up_job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_follow_up_job" ADD CONSTRAINT "sales_follow_up_job_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_follow_up_job" ADD CONSTRAINT "sales_follow_up_job_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_follow_up_job_org_status_due_idx" ON "sales_follow_up_job" USING btree ("organization_id","status","due_at");--> statement-breakpoint
CREATE INDEX "sales_follow_up_job_lead_idx" ON "sales_follow_up_job" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "sales_follow_up_job_conv_idx" ON "sales_follow_up_job" USING btree ("conversation_id");