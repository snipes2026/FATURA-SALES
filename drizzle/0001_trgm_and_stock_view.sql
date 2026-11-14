-- Hand-written migration: things drizzle-kit does not generate.

-- Trigram search for item-name autocomplete.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_item_name_trgm_idx" ON "products" USING gin ("item_name" gin_trgm_ops);
--> statement-breakpoint

-- Current stock per product per location (materialize later if needed).
CREATE OR REPLACE VIEW "current_stock" AS
SELECT
  sl.product_id,
  sl.location_id,
  SUM(sl.qty_in - sl.qty_out)::integer AS qty
FROM "stock_ledger" sl
GROUP BY sl.product_id, sl.location_id;
