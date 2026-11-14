CREATE TABLE "advance_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"sales_id" integer NOT NULL,
	"adj_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" integer,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advance_adjustments_amount_positive" CHECK ("advance_adjustments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "sales_header" ADD COLUMN "advance_used" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_header" ADD COLUMN "cash_tendered" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_header" ADD COLUMN "change_returned" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "advance_adjustments" ADD CONSTRAINT "advance_adjustments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_adjustments" ADD CONSTRAINT "advance_adjustments_sales_id_sales_header_id_fk" FOREIGN KEY ("sales_id") REFERENCES "public"."sales_header"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_adjustments" ADD CONSTRAINT "advance_adjustments_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_adjustments" ADD CONSTRAINT "advance_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advance_adjustments_customer_idx" ON "advance_adjustments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "advance_adjustments_sales_idx" ON "advance_adjustments" USING btree ("sales_id");