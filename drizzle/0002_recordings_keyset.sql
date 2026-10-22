DROP INDEX "recordings_recorded_at";--> statement-breakpoint
CREATE INDEX "recordings_recorded_at_id" ON "recordings" USING btree ("recorded_at","id");