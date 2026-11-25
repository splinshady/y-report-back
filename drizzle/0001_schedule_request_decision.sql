DROP INDEX "schedule_request_day_park_date_idx";--> statement-breakpoint
ALTER TABLE "schedule_request" ADD COLUMN "rejected_by_user_id" text;--> statement-breakpoint
ALTER TABLE "schedule_request" ADD COLUMN "rejected_at" timestamp;--> statement-breakpoint
ALTER TABLE "schedule_request_day" ADD COLUMN "reserved" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_request" ADD CONSTRAINT "schedule_request_rejected_by_user_id_user_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_request_day_park_date_idx" ON "schedule_request_day" USING btree ("taxi_park_id","work_date") WHERE "schedule_request_day"."reserved" = true;