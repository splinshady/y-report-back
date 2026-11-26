-- Старые заявки и их дни удаляются: их нельзя отнести к машине.
DELETE FROM "schedule_request_day";
--> statement-breakpoint
DELETE FROM "schedule_request";
--> statement-breakpoint
CREATE TABLE "car" (
	"id" text PRIMARY KEY NOT NULL,
	"taxi_park_id" text NOT NULL,
	"plate" text NOT NULL,
	"photo" "bytea",
	"photo_content_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "schedule_request_day_park_date_idx";--> statement-breakpoint
ALTER TABLE "schedule_request" ADD COLUMN "car_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_request_day" ADD COLUMN "car_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "car" ADD CONSTRAINT "car_taxi_park_id_taxi_park_id_fk" FOREIGN KEY ("taxi_park_id") REFERENCES "public"."taxi_park"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "car_taxi_park_id_idx" ON "car" USING btree ("taxi_park_id");--> statement-breakpoint
ALTER TABLE "schedule_request" ADD CONSTRAINT "schedule_request_car_id_car_id_fk" FOREIGN KEY ("car_id") REFERENCES "public"."car"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_request_day" ADD CONSTRAINT "schedule_request_day_car_id_car_id_fk" FOREIGN KEY ("car_id") REFERENCES "public"."car"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_request_car_id_idx" ON "schedule_request" USING btree ("car_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_request_day_car_date_idx" ON "schedule_request_day" USING btree ("car_id","work_date") WHERE "schedule_request_day"."reserved" = true;