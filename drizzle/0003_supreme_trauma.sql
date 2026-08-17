CREATE TABLE "integration_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"external_id" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"message_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_event" ADD CONSTRAINT "integration_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_event" ADD CONSTRAINT "integration_event_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_event_org_src_type_ext_uq" ON "integration_event" USING btree ("organization_id","source","event_type","external_id");--> statement-breakpoint
CREATE INDEX "integration_event_org_idx" ON "integration_event" USING btree ("organization_id","created_at");