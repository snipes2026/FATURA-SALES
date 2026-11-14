DROP INDEX "grn_lines_product_idx";--> statement-breakpoint
DROP INDEX "products_sku_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "grn_lines_product_uq" ON "grn_lines" USING btree ("product_id") WHERE "grn_lines"."product_id" is not null;