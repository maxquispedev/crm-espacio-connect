-- 007 - Meta CAPI: QualifiedLead y Purchase (Corte B).
--
-- Adaptación selectiva del upstream 016 (kevinrivm/vocero-crm, commits
-- 0a154ea2711ad5350e20451c573a7863b926cfed y 75124422bba2298bb21cf3e712cae16b31f01ce2).
-- Mismos nombres de columna/shape que el upstream para que una futura
-- sincronización sea viable.
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitución IV):
-- IF NOT EXISTS en tablas/índices/check, y bloque DO con
-- EXCEPTION WHEN duplicate_object para las FK.
--
-- Puramente ADITIVA: dos tablas nuevas + FK + índices + checks. No toca
-- tablas existentes (ad_attribution de 006 ya entrega el ctwa_clid que
-- estas tablas consumen).

-- ============================================================
-- conversion_event — log durable del reporte CAPI
-- ============================================================

CREATE TABLE IF NOT EXISTS "conversion_event" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "event_name" text NOT NULL,
  "custom_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'skipped',
  "fbtrace_id" text,
  "error_message" text,
  "skip_reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "conversion_event"
    ADD CONSTRAINT "conversion_event_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "conversion_event"
    ADD CONSTRAINT "conversion_event_conversation_id_conversation_id_fk"
    FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- Dedup durable: una sola fila por (org, conversation, event_name).
-- Es la barrera contra doble webhook y doble move de etapa simultáneo.
CREATE UNIQUE INDEX IF NOT EXISTS "conversion_event_org_conv_event_uq"
  ON "conversion_event" USING btree ("organization_id","conversation_id","event_name");
--> statement-breakpoint

-- Listado de actividad por organización (UI Ajustes → Anuncios).
CREATE INDEX IF NOT EXISTS "conversion_event_org_created_idx"
  ON "conversion_event" USING btree ("organization_id","created_at" DESC);
--> statement-breakpoint

-- Check del catálogo cerrado de eventos (Constitución VIII: foco vertical,
-- solo QualifiedLead y Purchase. InitiateCheckout queda fuera de fábrica).
DO $$ BEGIN
  ALTER TABLE "conversion_event"
    ADD CONSTRAINT "conversion_event_event_name_check"
    CHECK ("event_name" IN ('QualifiedLead','Purchase'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- Check de status (sent | failed | skipped). Los skips son legibles desde la UI.
DO $$ BEGIN
  ALTER TABLE "conversion_event"
    ADD CONSTRAINT "conversion_event_status_check"
    CHECK ("status" IN ('sent','failed','skipped'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- ============================================================
-- capi_settings — config cifrada por organización
-- ============================================================

CREATE TABLE IF NOT EXISTS "capi_settings" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "dataset_id" text NOT NULL,
  -- Token opcional. Si está NULL se reusa el token de WhatsApp business.
  "access_token_cipher" text,
  "access_token_iv" text,
  "access_token_tag" text,
  "access_token_last4" text,
  -- Etapa calificada configurable por tenant (NO hardcodeada a "Interesado").
  "qualified_stage_id" text,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "capi_settings"
    ADD CONSTRAINT "capi_settings_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- Configuración única por organización.
CREATE UNIQUE INDEX IF NOT EXISTS "capi_settings_org_uq"
  ON "capi_settings" USING btree ("organization_id");
--> statement-breakpoint

-- FK opcional a pipeline_stage. ON DELETE SET NULL: si el tenant borra
-- la etapa calificada, la config queda sin etapa y QualifiedLead pasa a
-- skipped con motivo, sin tirar la config.
DO $$ BEGIN
  ALTER TABLE "capi_settings"
    ADD CONSTRAINT "capi_settings_qualified_stage_id_pipeline_stage_id_fk"
    FOREIGN KEY ("qualified_stage_id") REFERENCES "public"."pipeline_stage"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
