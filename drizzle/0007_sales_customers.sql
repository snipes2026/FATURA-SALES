CREATE TYPE "public"."alloc_target" AS ENUM('BILL', 'OPENING', 'ADVANCE');--> statement-breakpoint
CREATE TYPE "public"."cash_direction" AS ENUM('IN', 'OUT');--> statement-breakpoint
CREATE TYPE "public"."dr_cr" AS ENUM('DR', 'CR');--> statement-breakpoint
CREATE TYPE "public"."pay_mode" AS ENUM('CASH', 'BANK1', 'BANK2');--> statement-breakpoint
CREATE TYPE "public"."print_format" AS ENUM('A4', 'THERMAL80');--> statement-breakpoint
CREATE TYPE "public"."receipt_source" AS ENUM('SALE', 'STANDALONE');--> statement-breakpoint
CREATE TYPE "public"."receipt_status" AS ENUM('SAVED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."sale_gst_mode" AS ENUM('ADD', 'INCLUDES');--> statement-breakpoint
CREATE TYPE "public"."sale_status" AS ENUM('SAVED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."voucher_type" AS ENUM('OPENING', 'SALE', 'RECEIPT', 'ADVANCE', 'SETTLEMENT', 'SALE_CANCEL', 'RECEIPT_CANCEL', 'REFUND');--> statement-breakpoint
CREATE TABLE "cash_bank_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entry_date" date NOT NULL,
	"mode" "pay_mode" NOT NULL,
	"direction" "cash_direction" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"ref_type" varchar(20) NOT NULL,
	"ref_id" integer NOT NULL,
	"customer_id" integer,
	"location_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_bank_ledger_amount_positive" CHECK ("cash_bank_ledger"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "customer_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"entry_date" date NOT NULL,
	"voucher_type" "voucher_type" NOT NULL,
	"voucher_id" integer NOT NULL,
	"voucher_no" varchar(40),
	"particulars" text,
	"debit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_ledger_nonneg" CHECK ("customer_ledger"."debit" >= 0 and "customer_ledger"."credit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"address" text,
	"gstin" varchar(15),
	"state_code" char(2) NOT NULL,
	"phone" varchar(30) NOT NULL,
	"opening_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"opening_type" "dr_cr" DEFAULT 'DR' NOT NULL,
	"opening_date" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_walkin" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_opening_nonneg" CHECK ("customers"."opening_balance" >= 0),
	CONSTRAINT "customers_walkin_no_opening" CHECK (not "customers"."is_walkin" or "customers"."opening_balance" = 0)
);
--> statement-breakpoint
CREATE TABLE "receipt_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_id" integer NOT NULL,
	"target_type" "alloc_target" NOT NULL,
	"sales_id" integer,
	"amount" numeric(14, 2) NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" integer,
	CONSTRAINT "receipt_allocations_amount_positive" CHECK ("receipt_allocations"."amount" > 0),
	CONSTRAINT "receipt_allocations_bill_has_sale" CHECK (("receipt_allocations"."target_type" = 'BILL') = ("receipt_allocations"."sales_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "receipt_modes" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_id" integer NOT NULL,
	"mode" "pay_mode" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	CONSTRAINT "receipt_modes_amount_positive" CHECK ("receipt_modes"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_no" varchar(40) NOT NULL,
	"fy" varchar(5) NOT NULL,
	"receipt_date" date NOT NULL,
	"customer_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"source" "receipt_source" NOT NULL,
	"sales_id" integer,
	"total_amount" numeric(14, 2) NOT NULL,
	"remarks" text,
	"status" "receipt_status" DEFAULT 'SAVED' NOT NULL,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" integer,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_receipt_no_unique" UNIQUE("receipt_no"),
	CONSTRAINT "receipts_total_positive" CHECK ("receipts"."total_amount" > 0),
	CONSTRAINT "receipts_sale_has_bill" CHECK ("receipts"."source" <> 'SALE' or "receipts"."sales_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "sales_header" (
	"id" serial PRIMARY KEY NOT NULL,
	"bill_no" varchar(40) NOT NULL,
	"fy" varchar(5) NOT NULL,
	"bill_date" date NOT NULL,
	"customer_id" integer NOT NULL,
	"location_id" integer NOT NULL,
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
	"credit_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"prev_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"balance_after" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" "sale_status" DEFAULT 'SAVED' NOT NULL,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_header_bill_no_unique" UNIQUE("bill_no"),
	CONSTRAINT "sales_header_amounts_nonneg" CHECK ("sales_header"."gross" >= 0 and "sales_header"."taxable" >= 0 and "sales_header"."gst_amount" >= 0 and "sales_header"."cgst" >= 0 and "sales_header"."sgst" >= 0 and "sales_header"."igst" >= 0 and "sales_header"."net_amount" >= 0 and "sales_header"."credit_amount" >= 0),
	CONSTRAINT "sales_header_credit_le_net" CHECK ("sales_header"."credit_amount" <= "sales_header"."net_amount"),
	CONSTRAINT "sales_header_qty_positive" CHECK ("sales_header"."total_qty" > 0),
	CONSTRAINT "sales_header_cancel_reason" CHECK ("sales_header"."status" <> 'CANCELLED' or "sales_header"."cancel_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "sales_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"sales_id" integer NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" integer NOT NULL,
	"barcode" varchar(40) NOT NULL,
	"item_name" varchar(200) NOT NULL,
	"hsn_code" varchar(8) NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"qty" integer NOT NULL,
	"rate" numeric(14, 2) NOT NULL,
	"purchase_rate" numeric(14, 2) DEFAULT '0' NOT NULL,
	"price_edited" boolean DEFAULT false NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"taxable" numeric(14, 2) NOT NULL,
	"gst_amount" numeric(14, 2) NOT NULL,
	"cgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(14, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "sales_lines_qty_positive" CHECK ("sales_lines"."qty" > 0),
	CONSTRAINT "sales_lines_amounts_nonneg" CHECK ("sales_lines"."rate" >= 0 and "sales_lines"."amount" >= 0 and "sales_lines"."taxable" >= 0 and "sales_lines"."gst_amount" >= 0 and "sales_lines"."cgst" >= 0 and "sales_lines"."sgst" >= 0 and "sales_lines"."igst" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"allow_price_edit" boolean DEFAULT false NOT NULL,
	"bank1_name" varchar(40) DEFAULT 'Bank 1' NOT NULL,
	"bank2_name" varchar(40) DEFAULT 'Bank 2' NOT NULL,
	"bank2_enabled" boolean DEFAULT false NOT NULL,
	"default_gst_mode" "sale_gst_mode" DEFAULT 'INCLUDES' NOT NULL,
	"allow_negative_stock" boolean DEFAULT false NOT NULL,
	"auto_increment_qty" boolean DEFAULT true NOT NULL,
	"invoice_prefix" varchar(20) DEFAULT 'INV' NOT NULL,
	"invoice_digits" smallint DEFAULT 4 NOT NULL,
	"receipt_prefix" varchar(20) DEFAULT 'RCT' NOT NULL,
	"receipt_digits" smallint DEFAULT 4 NOT NULL,
	"print_format" "print_format" DEFAULT 'A4' NOT NULL,
	"walkin_allow_credit" boolean DEFAULT false NOT NULL,
	"walkin_allow_advance" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_settings_single_row" CHECK ("sales_settings"."id" = 1),
	CONSTRAINT "sales_settings_digits" CHECK ("sales_settings"."invoice_digits" between 3 and 8 and "sales_settings"."receipt_digits" between 3 and 8)
);
--> statement-breakpoint
ALTER TABLE "cash_bank_ledger" ADD CONSTRAINT "cash_bank_ledger_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_bank_ledger" ADD CONSTRAINT "cash_bank_ledger_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_bank_ledger" ADD CONSTRAINT "cash_bank_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_ledger" ADD CONSTRAINT "customer_ledger_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_ledger" ADD CONSTRAINT "customer_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_sales_id_sales_header_id_fk" FOREIGN KEY ("sales_id") REFERENCES "public"."sales_header"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_modes" ADD CONSTRAINT "receipt_modes_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_sales_id_sales_header_id_fk" FOREIGN KEY ("sales_id") REFERENCES "public"."sales_header"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_header" ADD CONSTRAINT "sales_header_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_header" ADD CONSTRAINT "sales_header_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_header" ADD CONSTRAINT "sales_header_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_header" ADD CONSTRAINT "sales_header_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_lines" ADD CONSTRAINT "sales_lines_sales_id_sales_header_id_fk" FOREIGN KEY ("sales_id") REFERENCES "public"."sales_header"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_lines" ADD CONSTRAINT "sales_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_bank_ledger_mode_date_idx" ON "cash_bank_ledger" USING btree ("mode","entry_date");--> statement-breakpoint
CREATE INDEX "cash_bank_ledger_ref_idx" ON "cash_bank_ledger" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "customer_ledger_customer_date_idx" ON "customer_ledger" USING btree ("customer_id","entry_date","id");--> statement-breakpoint
CREATE INDEX "customer_ledger_voucher_idx" ON "customer_ledger" USING btree ("voucher_type","voucher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_gstin_uq" ON "customers" USING btree ("gstin") WHERE "customers"."gstin" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_walkin_uq" ON "customers" USING btree ("is_walkin") WHERE "customers"."is_walkin";--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "receipt_allocations_receipt_idx" ON "receipt_allocations" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "receipt_allocations_sales_idx" ON "receipt_allocations" USING btree ("sales_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_modes_receipt_mode_uq" ON "receipt_modes" USING btree ("receipt_id","mode");--> statement-breakpoint
CREATE INDEX "receipts_customer_date_idx" ON "receipts" USING btree ("customer_id","receipt_date");--> statement-breakpoint
CREATE INDEX "receipts_sales_idx" ON "receipts" USING btree ("sales_id");--> statement-breakpoint
CREATE INDEX "sales_header_customer_date_idx" ON "sales_header" USING btree ("customer_id","bill_date");--> statement-breakpoint
CREATE INDEX "sales_header_bill_date_idx" ON "sales_header" USING btree ("bill_date");--> statement-breakpoint
CREATE INDEX "sales_header_location_idx" ON "sales_header" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "sales_header_status_idx" ON "sales_header" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_lines_sales_line_uq" ON "sales_lines" USING btree ("sales_id","line_no");--> statement-breakpoint
CREATE INDEX "sales_lines_product_idx" ON "sales_lines" USING btree ("product_id");