CREATE TYPE "public"."audit_action" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'CANCEL', 'LOGIN');--> statement-breakpoint
CREATE TYPE "public"."category_mode" AS ENUM('MANDATORY', 'OPTIONAL', 'HIDDEN');--> statement-breakpoint
CREATE TYPE "public"."charge_type" AS ENUM('FREIGHT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."discount_type" AS ENUM('PERCENT', 'AMOUNT');--> statement-breakpoint
CREATE TYPE "public"."grn_status" AS ENUM('DRAFT', 'SAVED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."label_size" AS ENUM('50x25', '38x25');--> statement-breakpoint
CREATE TYPE "public"."location_type" AS ENUM('STORE', 'GODOWN');--> statement-breakpoint
CREATE TYPE "public"."tax_type" AS ENUM('INTRA', 'INTER');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"table_name" varchar(60) NOT NULL,
	"record_id" varchar(60) NOT NULL,
	"action" "audit_action" NOT NULL,
	"old_json" jsonb,
	"new_json" jsonb,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "barcode_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"prefix" varchar(10) DEFAULT '' NOT NULL,
	"suffix" varchar(10) DEFAULT '' NOT NULL,
	"digits" smallint DEFAULT 6 NOT NULL,
	"start_number" integer DEFAULT 1 NOT NULL,
	"symbology" varchar(20) DEFAULT 'CODE128' NOT NULL,
	"label_size" "label_size" DEFAULT '50x25' NOT NULL,
	"label_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"labels_per_row" smallint DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "barcode_settings_single_row" CHECK ("barcode_settings"."id" = 1),
	CONSTRAINT "barcode_settings_digits" CHECK ("barcode_settings"."digits" between 3 and 12)
);
--> statement-breakpoint
CREATE TABLE "category_config" (
	"slot" smallint PRIMARY KEY NOT NULL,
	"label" varchar(40) NOT NULL,
	"mode" "category_mode" DEFAULT 'OPTIONAL' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_config_slot" CHECK ("category_config"."slot" between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE "category_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"slot" smallint NOT NULL,
	"value" varchar(60) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_profile" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" varchar(160) NOT NULL,
	"address" text,
	"gstin" varchar(15),
	"state_code" char(2),
	"phone" varchar(30),
	"email" varchar(120),
	"logo_path" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_profile_single_row" CHECK ("company_profile"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"name" varchar(40) NOT NULL,
	"fy" varchar(5) NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "counters_name_fy_pk" PRIMARY KEY("name","fy")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"hsn_code" varchar(8) NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"slab_enabled" boolean DEFAULT false NOT NULL,
	"slab_threshold" numeric(14, 2),
	"slab_rate_above" numeric(5, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_name_unique" UNIQUE("name"),
	CONSTRAINT "departments_hsn_format" CHECK ("departments"."hsn_code" ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'),
	CONSTRAINT "departments_slab_complete" CHECK (not "departments"."slab_enabled" or ("departments"."slab_threshold" is not null and "departments"."slab_rate_above" is not null))
);
--> statement-breakpoint
CREATE TABLE "grn_charges" (
	"id" serial PRIMARY KEY NOT NULL,
	"grn_id" integer NOT NULL,
	"charge_type" charge_type NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"gst_applicable" boolean DEFAULT false NOT NULL,
	"gst_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"gst_amount" numeric(14, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grn_header" (
	"id" serial PRIMARY KEY NOT NULL,
	"grn_no" varchar(40),
	"fy" varchar(5),
	"grn_date" date NOT NULL,
	"status" "grn_status" DEFAULT 'DRAFT' NOT NULL,
	"location_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"invoice_no" varchar(60) NOT NULL,
	"invoice_date" date NOT NULL,
	"transport_id" integer,
	"lr_no" varchar(60),
	"transport_date" date,
	"tax_type" "tax_type" DEFAULT 'INTRA' NOT NULL,
	"total_qty" integer DEFAULT 0 NOT NULL,
	"gross_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount_type" "discount_type" DEFAULT 'PERCENT' NOT NULL,
	"discount_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"taxable_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cgst_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"charges_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"charges_gst_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_payable" numeric(14, 2) DEFAULT '0' NOT NULL,
	"supplier_invoice_total" numeric(14, 2),
	"remarks" text,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" integer,
	"saved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" integer NOT NULL,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grn_header_grn_no_unique" UNIQUE("grn_no"),
	CONSTRAINT "grn_header_saved_has_no" CHECK ("grn_header"."status" = 'DRAFT' or "grn_header"."grn_no" is not null)
);
--> statement-breakpoint
CREATE TABLE "grn_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"grn_id" integer NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" integer,
	"department_id" integer NOT NULL,
	"hsn_code" varchar(8) NOT NULL,
	"item_name" varchar(200) NOT NULL,
	"cat1_value_id" integer,
	"cat2_value_id" integer,
	"cat3_value_id" integer,
	"cat4_value_id" integer,
	"qty" integer NOT NULL,
	"purchase_rate" numeric(14, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"discount_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"taxable_value" numeric(14, 2) NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"cgst_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"gst_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"wsp" numeric(14, 2),
	"rsp" numeric(14, 2),
	"mrp" numeric(14, 2) NOT NULL,
	"barcode" varchar(40),
	"image_path" text,
	"price_warning_overridden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grn_lines_qty_positive" CHECK ("grn_lines"."qty" > 0),
	CONSTRAINT "grn_lines_rate_nonneg" CHECK ("grn_lines"."purchase_rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "grn_number_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"prefix" varchar(20) DEFAULT 'GRN' NOT NULL,
	"digits" smallint DEFAULT 4 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grn_number_settings_single_row" CHECK ("grn_number_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"type" "location_type" NOT NULL,
	"gstin" varchar(15),
	"state_code" char(2) NOT NULL,
	"address" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"department_id" integer NOT NULL,
	"item_name" varchar(200) NOT NULL,
	"cat1_value_id" integer,
	"cat2_value_id" integer,
	"cat3_value_id" integer,
	"cat4_value_id" integer,
	"barcode" varchar(40) NOT NULL,
	"purchase_rate" numeric(14, 2) NOT NULL,
	"wsp" numeric(14, 2),
	"rsp" numeric(14, 2),
	"mrp" numeric(14, 2) NOT NULL,
	"image_path" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_barcode_unique" UNIQUE("barcode"),
	CONSTRAINT "products_mrp_positive" CHECK ("products"."mrp" > 0)
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(64) NOT NULL,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "stock_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"location_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"qty_in" integer DEFAULT 0 NOT NULL,
	"qty_out" integer DEFAULT 0 NOT NULL,
	"ref_doc_type" varchar(20) NOT NULL,
	"ref_doc_id" integer NOT NULL,
	"ref_line_id" integer,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_ledger_qty_nonneg" CHECK ("stock_ledger"."qty_in" >= 0 and "stock_ledger"."qty_out" >= 0),
	CONSTRAINT "stock_ledger_one_side" CHECK ("stock_ledger"."qty_in" > 0 or "stock_ledger"."qty_out" > 0)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"gstin" varchar(15),
	"state_code" char(2) NOT NULL,
	"address" text,
	"contact_person" varchar(120),
	"phone" varchar(30),
	"email" varchar(120),
	"pan" varchar(10),
	"opening_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transports" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"gstin" varchar(15),
	"phone" varchar(30),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transports_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user_locations" (
	"user_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	CONSTRAINT "user_locations_user_id_location_id_pk" PRIMARY KEY("user_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"username" varchar(60) NOT NULL,
	"password_hash" text NOT NULL,
	"role_id" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_values" ADD CONSTRAINT "category_values_slot_category_config_slot_fk" FOREIGN KEY ("slot") REFERENCES "public"."category_config"("slot") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_values" ADD CONSTRAINT "category_values_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_charges" ADD CONSTRAINT "grn_charges_grn_id_grn_header_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."grn_header"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_header" ADD CONSTRAINT "grn_header_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_header" ADD CONSTRAINT "grn_header_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_header" ADD CONSTRAINT "grn_header_transport_id_transports_id_fk" FOREIGN KEY ("transport_id") REFERENCES "public"."transports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_header" ADD CONSTRAINT "grn_header_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_header" ADD CONSTRAINT "grn_header_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_header" ADD CONSTRAINT "grn_header_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_grn_id_grn_header_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."grn_header"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_cat1_value_id_category_values_id_fk" FOREIGN KEY ("cat1_value_id") REFERENCES "public"."category_values"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_cat2_value_id_category_values_id_fk" FOREIGN KEY ("cat2_value_id") REFERENCES "public"."category_values"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_cat3_value_id_category_values_id_fk" FOREIGN KEY ("cat3_value_id") REFERENCES "public"."category_values"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_cat4_value_id_category_values_id_fk" FOREIGN KEY ("cat4_value_id") REFERENCES "public"."category_values"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_cat1_value_id_category_values_id_fk" FOREIGN KEY ("cat1_value_id") REFERENCES "public"."category_values"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_cat2_value_id_category_values_id_fk" FOREIGN KEY ("cat2_value_id") REFERENCES "public"."category_values"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_cat3_value_id_category_values_id_fk" FOREIGN KEY ("cat3_value_id") REFERENCES "public"."category_values"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_cat4_value_id_category_values_id_fk" FOREIGN KEY ("cat4_value_id") REFERENCES "public"."category_values"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_table_record_idx" ON "audit_log" USING btree ("table_name","record_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "category_values_slot_value_uq" ON "category_values" USING btree ("slot",lower("value"));--> statement-breakpoint
CREATE UNIQUE INDEX "grn_charges_grn_type_uq" ON "grn_charges" USING btree ("grn_id","charge_type");--> statement-breakpoint
CREATE UNIQUE INDEX "grn_header_supplier_invoice_uq" ON "grn_header" USING btree ("supplier_id",upper(trim("invoice_no"))) WHERE "grn_header"."status" <> 'CANCELLED';--> statement-breakpoint
CREATE INDEX "grn_header_grn_date_idx" ON "grn_header" USING btree ("grn_date");--> statement-breakpoint
CREATE INDEX "grn_header_supplier_idx" ON "grn_header" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "grn_header_location_idx" ON "grn_header" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "grn_header_status_idx" ON "grn_header" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "grn_lines_grn_line_uq" ON "grn_lines" USING btree ("grn_id","line_no");--> statement-breakpoint
CREATE INDEX "grn_lines_product_idx" ON "grn_lines" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_uq" ON "products" USING btree ("department_id",lower("item_name"),coalesce("cat1_value_id", 0),coalesce("cat2_value_id", 0),coalesce("cat3_value_id", 0),coalesce("cat4_value_id", 0),"mrp");--> statement-breakpoint
CREATE INDEX "products_department_idx" ON "products" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "stock_ledger_product_location_idx" ON "stock_ledger" USING btree ("product_id","location_id");--> statement-breakpoint
CREATE INDEX "stock_ledger_ref_idx" ON "stock_ledger" USING btree ("ref_doc_type","ref_doc_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_gstin_uq" ON "suppliers" USING btree ("gstin") WHERE "suppliers"."gstin" is not null;--> statement-breakpoint
CREATE INDEX "suppliers_name_idx" ON "suppliers" USING btree ("name");