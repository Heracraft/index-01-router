ALTER TABLE "deliveries" ADD COLUMN "sent_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recordings" ADD COLUMN "transcript_version" integer DEFAULT 0 NOT NULL;