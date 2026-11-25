CREATE TABLE "taxi_park" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_request" (
	"id" text PRIMARY KEY NOT NULL,
	"taxi_park_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"approved_by_user_id" text,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "schedule_request_day" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"taxi_park_id" text NOT NULL,
	"work_date" text NOT NULL,
	"shift" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedule_request" ADD CONSTRAINT "schedule_request_taxi_park_id_taxi_park_id_fk" FOREIGN KEY ("taxi_park_id") REFERENCES "public"."taxi_park"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_request" ADD CONSTRAINT "schedule_request_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_request" ADD CONSTRAINT "schedule_request_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_request_day" ADD CONSTRAINT "schedule_request_day_request_id_schedule_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."schedule_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_request_day" ADD CONSTRAINT "schedule_request_day_taxi_park_id_taxi_park_id_fk" FOREIGN KEY ("taxi_park_id") REFERENCES "public"."taxi_park"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_request_taxi_park_id_idx" ON "schedule_request" USING btree ("taxi_park_id");--> statement-breakpoint
CREATE INDEX "schedule_request_created_by_user_id_idx" ON "schedule_request" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "schedule_request_day_request_id_idx" ON "schedule_request_day" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_request_day_park_date_idx" ON "schedule_request_day" USING btree ("taxi_park_id","work_date");
