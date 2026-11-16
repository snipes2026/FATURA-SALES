CREATE TYPE "public"."credit_source" AS ENUM('OPENING_CR', 'ADVANCE', 'SALES_RETURN');--> statement-breakpoint
CREATE TYPE "public"."credit_target" AS ENUM('BILL', 'OPENING', 'REFUND');--> statement-breakpoint
CREATE TYPE "public"."return_qty_check" AS ENUM('OFF', 'WARN', 'BLOCK');--> statement-breakpoint
ALTER TYPE "public"."voucher_type" ADD VALUE 'SALES_RETURN';--> statement-breakpoint
ALTER TYPE "public"."voucher_type" ADD VALUE 'SALES_RETURN_CANCEL';--> statement-breakpoint
ALTER TYPE "public"."voucher_type" ADD VALUE 'REFUND_CANCEL';--> statement-breakpoint
CREATE TABLE "credit_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"credit_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"target_type" "credit_target" NOT NULL,
	"sales_id" integer,
	"applied_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_applications_amount_positive" CHECK ("credit_applications"."amount" > 0),
	CONSTRAINT "credit_applications_bill_has_sale" CHECK (("credit_applications"."target_type" = 'BILL') = ("credit_applications"."sales_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "customer_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"source_type" "credit_source" NOT NULL,
	"source_id" integer NOT NULL,
	"credit_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"remaining" numeric(14, 2) NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_credits_amount_positive" CHECK ("customer_credits"."amount" > 0),
	CONSTRAINT "customer_credits_remaining_range" CHECK ("customer_credits"."remaining" >= 0 and "customer_credits"."remaining" <= "customer_credits"."amount"),
	CONSTRAINT "customer_credits_reversed_empty" CHECK ("customer_credits"."reversed_at" is null or "customer_credits"."remaining" = 0)
);
--> statement-breakpoint
CREATE TABLE "sales_return_header" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_no" varchar(40) NOT NULL,
	"fy" varchar(5) NOT NULL,
	"return_date" date NOT NULL,
	"customer_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"against_sales_id" integer,
	"customer_name" varchar(160) NOT NULL,
	"customer_gstin" varchar(15),
	"customer_state_code" char(2) NOT NULL,
	"customer_address" text,
	"customer_phone" varchar(30),
	"gst_mode" "sale_gst_mode" NOT NULL,
	"tax_type" "tax_type" NOT NULL,
	"total_qty" integer NOT NULL,
	"gross" numeric(14, 2) NOT NULL,
	"taxable" numeric(14, 2) NOT NULL,
	"gst_amount" numeric(14, 2) NOT NULL,
	"gst_overridden" boolean DEFAULT false NOT NULL,
	"cgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(14, 2) NOT NULL,
	"applied_to_dues" numeric(14, 2) DEFAULT '0' NOT NULL,
	"advance_created" numeric(14, 2) DEFAULT '0' NOT NULL,
	"refund_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"refund_mode" "pay_mode",
	"prev_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"balance_after" numeric(14, 2) DEFAULT '0' NOT NULL,
	"remarks" text,
	"status" "sale_status" DEFAULT 'SAVED' NOT NULL,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_return_header_return_no_unique" UNIQUE("return_no"),
	CONSTRAINT "sales_return_amounts_nonneg" CHECK ("sales_return_header"."gross" >= 0 and "sales_return_header"."taxable" >= 0 and "sales_return_header"."gst_amount" >= 0 and "sales_return_header"."cgst" >= 0 and "sales_return_header"."sgst" >= 0 and "sales_return_header"."igst" >= 0 and "sales_return_header"."applied_to_dues" >= 0 and "sales_return_header"."advance_created" >= 0 and "sales_return_header"."refund_amount" >= 0),
	CONSTRAINT "sales_return_net_positive" CHECK ("sales_return_header"."net_amount" > 0),
	CONSTRAINT "sales_return_qty_positive" CHECK ("sales_return_header"."total_qty" > 0),
	CONSTRAINT "sales_return_settled" CHECK ("sales_return_header"."applied_to_dues" + "sales_return_header"."advance_created" + "sales_return_header"."refund_amount" = "sales_return_header"."net_amount"),
	CONSTRAINT "sales_return_refund_mode" CHECK (("sales_return_header"."refund_amount" > 0) = ("sales_return_header"."refund_mode" is not null)),
	CONSTRAINT "sales_return_cancel_reason" CHECK ("sales_return_header"."status" <> 'CANCELLED' or "sales_return_header"."cancel_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "sales_return_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_id" integer NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" integer NOT NULL,
	"original_sales_line_id" integer,
	"barcode" varchar(40) NOT NULL,
	"item_name" varchar(200) NOT NULL,
	"hsn_code" varchar(8) NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"qty" integer NOT NULL,
	"rate" numeric(14, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"taxable" numeric(14, 2) NOT NULL,
	"gst_amount" numeric(14, 2) NOT NULL,
	"cgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(14, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "sales_return_lines_qty_positive" CHECK ("sales_return_lines"."qty" > 0),
	CONSTRAINT "sales_return_lines_rate_positive" CHECK ("sales_return_lines"."rate" > 0),
	CONSTRAINT "sales_return_lines_amounts_nonneg" CHECK ("sales_return_lines"."amount" >= 0 and "sales_return_lines"."taxable" >= 0 and "sales_return_lines"."gst_amount" >= 0 and "sales_return_lines"."cgst" >= 0 and "sales_return_lines"."sgst" >= 0 and "sales_return_lines"."igst" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sales_settings" DROP CONSTRAINT "sales_settings_digits";--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "return_qty_check" "return_qty_check" DEFAULT 'WARN' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "return_prefix" varchar(20) DEFAULT 'SR' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "return_digits" smallint DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "return_print_format" "print_format" DEFAULT 'A4' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_credit_id_customer_credits_id_fk" FOREIGN KEY ("credit_id") REFERENCES "public"."customer_credits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_sales_id_sales_header_id_fk" FOREIGN KEY ("sales_id") REFERENCES "public"."sales_header"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_header" ADD CONSTRAINT "sales_return_header_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_header" ADD CONSTRAINT "sales_return_header_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_header" ADD CONSTRAINT "sales_return_header_against_sales_id_sales_header_id_fk" FOREIGN KEY ("against_sales_id") REFERENCES "public"."sales_header"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_header" ADD CONSTRAINT "sales_return_header_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_header" ADD CONSTRAINT "sales_return_header_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_return_id_sales_return_header_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sales_return_header"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_original_sales_line_id_sales_lines_id_fk" FOREIGN KEY ("original_sales_line_id") REFERENCES "public"."sales_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_applications_credit_idx" ON "credit_applications" USING btree ("credit_id");--> statement-breakpoint
CREATE INDEX "credit_applications_customer_idx" ON "credit_applications" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "credit_applications_sales_idx" ON "credit_applications" USING btree ("sales_id");--> statement-breakpoint
CREATE INDEX "customer_credits_customer_idx" ON "customer_credits" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_credits_source_uq" ON "customer_credits" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "sales_return_customer_date_idx" ON "sales_return_header" USING btree ("customer_id","return_date");--> statement-breakpoint
CREATE INDEX "sales_return_date_idx" ON "sales_return_header" USING btree ("return_date");--> statement-breakpoint
CREATE INDEX "sales_return_against_idx" ON "sales_return_header" USING btree ("against_sales_id");--> statement-breakpoint
CREATE INDEX "sales_return_status_idx" ON "sales_return_header" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_return_lines_line_uq" ON "sales_return_lines" USING btree ("return_id","line_no");--> statement-breakpoint
CREATE INDEX "sales_return_lines_product_idx" ON "sales_return_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sales_return_lines_orig_idx" ON "sales_return_lines" USING btree ("original_sales_line_id");--> statement-breakpoint
ALTER TABLE "sales_settings" ADD CONSTRAINT "sales_settings_digits" CHECK ("sales_settings"."invoice_digits" between 3 and 8 and "sales_settings"."receipt_digits" between 3 and 8 and "sales_settings"."return_digits" between 3 and 8);--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Data move: advances into the credit pool (hand-written).
--   opening balance entered as Cr  → customer_credits OPENING_CR
--   receipt allocation ADVANCE     → customer_credits ADVANCE (reversed stays reversed)
--   advance_adjustments            → credit_applications BILL, consuming the
--                                    customer's credits oldest first
-- Totals per customer are unchanged; advance_adjustments is dropped in 0011.
-- ---------------------------------------------------------------------------
INSERT INTO "customer_credits" ("customer_id", "source_type", "source_id", "credit_date", "amount", "remaining", "created_at")
SELECT c."id", 'OPENING_CR', c."id", c."opening_date", c."opening_balance", c."opening_balance", c."created_at"
FROM "customers" c
WHERE c."opening_type" = 'CR' AND c."opening_balance" > 0;
--> statement-breakpoint
INSERT INTO "customer_credits" ("customer_id", "source_type", "source_id", "credit_date", "amount", "remaining", "reversed_at", "reversed_by", "created_by", "created_at")
SELECT r."customer_id", 'ADVANCE', ra."id", r."receipt_date", ra."amount",
       CASE WHEN ra."reversed_at" IS NULL THEN ra."amount" ELSE 0 END,
       ra."reversed_at", ra."reversed_by", r."created_by", r."created_at"
FROM "receipt_allocations" ra
JOIN "receipts" r ON r."id" = ra."receipt_id"
WHERE ra."target_type" = 'ADVANCE';
--> statement-breakpoint
DO $$
DECLARE
  adj record;
  cr record;
  need numeric(14,2);
  take numeric(14,2);
BEGIN
  FOR adj IN SELECT * FROM "advance_adjustments" ORDER BY "id" LOOP
    IF adj."reversed_at" IS NOT NULL THEN
      -- History only: attach to the customer's oldest credit, no effect on remaining
      SELECT "id" INTO cr FROM "customer_credits" WHERE "customer_id" = adj."customer_id" ORDER BY "credit_date", "id" LIMIT 1;
      IF FOUND THEN
        INSERT INTO "credit_applications" ("credit_id", "customer_id", "target_type", "sales_id", "applied_date", "amount", "reversed_at", "reversed_by", "created_by", "created_at")
        VALUES (cr."id", adj."customer_id", 'BILL', adj."sales_id", adj."adj_date", adj."amount", adj."reversed_at", adj."reversed_by", adj."created_by", adj."created_at");
      END IF;
      CONTINUE;
    END IF;
    need := adj."amount";
    FOR cr IN SELECT "id", "remaining" FROM "customer_credits"
              WHERE "customer_id" = adj."customer_id" AND "reversed_at" IS NULL AND "remaining" > 0
              ORDER BY "credit_date", "id" LOOP
      EXIT WHEN need <= 0;
      take := least(need, cr."remaining");
      INSERT INTO "credit_applications" ("credit_id", "customer_id", "target_type", "sales_id", "applied_date", "amount", "created_by", "created_at")
      VALUES (cr."id", adj."customer_id", 'BILL', adj."sales_id", adj."adj_date", take, adj."created_by", adj."created_at");
      UPDATE "customer_credits" SET "remaining" = "remaining" - take WHERE "id" = cr."id";
      need := need - take;
    END LOOP;
    IF need > 0 THEN
      RAISE EXCEPTION 'advance_adjustments %: customer % used % more advance than they had', adj."id", adj."customer_id", need;
    END IF;
  END LOOP;
END $$;
