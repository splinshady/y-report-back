CREATE TABLE "taxi_park_member" (
	"id" text PRIMARY KEY NOT NULL,
	"taxi_park_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "taxi_park_member_role_check" CHECK ("taxi_park_member"."role" in ('owner', 'worker'))
);
--> statement-breakpoint
ALTER TABLE "taxi_park_member" ADD CONSTRAINT "taxi_park_member_taxi_park_id_taxi_park_id_fk" FOREIGN KEY ("taxi_park_id") REFERENCES "public"."taxi_park"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxi_park_member" ADD CONSTRAINT "taxi_park_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "taxi_park_member_user_id_idx" ON "taxi_park_member" USING btree ("user_id");