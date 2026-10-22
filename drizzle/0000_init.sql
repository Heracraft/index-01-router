CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."recording_status" AS ENUM('received', 'transcribing', 'routing', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recording_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"target" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"triggers" text[] DEFAULT '{}' NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" text NOT NULL,
	"source" text NOT NULL,
	"trigger" text NOT NULL,
	"signed" boolean DEFAULT false NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"audio_path" text,
	"audio_mime" text,
	"audio_bytes" integer,
	"duration_ms" integer,
	"app_transcript" text,
	"transcript" text,
	"languages" text,
	"transcribed_by" text,
	"transcribe_ms" integer,
	"status" "recording_status" DEFAULT 'received' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" integer NOT NULL,
	"reason" text NOT NULL,
	"delivery_id" text,
	"trigger" text,
	"signed" boolean DEFAULT false NOT NULL,
	"test" boolean DEFAULT false NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"user_agent" text,
	"recording_id" uuid
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_recording_integration" ON "deliveries" USING btree ("recording_id","integration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recordings_delivery_id" ON "recordings" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "recordings_recorded_at" ON "recordings" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "recordings_status" ON "recordings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhook_events_at" ON "webhook_events" USING btree ("at");