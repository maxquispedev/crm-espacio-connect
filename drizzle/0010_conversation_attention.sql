-- 013 C1: aditiva/re-ejecutable, sin seeds ni backfill (plan §3.2). El
-- vencimiento NO es una columna de estado: `deferred` + `due_at <= now()` es un
-- recordatorio vencido, derivado en cada lectura (plan §3.3, D-5). Sin worker,
-- sin cron, sin lease.
CREATE TABLE IF NOT EXISTS "conversation_attention" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "state" text NOT NULL,
  "due_at" timestamp,
  "note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "conversation_attention" ADD CONSTRAINT "conversation_attention_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "conversation_attention" ADD CONSTRAINT "conversation_attention_conversation_id_conversation_id_fk"
    FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- Una fila por conversación: programar otro recordatorio reemplaza al anterior
-- en vez de acumular compromisos ambiguos (plan §5, D-6).
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_attention_org_conv_uq"
  ON "conversation_attention" USING btree ("organization_id", "conversation_id");
--> statement-breakpoint
-- Índices org-first (Constitución III): toda lectura entra por organización.
CREATE INDEX IF NOT EXISTS "conversation_attention_org_state_idx"
  ON "conversation_attention" USING btree ("organization_id", "state");
--> statement-breakpoint
-- Buckets de Agenda y "Por atender" ordenan/filtran por (org, state, due_at).
CREATE INDEX IF NOT EXISTS "conversation_attention_org_state_due_idx"
  ON "conversation_attention" USING btree ("organization_id", "state", "due_at");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "conversation_attention" ADD CONSTRAINT "conversation_attention_state_check"
    CHECK ("state" IN ('pending', 'waiting_client', 'deferred'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- Coherencia `deferred` <-> `due_at`, en ambos sentidos: un recordatorio sin
-- fecha no puede aplazar, y un estado sin recordatorio no puede arrastrar una
-- fecha vieja.
DO $$ BEGIN
  ALTER TABLE "conversation_attention" ADD CONSTRAINT "conversation_attention_due_coherence_check"
    CHECK (("state" = 'deferred' AND "due_at" IS NOT NULL) OR ("state" <> 'deferred' AND "due_at" IS NULL));
EXCEPTION WHEN duplicate_object THEN null; END $$;
