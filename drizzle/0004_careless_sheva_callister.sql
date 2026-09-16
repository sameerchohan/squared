CREATE TABLE "expense_guest_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"sponsor_user_id" uuid NOT NULL,
	CONSTRAINT "expense_guest_shares_expense_guest_unique" UNIQUE("expense_id","guest_id")
);
--> statement-breakpoint
CREATE TABLE "group_guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sponsor_user_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_shares" ADD COLUMN "share_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD COLUMN "covered_by" uuid;--> statement-breakpoint
ALTER TABLE "expense_guest_shares" ADD CONSTRAINT "expense_guest_shares_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_guest_shares" ADD CONSTRAINT "expense_guest_shares_guest_id_group_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."group_guests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_guest_shares" ADD CONSTRAINT "expense_guest_shares_sponsor_user_id_users_id_fk" FOREIGN KEY ("sponsor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_guests" ADD CONSTRAINT "group_guests_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_guests" ADD CONSTRAINT "group_guests_sponsor_user_id_users_id_fk" FOREIGN KEY ("sponsor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_guest_shares_guest_id_idx" ON "expense_guest_shares" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "group_guests_group_id_idx" ON "group_guests" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "group_guests_sponsor_user_id_idx" ON "group_guests" USING btree ("sponsor_user_id");--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_covered_by_users_id_fk" FOREIGN KEY ("covered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_share_count_non_negative_check" CHECK ("expense_shares"."share_count" >= 0);--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_covered_not_self_check" CHECK ("expense_shares"."covered_by" IS NULL OR "expense_shares"."covered_by" <> "expense_shares"."user_id");--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_covered_pays_nothing_check" CHECK ("expense_shares"."covered_by" IS NULL OR ("expense_shares"."share_count" = 0 AND "expense_shares"."owed_cents" = 0));