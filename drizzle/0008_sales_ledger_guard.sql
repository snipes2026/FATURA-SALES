-- Hand-written migration: things drizzle-kit does not generate.

-- Customer search by name (billing screen customer picker).
CREATE INDEX IF NOT EXISTS "customers_name_trgm_idx" ON "customers" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint

-- customer_ledger is append-only. The only exception is the OPENING row of a customer
-- who has no other entries yet (opening balance edited / unused customer deleted).
CREATE OR REPLACE FUNCTION customer_ledger_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.voucher_type = 'OPENING' AND NOT EXISTS (
    SELECT 1 FROM customer_ledger WHERE customer_id = OLD.customer_id AND voucher_type <> 'OPENING'
  ) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'customer_ledger is append-only (post a reversing entry instead)' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS customer_ledger_append_only ON customer_ledger;
--> statement-breakpoint
CREATE TRIGGER customer_ledger_append_only
  BEFORE UPDATE OR DELETE ON customer_ledger
  FOR EACH ROW EXECUTE FUNCTION customer_ledger_guard();
--> statement-breakpoint

-- Sales settings row always exists.
INSERT INTO "sales_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;
