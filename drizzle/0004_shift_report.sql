CREATE TABLE "shift_report" (
	"id" text PRIMARY KEY NOT NULL,
	"taxi_park_id" text NOT NULL,
	"car_id" text NOT NULL,
	"work_date" text NOT NULL,
	"shift" text NOT NULL,
	"mileage_start" double precision NOT NULL,
	"mileage_end" double precision NOT NULL,
	"cashless" double precision NOT NULL,
	"cash" double precision NOT NULL,
	"discount" double precision NOT NULL,
	"tip" double precision NOT NULL,
	"wash" double precision NOT NULL,
	"line_time" double precision NOT NULL,
	"cash_start" double precision NOT NULL,
	"cash_end" double precision NOT NULL,
	"shift_total" double precision NOT NULL,
	"photo_1" "bytea" NOT NULL,
	"photo_1_content_type" text NOT NULL,
	"photo_2" "bytea" NOT NULL,
	"photo_2_content_type" text NOT NULL,
	"photo_3" "bytea" NOT NULL,
	"photo_3_content_type" text NOT NULL,
	"photo_4" "bytea" NOT NULL,
	"photo_4_content_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shift_report_shift_check" CHECK ("shift_report"."shift" in ('day', 'night'))
);
--> statement-breakpoint
ALTER TABLE "shift_report" ADD CONSTRAINT "shift_report_taxi_park_id_taxi_park_id_fk" FOREIGN KEY ("taxi_park_id") REFERENCES "public"."taxi_park"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_report" ADD CONSTRAINT "shift_report_car_id_car_id_fk" FOREIGN KEY ("car_id") REFERENCES "public"."car"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_report_taxi_park_id_idx" ON "shift_report" USING btree ("taxi_park_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_report_car_date_shift_idx" ON "shift_report" USING btree ("car_id","work_date","shift");