ALTER TABLE "grn_charges" DROP COLUMN "gst_applicable";--> statement-breakpoint
ALTER TABLE "grn_charges" DROP COLUMN "gst_rate";--> statement-breakpoint
ALTER TABLE "grn_charges" DROP COLUMN "gst_amount";--> statement-breakpoint
ALTER TABLE "grn_header" DROP COLUMN "charges_gst_amount";