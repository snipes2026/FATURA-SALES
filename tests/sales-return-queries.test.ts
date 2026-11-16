/**
 * Sales Return screen queries: the customer's bills, bill lines with qty already
 * returned, and per product the qty sold / returned and the last rate billed —
 * all ignoring cancelled bills and returns.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { runMigrations, seedBasics, startTestDb } from "./helpers/test-db";

let stop: () => Promise<void>;
let c: pg.Client;
let ids: Awaited<ReturnType<typeof seedBasics>>;
let q: typeof import("../src/app/(app)/sales-returns/_lib/queries");
let app: { db: typeof import("../src/db").db; pool: typeof import("../src/db").pool };
let p1: number;
let p2: number;
let cust: number;
let other: number;
let seq = 0;

const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];

async function bill(customerId: number, date: string, lines: [productId: number, qty: number, rate: number][], status = "SAVED") {
  const net = lines.reduce((a, [, qty, rate]) => a + qty * rate, 0);
  const h = await one(
    `insert into sales_header (bill_no, fy, bill_date, customer_id, location_id, customer_name, customer_state_code, gst_mode, tax_type, total_qty, gross, taxable, gst_amount, net_amount, status, cancel_reason, created_by)
     values ($1,'26-27',$2,$3,$4,'X','27','INCLUDES','INTRA',1,$5,$5,0,$5,$6,$7,$8) returning id`,
    [`INV/26-27/${String(++seq).padStart(4, "0")}`, date, customerId, ids.locationId, net, status, status === "CANCELLED" ? "x" : null, ids.userId],
  );
  const lineIds: number[] = [];
  for (const [i, [productId, qty, rate]] of lines.entries())
    lineIds.push(
      (
        await one(
          `insert into sales_lines (sales_id, line_no, product_id, barcode, item_name, hsn_code, gst_rate, qty, rate, amount, taxable, gst_amount)
           values ($1,$2,$3,'B','Item','6205',5,$4,$5,$6,$6,0) returning id`,
          [h.id, i + 1, productId, qty, rate, qty * rate],
        )
      ).id,
    );
  return { id: h.id as number, lineIds };
}

async function ret(customerId: number, lines: [productId: number, qty: number, originalLineId: number | null][], status = "SAVED") {
  const h = await one(
    `insert into sales_return_header (return_no, fy, return_date, customer_id, location_id, customer_name, customer_state_code, gst_mode, tax_type, total_qty, gross, taxable, gst_amount, net_amount, advance_created, status, cancel_reason, created_by)
     values ($1,'26-27','2026-09-01',$2,$3,'X','27','INCLUDES','INTRA',1,100,100,0,100,100,$4,$5,$6) returning id`,
    [`SR/26-27/${String(++seq).padStart(4, "0")}`, customerId, ids.locationId, status, status === "CANCELLED" ? "x" : null, ids.userId],
  );
  for (const [i, [productId, qty, orig]] of lines.entries())
    await c.query(
      `insert into sales_return_lines (return_id, line_no, product_id, original_sales_line_id, barcode, item_name, hsn_code, gst_rate, qty, rate, amount, taxable, gst_amount)
       values ($1,$2,$3,$4,'B','Item','6205',5,$5,100,100,100,0)`,
      [h.id, i + 1, productId, orig, qty],
    );
}

before(async () => {
  const t = await startTestDb();
  stop = t.stop;
  await runMigrations(t.url);
  ids = await seedBasics(t.url);
  process.env.DATABASE_URL = t.url;
  process.env.DB_POOL_MAX = "1";
  const dbm = await import("../src/db");
  app = { db: dbm.db, pool: dbm.pool };
  q = await import("../src/app/(app)/sales-returns/_lib/queries");
  c = new pg.Client(t.url);
  await c.connect();
  const prod = async (b: string) => (await one(`insert into products (department_id, item_name, barcode, purchase_rate, wsp, mrp) values ($1,$2,$2,100,200,399) returning id`, [ids.deptId, b])).id as number;
  p1 = await prod("Q000001");
  p2 = await prod("Q000002");
  const cu = async (n: string) => (await one(`insert into customers (name, phone, state_code, opening_date) values ($1,'9','27','2026-04-01') returning id`, [n])).id as number;
  cust = await cu("Buyer");
  other = await cu("Someone else");
});

after(async () => {
  await c.end();
  await app.pool.end();
  await stop();
});

describe("sales return queries", () => {
  it("sold / returned / last rate per product, for this customer only, ignoring cancelled documents", async () => {
    const b1 = await bill(cust, "2026-05-01", [
      [p1, 10, 180],
      [p2, 2, 500],
    ]);
    await bill(cust, "2026-06-01", [[p1, 14, 175]]); // later bill → last rate 175
    await bill(cust, "2026-07-01", [[p1, 5, 150]], "CANCELLED"); // ignored
    await bill(other, "2026-08-01", [[p1, 99, 99]]); // another customer
    await ret(cust, [[p1, 4, b1.lineIds[0]]]);
    await ret(cust, [[p1, 3, null]], "CANCELLED"); // ignored

    const h = await q.returnHints(app.db, cust, [p1, p2]);
    assert.deepEqual(h[p1], { sold: 24, returned: 4, lastRate: "175.00" });
    assert.deepEqual(h[p2], { sold: 2, returned: 0, lastRate: "500.00" });
    const none = await q.returnHints(app.db, other, [p2]);
    assert.deepEqual(none[p2], { sold: 0, returned: 0, lastRate: null });

    const lines = await q.billLines(app.db, b1.id);
    assert.deepEqual(
      lines.map((l) => [l.productId, l.qty, l.returned, l.rate]),
      [
        [p1, 10, 4, "180.00"],
        [p2, 2, 0, "500.00"],
      ],
    );
  });

  it("lists the customer's saved bills newest first, and finds them by bill number", async () => {
    const bills = await q.customerBills(app.db, cust);
    assert.deepEqual(
      bills.map((b) => b.billNo),
      ["INV/26-27/0002", "INV/26-27/0001"],
    );
    assert.deepEqual(
      (await q.customerBills(app.db, cust, "0001")).map((b) => b.billNo),
      ["INV/26-27/0001"],
    );
  });
});
