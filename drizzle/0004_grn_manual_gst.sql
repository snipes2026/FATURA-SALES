CREATE TYPE "public"."gst_mode" AS ENUM('PERCENT', 'AMOUNT');--> statement-breakpoint
DROP INDEX "grn_charges_grn_type_uq";--> statement-breakpoint
ALTER TABLE "grn_lines" ALTER COLUMN "gst_rate" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "grn_lines" ALTER COLUMN "cgst_amount" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "grn_lines" ALTER COLUMN "cgst_amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "grn_lines" ALTER COLUMN "sgst_amount" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "grn_lines" ALTER COLUMN "sgst_amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "grn_lines" ALTER COLUMN "igst_amount" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "grn_lines" ALTER COLUMN "igst_amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "grn_lines" ALTER COLUMN "gst_amount" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "grn_lines" ALTER COLUMN "gst_amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "grn_charges" ADD COLUMN "description" varchar(100);--> statement-breakpoint
ALTER TABLE "grn_charges" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "grn_header" ADD COLUMN "invoice_value" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "grn_header" ADD COLUMN "gst_mode" "gst_mode" DEFAULT 'PERCENT' NOT NULL;--> statement-breakpoint
ALTER TABLE "grn_header" ADD COLUMN "gst_input" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "grn_header" ADD COLUMN "gst_amount" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE INDEX "grn_charges_grn_idx" ON "grn_charges" USING btree ("grn_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Data move for GRNs created before GST became a single summary field.
-- Old header CGST/SGST/IGST already include the GST on freight/other charges,
-- and old charges_amount excludes it, so:
--   old net = taxable + (cgst+sgst+igst) + charges_amount + round_off
--   new net = taxable + gst_amount        + charges         + round_off   (same value)
-- ---------------------------------------------------------------------------
UPDATE "grn_header" SET "invoice_value" = "net_payable";--> statement-breakpoint
ALTER TABLE "grn_header" ALTER COLUMN "invoice_value" SET NOT NULL;--> statement-breakpoint
UPDATE "grn_header"
SET "gst_mode" = 'AMOUNT',
    "gst_amount" = "cgst_amount" + "sgst_amount" + "igst_amount",
    "gst_input" = "cgst_amount" + "sgst_amount" + "igst_amount";--> statement-breakpoint
UPDATE "grn_charges" SET "description" = 'Other charges' WHERE "charge_type" = 'OTHER' AND "description" IS NULL;